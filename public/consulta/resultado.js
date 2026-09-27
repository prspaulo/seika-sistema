function formatarCnpjMascara(cnpj) {
  const digits = String(cnpj || '').replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function primeiroNomeSocioAdministrador(socios) {
  const admin = (socios || []).find(s => /admin/i.test(s.qualificacao || ''));
  if (!admin || !admin.nome) return '';
  return admin.nome.trim().split(/\s+/)[0];
}

function irParaGerarProposta(data) {
  const prefill = {
    cliente_nome: data.razaoSocial || '',
    cliente_cnpj: formatarCnpjMascara(data.cnpj),
    cliente_primeiro_nome: primeiroNomeSocioAdministrador(data.socios)
  };
  sessionStorage.setItem('propostaPrefill', JSON.stringify(prefill));
  window.location.href = '/propostas/index.html';
}

function formatarMoeda(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const num = Number(valor);
  if (Number.isNaN(num)) return valor;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function campo(label, valor) {
  const div = document.createElement('div');
  div.className = 'campo';
  const l = document.createElement('label');
  l.textContent = label;
  const s = document.createElement('span');
  s.textContent = valor && String(valor).trim() !== '' ? valor : '—';
  div.append(l, s);
  return div;
}

function preencherResultado(containerEl, data) {
  containerEl.innerHTML = '';

  const situacaoLower = (data.situacaoCadastral || '').toLowerCase();
  const badgeClasse = situacaoLower.includes('ativa') ? 'ativa' : 'inativa';

  const header = document.createElement('div');
  header.innerHTML = `
    <h2>${data.razaoSocial || 'Razão social não informada'}</h2>
    ${data.nomeFantasia ? `<div class="fantasia">${data.nomeFantasia}</div>` : ''}
    <span class="badge ${badgeClasse}">${data.situacaoCadastral || 'Situação desconhecida'}</span>
  `;
  const btnProposta = document.createElement('button');
  btnProposta.type = 'button';
  btnProposta.className = 'btn-gerar-proposta';
  btnProposta.textContent = 'Gerar proposta para este cliente';
  btnProposta.addEventListener('click', () => irParaGerarProposta(data));
  header.appendChild(btnProposta);
  containerEl.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.append(
    campo('CNPJ', data.cnpj),
    campo('Data de abertura', data.dataAbertura),
    campo('Natureza jurídica', data.naturezaJuridica),
    campo('Porte', data.porte),
    campo('Capital social', formatarMoeda(data.capitalSocial)),
    campo('Atividade principal', data.atividadePrincipal),
    campo('Telefone', data.telefone),
    campo('E-mail', data.email)
  );
  containerEl.appendChild(grid);

  const end = data.endereco || {};
  const enderecoTexto = [
    end.logradouro,
    end.numero,
    end.complemento,
    end.bairro,
    end.municipio && end.uf ? `${end.municipio}/${end.uf}` : end.municipio || end.uf,
    end.cep
  ].filter(Boolean).join(', ');

  const enderecoTitulo = document.createElement('div');
  enderecoTitulo.className = 'secao-titulo';
  enderecoTitulo.textContent = 'Endereço';
  containerEl.appendChild(enderecoTitulo);

  const enderecoDiv = document.createElement('div');
  enderecoDiv.className = 'campo';
  enderecoDiv.innerHTML = `<span>${enderecoTexto || '—'}</span>`;
  containerEl.appendChild(enderecoDiv);

  if (data.atividadesSecundarias && data.atividadesSecundarias.length > 0) {
    const titulo = document.createElement('div');
    titulo.className = 'secao-titulo';
    titulo.textContent = 'Atividades secundárias';
    containerEl.appendChild(titulo);

    const ul = document.createElement('ul');
    ul.className = 'lista-simples';
    data.atividadesSecundarias.forEach(a => {
      const li = document.createElement('li');
      li.textContent = a;
      ul.appendChild(li);
    });
    containerEl.appendChild(ul);
  }

  if (data.simples) {
    const titulo = document.createElement('div');
    titulo.className = 'secao-titulo';
    titulo.textContent = 'Simples Nacional / MEI';
    containerEl.appendChild(titulo);

    const gridSimples = document.createElement('div');
    gridSimples.className = 'grid';
    const s = data.simples;
    gridSimples.append(
      campo('Optante pelo Simples', s.optanteSimples ? 'Sim' : 'Não'),
      campo('Data de opção (Simples)', s.dataOpcaoSimples),
      campo('Data de exclusão (Simples)', s.dataExclusaoSimples),
      campo('Optante pelo MEI', s.optanteMei ? 'Sim' : 'Não'),
      campo('Data de opção (MEI)', s.dataOpcaoMei),
      campo('Data de exclusão (MEI)', s.dataExclusaoMei)
    );
    containerEl.appendChild(gridSimples);
  }

  if (data.socios && data.socios.length > 0) {
    const titulo = document.createElement('div');
    titulo.className = 'secao-titulo';
    titulo.textContent = 'Quadro societário';
    containerEl.appendChild(titulo);

    const ul = document.createElement('ul');
    ul.className = 'lista-simples';
    data.socios.forEach(s => {
      const li = document.createElement('li');
      li.textContent = `${s.nome}${s.qualificacao ? ' — ' + s.qualificacao : ''}`;
      ul.appendChild(li);
    });
    containerEl.appendChild(ul);
  }

  const fonte = document.createElement('div');
  fonte.className = 'fonte';
  fonte.textContent = `Fonte: ${data.fonte}`;
  containerEl.appendChild(fonte);
}
