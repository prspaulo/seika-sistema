const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { obterRole } = require('./usuarios');
const { encontrarUsuario } = require('./usuarios-locais');
const { getRoleDef } = require('./rbac');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'seikacontabilidade.com.br').toLowerCase();

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const MAX_TENTATIVAS = 5;
const JANELA_BLOQUEIO_MS = 15 * 60 * 1000;
const tentativasLogin = new Map();

function podeTentar(chave) {
  const registro = tentativasLogin.get(chave);
  if (!registro) return true;
  if (registro.expiraEm < Date.now()) {
    tentativasLogin.delete(chave);
    return true;
  }
  return registro.count < MAX_TENTATIVAS;
}

function registrarFalha(chave) {
  const agora = Date.now();
  const registro = tentativasLogin.get(chave);
  if (!registro || registro.expiraEm < agora) {
    tentativasLogin.set(chave, { count: 1, expiraEm: agora + JANELA_BLOQUEIO_MS });
  } else {
    registro.count += 1;
  }
}

function limparTentativas(chave) {
  tentativasLogin.delete(chave);
}

function verificarSenha(senha, armazenado) {
  if (!armazenado || !armazenado.includes(':')) return false;
  const [salt, hashHex] = armazenado.split(':');
  try {
    const hash = crypto.scryptSync(senha, salt, 64);
    const hashArmazenado = Buffer.from(hashHex, 'hex');
    if (hash.length !== hashArmazenado.length) return false;
    return crypto.timingSafeEqual(hash, hashArmazenado);
  } catch {
    return false;
  }
}

module.exports = function registerAuthRoutes(app) {
  app.get('/auth/config', (req, res) => {
    res.json({ googleClientId: GOOGLE_CLIENT_ID, allowedDomain: ALLOWED_EMAIL_DOMAIN });
  });

  app.get('/auth/me', (req, res) => {
    if (!req.session.user) {
      return res.json({ user: null });
    }
    const permissoes = getRoleDef(req.session.user.role).permissoes;
    res.json({ user: { ...req.session.user, permissoes } });
  });

  app.post('/auth/google', async (req, res) => {
    if (!googleClient) {
      return res.status(503).json({ erro: 'Login com Google não configurado no servidor.' });
    }

    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ erro: 'Credencial do Google ausente.' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ erro: 'Não foi possível validar o login do Google.' });
    }

    const email = String(payload.email || '').toLowerCase();
    const dominio = email.split('@')[1] || '';

    if (!payload.email_verified || dominio !== ALLOWED_EMAIL_DOMAIN) {
      return res.status(403).json({ erro: `Apenas contas @${ALLOWED_EMAIL_DOMAIN} podem acessar este sistema.` });
    }

    req.session.user = {
      email,
      name: payload.name || email,
      picture: payload.picture || null,
      provider: 'google',
      role: obterRole(email)
    };

    res.json({ ok: true, user: req.session.user });
  });

  app.post('/auth/login-local', (req, res) => {
    const { usuario, senha } = req.body || {};
    const chave = req.ip + ':' + (usuario || '');

    if (!podeTentar(chave)) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' });
    }

    const registro = encontrarUsuario(usuario);
    const valido = registro && verificarSenha(String(senha || ''), registro.senhaHash);

    if (!valido) {
      registrarFalha(chave);
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }

    limparTentativas(chave);
    req.session.user = {
      email: registro.usuario,
      name: registro.nome || registro.usuario,
      provider: 'local',
      role: registro.role
    };
    res.json({ ok: true, user: req.session.user });
  });

  app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('seika.sid');
      res.json({ ok: true });
    });
  });

  if (!GOOGLE_CLIENT_ID) {
    console.log('Aviso: GOOGLE_CLIENT_ID não definido — login com Google desabilitado (apenas login local funcionará).');
  }
};
