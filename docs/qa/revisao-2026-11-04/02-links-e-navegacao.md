# Revisão 02 · Links, rotas e navegação (Tinindo, `main` b7b58fc)

Escopo: roteador, módulos, links internos e externos, navegação por menu, abas e histórico, foco e título por rota, recarga e URLs inválidas.
Ambiente: `dist/` servido com `npx vite preview --port 4302 --strictPort`, Chromium do Playwright 1.56.1 (desktop 1280×900 e Pixel 7), **modo demonstração offline** (sem Supabase; `/entrar` redireciona para `/app`).
Nada foi alterado no repositório. Scripts e saídas brutas estão em
`scratchpad/a2/`:
`routes.mjs` (padrões), `crawl.mjs` → `crawl-desktop.json` (72 URLs visitadas, todos os `<a href>` coletados),
`follow.mjs` → `follow-desktop.json` (163 cliques com voltar), `invalid.mjs` → `invalid.json` (42 URLs inválidas, profundas e recarregadas),
`flows.mjs` / `flows2.mjs` / `agent.mjs` → `flows.log`, `flows2.log` (fluxos dirigidos), `shot-configurar-*.png`.

---

## 1. Resumo

- **Nenhum link interno quebrado no código.** Os 60 padrões de rota existem. Todos os destinos `/app/...` escritos no front, nos dados de demonstração, nas migrações P22/P44/P45 (`route`/`href` de passos e insights) e no guia do assistente caem numa rota registrada, com os parâmetros certos. Os links relativos (`..`, `../..`, `atendimento/:id`, `novo?data=`, `reagendar`, `reservas`, `vincular`, `previa`) resolvem para o lugar esperado.
- **Dinâmica sem erro técnico:** em 72 URLs rastreadas, 163 links clicados e 42 URLs inválidas ou recarregadas, não houve nenhum erro de console, `pageerror`, requisição com falha ou resposta HTTP ≥ 400. Em toda troca de rota, o título acompanha o `<h1>` (`<h1> · Tinindo`). Fora os casos listados abaixo, o foco vai para o `<h1>` e o "voltar" do navegador volta para a origem nos 163 cliques.
- **Problemas encontrados:**
  - (a) Links profundos com âncora da configuração guiada (P44) não levam ao trecho: `#modelos` nunca funciona e `#descrever` põe o foco num título que fica fora da tela.
  - (b) No diretório de demonstração, os cartões e os botões "Ver horários" levam a perfis que não existem ("Perfil não encontrado").
  - (c) O foco se perde (vai para `body`) depois das ações dos insights ("Agora não", "Preparar…") na Home e em Metas.
  - (d) Pelo código, o login não guarda o destino. Um link profundo aberto sem sessão (avaliar, minhas reservas, insight) termina em `/app`. Não deu para testar na demonstração.
  - (e) Na demonstração, várias rotas profundas não sobrevivem à recarga nem a uma aba nova, porque o estado vive na memória da aba.
  - (f) As páginas públicas de "não encontrado" ou "link inválido" são becos sem saída: não têm nenhum link nem botão.

## 2. Tabela de rotas

Legenda: "Abre ok" quer dizer carga direta (equivale a recarregar) sem 404 nem erro de rota, com `<h1>` e título coerentes. Erros = console, `pageerror`, requisição falha, HTTP ≥ 400. Em todas as linhas o resultado foi **0**.

