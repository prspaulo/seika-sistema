// Elementos marcados com .requer-<algo> começam escondidos (via CSS, em
// theme.css) pra nunca aparecer nem por um instante antes desta checagem
// terminar. Aqui a gente ou revela, ou remove de vez, conforme a permissão.
const ELEMENTOS_RESTRITOS = [
  { classe: 'requer-propostas', temAcesso: (p) => !!(p && p.propostas && p.propostas.acessar) },
  { classe: 'requer-admin', temAcesso: (p) => !!(p && p.consulta && p.consulta.admin) }
];

function mostrarTodosElementosRestritos() {
  for (const { classe } of ELEMENTOS_RESTRITOS) {
    document.querySelectorAll('.' + classe).forEach((el) => {
      el.style.visibility = 'visible';
    });
  }
}

window.seikaAuthReady = (function () {
  return fetch('/auth/me')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.user) {
        mostrarTodosElementosRestritos();
        return null;
      }
      window.seikaAuth = data.user;

      for (const { classe, temAcesso } of ELEMENTOS_RESTRITOS) {
        if (temAcesso(data.user.permissoes)) {
          document.querySelectorAll('.' + classe).forEach((el) => { el.style.visibility = 'visible'; });
        } else {
          document.querySelectorAll('.' + classe).forEach((el) => el.remove());
        }
      }

      const nav = document.querySelector('.topnav');
      if (nav) {
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'topnav-link';
        link.title = 'Sair do sistema';
        link.textContent = 'Sair (' + data.user.email + ')';
        link.addEventListener('click', async (e) => {
          e.preventDefault();
          await fetch('/auth/logout', { method: 'POST' });
          window.location.href = '/login.html';
        });
        nav.appendChild(link);
      }

      return data.user;
    })
    .catch(() => {
      // Falha na checagem (ex: rede instável) — não deixa o usuário travado
      // sem ver nada; a rota em si continua protegida no servidor.
      mostrarTodosElementosRestritos();
      return null;
    });
})();
