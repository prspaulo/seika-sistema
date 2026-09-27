const puppeteer = require('puppeteer');
const { fillTemplate, readTemplate } = require('./lib/proposta');

function slugify(text) {
  return (text || 'proposta')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'proposta';
}

async function gerarPdf(templateName, dados) {
  const html = readTemplate(templateName);
  const filled = fillTemplate(html, dados);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(filled, { waitUntil: 'networkidle0' });
  const pdfBuffer = Buffer.from(
    await page.pdf({
      width: '1280px',
      height: '905px',
      printBackground: true,
      pageRanges: '',
    })
  );
  await browser.close();
  return pdfBuffer;
}

function enviarPdf(res, pdfBuffer, fileName) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.end(pdfBuffer);
}

module.exports = function registerPropostasRoutes(app) {
  app.post('/gerar', async (req, res) => {
    try {
      const pdfBuffer = await gerarPdf('proposta.html', req.body);
      enviarPdf(res, pdfBuffer, `proposta-${slugify(req.body.cliente_nome)}.pdf`);
    } catch (err) {
      console.error(err);
      res.status(500).send('Erro ao gerar o PDF. Veja o console do servidor para detalhes.');
    }
  });

  app.post('/gerar-simples', async (req, res) => {
    try {
      const pdfBuffer = await gerarPdf('proposta-simples.html', req.body);
      enviarPdf(res, pdfBuffer, `proposta-simples-${slugify(req.body.cliente_nome)}.pdf`);
    } catch (err) {
      console.error(err);
      res.status(500).send('Erro ao gerar o PDF. Veja o console do servidor para detalhes.');
    }
  });
};