| Rota | Módulo | Pública? | Abre ok | Erros | Observação |
|---|---|---|---|---|---|
| `/` | router | pública | sim (→ `/app`) | 0 | redireciona com `replace` |
| `/entrar` | router/SignIn | pública | sim (→ `/app` na demo) | 0 | tela de login não testável na demo |
| `/criar-conta` | identity | pública | sim | 0 | |
| `/recuperar-senha` | identity | pública | sim | 0 | |
| `/p/:slug` | network | pública | sim | 0 | na demo só existe depois de publicar o perfil na mesma aba; recarregar → "Perfil não encontrado" (F5) |
| `/convite` | network | pública (token `#t`) | sim | 0 | token sai da URL; recarregar na demo → "Convite indisponível" |
| `/indicar` | network | pública | sim | 0 | |
| `/oferta` | waitlist | pública (token `#t`) | sim | 0 | recarregar mantém a oferta |
| `/orcamento` | sales | pública (token `#t`) | sim | 0 | recarregar ou aba nova na demo → "link não é válido" (F5) |
| `/pagar` | payments | pública (token `#t`) | sim | 0 | recarregar ok; aba nova na demo → "Não encontramos esta cobrança" |
| `/s/:slug` | presence | pública | sim | 0 | só depois de publicar o site na aba |
| `/diretorio` | discovery | pública | sim | 0 | |
| `/diretorio/:uf/:cidade` | discovery | pública | sim | 0 | links para perfis inexistentes (F2); UF ou cidade inválida → erro genérico (F9) |
| `/diretorio/:uf/:cidade/:categoria` | discovery | pública | sim | 0 | categoria inválida é ignorada sem aviso (F9) |
| `/avaliar` | reputation | cliente (login) | sim | 0 | `?atendimento=` inválido não quebra |
| `/avaliacoes/:slug` | reputation | pública | sim | 0 | mostra avaliações de perfil não publicado (F2) |
| `/app` | Home | app | sim | 0 | |
| `/app/agenda` | scheduling | app | sim | 0 | `?data=` e `?visao=` inválidos caem no padrão |
| `/app/agenda/novo` | scheduling | app | sim | 0 | `?data=lixo&inicio=99:99` não quebra |
| `/app/agenda/horarios` | scheduling | app | sim | 0 | |
| `/app/agenda/atendimento/:bookingId` | scheduling | app | sim | 0 | id inválido → "Erro: Não encontrado" com h1 e título genéricos "Atendimento" (F10) |
| `/app/agenda/atendimento/:bookingId/reagendar` | scheduling | app | sim | 0 | id inválido → idem |
| `/app/clientes` | crm | app | sim | 0 | |
| `/app/clientes/servicos` | crm | app | sim | 0 | |
| `/app/clientes/importar` | crm | app | sim | 0 | |
| `/app/clientes/:customerId` | crm | app | sim | 0 | id inválido → "Cliente não encontrado" (bom) |
| `/app/mensagens` | messaging | app | sim | 0 | |
| `/app/mensagens/simulador` | messaging | app | sim | 0 | |
| `/app/mensagens/:contactId` | messaging | app | sim | 0 | id inválido → "Conversa não encontrada"; recarregar na demo também (F5) |
| `/app/caixa` | finance | app | sim | 0 | `?mes=lixo` não quebra |
| `/app/contas` | finance-advanced | app | sim | 0 | |
| `/app/pagamentos` | payments | app | sim | 0 | |
| `/app/notas` | fiscal | app | sim | 0 | |
| `/app/relacionamento` | lifecycle | app | sim | 0 | |
| `/app/avaliacoes` | reputation | app | sim | 0 | |
| `/app/assinaturas` | recurrence | app | sim | 0 | |
| `/app/indicacoes` | referrals | app | sim | 0 | |
| `/app/campanhas` | campaigns | app | sim | 0 | |
| `/app/metas` | growth-advice | app | sim | 0 | `?insight=<id>` foca o item; `?insight=lixo` é ignorado |
| `/app/orcamentos` | sales | app | sim | 0 | |
| `/app/resultado` | analytics | app | sim | 0 | |
| `/app/resultado/custo` | analytics | app | sim | 0 | |
| `/app/precos` | pricing | app | sim | 0 | |
| `/app/lista-de-espera` | waitlist | app | sim | 0 | `?vaga=` válido destaca e foca "Preparar oferta"; `?vaga=lixo` ignorado |
| `/app/assistente` | agent | app | sim | 0 | |
| `/app/perfil` | network | app | sim | 0 | |
| `/app/perfil/previa` | network | app | sim | 0 | |
| `/app/site` | presence | app | sim | 0 | |
| `/app/diretorio` | discovery | app | sim | 0 | |
| `/app/servicos-tinindo` | service-ops | app | sim | 0 | |
| `/app/servicos-tinindo/operacao` | service-ops | app | sim | 0 | |
| `/app/equipe` | resources | app | sim | 0 | |
| `/app/materiais` | materials | app | sim | 0 | |
| `/app/domicilio` | field-service | app | sim | 0 | |
| `/app/configurar` | setup | app | sim | 0 | âncoras `#modelos` e `#descrever` com defeito (F1) |
| `/app/conta` | identity | app (conta) | sim | 0 | `?novo=1` é consumido e sai da URL |
| `/app/conta/novo-negocio` | identity | app (conta) | sim | 0 | |
| `/app/conta/vincular` | identity | app (conta) | sim | 0 | |
| `/app/conta/reservas` | identity | cliente (minhas reservas) | sim | 0 | |
| `/app/conta/nova-senha` | identity | app (conta) | sim | 0 | |
| `*` (ex.: `/app/xyz`, `/app/agenda/atendimento`, `/diretorio/sp`, `/p/`, `/app//agenda`, `/index.html`) | Fallbacks | — | 404 amigável | 0 | renderiza fora do shell e responde HTTP 200 (F8) |

