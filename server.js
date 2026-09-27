const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Corpo da requisição inválido.' });
  }
  next(err);
});
app.use(express.static(path.join(__dirname, 'public')));

require('./modules/consulta/routes')(app);
require('./modules/propostas/routes')(app);

app.listen(PORT, () => {
  console.log(`Seika Sistema rodando em http://localhost:${PORT}`);
});
