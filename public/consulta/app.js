const form = document.getElementById('form-busca');
const input = document.getElementById('input-cnpj');
const btnBuscar = document.getElementById('btn-buscar');
const mensagemEl = document.getElementById('mensagem');
const loadingEl = document.getElementById('loading');
const resultadoEl = document.getElementById('resultado');

function formatarCNPJEnquantoDigita(valor) {
  const digits = valor.replace(/\D/g, '').slice(0, 14);
  let out = digits;
  if (digits.length > 12) {
    out = digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, '$1.$2.$3/$4-$5');
  } else if (digits.length > 8) {
    out = digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})/, '$1.$2.$3/$4');
  } else if (digits.length > 5) {
    out = digits.replace(/^(\d{2})(\d{3})(\d{0,3})/, '$1.$2.$3');
  } else if (digits.length > 2) {
    out = digits.replace(/^(\d{2})(\d{0,3})/, '$1.$2');
  }
  return out;
}

input.addEventListener('input', (e) => {
  e.target.value = formatarCNPJEnquantoDigita(e.target.value);
});

function esconderTudo() {
  mensagemEl.hidden = true;
  loadingEl.hidden = true;
  resultadoEl.hidden = true;
}

function mostrarMensagem(texto) {
  esconderTudo();
  mensagemEl.textContent = texto;
  mensagemEl.hidden = false;
}

function renderResultado(data) {
  esconderTudo();
  preencherResultado(resultadoEl, data);
  resultadoEl.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cnpj = input.value.replace(/\D/g, '');

  if (cnpj.length !== 14) {
    mostrarMensagem('Digite um CNPJ com 14 dígitos.');
    return;
  }

  esconderTudo();
  loadingEl.hidden = false;
  btnBuscar.disabled = true;

  try {
    const res = await fetch(`/api/cnpj/${cnpj}`);
    const data = await res.json();

    if (!res.ok) {
      mostrarMensagem(data.erro || 'Erro ao consultar o CNPJ.');
      return;
    }

    renderResultado(data);
  } catch (err) {
    mostrarMensagem('Erro de conexão. Verifique sua internet e tente novamente.');
  } finally {
    btnBuscar.disabled = false;
  }
});
