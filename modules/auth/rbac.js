// Definição central dos papéis (roles) e permissões do sistema.
// Para dar um novo nível de acesso a alguém: adicione o papel aqui (se ainda
// não existir) e mapeie o e-mail da pessoa em modules/auth/usuarios.json.

const ROLES = {
  // Login local de administrador sempre recebe este papel.
  admin: {
    label: 'Administrador',
    permissoes: {
      consulta: { acessar: true, baseCompleta: true, admin: true, restricoes: null },
      propostas: { acessar: true }
    }
  },

  // Papel padrão de qualquer conta @dominio que fizer login pelo Google e
  // não estiver listada em usuarios.json.
  equipe: {
    label: 'Equipe',
    permissoes: {
      consulta: { acessar: true, baseCompleta: true, admin: false, restricoes: null },
      propostas: { acessar: true }
    }
  },

  // Papel da Ingrid: consulta de CNPJ restrita (apenas empresas de Belo
  // Horizonte, ativas, da área de saúde), sem acesso a Propostas.
  consulta_saude_bh: {
    label: 'Consulta — Saúde BH',
    permissoes: {
      consulta: {
        acessar: true,
        baseCompleta: true,
        admin: false,
        restricoes: {
          municipios: ['BELO HORIZONTE'],
          situacoes: ['ATIVA'],
          cnaePrefixos: ['86', '87', '88'], // CNAE seção Q — saúde humana e serviços sociais
          colunasLista: ['cnpj', 'razaoSocial'],
          ocultarCapitalSocial: true,
          sociosSomenteAdministrador: true
        }
      },
      propostas: { acessar: false }
    }
  }
};

const ROLE_PADRAO = 'equipe';

function getRoleDef(roleName) {
  return ROLES[roleName] || ROLES[ROLE_PADRAO];
}

function temPermissao(user, caminho) {
  if (!user) return false;
  const roleDef = getRoleDef(user.role);
  const partes = caminho.split('.');
  let node = roleDef.permissoes;
  for (const parte of partes) {
    if (!node) return false;
    node = node[parte];
  }
  return !!node;
}

function obterRestricoesConsulta(user) {
  if (!user) return null;
  return getRoleDef(user.role).permissoes?.consulta?.restricoes || null;
}

module.exports = { ROLES, ROLE_PADRAO, getRoleDef, temPermissao, obterRestricoesConsulta };
