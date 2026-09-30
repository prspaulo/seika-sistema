// Mapeamento de e-mail (login Google) -> papel de acesso (RBAC).
// Edite modules/auth/usuarios.json para dar acesso a alguém — não existe
// tela de cadastro no sistema, isso é feito manualmente aqui pelo admin.
// Quem não estiver listado recebe o papel padrão "equipe" (acesso total,
// igual ao comportamento antes do RBAC).

const fs = require('fs');
const path = require('path');
const { ROLE_PADRAO } = require('./rbac');

const ARQUIVO = path.join(__dirname, 'usuarios.json');

function carregarMapa() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return {};
  }
}

function obterRole(email) {
  const mapa = carregarMapa();
  return mapa[String(email || '').toLowerCase()] || ROLE_PADRAO;
}

module.exports = { obterRole };
