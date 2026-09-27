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

const BANCOS_CNPJ_BASICO = [
  '06271464', '33147315', '59438325', '60885092', '18289018', '29522734', '05720915', '07207996', '07392602', '05985805',
  '58947273', '60746948', '05720890', '05722187', '05721148', '22481903', '30988641', '25201474', '06153633', '05721487',
  '21014739', '21014738', '22867320', '18837696', '08133691', '17300349', '05719837', '05719852', '05719894', '05719898',
  '05719902', '05719940', '05719954', '05720355', '05720588', '05720589', '05720590', '05720591', '05720592', '05720593',
  '05720595', '05720596', '05720597', '05720598', '05722588', '05906382', '05981511', '06000725', '12636664', '00000000',
  '07857848', '07864800', '09393268', '90400888', '24096949', '12055147', '21242784', '06949832', '05706524', '05720902',
  '05721369', '05723460', '05720805', '61472676', '05706612', '05709843', '05710518', '05710821', '05903821', '05720715',
  '05614592', '05837233', '05714207', '45686953', '05993503', '06166712', '05489136', '08263186', '07129878', '05620563',
  '07018622', '05856030', '05985883', '05837234', '05489039', '06258426', '05985884', '07518132', '21233789', '60700556',
  '05939638', '07718259', '21233790', '07790917', '21233791', '10341411', '11350687', '23479420', '53096700', '33517640',
  '05721494', '05707616', '13429191', '07700444', '21242785', '53391015', '11227198', '21242786', '00360305', '07708145',
  '40430971', '31781135', '07221678', '60872504', '60701190', '07264921', '22048558', '22039863', '62357210', '07256532'
];

function prepararTabelaTemp(popularFn) {
  db.exec('DROP TABLE IF EXISTS temp_remocao');
  db.exec('CREATE TEMP TABLE temp_remocao (cnpj_basico TEXT PRIMARY KEY)');
  popularFn();
}

function executarRemocao(descricao) {
  const total = db.prepare('SELECT COUNT(*) as c FROM temp_remocao').get().c;
  log(`${descricao}: ${total} empresas-base identificadas para remoção.`);

  if (total === 0) {
    db.exec('DROP TABLE temp_remocao');
    return;
  }

  const tabelas = ['estabelecimentos', 'socios', 'simples', 'empresas'];
  for (const tabela of tabelas) {
    const r = db.prepare(`DELETE FROM ${tabela} WHERE cnpj_basico IN (SELECT cnpj_basico FROM temp_remocao)`).run();
    log(`  ${tabela}: ${r.changes} linha(s) removida(s)`);
    checkpoint();
  }

  db.exec('DROP TABLE temp_remocao');
}

log('Removendo bancos específicos (Banco do Brasil, Itaú Unibanco, Caixa, Bradesco, Santander)...');
prepararTabelaTemp(() => {
  const insertTemp = db.prepare('INSERT OR IGNORE INTO temp_remocao (cnpj_basico) VALUES (?)');
  db.exec('BEGIN');
  for (const cb of BANCOS_CNPJ_BASICO) insertTemp.run(cb);
  db.exec('COMMIT');
});
executarRemocao('Bancos específicos');

log('Removendo empresas com porte "DEMAIS" (código 05), em lotes retomáveis...');
const BATCH_SIZE = 300000;
let totalProcessado = 0;
while (true) {
  const lote = db.prepare("SELECT cnpj_basico FROM empresas WHERE porte = '05' LIMIT ?").all(BATCH_SIZE);
  if (lote.length === 0) break;

  db.exec('DROP TABLE IF EXISTS temp_lote');
  db.exec('CREATE TEMP TABLE temp_lote (cnpj_basico TEXT PRIMARY KEY)');
  const insertLote = db.prepare('INSERT INTO temp_lote (cnpj_basico) VALUES (?)');
  db.exec('BEGIN');
  for (const row of lote) insertLote.run(row.cnpj_basico);
  db.exec('COMMIT');

  for (const tabela of ['estabelecimentos', 'socios', 'simples', 'empresas']) {
    db.prepare(`DELETE FROM ${tabela} WHERE cnpj_basico IN (SELECT cnpj_basico FROM temp_lote)`).run();
  }
  db.exec('DROP TABLE temp_lote');
  checkpoint();

  totalProcessado += lote.length;
  log(`  progresso: ${totalProcessado} empresas processadas (porte DEMAIS)...`);
}
log(`Porte DEMAIS: ${totalProcessado} empresas removidas no total.`);

const totalFinal = db.prepare('SELECT COUNT(*) as c FROM estabelecimentos').get().c;
log(`Total de estabelecimentos restantes na base: ${totalFinal}`);

log('Concluído com sucesso.');
db.close();
