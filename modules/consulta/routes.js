const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DB_PATH = path.join(ROOT_DIR, 'data', 'cnpj.db');

let localDb = null;
let refCnae = new Map();
let refNatureza = new Map();
let refMunicipio = new Map();
let refQualificacao = new Map();
let totalCnpjs = 0;

function loadRefMap(table) {
  const map = new Map();
  for (const row of localDb.prepare(`SELECT codigo, descricao FROM ${table}`).all()) {
    map.set(row.codigo, row.descricao);
  }
  return map;
}

if (fs.existsSync(DB_PATH)) {
  try {
    localDb = new DatabaseSync(DB_PATH, { readOnly: true });
    refCnae = loadRefMap('ref_cnae');
    refNatureza = loadRefMap('ref_natureza');
    refMunicipio = loadRefMap('ref_municipio');
    refQualificacao = loadRefMap('ref_qualificacao');
    totalCnpjs = localDb.prepare('SELECT COUNT(*) as c FROM estabelecimentos').get().c;
    console.log(`Base local de CNPJ carregada (${DB_PATH}) - ${totalCnpjs} CNPJs`);
  } catch (err) {
    console.warn('Não foi possível abrir a base local de CNPJ:', err.message);
    localDb = null;
  }
}

const SITUACAO_CADASTRAL = {
  '01': 'NULA',
  '02': 'ATIVA',
  '03': 'SUSPENSA',
  '04': 'INAPTA',
  '08': 'BAIXADA'
};

const PORTE_EMPRESA = {
  '00': 'NÃO INFORMADO',
  '01': 'MICRO EMPRESA',
  '03': 'EMPRESA DE PEQUENO PORTE',
  '05': 'DEMAIS'
};

function formatarData(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8 || yyyymmdd === '00000000') return null;
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}

function fetchFromLocalDatabase(cnpj) {
  if (!localDb) return null;

  const row = localDb.prepare(`
    SELECT e.*, emp.razao_social, emp.natureza_juridica, emp.porte, emp.capital_social
    FROM estabelecimentos e
    JOIN empresas emp ON emp.cnpj_basico = e.cnpj_basico
    WHERE e.cnpj = ?
  `).get(cnpj);

  if (!row) return null;

  const atividadesSecundarias = (row.cnae_fiscal_secundaria || '')
    .split(',')
    .map(c => c.trim())
    .filter(Boolean)
    .map(c => refCnae.get(c))
    .filter(Boolean);

  const socios = localDb.prepare(`
    SELECT nome_socio, qualificacao_socio FROM socios WHERE cnpj_basico = ?
  `).all(row.cnpj_basico).map(s => ({
    nome: s.nome_socio,
    qualificacao: refQualificacao.get(s.qualificacao_socio) || null
  }));

  const simplesRow = localDb.prepare(`
    SELECT * FROM simples WHERE cnpj_basico = ?
  `).get(row.cnpj_basico);

  const simples = {
    optanteSimples: simplesRow ? simplesRow.opcao_simples === 'S' : false,
    dataOpcaoSimples: simplesRow ? formatarData(simplesRow.data_opcao_simples) : null,
    dataExclusaoSimples: simplesRow ? formatarData(simplesRow.data_exclusao_simples) : null,
    optanteMei: simplesRow ? simplesRow.opcao_mei === 'S' : false,
    dataOpcaoMei: simplesRow ? formatarData(simplesRow.data_opcao_mei) : null,
    dataExclusaoMei: simplesRow ? formatarData(simplesRow.data_exclusao_mei) : null
  };

  return {
    fonte: 'Base local (Dados Abertos CNPJ - Receita Federal)',
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia || null,
    situacaoCadastral: SITUACAO_CADASTRAL[row.situacao_cadastral] || row.situacao_cadastral,
    dataSituacaoCadastral: formatarData(row.data_situacao_cadastral),
    dataAbertura: formatarData(row.data_inicio_atividade),
    naturezaJuridica: refNatureza.get(row.natureza_juridica) || null,
    porte: PORTE_EMPRESA[row.porte] || row.porte,
    capitalSocial: row.capital_social,
    atividadePrincipal: refCnae.get(row.cnae_fiscal_principal) || null,
    atividadesSecundarias,
    endereco: {
      logradouro: [row.tipo_logradouro, row.logradouro].filter(Boolean).join(' '),
      numero: row.numero,
      complemento: row.complemento,
      bairro: row.bairro,
      municipio: refMunicipio.get(row.municipio) || null,
      uf: row.uf,
      cep: row.cep
    },
    telefone: row.ddd1 && row.telefone1 ? `(${row.ddd1}) ${row.telefone1}` : null,
    email: row.email || null,
    socios,
    simples
  };
}

function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

function isValidCNPJ(cnpj) {
  cnpj = onlyDigits(cnpj);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calcCheckDigit = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base
      .split('')
      .reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const base = cnpj.slice(0, 12);
  const digit1 = calcCheckDigit(base);
  const digit2 = calcCheckDigit(base + digit1);

  return cnpj === base + String(digit1) + String(digit2);
}

