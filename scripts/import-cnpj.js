const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const path = require('node:path');
const fs = require('node:fs');
const unzipper = require('unzipper');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') out.dir = args[++i];
    else if (args[i] === '--periodo') out.periodo = args[++i];
  }
  return out;
}
const cli = parseArgs();

const SHARE_TOKEN = 'gn672Ad4CF8N6TK';
const PERIOD = cli.periodo || process.env.CNPJ_PERIODO || '2026-09';
const BASE_URL = `https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ/${PERIOD}`;
const AUTH_HEADER = 'Basic ' + Buffer.from(SHARE_TOKEN + ':').toString('base64');

const DB_PATH = path.join(__dirname, '..', 'data', 'cnpj.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const LOCAL_DOWNLOADS_DIR = cli.dir || process.env.CNPJ_DOWNLOADS_DIR || path.join(__dirname, '..', 'downloads');
fs.mkdirSync(LOCAL_DOWNLOADS_DIR, { recursive: true });

const BATCH_SIZE = 20000;
const MAX_ATTEMPTS = 6;

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -200000;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS empresas (
    cnpj_basico TEXT,
    razao_social TEXT,
    natureza_juridica TEXT,
    qualificacao_responsavel TEXT,
    capital_social REAL,
    porte TEXT,
    source_file TEXT
  );
  CREATE TABLE IF NOT EXISTS estabelecimentos (
    cnpj TEXT,
    cnpj_basico TEXT,
    nome_fantasia TEXT,
    situacao_cadastral TEXT,
    data_situacao_cadastral TEXT,
    data_inicio_atividade TEXT,
    cnae_fiscal_principal TEXT,
    cnae_fiscal_secundaria TEXT,
    tipo_logradouro TEXT,
    logradouro TEXT,
    numero TEXT,
    complemento TEXT,
    bairro TEXT,
    cep TEXT,
    uf TEXT,
    municipio TEXT,
    ddd1 TEXT,
    telefone1 TEXT,
    email TEXT,
    source_file TEXT
  );
  CREATE TABLE IF NOT EXISTS socios (
    cnpj_basico TEXT,
    nome_socio TEXT,
    qualificacao_socio TEXT,
    source_file TEXT
  );
  CREATE TABLE IF NOT EXISTS simples (
    cnpj_basico TEXT,
    opcao_simples TEXT,
    data_opcao_simples TEXT,
    data_exclusao_simples TEXT,
    opcao_mei TEXT,
    data_opcao_mei TEXT,
    data_exclusao_mei TEXT,
    source_file TEXT
  );
  CREATE TABLE IF NOT EXISTS ref_cnae (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE IF NOT EXISTS ref_natureza (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE IF NOT EXISTS ref_municipio (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE IF NOT EXISTS ref_pais (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE IF NOT EXISTS ref_qualificacao (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE IF NOT EXISTS ref_motivo (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE IF NOT EXISTS import_progress (file TEXT PRIMARY KEY, rows INTEGER, done INTEGER);
  CREATE TABLE IF NOT EXISTS metadata (chave TEXT PRIMARY KEY, valor TEXT);
`);

function getMetadata(chave) {
  const row = db.prepare('SELECT valor FROM metadata WHERE chave = ?').get(chave);
  return row ? row.valor : null;
}

function setMetadata(chave, valor) {
  db.prepare(`
    INSERT INTO metadata (chave, valor) VALUES (?, ?)
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor
  `).run(chave, valor);
}

const periodoAtual = getMetadata('periodo_atual');
if (periodoAtual && periodoAtual !== PERIOD) {
  console.log(`[${new Date().toISOString()}] Base atual é do período ${periodoAtual}, importando período novo (${PERIOD}). Limpando dados do período anterior...`);
  db.exec(`
    DELETE FROM estabelecimentos;
    DELETE FROM empresas;
    DELETE FROM socios;
    DELETE FROM simples;
    DELETE FROM ref_cnae;
    DELETE FROM ref_natureza;
    DELETE FROM ref_municipio;
    DELETE FROM ref_pais;
    DELETE FROM ref_qualificacao;
    DELETE FROM ref_motivo;
    DELETE FROM import_progress;
    DROP TABLE IF EXISTS empresas_fts;
  `);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  console.log(`[${new Date().toISOString()}] Dados do período anterior removidos.`);
}
setMetadata('periodo_atual', PERIOD);

function isDone(file) {
  const row = db.prepare('SELECT done FROM import_progress WHERE file = ?').get(file);
  return !!(row && row.done === 1);
}

function markDone(file, rows) {
  db.prepare(`
    INSERT INTO import_progress (file, rows, done) VALUES (?, ?, 1)
    ON CONFLICT(file) DO UPDATE SET rows = excluded.rows, done = 1
  `).run(file, rows);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

async function openEntryStream(filename) {
  const localPath = path.join(LOCAL_DOWNLOADS_DIR, filename);
  if (fs.existsSync(localPath)) {
    log(`usando arquivo local: ${localPath}`);
    const source = fs.createReadStream(localPath);
    const entry = source.pipe(unzipper.ParseOne());
    source.on('error', (err) => entry.destroy(err));
    return entry;
  }

  const url = `${BASE_URL}/${filename}`;
  const res = await fetch(url, { headers: { Authorization: AUTH_HEADER } });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ao baixar ${filename}`);
  }
  const source = Readable.fromWeb(res.body);
  const entry = source.pipe(unzipper.ParseOne());
  source.on('error', (err) => entry.destroy(err));
  return entry;
}

function parseCsvLine(rawLine) {
  let line = rawLine;
  if (line.endsWith('\r')) line = line.slice(0, -1);
  if (!line) return null;
  const inner = line.slice(1, -1);
  return inner.split('";"');
}

function toNumber(str) {
  if (!str) return null;
  const n = Number(String(str).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function field(fields, i) {
  const v = fields[i];
  return v === undefined || v === '' ? null : v;
}

let warnedBadLines = 0;

async function streamRows(filename, onLine) {
  const entryStream = await openEntryStream(filename);
  let leftover = '';
  let rowCount = 0;
  let skippedCount = 0;

  entryStream.on('data', (chunk) => {
    leftover += chunk.toString('latin1');
    let idx;
    while ((idx = leftover.indexOf('\n')) >= 0) {
      const line = leftover.slice(0, idx);
      leftover = leftover.slice(idx + 1);
      const fields = parseCsvLine(line);
      if (fields) {
        try {
          onLine(fields);
          rowCount++;
        } catch (err) {
          skippedCount++;
          if (warnedBadLines < 20) {
            warnedBadLines++;
            log(`  linha ignorada em ${filename} (${err.message}): ${line.slice(0, 200)}`);
          }
        }
      }
    }
  });

  await new Promise((resolve, reject) => {
    entryStream.on('end', resolve);
    entryStream.on('error', reject);
  });

  if (leftover.trim()) {
    const fields = parseCsvLine(leftover);
    if (fields) {
      try {
        onLine(fields);
        rowCount++;
      } catch (err) {
        skippedCount++;
      }
    }
  }

  if (skippedCount > 0) {
    log(`  ${filename}: ${skippedCount} linha(s) ignorada(s) por erro de dados`);
  }

  return rowCount;
}

const TABLES_WITH_SOURCE_FILE = new Set(['empresas', 'estabelecimentos', 'socios', 'simples']);

async function importWithRetry(filename, table, importFn) {
  if (isDone(filename)) {
    log(`pulando ${filename} (já importado)`);
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      log(`importando ${filename} (tentativa ${attempt}/${MAX_ATTEMPTS})`);
      if (TABLES_WITH_SOURCE_FILE.has(table)) {
        db.prepare(`DELETE FROM ${table} WHERE source_file = ?`).run(filename);
      } else {
        db.exec(`DELETE FROM ${table}`);
      }

      const rowCount = await importFn();

      markDone(filename, rowCount);
      log(`concluído ${filename}: ${rowCount} linhas`);

      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

      const localPath = path.join(LOCAL_DOWNLOADS_DIR, filename);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        log(`arquivo local removido: ${localPath}`);
      }

      return;
    } catch (err) {
      log(`erro em ${filename}: ${err.message}`);
      try { db.exec('ROLLBACK'); } catch { /* nenhuma transação aberta */ }
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Falha definitiva ao importar ${filename} após ${MAX_ATTEMPTS} tentativas: ${err.message}`);
      }
      const delay = 5000 * attempt;
      log(`aguardando ${delay}ms antes de tentar de novo...`);
      await sleep(delay);
    }
  }
}

async function importRefTable(filename, table) {
  await importWithRetry(filename, table, async () => {
    const stmt = db.prepare(`INSERT INTO ${table} (codigo, descricao) VALUES (?, ?)`);
    let batch = 0;
    db.exec('BEGIN');
    const rowCount = await streamRows(filename, (fields) => {
      if (!fields[0]) throw new Error('codigo ausente');
      stmt.run(fields[0], field(fields, 1));
      batch++;
      if (batch >= BATCH_SIZE) {
        db.exec('COMMIT');
        db.exec('BEGIN');
        batch = 0;
      }
    });
    db.exec('COMMIT');
    return rowCount;
  });
}

async function importEmpresas(filename) {
  await importWithRetry(filename, 'empresas', async () => {
    const stmt = db.prepare(`
      INSERT INTO empresas (cnpj_basico, razao_social, natureza_juridica, qualificacao_responsavel, capital_social, porte, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    let batch = 0;
    let total = 0;
    db.exec('BEGIN');
    const rowCount = await streamRows(filename, (f) => {
      stmt.run(field(f, 0), field(f, 1), field(f, 2), field(f, 3), toNumber(f[4]), field(f, 5), filename);
      batch++;
      total++;
      if (batch >= BATCH_SIZE) {
        db.exec('COMMIT');
        db.exec('BEGIN');
        batch = 0;
        if (total % 200000 === 0) log(`  ${filename}: ${total} linhas...`);
      }
    });
    db.exec('COMMIT');
    return rowCount;
  });
}

async function importEstabelecimentos(filename) {
  await importWithRetry(filename, 'estabelecimentos', async () => {
    const stmt = db.prepare(`
      INSERT INTO estabelecimentos (
        cnpj, cnpj_basico, nome_fantasia, situacao_cadastral, data_situacao_cadastral,
        data_inicio_atividade, cnae_fiscal_principal, cnae_fiscal_secundaria,
        tipo_logradouro, logradouro, numero, complemento, bairro, cep, uf, municipio,
        ddd1, telefone1, email, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let batch = 0;
    let total = 0;
    db.exec('BEGIN');
    const rowCount = await streamRows(filename, (f) => {
      if (!f[0] || !f[1] || !f[2]) {
        throw new Error('cnpj incompleto');
      }
      const cnpj = `${f[0]}${f[1]}${f[2]}`;
      stmt.run(
        cnpj, field(f, 0), field(f, 4), field(f, 5), field(f, 6), field(f, 10), field(f, 11), field(f, 12),
        field(f, 13), field(f, 14), field(f, 15), field(f, 16), field(f, 17), field(f, 18), field(f, 19), field(f, 20),
        field(f, 21), field(f, 22), field(f, 27), filename
      );
      batch++;
      total++;
      if (batch >= BATCH_SIZE) {
        db.exec('COMMIT');
        db.exec('BEGIN');
        batch = 0;
        if (total % 200000 === 0) log(`  ${filename}: ${total} linhas...`);
      }
    });
    db.exec('COMMIT');
    return rowCount;
  });
}

async function importSocios(filename) {
  await importWithRetry(filename, 'socios', async () => {
    const stmt = db.prepare(`
      INSERT INTO socios (cnpj_basico, nome_socio, qualificacao_socio, source_file)
      VALUES (?, ?, ?, ?)
    `);
    let batch = 0;
    let total = 0;
    db.exec('BEGIN');
    const rowCount = await streamRows(filename, (f) => {
      if (!f[0]) throw new Error('cnpj_basico ausente');
      stmt.run(f[0], field(f, 2), field(f, 4), filename);
      batch++;
      total++;
      if (batch >= BATCH_SIZE) {
        db.exec('COMMIT');
        db.exec('BEGIN');
        batch = 0;
        if (total % 200000 === 0) log(`  ${filename}: ${total} linhas...`);
      }
    });
    db.exec('COMMIT');
    return rowCount;
  });
}

async function importSimples(filename) {
  await importWithRetry(filename, 'simples', async () => {
    const stmt = db.prepare(`
      INSERT INTO simples (
        cnpj_basico, opcao_simples, data_opcao_simples, data_exclusao_simples,
        opcao_mei, data_opcao_mei, data_exclusao_mei, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let batch = 0;
    let total = 0;
    db.exec('BEGIN');
    const rowCount = await streamRows(filename, (f) => {
      if (!f[0]) throw new Error('cnpj_basico ausente');
      stmt.run(f[0], field(f, 1), field(f, 2), field(f, 3), field(f, 4), field(f, 5), field(f, 6), filename);
      batch++;
      total++;
      if (batch >= BATCH_SIZE) {
        db.exec('COMMIT');
        db.exec('BEGIN');
        batch = 0;
        if (total % 200000 === 0) log(`  ${filename}: ${total} linhas...`);
      }
    });
    db.exec('COMMIT');
    return rowCount;
  });
}

async function main() {
  log('Iniciando importação da base CNPJ da Receita Federal (' + PERIOD + ')');

  const refFiles = [
    ['Cnaes.zip', 'ref_cnae'],
    ['Naturezas.zip', 'ref_natureza'],
    ['Municipios.zip', 'ref_municipio'],
    ['Paises.zip', 'ref_pais'],
    ['Qualificacoes.zip', 'ref_qualificacao'],
    ['Motivos.zip', 'ref_motivo'],
  ];
  for (const [file, table] of refFiles) {
    await importRefTable(file, table);
  }

  for (let i = 0; i <= 9; i++) {
    await importEmpresas(`Empresas${i}.zip`);
  }

  for (let i = 0; i <= 9; i++) {
    await importEstabelecimentos(`Estabelecimentos${i}.zip`);
  }

  for (let i = 0; i <= 9; i++) {
    await importSocios(`Socios${i}.zip`);
  }

  await importSimples('Simples.zip');

  log('Limpando linhas com CNPJ inválido (lixo de parsing)...');
  const removed = db.prepare(`
    DELETE FROM estabelecimentos WHERE length(cnpj) != 14 OR cnpj GLOB '*[^0-9]*'
  `).run();
  log(`  ${removed.changes} linha(s) removida(s)`);

  log('Criando índices...');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_estab_cnpj ON estabelecimentos(cnpj);
    CREATE INDEX IF NOT EXISTS idx_estab_basico ON estabelecimentos(cnpj_basico);
    CREATE INDEX IF NOT EXISTS idx_empresas_basico ON empresas(cnpj_basico);
    CREATE INDEX IF NOT EXISTS idx_socios_basico ON socios(cnpj_basico);
    CREATE INDEX IF NOT EXISTS idx_simples_basico ON simples(cnpj_basico);
  `);

  log('Importação concluída com sucesso.');
  db.close();
}

main().catch((err) => {
  log('ERRO FATAL:', err.message);
  db.close();
  process.exit(1);
});
