const { execFileSync } = require('node:child_process');
const path = require('node:path');

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

if (!cli.dir) {
  console.error('Uso: node scripts/atualizar-base.js --dir "<pasta com os .zip baixados>" [--periodo AAAA-MM]');
  console.error('Exemplo: node scripts/atualizar-base.js --dir "C:\\Users\\paulo\\Downloads\\cnpj-2026-10" --periodo 2026-10');
  process.exit(1);
}

function log(...args) {
  console.log(`\n[atualizar-base ${new Date().toISOString()}]`, ...args);
}

function rodar(script, extraArgs = []) {
  log(`Executando ${script}...`);
  execFileSync(process.execPath, [path.join(__dirname, script), ...extraArgs], { stdio: 'inherit' });
}

const importArgs = ['--dir', cli.dir];
if (cli.periodo) importArgs.push('--periodo', cli.periodo);

log('Etapa 1/3: importação dos arquivos da Receita Federal');
rodar('import-cnpj.js', importArgs);

log('Etapa 2/3: construção dos índices de busca (UF, município, texto)');
rodar('build-search-index.js');

log('Etapa 3/3: remoção de bancos específicos e empresas de porte DEMAIS');
rodar('remove-entities.js');

log('Atualização completa concluída com sucesso.');