Também verificado: barra final (`/app/agenda/`) e maiúsculas (`/APP/AGENDA`) abrem a tela certa.

## 3. Links quebrados ou suspeitos

Não há nenhum destino inexistente no roteador. Os itens abaixo são links que **chegam numa rota válida mas não entregam o que prometem**.

| Origem | Destino | Motivo |
|---|---|---|
| `src/features/discovery/demoPort.ts:21-26` (cartões em `/diretorio/sp/sao-paulo` e `/diretorio/sp/sao-paulo/barber`; `DirectoryPages.tsx:31,36`) | `/p/studio-exemplo-c`, `/p/studio-exemplo-c#agendar`, `/p/treino-exemplo-d`, `/p/barba-exemplo-e`, `/p/barba-exemplo-e#agendar` | O demo do diretório lista negócios que o demo de `network` não conhece (`api.ts:331-332` só responde ao slug publicado na aba). Os 5 links abrem "Perfil não encontrado". |
| `/avaliacoes/barbearia-exemplo-a` ("Voltar ao perfil", `PublicPages`/`ReviewPages`) | `/p/barbearia-exemplo-a` | A lista de avaliações abre para um perfil não publicado (o demo de `discovery` diz `profilePublished: true` e o de `network` diz não publicado). O "voltar" cai em "Perfil não encontrado". |
| `src/features/crm/ServicesPage.tsx:194` (SetupHint "Usar modelos com preço") | `/app/configurar#modelos` | A âncora não funciona: o foco fica no `<h1>` e a página não rola (F1). O SetupHint não aparece no estado da demo, então o comportamento foi confirmado navegando pelo app até a mesma URL. |
| `src/features/setup/SetupCard.tsx:79` ("descreva seu negócio em uma frase") | `/app/configurar#descrever` | O foco vai para `h2#setup-describe-title`, mas o elemento fica em y≈1204 px com a janela no topo, fora da tela (F1, `shot-configurar-descrever.png`). |
| `src/features/agent/setupGuide.ts:36` e `supabase/migrations/20261103134122_p44_setup.sql:25` (passo "Política de cancelamento" → "Abrir política de cancelamento") | `/app/conta` | Rota válida, mas a política fica na seção "Objetivo e política de cancelamento" (`#onboarding-title`), mais abaixo. O foco vai para o `h1` da Conta. Sugestão: `/app/conta#onboarding-title`. Impacto baixo. |
| Perfil público `/p/:slug` → "Minhas reservas" | `/app/conta/reservas` | Funciona, mas leva o cliente anônimo para dentro do app. Sem sessão, ele vai para `/entrar` e, pelo código, depois do login cai em `/app`, não em reservas (F4). |
| Assistente: guia de configuração diz "Política de cancelamento" pendente, `/app/configurar` diz "Definir a antecedência para cancelar ✓" | — | Inconsistência entre os dados de demonstração de `agent` (`setupGuide.ts:36`, `done: false`) e de `setup` (`demoPort.ts:52`). Não é link quebrado, é sinal contraditório. |

