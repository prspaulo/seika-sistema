const PAGE_SIZE = 50;

const UFS = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'],
  ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins']
];

const totalInfoEl = document.getElementById('total-info');
const mensagemEl = document.getElementById('mensagem');
const loadingEl = document.getElementById('loading');
const tabelaEl = document.getElementById('tabela-cnpjs');
const tabelaCorpoEl = document.getElementById('tabela-corpo');
const btnAnterior = document.getElementById('btn-anterior');
const btnProxima = document.getElementById('btn-proxima');
const paginaAtualEl = document.getElementById('pagina-atual');

const formFiltros = document.getElementById('form-filtros');
const filtroBuscaEl = document.getElementById('filtro-busca');
const filtroUfEl = document.getElementById('filtro-uf');
const filtroMunicipioEl = document.getElementById('filtro-municipio');
const filtroCnaeEl = document.getElementById('filtro-cnae');
const listaCnaesEl = document.getElementById('lista-cnaes');
const btnLimparFiltros = document.getElementById('btn-limpar-filtros');

const modalOverlay = document.getElementById('modal-overlay');
const modalFechar = document.getElementById('modal-fechar');
const modalLoading = document.getElementById('modal-loading');
const modalMensagem = document.getElementById('modal-mensagem');
const modalResultado = document.getElementById('modal-resultado');

let currentPage = 1;
let hasMoreCurrent = false;
let cursors = { 1: null };
let filtrosAtivos = { q: '', uf: '', municipio: '', cnae: '' };

for (const [sigla, nome] of UFS) {
  const opt = document.createElement('option');
  opt.value = sigla;
  opt.textContent = `${sigla} - ${nome}`;
  filtroUfEl.appendChild(opt);
}

async function carregarListaCnaes() {
  try {
    const res = await fetch('/api/cnaes');
    if (!res.ok) return;
    const data = await res.json();
    for (const { codigo, descricao } of data.items) {
      const opt = document.createElement('option');
      opt.value = `${codigo} - ${descricao}`;
      listaCnaesEl.appendChild(opt);
    }
  } catch (err) {
    // filtro de CNAE fica sem sugestões, mas continua funcionando por digitação livre
  }
}

carregarListaCnaes();

