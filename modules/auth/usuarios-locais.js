// Contas de login local (usuário/senha), pra quem ainda não tem e-mail
// corporativo pra usar o login com Google. Sem tela de cadastro — edição
// manual deste JSON pelo admin do sistema (gere o hash da senha com
// scripts/gerar-hash-senha.js).

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'usuarios-locais.json');

function carregarUsuarios() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return [];
  }
}

function encontrarUsuario(usuario) {
  const usuarios = carregarUsuarios();
  return usuarios.find(u => u.usuario === String(usuario || '').toLowerCase()) || null;
}

module.exports = { carregarUsuarios, encontrarUsuario };