Links externos encontrados: `https://wa.me/...` (com `target=_blank`) e `tel:+55...` em Clientes e Relacionamento, Orçamentos, Lista de espera e Pagamentos. O formato está certo; eles não foram abertos (são domínio externo).

## 4. Problemas de navegação

**Voltar do navegador.** Funcionou nos 163 cliques do rastreador e em todos os fluxos dirigidos, entre eles Home → insight → voltar, Metas → fluxo → voltar, inbox → conversa → voltar → avançar, perfil → avaliações → perfil, convite → perfil de quem convidou → convite, e menu do celular aberto + voltar (o menu fecha). Dois pontos de atenção:
- Depois de **criar um agendamento**, voltar retorna ao formulário `/app/agenda/novo?data=…` (zerado). Depois de **reagendar**, voltar retorna a `/…/reagendar` do atendimento já remarcado. Causa: `navigate(target, { relative: "path" })` sem `replace` (`BookingFlowPage.tsx:150`).

**Foco.** Ao trocar de caminho, o foco vai para o `<h1>` (RouteFocus). Na primeira carga fica no `body`, como projetado. O "Pular para o conteúdo" funciona por teclado (Tab, Enter → `main#conteudo`). Problemas:
- "Agora não" (Home e Metas), "Preparar regra de preço" (Metas): o item ou a lista é recarregado e o foco cai no `body` (F3).
- `/app/configurar#modelos` e `#descrever`: ver F1.
- `/app/metas?insight=<id>` vindo da Home: o foco vai corretamente para o `li` do insight, que é rolado para o centro.

**Título.** Sempre `<h1> · Tinindo`, inclusive no 404. Exceções de pouca informação: `/app/agenda/atendimento/<id inválido>` ("Atendimento · Tinindo", com erro só no corpo) e `/avaliacoes/<slug inválido>` ("Avaliações · Tinindo" com "Perfil não encontrado." no corpo).

**Recarregar e links profundos.** Com `vite preview` e `not_found_handling: "single-page-application"` (`wrangler.jsonc`), toda rota profunda devolve o `index.html` e abre. Na demonstração, porém, o estado vive em memória por aba:
- Recarregar `/p/:slug`, `/s/:slug`, `/app/mensagens/:contactId` e `/convite` mostra "não encontrado" ou "indisponível". `/orcamento` recarregado vira "link não é válido".
- `/pagar` e `/oferta` sobrevivem à recarga (sessionStorage), mas o link de pagamento ou de orçamento aberto em aba nova falha.

**Menus e abas.**
- Desktop: o menu lateral tem todos os 30 itens, e todos abrem a tela certa.
- Celular (Pixel 7): as 5 abas (Hoje, Agenda, Clientes, Mensagens, Dinheiro) e as sub-abas por grupo abrem certo.
- `aria-current` marca o item mais específico (Horários vence Agenda). Em `/app/agenda/atendimento/:id` a marca fica em Agenda; em `/app/conta/reservas`, em Conta.
- Menu: Esc fecha e devolve o foco ao botão "Menu"; tocar num item fecha o menu.

**Páginas sem saída.**
- `/p/nao-existe`, `/s/nao-existe`, `/avaliacoes/nao-existe` e os links públicos inválidos (`/convite`, `/orcamento`, `/pagar`, `/oferta`) não têm nenhum link nem botão (F6).
- O 404 global tem "Voltar ao início" (→ `/app`), mas é renderizado fora do shell, sem menu (F8).

