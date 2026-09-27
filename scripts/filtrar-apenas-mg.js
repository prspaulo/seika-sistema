const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SRC_PATH = path.join(DATA_DIR, 'cnpj.db');
const NEW_PATH = path.join(DATA_DIR, 'cnpj_mg_new.db');
const SRC_PATH_SQL = SRC_PATH.split(path.sep).join('/');

const UF = 'MG';

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

for (const ext of ['', '-wal', '-shm']) {
  const p = NEW_PATH + ext;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const db = new DatabaseSync(NEW_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = OFF;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -400000;
`);

log(`Anexando base original: ${SRC_PATH_SQL}`);
db.exec(`ATTACH DATABASE '${SRC_PATH_SQL}' AS src`);

log('Criando schema da nova base...');
db.exec(`
  CREATE TABLE empresas (
    cnpj_basico TEXT,
    razao_social TEXT,
    natureza_juridica TEXT,
    qualificacao_responsavel TEXT,
    capital_social REAL,
    porte TEXT,
    source_file TEXT
  );
  CREATE TABLE estabelecimentos (
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
  CREATE TABLE socios (
    cnpj_basico TEXT,
    nome_socio TEXT,
    qualificacao_socio TEXT,
    source_file TEXT
  );
  CREATE TABLE simples (
    cnpj_basico TEXT,
    opcao_simples TEXT,
    data_opcao_simples TEXT,
    data_exclusao_simples TEXT,
    opcao_mei TEXT,
    data_opcao_mei TEXT,
    data_exclusao_mei TEXT,
    source_file TEXT
  );
  CREATE TABLE ref_cnae (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE ref_natureza (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE ref_municipio (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE ref_pais (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE ref_qualificacao (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE ref_motivo (codigo TEXT PRIMARY KEY, descricao TEXT);
  CREATE TABLE import_progress (file TEXT PRIMARY KEY, rows INTEGER, done INTEGER);
  CREATE TABLE metadata (chave TEXT PRIMARY KEY, valor TEXT);
`);

log(`Copiando estabelecimentos com uf = ${UF}...`);
let r = db.prepare(`INSERT INTO estabelecimentos SELECT * FROM src.estabelecimentos WHERE uf = ?`).run(UF);
log(`  ${r.changes} linha(s) copiada(s).`);

log('Criando índice temporário para filtragem por cnpj_basico...');
db.exec('CREATE INDEX tmp_idx_estab_basico ON estabelecimentos(cnpj_basico)');

log('Copiando empresas...');
r = db.prepare(`INSERT INTO empresas SELECT * FROM src.empresas WHERE cnpj_basico IN (SELECT cnpj_basico FROM estabelecimentos)`).run();
log(`  ${r.changes} linha(s) copiada(s).`);

log('Copiando socios...');
r = db.prepare(`INSERT INTO socios SELECT * FROM src.socios WHERE cnpj_basico IN (SELECT cnpj_basico FROM estabelecimentos)`).run();
log(`  ${r.changes} linha(s) copiada(s).`);

log('Copiando simples...');
r = db.prepare(`INSERT INTO simples SELECT * FROM src.simples WHERE cnpj_basico IN (SELECT cnpj_basico FROM estabelecimentos)`).run();
log(`  ${r.changes} linha(s) copiada(s).`);

log('Copiando tabelas de referência (sem filtro)...');
for (const t of ['ref_cnae', 'ref_natureza', 'ref_municipio', 'ref_pais', 'ref_qualificacao', 'ref_motivo', 'import_progress', 'metadata']) {
  db.exec(`INSERT INTO ${t} SELECT * FROM src.${t}`);
}

log('Desanexando base original...');
db.exec('DETACH DATABASE src');

log('Criando índices finais...');
db.exec(`
  DROP INDEX IF EXISTS tmp_idx_estab_basico;
  CREATE UNIQUE INDEX idx_estab_cnpj ON estabelecimentos(cnpj);
  CREATE INDEX idx_estab_basico ON estabelecimentos(cnpj_basico);
  CREATE INDEX idx_estab_uf_cnpj ON estabelecimentos(uf, cnpj);
  CREATE INDEX idx_estab_municipio_cnpj ON estabelecimentos(municipio, cnpj);
  CREATE INDEX idx_estab_cnae_cnpj ON estabelecimentos(cnae_fiscal_principal, cnpj);
  CREATE INDEX idx_empresas_basico ON empresas(cnpj_basico);
  CREATE INDEX idx_socios_basico ON socios(cnpj_basico);
  CREATE INDEX idx_simples_basico ON simples(cnpj_basico);
`);

log('Criando índice de busca textual (FTS5) sobre razão social...');
db.exec('CREATE VIRTUAL TABLE empresas_fts USING fts5(cnpj_basico UNINDEXED, razao_social);');
const insertFts = db.prepare('INSERT INTO empresas_fts (cnpj_basico, razao_social) VALUES (?, ?)');
const selectAll = db.prepare('SELECT cnpj_basico, razao_social FROM empresas');
let count = 0;
let batch = 0;
db.exec('BEGIN');
for (const row of selectAll.iterate()) {
  if (row.razao_social) {
    insertFts.run(row.cnpj_basico, row.razao_social);
  }
  count++;
  batch++;
  if (batch >= 20000) {
    db.exec('COMMIT');
    db.exec('BEGIN');
    batch = 0;
  }
}
db.exec('COMMIT');
log(`  índice de busca criado com ${count} empresas.`);

log('Verificação final da nova base:');
for (const tabela of ['estabelecimentos', 'empresas', 'socios', 'simples']) {
  const c = db.prepare(`SELECT COUNT(*) c FROM ${tabela}`).get().c;
  log(`  ${tabela}: ${c} linha(s)`);
}
const ufsDiferentes = db.prepare(`SELECT COUNT(DISTINCT uf) c FROM estabelecimentos WHERE uf != ?`).get(UF).c;
log(`  estabelecimentos com uf diferente de ${UF}: ${ufsDiferentes} (esperado: 0)`);

log('Finalizando checkpoint...');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

const stat = fs.statSync(NEW_PATH);
log(`Novo arquivo de banco criado em ${NEW_PATH} (${(stat.size / (1024 * 1024 * 1024)).toFixed(2)} GB).`);
log('Concluído com sucesso. O arquivo original (cnpj.db) NÃO foi modificado/substituído ainda.');