function formatarCNPJExibicao(cnpj) {
  return String(cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function mostrarMensagem(texto) {
  mensagemEl.textContent = texto;
  mensagemEl.hidden = false;
  tabelaEl.hidden = true;
}

function esconderMensagem() {
  mensagemEl.hidden = true;
}

function formatarTotal(total) {
  return Number(total).toLocaleString('pt-BR');
}

function renderTabela(items) {
  tabelaCorpoEl.innerHTML = '';

  if (items.length === 0) {
    mostrarMensagem('Nenhum CNPJ encontrado com esses filtros.');
    return;
  }

  esconderMensagem();
  tabelaEl.hidden = false;

  for (const item of items) {
    const tr = document.createElement('tr');

    const situacaoLower = (item.situacaoCadastral || '').toLowerCase();
    const badgeClasse = situacaoLower.includes('ativa') ? 'ativa' : 'inativa';

    tr.innerHTML = `
      <td><span class="cnpj-link" data-cnpj="${item.cnpj}">${formatarCNPJExibicao(item.cnpj)}</span></td>
      <td>${item.razaoSocial || '—'}</td>
      <td><span class="badge ${badgeClasse}">${item.situacaoCadastral || '—'}</span></td>
      <td>${[item.municipio, item.uf].filter(Boolean).join(' / ') || '—'}</td>
    `;
    tabelaCorpoEl.appendChild(tr);
  }
}

async function loadPage(page) {
  loadingEl.hidden = false;
  esconderMensagem();
  btnAnterior.disabled = true;
  btnProxima.disabled = true;

  try {
    const after = cursors[page];
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (after) params.set('after', after);
    if (filtrosAtivos.q) params.set('q', filtrosAtivos.q);
    if (filtrosAtivos.uf) params.set('uf', filtrosAtivos.uf);
    if (filtrosAtivos.municipio) params.set('municipio', filtrosAtivos.municipio);
    if (filtrosAtivos.cnae) params.set('cnae', filtrosAtivos.cnae);

    const res = await fetch(`/api/cnpjs?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) {
      mostrarMensagem(data.erro || 'Erro ao carregar a lista de CNPJs.');
      return;
    }

    currentPage = page;
    hasMoreCurrent = data.hasMore;

    if (data.nextCursor) {
      cursors[page + 1] = data.nextCursor;
    }

    renderTabela(data.items);

    const temFiltro = filtrosAtivos.q || filtrosAtivos.uf || filtrosAtivos.municipio || filtrosAtivos.cnae;
    if (temFiltro) {
      totalInfoEl.textContent = `${formatarTotal(data.total)} CNPJs na base local (filtro aplicado)`;
      paginaAtualEl.textContent = `Página ${formatarTotal(currentPage)}`;
    } else {
      const totalPaginasAprox = Math.ceil(data.total / PAGE_SIZE);
      totalInfoEl.textContent = `${formatarTotal(data.total)} CNPJs cadastrados na base local`;
      paginaAtualEl.textContent = `Página ${formatarTotal(currentPage)} de ~${formatarTotal(totalPaginasAprox)}`;
    }
  } catch (err) {
    mostrarMensagem('Erro de conexão. Verifique se o servidor está rodando.');
  } finally {
    loadingEl.hidden = true;
    btnAnterior.disabled = currentPage <= 1;
    btnProxima.disabled = !hasMoreCurrent;
  }
}

function normalizarFiltroCnae(valor) {
  // quando o valor vem da sugestão do datalist ("4712100 - Comércio varejista..."),
  // usa só o código para filtrar por correspondência exata/prefixo
  const match = valor.match(/^(\d+)\s*-\s*/);
  return match ? match[1] : valor;
}

function aplicarFiltros() {
  filtrosAtivos = {
    q: filtroBuscaEl.value.trim(),
    uf: filtroUfEl.value,
    municipio: filtroMunicipioEl.value.trim(),
    cnae: normalizarFiltroCnae(filtroCnaeEl.value.trim())
  };
  cursors = { 1: null };
  loadPage(1);
}

formFiltros.addEventListener('submit', (e) => {
  e.preventDefault();
  aplicarFiltros();
});

btnLimparFiltros.addEventListener('click', () => {
  filtroBuscaEl.value = '';
  filtroUfEl.value = '';
  filtroMunicipioEl.value = '';
  filtroCnaeEl.value = '';
  aplicarFiltros();
});

btnAnterior.addEventListener('click', () => {
  if (currentPage > 1) loadPage(currentPage - 1);
});

btnProxima.addEventListener('click', () => {
  if (hasMoreCurrent) loadPage(currentPage + 1);
});

function abrirModal() {
  modalOverlay.hidden = false;
  modalLoading.hidden = false;
  modalMensagem.hidden = true;
  modalResultado.hidden = true;
}

function fecharModal() {
  modalOverlay.hidden = true;
}

async function abrirDetalhesCnpj(cnpj) {
  abrirModal();
  try {
    const res = await fetch(`/api/cnpj/${cnpj}`);
    const data = await res.json();

    if (!res.ok) {
      modalLoading.hidden = true;
      modalMensagem.textContent = data.erro || 'Erro ao consultar o CNPJ.';
      modalMensagem.hidden = false;
      return;
    }

    modalLoading.hidden = true;
    preencherResultado(modalResultado, data);
    modalResultado.hidden = false;
  } catch (err) {
    modalLoading.hidden = true;
    modalMensagem.textContent = 'Erro de conexão. Verifique sua internet e tente novamente.';
    modalMensagem.hidden = false;
  }
}

tabelaCorpoEl.addEventListener('click', (e) => {
  const alvo = e.target.closest('.cnpj-link');
  if (!alvo) return;
  abrirDetalhesCnpj(alvo.dataset.cnpj);
});

modalFechar.addEventListener('click', fecharModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) fecharModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalOverlay.hidden) fecharModal();
});

loadPage(1);
