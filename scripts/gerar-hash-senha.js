const crypto = require('crypto');

const senha = process.argv[2];
if (!senha) {
  console.error('Uso: node scripts/gerar-hash-senha.js <senha>');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
console.log(`${salt}:${hash}`);