function codigosMunicipioPorNome(termo) {
  const alvo = termo.toLowerCase();
  const codigos = [];
  for (const [codigo, nome] of refMunicipio) {
    if (nome.toLowerCase().includes(alvo)) codigos.push(codigo);
  }
  return codigos;
}

function codigosCnaePorTermo(termo) {
  const digits = onlyDigits(termo);
  const pareceCodigo = digits.length >= 2 && digits === termo.replace(/[.\-/\s]/g, '');

  if (pareceCodigo) {
    const codigos = [];
    for (const codigo of refCnae.keys()) {
      if (codigo.startsWith(digits)) codigos.push(codigo);
    }
    return codigos;
  }

  const alvo = termo.toLowerCase();
  const codigos = [];
  for (const [codigo, descricao] of refCnae) {
    if (descricao.toLowerCase().includes(alvo)) codigos.push(codigo);
  }
  return codigos;
}

function buildFtsQuery(q) {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map(termo => termo.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map(termo => `${termo}*`)
    .join(' ');
}

let searchIndexReady = false;
if (localDb) {
  try {
    searchIndexReady = !!localDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='empresas_fts'").get();
  } catch {
    searchIndexReady = false;
  }
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const MAX_LOG_LINHAS = 5000;

const atualizacaoEstado = {
  rodando: false,
  processo: null,
  logLinhas: [],
  inicio: null,
  fim: null,
  codigoSaida: null
};

const sseClients = new Set();

function adicionarLog(linha) {
  atualizacaoEstado.logLinhas.push(linha);
  if (atualizacaoEstado.logLinhas.length > MAX_LOG_LINHAS) {
    atualizacaoEstado.logLinhas.shift();
  }
  for (const res of sseClients) {
    res.write(`data: ${JSON.stringify(linha)}\n\n`);
  }
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ erro: 'Recurso administrativo desabilitado. Defina a variável de ambiente ADMIN_TOKEN no servidor para habilitar.' });
  }
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    return res.status(401).json({ erro: 'Token de administrador inválido.' });
  }
  next();
}

