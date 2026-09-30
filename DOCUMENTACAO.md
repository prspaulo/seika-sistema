# Documentação — Consulta de CNPJ

Sistema de consulta de CNPJ com base de dados própria, montada a partir dos **Dados Abertos do CNPJ** da Receita Federal. Não depende de APIs externas (BrasilAPI, ReceitaWS) nem tem limite de requisição — todas as consultas são resolvidas localmente, num banco SQLite.

## Sumário

1. [Visão geral](#visão-geral)
2. [Estrutura do projeto](#estrutura-do-projeto)
3. [Autenticação e controle de acesso (RBAC)](#autenticação-e-controle-de-acesso-rbac)
4. [Fonte dos dados](#fonte-dos-dados)
5. [Banco de dados](#banco-de-dados)
6. [Pipeline de importação](#pipeline-de-importação)
7. [Regras de exclusão de dados](#regras-de-exclusão-de-dados)
8. [API (backend)](#api-backend)
9. [Telas (frontend)](#telas-frontend)
10. [Configuração e variáveis de ambiente](#configuração-e-variáveis-de-ambiente)
11. [Como rodar](#como-rodar)
12. [Como atualizar a base para um novo período](#como-atualizar-a-base-para-um-novo-período)
13. [Limitações conhecidas](#limitações-conhecidas)
14. [Solução de problemas comuns](#solução-de-problemas-comuns)

---

## Visão geral

O sistema tem três partes:

- **Um banco SQLite local** (`data/cnpj.db`) com o cadastro de empresas da Receita Federal, importado a partir dos arquivos públicos de Dados Abertos do CNPJ.
- **Um servidor Express** (`server.js`) que expõe esse banco via API HTTP e serve as páginas.
- **Três telas web**: consulta individual de CNPJ, listagem/busca paginada de toda a base, e um painel de administração para atualizar os dados.

Fluxo típico de uso: o usuário digita um CNPJ ou navega/pesquisa na listagem → o servidor consulta o SQLite local → responde em milissegundos, sem qualquer chamada de rede externa.

## Estrutura do projeto

> Nota: este módulo de consulta hoje faz parte do **seika-sistema**, que também inclui
> o módulo de geração de propostas (`modules/propostas/`, `public/propostas/`). Veja a
> seção "Módulo de Propostas" no fim deste documento.

```
seika-sistema/
├── server.js                    # servidor Express unificado (sessão + auth gate + rotas dos 2 módulos + estáticos)
├── package.json
├── .env                         # tokens, segredos de sessão e credenciais do admin (não vai pro git)
├── .gitignore                   # ignora data/, downloads/, output/, .env, node_modules/
├── data/
│   └── cnpj.db                  # banco SQLite (gerado pela importação, não vai pro git)
├── downloads/                   # pasta onde você coloca os .zip baixados da Receita
├── scripts/
│   ├── import-cnpj.js           # importa os .zip da Receita pro SQLite
│   ├── build-search-index.js    # cria índices de UF/município e busca textual (FTS5)
│   ├── remove-entities.js       # remove bancos específicos + empresas de porte "DEMAIS"
│   ├── filtrar-apenas-mg.js     # filtra a base pra manter só estabelecimentos de MG
│   ├── atualizar-base.js        # orquestra os scripts acima em sequência
│   └── gerar-hash-senha.js      # gera o hash (scrypt) de uma senha pra usuarios-locais.json
├── modules/
│   ├── auth/
│   │   ├── routes.js            # rotas /auth/* (Google, login-local, logout, config, me)
│   │   ├── middleware.js        # requireAuth (gate geral) e requirePermission (RBAC)
│   │   ├── rbac.js              # definição dos papéis (roles) e permissões
│   │   ├── usuarios.js          # helper que lê usuarios.json (contas via Google)
│   │   ├── usuarios.json        # mapa e-mail corporativo -> papel (login Google)
│   │   ├── usuarios-locais.js   # helper que lê usuarios-locais.json
│   │   └── usuarios-locais.json # contas usuário/senha -> papel (login local, ex: admin, ingrid)
│   ├── consulta/routes.js       # rotas da API de consulta (antigo server.js) — já aplica as restrições de RBAC
│   └── propostas/               # rotas + lib de geração de PDF (ver seção própria) — protegidas por RBAC
└── public/
    ├── index.html                # hub com links pros 2 módulos
    ├── login.html                # tela de login (Google + acesso administrativo local)
    ├── sem-acesso.html           # tela exibida quando o papel do usuário não tem permissão pra área acessada
    ├── assets/
    │   ├── theme.css              # paleta e componentes (topbar, botões) compartilhados por todo o sistema
    │   ├── auth-nav.js            # injeta "Sair" na topbar e esconde links sem permissão, em todas as páginas
    │   └── logo.jpeg
    ├── consulta/
    │   ├── index.html / app.js   # tela de consulta por CNPJ
    │   ├── lista.html / lista.js # listagem paginada + busca + filtros + modal de detalhes
    │   ├── admin.html / admin.js # painel de atualização da base
    │   ├── resultado.js          # renderização do card de resultado (compartilhado)
    │   ├── style.css             # estilos específicos das telas de consulta
    │   └── assets/logo.jpeg      # logo do sistema
    └── propostas/                # ver seção "Módulo de Propostas"
```

## Autenticação e controle de acesso (RBAC)

O sistema inteiro (hub, Consulta e Propostas) fica atrás de login — não existe mais acesso anônimo a nenhuma tela ou rota de API, exceto `/login.html`, `/sem-acesso.html` e os arquivos estáticos de `public/assets/`.

### Formas de login

1. **Google (equipe com e-mail corporativo)** — restrito por domínio de e-mail. O usuário clica em "Entrar com Google" em `/login.html`, o navegador devolve um ID token (via Google Identity Services), o servidor valida esse token com `google-auth-library` e só aceita se `email_verified === true` e o domínio do e-mail bater com `ALLOWED_EMAIL_DOMAIN` (`seikacontabilidade.com.br`). **Não existe tela de cadastro** — quem tem conta Google desse domínio consegue entrar; quem não tem, não passa.
2. **Login local (usuário/senha)** — pra quem ainda não tem e-mail `@seikacontabilidade.com.br` (ex: Ingrid) ou pro acesso de administrador. As contas ficam em `modules/auth/usuarios-locais.json` (usuário, nome, papel e hash `scrypt` da senha — nunca texto puro). Serve também como acesso de contingência independente do Google. Tem limite de 5 tentativas erradas por 15 min por IP+usuário (`modules/auth/routes.js`).

A sessão é mantida em cookie (`express-session`, `MemoryStore` — ver [Limitações](#limitações-conhecidas)) por até 12h.

### RBAC — papéis e permissões

Definido em `modules/auth/rbac.js`. Cada papel (`role`) declara o que pode acessar em `consulta` (buscar, base completa, tela de admin, e um bloco opcional `restricoes`) e em `propostas` (`acessar`).

| Papel | Quem recebe | Acesso |
|---|---|---|
| `admin` | usuário local `admin` (`usuarios-locais.json`) | Total, sem restrição nenhuma (consulta + base completa + admin + propostas). |
| `equipe` | qualquer conta `@seikacontabilidade.com.br` que fizer login pelo Google e **não** estiver listada em `usuarios.json` | Total em consulta + propostas, mas sem a tela de admin (`consulta.admin`). Papel padrão — mantém o comportamento de antes do RBAC pra quem não tem regra especial. |
| `consulta_saude_bh` | usuário local `ingrid` (`usuarios-locais.json`) — ainda não tem e-mail corporativo | Sem acesso a Propostas. Na Consulta, só enxerga empresas de Belo Horizonte, situação Ativa, CNAE principal nas divisões 86/87/88 (seção "Saúde humana e serviços sociais" do IBGE); na listagem só vê as colunas CNPJ e Razão social; no detalhe não vê capital social nem sócios que não sejam administradores. |

**Quem decide o papel de cada pessoa:** duas fontes, conforme a forma de login —
- `modules/auth/usuarios.js` mapeia e-mail → papel, lendo `modules/auth/usuarios.json` (usado no login Google). Vazio hoje (`{}`) — ninguém tem regra especial por e-mail corporativo ainda.
- `modules/auth/usuarios-locais.js` mapeia usuário local → papel, lendo `modules/auth/usuarios-locais.json` (usado no login usuário/senha) — é aqui que estão `admin` e `ingrid` hoje.

Não há UI de gestão de usuários em nenhum dos dois casos — é edição manual desses JSONs pelo admin do sistema. Isso não é uma tela de "cadastro" (não é self-service); é configuração de servidor.

**Para dar acesso a alguém:**
- Já tem e-mail `@seikacontabilidade.com.br` e acesso padrão: não precisa fazer nada — a conta já cai no papel `equipe` ao logar com o Google.
- Já tem e-mail corporativo mas precisa de um papel restrito: adicione uma entrada em `usuarios.json` (e-mail → papel) e reinicie o servidor.
- **Não tem e-mail corporativo ainda** (caso da Ingrid): crie uma conta local em `usuarios-locais.json` — gere o hash da senha com `node scripts/gerar-hash-senha.js "a-senha-escolhida"` e adicione `{ "usuario", "nome", "role", "senhaHash" }` à lista. Quando a pessoa ganhar e-mail corporativo, dá pra migrar pra `usuarios.json` e remover a conta local, se preferir centralizar no Google.
- Em qualquer caso, se nenhum papel existente servir, crie um novo em `rbac.js` primeiro.

**Onde as restrições são aplicadas** (sempre no servidor, nunca só na tela — a pessoa não consegue burlar trocando a URL ou os parâmetros da busca):
- `modules/auth/middleware.js` — `requireAuth` (bloqueia tudo sem sessão) e `requirePermission(caminho)` (bloqueia por permissão específica; usado em `server.js` pra proteger `/propostas`, `/gerar`, `/gerar-simples` e `/consulta/admin.html`).
- `modules/consulta/routes.js` — `GET /api/cnpjs`, `GET /api/cnpj/:cnpj` e `GET /api/cnaes` aplicam `restricoes` do papel (força município/situação/CNAE, remove colunas e campos, e devolve 404 se a pessoa tentar acessar diretamente um CNPJ fora do escopo liberado pra ela).
- `requireAdmin` (dentro de `modules/consulta/routes.js`) agora exige **duas** coisas: papel com `consulta.admin = true` **e** o header `X-Admin-Token` correto — antes só exigia o token.

O frontend (`public/assets/auth-nav.js`, `public/consulta/lista.js`, `public/consulta/resultado.js`, `public/consulta/app.js`) também lê `GET /auth/me` (que devolve `{ user: { email, role, permissoes, ... } }`) pra esconder links/colunas/campos que a pessoa não pode usar — isso é só cosmético, a segurança de verdade está no backend.

### Rotas de autenticação

| Rota | Uso |
|---|---|
| `GET /auth/config` | Devolve `{ googleClientId, allowedDomain }` pro frontend montar o botão do Google. |
| `GET /auth/me` | Devolve o usuário logado (com `permissoes` resolvidas) ou `{ user: null }`. |
| `POST /auth/google` | Recebe `{ credential }` (ID token do Google), valida e cria a sessão. |
| `POST /auth/login-local` | Recebe `{ usuario, senha }`, valida contra `modules/auth/usuarios-locais.json`. |
| `POST /auth/logout` | Destroi a sessão. |

## Fonte dos dados

Os dados vêm do **Cadastro Nacional da Pessoa Jurídica (CNPJ)** — dados abertos publicados oficialmente pela Receita Federal, sem sigilo, para uso público (não é scraping nem acesso indevido).

- Página oficial: `gov.br/receitafederal` → Dados Abertos → Cadastros.
- Hospedagem atual dos arquivos: `arquivos.receitafederal.gov.br` (um compartilhamento Nextcloud), organizados por período (`AAAA-MM`), contendo:
  - `Empresas0.zip` a `Empresas9.zip`
  - `Estabelecimentos0.zip` a `Estabelecimentos9.zip`
  - `Socios0.zip` a `Socios9.zip`
  - `Simples.zip` (opção pelo Simples Nacional / MEI)
  - Tabelas de referência pequenas: `Cnaes.zip`, `Naturezas.zip`, `Municipios.zip`, `Paises.zip`, `Qualificacoes.zip`, `Motivos.zip`

**Importante:** esse endereço já mudou uma vez no passado (era `dadosabertos.rfb.gov.br`, hoje é `arquivos.receitafederal.gov.br`). Se a importação começar a falhar em massa no futuro, o primeiro passo é verificar se a Receita migrou de endereço de novo, e atualizar `SHARE_TOKEN`/`BASE_URL` em `scripts/import-cnpj.js`.

O servidor da Receita é conhecido por ser instável (timeouts, conexões resetadas) — por isso o fluxo recomendado é **baixar os arquivos manualmente pelo navegador** e apontar o caminho da pasta pro importador, em vez de depender do download automático (que existe como reserva, mas sofre com essa instabilidade).

## Banco de dados

SQLite (`data/cnpj.db`), acessado via módulo nativo `node:sqlite` (ainda experimental no Node, mas estável o suficiente para esse uso).

### Tabelas principais

| Tabela | Chave | Conteúdo |
|---|---|---|
| `empresas` | `cnpj_basico` (8 dígitos) | Razão social, natureza jurídica, porte, capital social |
| `estabelecimentos` | `cnpj` (14 dígitos) | Nome fantasia, situação cadastral, endereço, CNAE, telefone, e-mail — uma linha por filial/matriz |
| `socios` | `cnpj_basico` | Quadro societário |
| `simples` | `cnpj_basico` | Opção pelo Simples Nacional e MEI |

### Tabelas de referência (código → descrição)

`ref_cnae`, `ref_natureza`, `ref_municipio`, `ref_pais`, `ref_qualificacao`, `ref_motivo` — carregadas inteiras em memória pelo servidor na inicialização (são pequenas, poucos milhares de linhas), usadas para traduzir códigos em texto legível nas respostas da API.

Situação cadastral e porte são traduzidos por mapas fixos no próprio `server.js` (`SITUACAO_CADASTRAL`, `PORTE_EMPRESA`), pois não vêm como tabela de referência separada nos dados da Receita.

### Índices

- `estabelecimentos(cnpj)` — único, usado para toda consulta por CNPJ exato e para paginação por cursor.
- `estabelecimentos(cnpj_basico)`, `empresas(cnpj_basico)`, `socios(cnpj_basico)`, `simples(cnpj_basico)` — usados para os joins.
- `estabelecimentos(uf, cnpj)` e `estabelecimentos(municipio, cnpj)` — usados pelos filtros de UF/município na listagem.
- `empresas_fts` — tabela virtual **FTS5** (busca textual) sobre `razao_social`, usada pela busca por nome na listagem.

### Controle interno

- `import_progress`: marca quais arquivos (`Empresas0.zip`, etc.) já foram importados, por período — permite retomar uma importação interrompida sem reprocessar o que já foi feito.
- `metadata`: guarda `periodo_atual` (ex: `2026-09`) — usado para detectar quando um novo mês está sendo importado e limpar os dados do período anterior automaticamente.

## Pipeline de importação

Três scripts independentes, cada um chamável isoladamente ou em conjunto via `atualizar-base.js`.

### 1. `scripts/import-cnpj.js`

Lê os `.zip` (de uma pasta local ou, na falta do arquivo, direto da Receita via WebDAV) e faz streaming: baixa/lê → descompacta → faz parsing do CSV → insere no SQLite em lotes — **sem nunca gravar o CSV descompactado em disco** (economiza espaço, já que a base completa passa de 40GB).

Características importantes:
- **Resumível por arquivo**: se cair no meio, o próximo `run` pula os arquivos já concluídos (rastreado em `import_progress`) e refaz apenas o que faltou.
- **Tolerante a linhas malformadas**: uma linha com erro de parsing é logada e ignorada, em vez de derrubar a importação inteira (a base da Receita tem uma fração ínfima de registros com esse problema).
- **Consciente de período**: se o período pedido (`--periodo`) for diferente do que já está importado, limpa as tabelas de dados automaticamente antes de importar o novo período — evita misturar dados de meses diferentes.

Uso direto:
```bash
node scripts/import-cnpj.js --dir "C:\caminho\para\os\zips" --periodo 2026-10
```

### 2. `scripts/build-search-index.js`

Roda depois da importação. Cria:
- Índices `(uf, cnpj)` e `(municipio, cnpj)` em `estabelecimentos`.
- A tabela virtual FTS5 `empresas_fts`, repopulada do zero a cada execução (por isso deve rodar **depois** de qualquer reimportação).

### 3. `scripts/remove-entities.js`

Aplica as regras de exclusão de dados (veja seção abaixo). Roda em lotes de 300 mil empresas por vez, também resumível — se interrompido, a próxima execução simplesmente re-filtra o que ainda sobrou (a query `WHERE porte = '05'` já exclui automaticamente o que foi removido).

### Orquestrador: `scripts/atualizar-base.js`

Roda os três scripts acima em sequência, com um único comando:
```bash
node scripts/atualizar-base.js --dir "C:\caminho\para\os\zips" --periodo 2026-10
# ou
npm run atualizar-base -- --dir "C:\caminho\para\os\zips" --periodo 2026-10
```

Esse mesmo pipeline é o que roda por trás da tela `/admin.html`.

## Regras de exclusão de dados

Depois de importar, o sistema remove intencionalmente dois grupos de registros (a pedido específico do dono do projeto — ajuste `scripts/remove-entities.js` se as regras mudarem):

1. **Cinco bancos específicos**: Banco do Brasil, Itaú Unibanco, Caixa Econômica Federal, Bradesco e Santander — identificados por uma lista fixa de `cnpj_basico` (levantada por busca de razão social, excluindo deliberadamente fundos de investimento e consórcios que têm o nome do banco mas não são o banco em si, ex: *"ITAU RISING STARS ... FUNDO DE INVESTIMENTO"* fica de fora).
2. **Empresas de porte "DEMAIS"** (código `05` da Receita): qualquer empresa que não seja Micro Empresa nem Empresa de Pequeno Porte. **Atenção:** essa categoria é mais ampla que só "grandes empresas" — inclui médias empresas também, não só multinacionais/estatais. Hoje isso remove cerca de 21% da base (~14,9 milhões de registros).

Se um dia quiser mudar esses critérios (incluir outros bancos, mudar o corte de porte, usar capital social em vez de porte, etc.), é só editar `BANCOS_CNPJ_BASICO` e o filtro `porte = '05'` em `scripts/remove-entities.js`.

**Nota técnica:** remover linhas do SQLite não reduz o tamanho do arquivo `cnpj.db` no disco — o espaço fica reservado internamente para reuso futuro. Para recuperar esse espaço de verdade seria preciso rodar `VACUUM`, que exige quase o dobro do tamanho atual do banco em espaço livre — hoje isso não cabe no disco disponível.

## API (backend)

Todas as rotas de consulta exigem sessão autenticada (ver [Autenticação e controle de acesso](#autenticação-e-controle-de-acesso-rbac)) — sem cookie de sessão válido, devolvem `401`. O conteúdo da resposta também pode ser filtrado conforme o papel do usuário (`restricoes` do RBAC).

### `GET /api/cnpj/:cnpj`

Consulta um CNPJ específico (só dígitos ou formatado, tanto faz). Retorna 404 se não existir na base local, **ou se existir mas estiver fora do escopo liberado pro papel do usuário** (mesmo comportamento, de propósito, pra não revelar que o registro existe).

Resposta inclui: razão social, nome fantasia, situação cadastral, datas, natureza jurídica, porte, capital social, atividade principal/secundárias (+ `cnaeFiscalPrincipalCodigo`, o código bruto), endereço, telefone, e-mail, sócios, e bloco `simples` (Simples Nacional/MEI) — campos como `capitalSocial` e itens de `socios` podem vir omitidos/filtrados dependendo do papel.

### `GET /api/cnpjs`

Listagem paginada por **cursor** (não por número de página/`OFFSET` — ver [Limitações](#limitações-conhecidas)).

Parâmetros de query:
| Parâmetro | Uso |
|---|---|
| `limit` | itens por página (padrão 50, máx. 100) |
| `after` | CNPJ do último item da página anterior (cursor) |
| `q` | busca — se parecer um CNPJ (só dígitos), busca por prefixo de CNPJ; senão, busca textual na razão social via FTS5 |
| `uf` | filtro exato por UF (ex: `SP`) |
| `municipio` | filtro por trecho do nome do município |
| `cnae` | filtro por CNAE principal — código (prefixo) ou trecho da descrição da atividade |

Resposta: `{ items, nextCursor, hasMore, total }`. Se o papel do usuário tiver `restricoes`, os parâmetros `uf`/`municipio`/`cnae` que conflitem com a restrição são ignorados (a restrição do papel sempre prevalece), e cada item de `items` só traz as colunas listadas em `restricoes.colunasLista`.

### `GET /api/cnaes`

Lista os CNAEs (`{ codigo, descricao }`) conhecidos pela base local, ordenados por descrição — filtrado pelas divisões de CNAE liberadas pro papel do usuário, se houver restrição. Usada para popular as sugestões do filtro de CNAE principal em `lista.html`.

## Módulo de Propostas

Gera o PDF de uma proposta comercial a partir de um template HTML (`templates/proposta.html`
ou `templates/proposta-simples.html`) + os dados preenchidos no formulário
(`public/propostas/index.html` e `simples.html`), usando Puppeteer pra renderizar o HTML e
exportar em PDF.

- `POST /gerar` — gera a proposta completa (Regularização Fiscal) a partir do body do form.
- `POST /gerar-simples` — gera a proposta simplificada (Simples Nacional).
- `modules/propostas/lib/proposta.js` — faz o merge dos dados recebidos com os `DEFAULTS`
  (contador, telefone e e-mail da Seika) e substitui os placeholders `{{campo}}` do template.
- `generate.js` (CLI, opcional) — gera uma proposta a partir de um JSON, sem passar pelo
  formulário web: `node generate.js data/cliente.json`.

**Integração com a consulta de CNPJ:** no resultado de uma busca (`public/consulta/resultado.js`),
o botão "Gerar proposta para este cliente" salva `{ cliente_nome, cliente_cnpj,
cliente_primeiro_nome }` em `sessionStorage` e navega pra `/propostas/index.html`, que lê essa
chave ao carregar e preenche os campos correspondentes do formulário automaticamente. Só o
formulário principal (`proposta.html`) está integrado — o `proposta-simples.html` usa um campo
de documento genérico (`cliente_documento`) em vez de `cliente_cnpj` e por enquanto continua
preenchido manualmente.

### `GET /api/admin/status`, `POST /api/admin/atualizar`, `GET /api/admin/atualizar/stream`

Rotas administrativas — exigem o header `X-Admin-Token` (ou `?token=` na rota de stream, por limitação do `EventSource` do navegador, que não permite header customizado) igual ao valor de `ADMIN_TOKEN`. Se `ADMIN_TOKEN` não estiver definido no ambiente, essas rotas ficam **desabilitadas por padrão** (retornam 503).

- `status`: retorna se há uma atualização rodando, quando começou/terminou, código de saída.
- `atualizar` (POST, corpo `{ dir, periodo }`): dispara `scripts/atualizar-base.js` como processo filho separado (não trava o servidor principal durante as horas que a importação leva). Recusa iniciar uma segunda atualização se já houver uma em andamento.
- `atualizar/stream`: Server-Sent Events com o log em tempo real do processo em andamento.

## Telas (frontend)

Páginas HTML estáticas, sem framework — JavaScript puro, servidas diretamente pelo Express (`app.use(express.static('public'))`), atrás do gate de autenticação.

- **`login.html`** — botão "Entrar com Google" (Google Identity Services) + login local (usuário/senha) atrás de um link discreto "Entrar com usuário e senha" — esse formulário abre automaticamente quando o Google não está configurado (`GOOGLE_CLIENT_ID` ausente), já que aí é a única opção disponível.
- **`sem-acesso.html`** — exibida quando a sessão é válida mas o papel do usuário não tem permissão pra área acessada (ex: Ingrid tentando abrir `/propostas/`).
- **`index.html`** (hub) — busca de um CNPJ específico, mostra o resultado completo na própria página.
- **`lista.html`** — navega toda a base: busca por nome/CNPJ, filtro por UF, município e CNAE principal (código ou atividade — filtros ficam ocultos se o papel já tiver esses valores fixados por restrição), paginação Anterior/Próxima, clique em qualquer CNPJ abre um modal com os detalhes completos (mesma renderização da tela de busca).
- **`admin.html`** — token de administrador (`X-Admin-Token`) + papel com `consulta.admin`, formulário com pasta + período, dispara a atualização e acompanha o log em tempo real.
- **`resultado.js`** — função `preencherResultado(container, dados)` compartilhada entre `index.html` e o modal de `lista.html`; também decide, com base em `window.seikaAuth`, se mostra o botão "Gerar proposta" e a linha de capital social.
- **`assets/auth-nav.js`** — carregado por toda página autenticada; busca `/auth/me`, injeta o link "Sair (e-mail)" na topbar e remove links pra Propostas se o papel não tiver permissão.

## Configuração e variáveis de ambiente

Arquivo `.env` na raiz do projeto (não versionado):

```
ADMIN_TOKEN="sua-senha-aqui"

# --- Login do sistema ---
SESSION_SECRET="chave-aleatoria-longa"
ALLOWED_EMAIL_DOMAIN="seikacontabilidade.com.br"
GOOGLE_CLIENT_ID="xxxxxxxx.apps.googleusercontent.com"

# Contas de login local (usuário/senha) ficam em
# modules/auth/usuarios-locais.json, não aqui no .env.
```

Carregado automaticamente pelo `npm start`, que roda `node --env-file=.env server.js` (recurso nativo do Node, não precisa de biblioteca `dotenv`).

- `SESSION_SECRET` — chave usada pelo `express-session` pra assinar o cookie. Gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `ALLOWED_EMAIL_DOMAIN` — domínio de e-mail aceito no login Google (padrão: `seikacontabilidade.com.br` se a variável não existir).
- `GOOGLE_CLIENT_ID` — Client ID OAuth criado no Google Cloud Console (Credenciais → ID do cliente OAuth → Aplicativo da Web, com as origens JavaScript autorizadas configuradas). Sem essa variável, o login Google fica desabilitado e só o login local funciona.
- Contas de login local: cada entrada de `modules/auth/usuarios-locais.json` tem `{ usuario, nome, role, senhaHash }`. Gere o hash de uma senha com `node scripts/gerar-hash-senha.js "a-senha-escolhida"` (formato `salt:hash`, scrypt) e cole em `senhaHash`. Sem nenhuma entrada nesse arquivo, o login local fica indisponível pra todo mundo (inclusive o admin).

Outras variáveis opcionais (via ambiente, não têm entrada no `.env` hoje):
- `PORT` — porta do servidor (padrão `3000`).
- `NODE_ENV=production` — ativa o cookie de sessão `secure` (exige HTTPS); combine com `app.set('trust proxy', 1)` (já configurado) se estiver atrás de um proxy reverso.
- `CNPJ_DOWNLOADS_DIR` — pasta padrão de downloads pro `import-cnpj.js` (padrão: `./downloads`).
- `CNPJ_PERIODO` — período padrão pro `import-cnpj.js` (padrão: fixo no código, `2026-09`).

## Como rodar

```bash
npm install
npm start
```

Acesse `http://localhost:3000` e faça login (Google ou usuário/senha local).

Sem `ADMIN_TOKEN` definido, a tela `/admin.html` fica bloqueada mesmo pra quem tem o papel `admin`. Sem `GOOGLE_CLIENT_ID`, só o login local funciona — ninguém entra pelo Google.

## Como atualizar a base para um novo período

1. Baixe os arquivos `.zip` do mês desejado — pasta correspondente ao período dentro do compartilhamento da Receita (ver [Fonte dos dados](#fonte-dos-dados)) — pra qualquer pasta local.
2. Opção A — pela tela: acesse `/admin.html`, entre com o token, informe o caminho da pasta e o período (`AAAA-MM`), clique em "Iniciar atualização".
3. Opção B — por linha de comando:
   ```bash
   npm run atualizar-base -- --dir "C:\caminho\para\os\zips" --periodo 2026-10
   ```

O processo é longo (pode levar horas, dependendo do volume de dados e do hardware) e resumível — se cair no meio por qualquer motivo, rodar o mesmo comando de novo retoma de onde parou, sem duplicar nem perder trabalho.

## Limitações conhecidas

- **Paginação por cursor, não por número de página**: com dezenas de milhões de linhas, `OFFSET` tradicional fica cada vez mais lento quanto mais fundo a página. A navegação é Anterior/Próxima; não dá pra pular direto pra uma página arbitrária sem antes ter navegado até lá.
- **Busca textual é por palavra/prefixo, não por substring livre**: o FTS5 encontra "PETRO" em "PETROBRAS" (início de palavra), mas não encontra um trecho no meio de uma palavra.
- **Tamanho do banco não diminui após exclusões**: ver nota em [Regras de exclusão de dados](#regras-de-exclusão-de-dados).
- **Caminho de pasta no admin é resolvido no servidor, não no navegador**: se este sistema for publicado numa nuvem, o caminho informado em `/admin.html` precisa existir *naquela máquina* — os arquivos baixados localmente no seu PC não estão automaticamente acessíveis lá. Seria necessário algum mecanismo de upload (não implementado ainda).
- **`node:sqlite` é experimental**: o Node ainda emite um aviso (`ExperimentalWarning`) ao usá-lo. Funciona bem na prática, mas a API pode mudar em versões futuras do Node.
- **Sessão em memória (`MemoryStore`)**: `express-session` guarda as sessões na memória do processo — some ao reiniciar o servidor (todo mundo precisa logar de novo) e não escala pra múltiplas instâncias/processos. Suficiente pro uso atual (uma instância só), mas se um dia rodar em mais de um processo/servidor, precisa trocar por um store compartilhado (Redis, etc.).
- **Gestão de usuários e papéis é manual**: dar ou mudar o nível de acesso de alguém exige editar `modules/auth/usuarios.json` (e, pra um papel novo, `modules/auth/rbac.js`) e reiniciar o servidor — não existe tela de administração de usuários/papéis.
- **`total` da listagem não reflete os filtros/restrições**: `GET /api/cnpjs` sempre devolve a contagem total da base inteira em `total`, mesmo com filtro (de usuário ou de RBAC) aplicado — limitação pré-existente à introdução do RBAC, não recalculada por enquanto.

## Solução de problemas comuns

**Erro `EADDRINUSE: address already in use :::3000`**
Outro processo Node já está ouvindo a porta 3000 (uma instância anterior do servidor que não foi encerrada). No Windows: `taskkill /F /IM node.exe` encerra todos os processos Node, ou encontre o PID específico com `netstat -ano | findstr :3000`.

**Importação trava ou dá timeout ao baixar da Receita**
O servidor da Receita (`arquivos.receitafederal.gov.br`) é instável. Baixe os arquivos manualmente pelo navegador e use `--dir` para importar a partir do disco local, em vez de depender do download automático.

**Erro de disco cheio durante a criação de índices**
`CREATE INDEX` e `CREATE UNIQUE INDEX` no SQLite precisam de espaço temporário extra para ordenar os dados (pode ser vários GB para tabelas de dezenas de milhões de linhas). Libere espaço em disco antes de rodar `build-search-index.js` — como regra prática, tenha pelo menos mais uns 15-20GB livres além do tamanho atual do banco.

**`UNIQUE constraint failed: estabelecimentos.cnpj` ao criar índice**
Sinal de linhas com CNPJ corrompido/inválido (lixo de parsing) causando duplicidade. `import-cnpj.js` já filtra isso automaticamente antes de criar o índice único (`DELETE FROM estabelecimentos WHERE length(cnpj) != 14 OR cnpj GLOB '*[^0-9]*'`).
