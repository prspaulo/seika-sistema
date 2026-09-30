const { temPermissao } = require('./rbac');

const PUBLIC_PATHS = new Set(['/login.html', '/sem-acesso.html', '/favicon.ico']);

function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/assets/')) {
    return next();
  }

  if (req.session && req.session.user) {
    return next();
  }

  const isApi = req.path.startsWith('/api/') || req.path === '/gerar' || req.path === '/gerar-simples';
  if (isApi) {
    return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  }

  return res.redirect('/login.html?next=' + encodeURIComponent(req.originalUrl));
}

function requirePermission(caminho) {
  return function (req, res, next) {
    if (temPermissao(req.session && req.session.user, caminho)) {
      return next();
    }

    const isApi = req.path.startsWith('/api/') || req.path === '/gerar' || req.path === '/gerar-simples';
    if (isApi) {
      return res.status(403).json({ erro: 'Você não tem permissão para acessar este recurso.' });
    }

    return res.redirect('/sem-acesso.html');
  };
}

module.exports = { requireAuth, requirePermission, PUBLIC_PATHS };