module.exports = function registerConsultaRoutes(app) {
  app.get('/api/cnpjs', (req, res) => {
    if (!localDb) {
      return res.status(503).json({ erro: 'Base local de CNPJ não disponível. Rode a importação primeiro.' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const after = req.query.after ? onlyDigits(req.query.after) : '';
    const uf = req.query.uf ? String(req.query.uf).toUpperCase().trim() : null;
    const municipioTermo = req.query.municipio ? String(req.query.municipio).trim() : null;
    const cnaeTermo = req.query.cnae ? String(req.query.cnae).trim() : null;
    const q = req.query.q ? String(req.query.q).trim() : null;

    const conditions = ['e.cnpj > ?'];
    const baseParams = [after];

    if (uf) {
      conditions.push('e.uf = ?');
      baseParams.push(uf);
    }

    if (municipioTermo) {
      const codigos = codigosMunicipioPorNome(municipioTermo);
      if (codigos.length === 0) {
        return res.json({ items: [], nextCursor: null, hasMore: false, total: totalCnpjs });
      }
      conditions.push(`e.municipio IN (${codigos.map(() => '?').join(',')})`);
      baseParams.push(...codigos);
    }

    if (cnaeTermo) {
      const codigos = codigosCnaePorTermo(cnaeTermo);
      if (codigos.length === 0) {
        return res.json({ items: [], nextCursor: null, hasMore: false, total: totalCnpjs });
      }
      conditions.push(`e.cnae_fiscal_principal IN (${codigos.map(() => '?').join(',')})`);
      baseParams.push(...codigos);
    }

    const selectCols = 'e.cnpj, e.situacao_cadastral, e.uf, e.municipio, emp.razao_social, e.nome_fantasia';
    let query;
    let params;

    const qDigits = q ? onlyDigits(q) : '';
    const pareceCnpj = q && qDigits.length >= 3 && qDigits === q.replace(/[.\-/\s]/g, '');

    if (q && pareceCnpj) {
      conditions.push('e.cnpj LIKE ?');
      baseParams.push(`${qDigits}%`);
      query = `
        SELECT ${selectCols}
        FROM estabelecimentos e
        JOIN empresas emp ON emp.cnpj_basico = e.cnpj_basico
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.cnpj ASC
        LIMIT ?
      `;
      params = [...baseParams, limit];
    } else if (q) {
      if (!searchIndexReady) {
        return res.status(503).json({ erro: 'Busca textual ainda não disponível. Rode scripts/build-search-index.js primeiro.' });
      }
      const ftsQuery = buildFtsQuery(q);
      if (!ftsQuery) {
        return res.json({ items: [], nextCursor: null, hasMore: false, total: totalCnpjs });
      }
      query = `
        SELECT ${selectCols}
        FROM empresas_fts
        JOIN empresas emp ON emp.cnpj_basico = empresas_fts.cnpj_basico
        JOIN estabelecimentos e ON e.cnpj_basico = empresas_fts.cnpj_basico
        WHERE empresas_fts MATCH ? AND ${conditions.join(' AND ')}
        ORDER BY e.cnpj ASC
        LIMIT ?
      `;
      params = [ftsQuery, ...baseParams, limit];
    } else {
      query = `
        SELECT ${selectCols}
        FROM estabelecimentos e
        JOIN empresas emp ON emp.cnpj_basico = e.cnpj_basico
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.cnpj ASC
        LIMIT ?
      `;
      params = [...baseParams, limit];
    }

    let rows;
    try {
      rows = localDb.prepare(query).all(...params);
    } catch (err) {
      return res.status(400).json({ erro: 'Busca inválida. Tente outro termo.' });
    }

    const items = rows.map(r => ({
      cnpj: r.cnpj,
      razaoSocial: r.razao_social,
      nomeFantasia: r.nome_fantasia || null,
      situacaoCadastral: SITUACAO_CADASTRAL[r.situacao_cadastral] || r.situacao_cadastral,
      uf: r.uf,
      municipio: refMunicipio.get(r.municipio) || null
    }));

    const nextCursor = items.length === limit ? items[items.length - 1].cnpj : null;

    res.json({
      items,
      nextCursor,
      hasMore: nextCursor !== null,
      total: totalCnpjs
    });
  });

  app.get('/api/cnaes', (req, res) => {
    if (!localDb) {
      return res.status(503).json({ erro: 'Base local de CNPJ não disponível. Rode a importação primeiro.' });
    }

    const items = [...refCnae.entries()]
      .map(([codigo, descricao]) => ({ codigo, descricao }))
      .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));

    res.json({ items });
  });

  app.get('/api/cnpj/:cnpj', (req, res) => {
    const cnpj = onlyDigits(req.params.cnpj);

    if (!isValidCNPJ(cnpj)) {
      return res.status(400).json({ erro: 'CNPJ inválido. Verifique o número digitado.' });
    }

    const localData = fetchFromLocalDatabase(cnpj);
    if (localData) {
      return res.json(localData);
    }

    return res.status(404).json({ erro: 'CNPJ não encontrado na base local.' });
  });

  app.get('/api/admin/status', requireAdmin, (req, res) => {
    res.json({
      rodando: atualizacaoEstado.rodando,
      inicio: atualizacaoEstado.inicio,
      fim: atualizacaoEstado.fim,
      codigoSaida: atualizacaoEstado.codigoSaida
    });
  });

  app.post('/api/admin/atualizar', requireAdmin, (req, res) => {
    if (atualizacaoEstado.rodando) {
      return res.status(409).json({ erro: 'Já existe uma atualização em andamento.' });
    }

    const { dir, periodo } = req.body || {};
    if (!dir || typeof dir !== 'string') {
      return res.status(400).json({ erro: 'Informe o caminho da pasta com os arquivos baixados.' });
    }
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return res.status(400).json({ erro: 'Pasta não encontrada no servidor. Confirme o caminho.' });
    }
    if (periodo && !/^\d{4}-\d{2}$/.test(periodo)) {
      return res.status(400).json({ erro: 'Período inválido. Use o formato AAAA-MM (ex: 2026-10).' });
    }

    const args = [path.join(ROOT_DIR, 'scripts', 'atualizar-base.js'), '--dir', dir];
    if (periodo) args.push('--periodo', periodo);

    atualizacaoEstado.rodando = true;
    atualizacaoEstado.logLinhas = [];
    atualizacaoEstado.inicio = new Date().toISOString();
    atualizacaoEstado.fim = null;
    atualizacaoEstado.codigoSaida = null;

    const processo = spawn(process.execPath, args, { cwd: ROOT_DIR });
    atualizacaoEstado.processo = processo;

    adicionarLog(`Iniciando atualização (pasta: ${dir}${periodo ? `, período: ${periodo}` : ''})...`);

    processo.stdout.on('data', (chunk) => {
      chunk.toString('utf8').split('\n').filter(Boolean).forEach(adicionarLog);
    });
    processo.stderr.on('data', (chunk) => {
      chunk.toString('utf8').split('\n').filter(Boolean).forEach(adicionarLog);
    });

    processo.on('close', (codigo) => {
      atualizacaoEstado.rodando = false;
      atualizacaoEstado.processo = null;
      atualizacaoEstado.fim = new Date().toISOString();
      atualizacaoEstado.codigoSaida = codigo;
      adicionarLog(codigo === 0 ? '--- Atualização concluída com sucesso ---' : `--- Atualização terminou com erro (código ${codigo}) ---`);
    });

    res.json({ ok: true });
  });

  app.get('/api/admin/atualizar/stream', (req, res) => {
    if (!ADMIN_TOKEN || req.query.token !== ADMIN_TOKEN) {
      return res.status(401).end();
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    for (const linha of atualizacaoEstado.logLinhas) {
      res.write(`data: ${JSON.stringify(linha)}\n\n`);
    }

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  if (!ADMIN_TOKEN) {
    console.log('Aviso: ADMIN_TOKEN não definido — a tela de atualização (/consulta/admin.html) está desabilitada.');
  }
};