## 5. Achados

**F1 · Médio · Âncoras da configuração guiada (P44) não levam ao trecho.** `SetupPage.tsx:274-279` faz `getElementById` + `scrollIntoView` + `focus` uma única vez, ao montar (`[hash]`), antes de `progress` carregar.
- `#modelos`: `setup-templates-title` ainda não existe nesse momento. O foco fica no `h1` e não há rolagem.
- `#descrever`: o foco vai para o `h2`, mas o conteúdo que carrega depois empurra o título para y≈1204 px e a janela fica no topo. A pessoa vê o topo da página enquanto o foco está fora da tela.

Reproduzir: abra `/app`, navegue no app (ou pelo endereço) para `/app/configurar#modelos` e depois para `/app/configurar#descrever`, e compare o foco e a rolagem (`flows2.log`, `shot-configurar-descrever.png`). Afeta os links de `ServicesPage.tsx:194` e `SetupCard.tsx:79`.

**F2 · Médio (demonstração e homologação) · Diretório leva a perfis inexistentes.** Os cartões e o "Ver horários" de `/diretorio/sp/sao-paulo` apontam para `/p/studio-exemplo-c`, `/p/treino-exemplo-d` e `/p/barba-exemplo-e`, que abrem "Perfil não encontrado". O próprio negócio (`barbearia-exemplo-a`) não aparece na lista nem depois de publicado. `/avaliacoes/barbearia-exemplo-a` mostra avaliações de um perfil que o demo considera não publicado, e o "Voltar ao perfil" dele também cai em "Perfil não encontrado". Causa: os dados de demonstração de `discovery`, `network` e `reputation` não são coerentes entre si. Reproduzir: abra `/diretorio/sp/sao-paulo` e clique em "Studio Exemplo C" ou em "Ver horários".

**F3 · Médio (a11y, WCAG 2.4.3) · Foco perdido depois das ações dos insights (P45).** Depois de "Agora não: …" no cartão "Para você esta semana" da Home, e de "Agora não" ou "Preparar regra de preço" em Metas e sugestões, o item ou a lista recarrega e `document.activeElement` vira `body`. Quem usa teclado ou leitor de tela volta ao início do documento. Os "Ver" e "Abrir …" (toast) navegam certo e o foco vai para o `h1` destino. Reproduzir: abra `/app`, clique em "Agora não" no primeiro insight e inspecione `document.activeElement`.

**F4 · Médio-alto (produção; só análise estática, não testável na demo) · Login não volta ao destino.** `AppShell.tsx` manda quem está sem sessão para `<Navigate to="/entrar" replace />` sem guardar a origem. `SignIn.tsx:16` sempre redireciona para `/app`. `ReviewPages.tsx:383` também linka `/entrar` sem retorno. Um cliente que abre `/avaliar?atendimento=…` ou "Minhas reservas" a partir do perfil público, ou uma dona que abre `/app/metas?insight=…` vindo do resumo semanal, cai em "Hoje" depois de entrar e perde o parâmetro. Na demonstração o estado é sempre `offline_demo`, então não pude reproduzir no navegador.

**F5 · Baixo-médio (demonstração) · Rotas profundas não sobrevivem à recarga nem a uma aba nova.** Recarregar quebra `/p/:slug`, `/s/:slug`, `/app/mensagens/:contactId` ("Conversa não encontrada"), `/convite` ("Convite indisponível") e `/orcamento` ("Este link não é válido…"). Abrir em aba nova quebra o link de `/pagar` e de `/orcamento`. Causa: o estado dos demos fica em memória (`let shared`) e só pagamentos usa sessionStorage. Isso atrapalha quem testa a homologação compartilhando links. Os e2e contornam com `pushState` (`tests/e2e/*/helpers.ts`, `soft`). Reproduzir: publique o perfil em `/app/perfil`, clique em "Abrir perfil público" e aperte F5.

