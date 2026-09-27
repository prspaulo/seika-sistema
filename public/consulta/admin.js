const blocoToken = document.getElementById('bloco-token');
const blocoPainel = document.getElementById('bloco-painel');
const inputToken = document.getElementById('input-token');
const btnEntrar = document.getElementById('btn-entrar');
const mensagemToken = document.getElementById('mensagem-token');

const formAtualizar = document.getElementById('form-atualizar');
const inputDir = document.getElementById('input-dir');
const inputPeriodo = document.getElementById('input-periodo');
const btnIniciar = document.getElementById('btn-iniciar');
const mensagemPainel = document.getElementById('mensagem-painel');
const statusExecucao = document.getElementById('status-execucao');
const statusBadge = document.getElementById('status-badge');
const statusTexto = document.getElementById('status-texto');
const logConsole = document.getElementById('log-console');

let token = sessionStorage.getItem('cnpj-admin-token') || '';
let eventSource = null;
let statusInterval = null;

function mostrarMensagem(el, texto, tipo = 'erro') {
  el.textContent = texto;
  el.hidden = false;
  el.classList.toggle('mensagem-sucesso', tipo === 'sucesso');
}

function esconderMensagem(el) {
  el.hidden = true;
}

async function chamarAdmin(caminho, opcoes = {}) {
  const res = await fetch(caminho, {
    ...opcoes,
    headers: {
      ...(opcoes.headers || {}),
      'X-Admin-Token': token
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `Erro (HTTP ${res.status})`);
  return data;
}

function atualizarStatusVisual(status) {
  statusExecucao.hidden = false;
  if (status.rodando) {
    statusBadge.textContent = 'Rodando';
    statusBadge.className = 'badge ativa';
    statusTexto.textContent = `Iniciado em ${new Date(status.inicio).toLocaleString('pt-BR')}`;
    btnIniciar.disabled = true;
  } else {
    btnIniciar.disabled = false;
    if (status.fim) {
      const sucesso = status.codigoSaida === 0;
      statusBadge.textContent = sucesso ? 'Concluído' : 'Erro';
      statusBadge.className = `badge ${sucesso ? 'ativa' : 'inativa'}`;
      statusTexto.textContent = `Finalizado em ${new Date(status.fim).toLocaleString('pt-BR')}`;
    } else {
      statusExecucao.hidden = true;
    }
  }
}

async function atualizarStatus() {
  try {
    const status = await chamarAdmin('/api/admin/status');
    atualizarStatusVisual(status);
  } catch (err) {
    // ignora falhas pontuais de polling
  }
}

function conectarStream() {
  if (eventSource) eventSource.close();
  logConsole.hidden = false;
  eventSource = new EventSource(`/api/admin/atualizar/stream?token=${encodeURIComponent(token)}`);
  eventSource.onmessage = (e) => {
    const linha = JSON.parse(e.data);
    logConsole.textContent += linha + '\n';
    logConsole.scrollTop = logConsole.scrollHeight;
  };
  eventSource.onerror = () => {
    // o navegador tenta reconectar sozinho
  };
}

async function entrar() {
  const valor = inputToken.value.trim();
  if (!valor) {
    mostrarMensagem(mensagemToken, 'Digite o token.');
    return;
  }
  token = valor;
  btnEntrar.disabled = true;
  try {
    await chamarAdmin('/api/admin/status');
    sessionStorage.setItem('cnpj-admin-token', token);
    esconderMensagem(mensagemToken);
    blocoToken.hidden = true;
    blocoPainel.hidden = false;
    conectarStream();
    atualizarStatus();
    statusInterval = setInterval(atualizarStatus, 5000);
  } catch (err) {
    mostrarMensagem(mensagemToken, err.message);
    token = '';
  } finally {
    btnEntrar.disabled = false;
  }
}

btnEntrar.addEventListener('click', entrar);
inputToken.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') entrar();
});

formAtualizar.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconderMensagem(mensagemPainel);
  btnIniciar.disabled = true;

  try {
    await chamarAdmin('/api/admin/atualizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dir: inputDir.value.trim(),
        periodo: inputPeriodo.value.trim() || undefined
      })
    });
    logConsole.textContent = '';
    conectarStream();
    atualizarStatus();
  } catch (err) {
    mostrarMensagem(mensagemPainel, err.message);
    btnIniciar.disabled = false;
  }
});

if (token) {
  chamarAdmin('/api/admin/status')
    .then(() => {
      blocoToken.hidden = true;
      blocoPainel.hidden = false;
      conectarStream();
      atualizarStatus();
      statusInterval = setInterval(atualizarStatus, 5000);
    })
    .catch(() => {
      sessionStorage.removeItem('cnpj-admin-token');
      token = '';
    });
}
