const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', 'data', 'cnpj.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -200000;
`);

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function checkpoint() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
}

log('Criando índices de filtro (UF, município, CNAE principal)...');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_estab_uf_cnpj ON estabelecimentos(uf, cnpj);
  CREATE INDEX IF NOT EXISTS idx_estab_municipio_cnpj ON estabelecimentos(municipio, cnpj);
  CREATE INDEX IF NOT EXISTS idx_estab_cnae_cnpj ON estabelecimentos(cnae_fiscal_principal, cnpj);
`);
checkpoint();
log('Índices de filtro criados.');

log('Criando índice de busca textual (FTS5) sobre razão social...');
db.exec('DROP TABLE IF EXISTS empresas_fts;');
db.exec('CREATE VIRTUAL TABLE empresas_fts USING fts5(cnpj_basico UNINDEXED, razao_social);');

const insertStmt = db.prepare('INSERT INTO empresas_fts (cnpj_basico, razao_social) VALUES (?, ?)');
const selectStmt = db.prepare('SELECT cnpj_basico, razao_social FROM empresas');

let count = 0;
let batch = 0;
db.exec('BEGIN');
for (const row of selectStmt.iterate()) {
  if (row.razao_social) {
    insertStmt.run(row.cnpj_basico, row.razao_social);
  }
  count++;
  batch++;
  if (batch >= 20000) {
    db.exec('COMMIT');
    db.exec('BEGIN');
    batch = 0;
    if (count % 1000000 === 0) log(`  ${count} empresas indexadas...`);
  }
}
db.exec('COMMIT');
checkpoint();
log(`Índice de busca textual criado com ${count} empresas.`);

log('Concluído com sucesso.');
db.close();