**F6 · Baixo · Páginas públicas de erro sem saída.** "Perfil não encontrado", "Site não encontrado", "Avaliações · Perfil não encontrado", "Convite indisponível", "Orçamento · link não é válido", "Pagamento · Não encontramos esta cobrança" e "Vaga disponível · link não é válido" não têm nenhum link ou botão (nem para `/diretorio`). Reproduzir: abra `/p/nao-existe` e aperte Tab: o foco fica no `body`.

**F7 · Baixo · "Voltar" depois de criar ou reagendar volta ao formulário.** Depois de confirmar um agendamento (`/app/agenda/novo` → `/app/agenda/atendimento/<novo>`), o voltar abre o formulário de novo, vazio. Depois de reagendar, o voltar abre `/…/reagendar` do atendimento já remarcado. Usar `replace: true` em `BookingFlowPage.tsx:150` (e no `navigate` de `BookingDetailPage.tsx:375`) evitaria isso. Reproduzir: abra `/app/agenda?data=2026-10-21`, clique em Novo agendamento, escolha Bruno, Barba, 11:00, Confirmar e depois voltar.

**F8 · Baixo · 404 global fora do shell e com HTTP 200.** Um erro de digitação dentro do app (`/app/xyz`, `/app/agenda/atendimento`, `/app//agenda`) mostra "Página não encontrada" sem barra nem menu, só com "Voltar ao início". O status HTTP é 200 (SPA). Para `/p/*` e `/s/*` o Worker roda antes, mas não testei o Worker. Reproduzir: abra `/app/xyz`.

**F9 · Baixo · Diretório com parâmetro inválido.** `/diretorio/zz/cidade-x` mostra o título "Profissionais em cidade-x/ZZ" e o erro "Não deu certo agora. Nada foi alterado; tente de novo." em vez de "cidade não encontrada". `/diretorio/sp/sao-paulo/categoria-invalida` ignora a categoria sem avisar. `/diretorio/sp` dá 404, sem redirecionar para `/diretorio`. Reproduzir: abra as URLs citadas.

**F10 · Baixo · Atendimento inexistente com título genérico.** `/app/agenda/atendimento/xyz` (e `/reagendar`) mantém o h1 e o título "Atendimento" ou "Reagendar atendimento", com "Erro: Não encontrado" no corpo e o formulário de reagendar sem dados. Clientes e Mensagens fazem melhor ("Cliente não encontrado", "Conversa não encontrada"). Reproduzir: abra `/app/agenda/atendimento/xyz`.

**F11 · Baixo · "Abrir política de cancelamento" cai no topo da Conta.** Tanto no guia do assistente quanto no passo P44, o link leva a `/app/conta`, e a política fica mais abaixo (`#onboarding-title`). No demo, o assistente também diz que esse passo está pendente enquanto `/app/configurar` o mostra como feito. Reproduzir: em `/app/assistente`, clique em "Me ajuda a configurar" e depois em "Abrir política de cancelamento".

Observação fora da minha área, vista no print: em `/app/configurar`, o cartão do passo 4 ("Publicar seu perfil…") aparece com fundo preto e título quase invisível (`shot-configurar-descrever.png`). Vale o revisor visual conferir.

### O que não pôde ser testado
- Fluxos com sessão real (sem sessão → `/entrar` → retorno), o papel "cliente sem negócio" e a tela de login: na demonstração a sessão é sempre `offline_demo`.
- O Worker de produção (`worker/index.ts`, OG de `/p/*` e `/s/*`) e o status HTTP real em Cloudflare: só usei `vite preview`.
- Os links externos (`wa.me`, `tel:`): conferi o formato, não abri.
- O SetupHint `#modelos` em Serviços e o atalho `#descrever` no cartão da Home não aparecem no estado inicial da demo. Testei a mesma URL navegando pelo app, não o clique no próprio link.
- O rastreio em celular foi parcial: abas, sub-abas, menu, Esc e voltar. Não repeti os 163 cliques no viewport móvel.
