const express = require('express');
const session = require('express-session');
const path = require('path');
const { requireAuth, requirePermission } = require('./modules/auth/middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Corpo da requisição inválido.' });
  }
  next(err);
});

app.use(session({
  name: 'seika.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-isto',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

require('./modules/auth/routes')(app);
app.use(requireAuth);
app.use('/propostas', requirePermission('propostas.acessar'));
app.use(['/gerar', '/gerar-simples'], requirePermission('propostas.acessar'));
app.use('/consulta/admin.html', requirePermission('consulta.admin'));
app.use(express.static(path.join(__dirname, 'public')));

require('./modules/consulta/routes')(app);
require('./modules/propostas/routes')(app);

app.listen(PORT, () => {
  console.log(`Seika Sistema rodando em http://localhost:${PORT}`);
});
