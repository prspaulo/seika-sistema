// Gera a Proposta de Serviços Contábeis (PDF) a partir de um template HTML + dados do cliente.
//
// Uso:
//   node generate.js data/jefferson.json
//   node generate.js data/jefferson.json output/proposta-jefferson.pdf
//
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { fillTemplate, readTemplate } = require("./modules/propostas/lib/proposta");

async function main() {
  const dataPath = process.argv[2];
  if (!dataPath) {
    console.error("Uso: node generate.js <caminho-para-dados.json> [saida.pdf]");
    process.exit(1);
  }

  const html = readTemplate();
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  const filled = fillTemplate(html, data);

  const baseName = path.basename(dataPath, path.extname(dataPath));
  const outPath = process.argv[3] || path.join(__dirname, "output", `proposta-${baseName}.pdf`);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(filled, { waitUntil: "networkidle0" });
  await page.pdf({
    path: outPath,
    width: "1280px",
    height: "905px",
    printBackground: true,
    pageRanges: "",
  });
  await browser.close();

  console.log(`Proposta gerada: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
