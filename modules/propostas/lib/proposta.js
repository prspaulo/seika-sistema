const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.join(__dirname, "..", "..", "..", "templates");
const TEMPLATE_PATH = path.join(TEMPLATES_DIR, "proposta.html");

const DEFAULTS = {
  contador_nome: "Milton Sacchetto de Araújo",
  contador_crc: "CRC MG 125636/O",
  seika_telefone: "(31) 99065-1514",
  seika_email: "seikacontabil@gmail.com",
};

function fillTemplate(html, data) {
  const merged = { ...DEFAULTS, ...data };
  return html.replace(/{{\s*([\w]+)\s*}}/g, (match, key) => {
    if (!(key in merged) || merged[key] === undefined || merged[key] === null) {
      console.warn(`Aviso: campo "${key}" não encontrado nos dados, deixado em branco.`);
      return "";
    }
    return merged[key];
  });
}

function readTemplate(name = "proposta.html") {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");
}

module.exports = { DEFAULTS, fillTemplate, readTemplate, TEMPLATE_PATH, TEMPLATES_DIR };
