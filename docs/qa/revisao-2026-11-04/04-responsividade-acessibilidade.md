# Revisão 04 · Responsividade e acessibilidade (todas as telas, todos os tamanhos)

Data: 04/11/2026 · Base: `main` em `b7b58fc` · build de produção (`dist/`) servido por `vite preview` na porta 4304, modo demonstração (sem Supabase).
Nada foi alterado no repositório. Scripts, JSON e screenshots ficam em `scratchpad/a4/shots/..` (fora do repo).

## 1. Resumo

- **Cobertura:** 59 rotas (shell, módulos e páginas públicas, lista de `router.tsx` e `src/features/*/module.tsx`) × 6 tamanhos (320×640, 375×812, 414×896, 768×1024, 1024×768, 1440×900) × 2 temas (claro e escuro por `prefers-color-scheme`), ou seja, **708 carregamentos**, todos sem erro de página. Em cada um foram medidos: rolagem horizontal, elementos além da borda da tela, texto cortado ou vazando, tabelas, alvos de toque, fonte de campo, elementos encobertos por barras fixas (topo e fim da página) e **axe-core 4.10.2** (regras wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa), injetado pelo Playwright sem entrar no `package.json`. Também rodei uma passada extra (320, 375 e 768, tema claro) para achar texto que passa da borda do próprio cartão, porque a primeira medição não pegava esse caso. Depois vieram testes de interação: ordem de Tab, foco visível, menu do celular, folhas, menu "⋯", teclado virtual simulado, Assistente e Configuração.
- **Navegador:** só Chromium 1194 (Playwright 1.56.1). **WebKit não está em `/opt/pw-browsers`**, só `chromium-1194`, `chromium_headless_shell-1194` e `ffmpeg`. Por isso Safari/iOS não foi medido (ver Lacunas).
- **Situação geral:** a base está sólida. Só a Home (`/app`) em 320 px tem rolagem horizontal. Nenhum campo fica abaixo de 16 px em tela de toque. Todas as telas têm título próprio. As folhas nativas prendem o foco, fecham com Esc e devolvem o foco. O teclado virtual simulado não encobriu nenhum campo. O axe acusou só contraste de cor, em dois pontos.
- **Mais graves:**
  1. **(Alto) Configuração guiada P44: o passo atual fica ilegível nos dois temas.** O título e o link de ação do próximo passo estão com contraste **1:1** (texto da cor do fundo), e a explicação com 2,12:1 no claro e 1,75:1 no escuro. É justamente o passo que a tela pede para fazer agora (`setup.css:19`).
  2. **(Alto) Home em 320 px com rolagem horizontal** (scrollWidth 330). O cartão "Recebido no mês" fica cortado e "Novo agendamento" vaza do botão. Em 375 px o cartão ainda passa 8 px da própria borda (`pages.css:20-23`).
  3. **(Médio) Valores dos cartões de resumo (`.tn-stat`) saem do cartão em 375 px** em Contas (P31) e Resultado. Em Contas, o sinal de negativo de "Sobrou" quebra numa linha sozinho ("-" e, embaixo, "R$ 1.235,00"), e isso pode ser lido como valor positivo.
  4. **(Médio) O menu do celular não prende o foco:** 30 de 60 Tabs caem na página por trás da camada escura.
  5. **(Médio) Assistente P46:** depois de tocar numa sugestão, o foco vai para o `<body>`, porque o botão fica desabilitado enquanto responde.

## 2. Matriz rota × tamanho

Legenda: **ok** = nada medido fora do padrão nos dois temas · **H** = rolagem horizontal da página · **T** = texto ou valor passa da borda do cartão (medido só em 320, 375 e 768) · **C** = contraste abaixo de AA (axe) no conteúdo · **c** = contraste abaixo de AA só nos rótulos da barra de abas, sobre o vidro, no tema escuro · **A*n*** = *n* alvos interativos menores que 44×44 px (regra da marca; links dentro de frase não contam).
O fundo da barra de abas muda conforme o conteúdo que passa por baixo dela. Por isso o "c" aparece de forma pontual, e o mesmo pode acontecer em outras rotas conforme a rolagem.

| Rota | 320 | 375 | 414 | 768 | 1024 | 1440 |
|---|---|---|---|---|---|---|
| `/entrar` | H T | T | ok | ok | ok | ok |
| `/criar-conta` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/recuperar-senha` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/app` | H T | T | ok | ok | ok | ok |
| `/app/agenda` | ok | ok | ok | ok | ok | ok |
| `/app/agenda?visao=semana&data=2026-10-20` | ok | ok | ok | ok | ok | ok |
| `/app/agenda/novo?data=2026-10-20` | ok | ok | ok | ok | ok | ok |
| `/app/agenda/horarios` | ok | ok | ok | ok | ok | ok |
| `/app/agenda/atendimento/:id` | ok | ok | ok | ok | ok | ok |
| `/app/agenda/atendimento/:id/reagendar` | ok | ok | ok | ok | ok | ok |
| `/app/clientes` | ok | ok | ok | ok | ok | ok |
| `/app/clientes/servicos` | ok | ok | ok | ok | ok | ok |
| `/app/clientes/importar` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/app/clientes/:id` | ok | ok | ok | ok | ok | ok |
| `/app/mensagens` | ok | A1 | A1 | A1 | A1 | A1 |
| `/app/mensagens/simulador` | ok | ok | ok | ok | ok | ok |
| `/app/assistente` | ok | ok | ok | ok | ok | ok |
| `/app/caixa` | c | ok | ok | ok | ok | ok |
| `/app/contas` | ok | T | ok | ok | ok | ok |
| `/app/pagamentos` | ok | ok | ok | ok | ok | ok |
| `/app/assinaturas` | ok | ok | ok | ok | ok | ok |
| `/app/notas` | ok | ok | ok | ok | ok | ok |
| `/app/relacionamento` | A2 | A2 | A2 | A2 c | A2 | A2 |
| `/app/avaliacoes` | ok | ok | ok | ok | ok | ok |
| `/app/indicacoes` | ok | ok | ok | ok | ok | ok |
| `/app/campanhas` | ok | ok | ok | ok | ok | ok |
| `/app/metas` | ok | ok | ok | ok | ok | ok |
| `/app/orcamentos` | ok | ok | ok | ok | ok | ok |
| `/app/resultado` | ok | T | ok | ok | ok | ok |
| `/app/resultado/custo` | ok | ok | ok | ok | ok | ok |
| `/app/precos` | ok | ok | ok | ok | ok | ok |
| `/app/lista-de-espera` | c | ok | ok | ok | ok | ok |
| `/app/perfil` | ok | ok | ok | ok | ok | ok |
| `/app/perfil/previa` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/app/site` | ok | A1 | A1 | A1 | A1 | A1 |
| `/app/diretorio` | ok | ok | ok | ok | ok | ok |
| `/app/servicos-tinindo` | ok | ok | ok | ok | ok | ok |
| `/app/servicos-tinindo/operacao` | ok | ok | ok | ok | ok | ok |
| `/app/equipe` | ok | ok | ok | ok | ok | ok |
| `/app/materiais` | ok | ok | ok | ok | ok | ok |
| `/app/domicilio` | ok | ok | ok | ok | ok | ok |
| `/app/configurar` | C | C | C | C | C | C |
| `/app/conta` | A3 | A3 | A3 | A3 | A3 | A3 |
| `/app/conta/novo-negocio` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/app/conta/vincular` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/app/conta/reservas` | A2 | A2 | A2 | A2 | A2 | A2 |
| `/app/conta/nova-senha` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/diretorio` | ok | ok | ok | ok | ok | ok |
| `/diretorio/sp/sao-paulo` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/avaliar` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/avaliacoes/barbearia-exemplo-a` | A1 | A1 | A1 | A1 | A1 | A1 |
| `/indicar` | ok | ok | ok | ok | ok | ok |
| `/convite#t=…` | ok | ok | ok | ok | ok | ok |
| `/oferta#t=…` | ok | ok | ok | ok | ok | ok |
| `/orcamento#t=…` | ok | ok | ok | ok | ok | ok |
| `/pagar#t=…` | ok | ok | ok | ok | ok | ok |
| `/p/barbearia-exemplo-a` | ok | ok | ok | ok | ok | ok |
| `/s/barbearia-exemplo-a` | ok | ok | ok | ok | ok | ok |
| `/nao-existe` | ok | ok | ok | ok | ok | ok |

Observações da matriz:
- `/entrar` cai na Home em demonstração (sessão de exemplo), por isso repete o resultado de `/app`.
- `/p/barbearia-exemplo-a` e `/s/barbearia-exemplo-a` mostram "não encontrado", porque o perfil e o site não estão publicados na demonstração. `/convite`, `/oferta`, `/orcamento` e `/pagar` foram medidos no estado de link inválido. Os estados reais dessas páginas **não** foram medidos.
- Nenhuma tabela ficou sem adaptação: a única (`/app/resultado/custo`) vira cartões no celular e cabe em 320 px.
- Fonte de campo abaixo de 16 px: **nenhuma** em tela de toque (a regra `@media (pointer: coarse)` em `ui.css` funciona).

## 3. Achados

### R-01 · Alto · P44 Configuração guiada: passo atual com texto da cor do fundo
- **Rota:** `/app/configurar`, todos os tamanhos, claro e escuro.
- **Medida:** o cartão `li.tn-setup-step[data-next]` recebe fundo `--tn-selected-bg` (= `--tn-action`: #111111 no claro, #F7F7F5 no escuro), mas o texto continua com a cor normal. O título "Publicar seu perfil e mandar o link" fica #111 sobre #111 no claro e #F7F7F5 sobre #F7F7F5 no escuro (**1:1**). O link de ação "Publicar perfil" também fica em 1:1. Na explicação, o axe mediu **2,12:1** no claro e **1,75:1** no escuro. Só o número do passo aparece.
- **Arquivo:** `src/features/setup/setup.css:19` usa `--tn-selected-bg` sem `--tn-selected-text`. O par está definido em `src/styles/global.css:22-25` e o padrão do item 9 da auditoria UX é usar fundo e texto juntos.
- **Impacto:** alto. A tela existe para levar ao próximo passo, e é exatamente esse passo que não se lê. Falha WCAG 1.4.3.
- **Sugestão:** usar `--tn-action-subtle` com borda `--tn-selected-border`, como no `.tn-choice[data-selected]` de `ui.css:287`, ou aplicar `--tn-selected-text` ao título, à explicação e ao link.
- **Screenshots:** `scratchpad/a4/shots/configurar_passo_atual_375_light.png`, `scratchpad/a4/shots/configurar_passo_atual_375_dark.png`, `scratchpad/a4/shots/375x812_dark__app_configurar.png` (página inteira).

### R-02 · Alto · Home em 320 px com rolagem horizontal
- **Rota:** `/app` (e `/entrar`, que redireciona para ela), 320×640, claro e escuro.
- **Medida:** `scrollWidth` 330 com largura de 320. O terceiro cartão do resumo ("Recebido no mês", "R$ 1.740,00") passa 26 px da própria borda e 10 px da tela. Em 375 px não há rolagem, mas o valor ainda passa **8 px** da borda do cartão. Nas ações rápidas, "agendamento" (100 px de texto em 89 px) e "recebimento" (92 em 89) encostam na borda.
- **Arquivo:** `src/app/pages/pages.css:20` (3 colunas `minmax(0,1fr)`), `:23` (`.tn-today .tn-stat__value { white-space: nowrap }` com `--tn-text-group`) e `:24-41` (`.tn-quick`). O item da grade não tem `min-width: 0` e o valor não pode quebrar, então o conteúdo empurra a coluna.
- **Impacto:** alto. É a primeira tela do app e falha WCAG 1.4.10 (Reflow) em 320 px. Regressão de A11Y-01 (ver seção 4). O teste `tests/e2e/foundation/a11y.spec.ts:50` só confere 4 rotas e não inclui `/app`.
- **Observação de método:** com 500 ms de espera a Home ainda não tinha carregado o resumo e passava. O problema só aparece depois que o conteúdo assíncrono chega. Um teste de `scrollWidth` precisa esperar o resumo.
- **Screenshots:** `scratchpad/a4/shots/home_320_stats_quick.png`, `scratchpad/a4/shots/320x640_light__app.png`, `scratchpad/a4/shots/320x640_dark__app.png`.

### R-03 · Médio · Valores dos cartões de resumo saem do cartão; negativo quebra sozinho (P31 Contas, Resultado)
- **Rotas:** `/app/contas` (P31) e `/app/resultado`, 375×812. Também em janela estreita sem toque, por exemplo 375×900 no desktop.
- **Medida:** em duas colunas (`minmax(140px,1fr)`), "R$ 1.535,00" e "R$ 2.540,00" passam **7 px** da borda do cartão. Em Contas, "-R$ 1.235,00" ocupa duas linhas (72 px de altura), com o "-" sozinho em cima. O hífen comum permite a quebra.
- **Arquivo:** `src/components/ui/ui.css:373` (`.tn-stats`), `:374-385` (`.tn-stat` sem `min-width: 0`) e `:388` (`.tn-stat__value` em `--tn-text-number`). O valor vem de `src/features/finance-advanced/AccountsPage.tsx:152` (`formatCents`). Sugestão: usar o sinal de menos U+2212 sem quebra (`white-space: nowrap` no valor) e deixar a grade cair para 1 coluna, ou diminuir o número, quando não couber.
- **Impacto:** médio. Num valor financeiro, "−" separado de "R$ 1.235,00" pode ser lido como saldo positivo.
- **Screenshots:** `scratchpad/a4/shots/contas_stats_375_mobile.png`, `scratchpad/a4/shots/contas_stats_375.png`, `scratchpad/a4/shots/resultado_stats_375.png`, `scratchpad/a4/shots/new_app_contas_375_light.png`.

### R-04 · Médio · Menu do celular não prende o foco
- **Rota:** qualquer tela do app abaixo de 900 px (medido em `/app/agenda`, 375×812).
- **Medida:** ao abrir o Menu, o foco vai para "Fechar menu" (ok). Em 60 Tabs seguidos, **30 caíram fora do menu**, em "Agenda", "Horários", "Espera", "Preços", "Domicílio", "Como funciona", o campo de dia, "Dia anterior", "Hoje", "Próximo dia", que estão atrás da camada escura. O `<nav id="tn-menu">` não tem `role="dialog"` nem `aria-modal`, e o `main` não fica `inert`. Esc fecha e devolve o foco ao botão "Menu" (ok).
- **Arquivo:** `src/app/AppShell.tsx:110-127` (efeito do menu, só trata Esc) e `:201-203` (scrim e nav).
- **Impacto:** médio. Quem usa teclado ou leitor de tela navega por trás do menu sem enxergar onde está o foco (WCAG 2.4.3 e 2.4.11). As folhas `<Sheet>` já resolvem isso com `showModal()`.
- **Screenshot:** `scratchpad/a4/shots/menu_375_open.png`.

### R-05 · Médio · P46 Assistente: foco se perde ao usar uma sugestão
- **Rota:** `/app/assistente`, 320, 375 e 1440 px.
- **Medida:** com foco no chip "o que tenho amanhã?" e Enter, o foco vai para `BODY`. Tocar no chip dá o mesmo resultado. Pelo campo e Enter, o foco fica no campo (ok). A resposta entra num `aria-live="polite"` e a tela rola até ela (ok).
- **Arquivo:** `src/features/agent/AgentPage.tsx:211` (`disabled={busy}` no chip: o botão focado fica desabilitado e o Chrome tira o foco). Sugestão: `aria-disabled` com o clique ignorado enquanto responde, ou levar o foco à resposta nova (`#ag-turn-*`, como a rolagem de `:146` já faz).
- **Impacto:** médio. No teclado, o próximo Tab recomeça do topo da página (WCAG 2.4.3).
- **Screenshots:** `scratchpad/a4/shots/assist_320_quanto_rec.png`, `scratchpad/a4/shots/assist_320_marca_um_c.png`.

### R-06 · Baixo/Médio · Rótulos da barra de abas no tema escuro: o vidro deixa o fundo claro passar
- **Rotas:** o axe mediu em `/app/caixa`@320, `/app/lista-de-espera`@320, `/app/configurar`@375 e `/app/relacionamento`@768, todas no escuro. Pode acontecer em qualquer tela, conforme o que passa por baixo da barra.
- **Medida:** rótulo #BDBDB7, de 12 px, sobre o vidro `rgba(28,28,26,.70)` composto com conteúdo claro por baixo (fundo efetivo #5E5E5C): **3,44:1**, quando o mínimo é 4,5:1. O texto da página também aparece legível por trás dos rótulos, por exemplo "Recebi R$ 60,00 no Pix" sob "Hoje / Agenda".
- **Arquivo:** `src/app/shell.css:172-206` (`.tn-tabbar`) e `brand/tokens/tokens.css:153` e `:184` (`--tn-glass-bg` com 0,70).
- **Impacto:** baixo a médio. É intermitente, mas fica na navegação principal.
- **Screenshots:** `scratchpad/a4/shots/tabbar_vidro_caixa_320_dark.png`, `scratchpad/a4/shots/320x640_dark__app_caixa.png`.

### R-07 · Baixo · Alvos de toque menores que 44 px (regra da marca)
Medidas iguais em todos os tamanhos. Nenhum desses links está dentro de uma frase.

| Alvo | Medida | Rota | Arquivo |
|---|---|---|---|
| "Ver sugestões em Metas e sugestões" (P45, novo) | 281×**20** | `/app/mensagens` (375+) | `src/features/growth-advice/Insights.tsx:171` |
| "Ajustar o texto com o assistente" (P46, novo) | ×24 | `/app/relacionamento` | `src/features/lifecycle/LifecyclePage.tsx:101` (classe `tn-lc-assist` sem CSS) |
| "Redigir a apresentação com o assistente" (P46, novo) | ×24 | `/app/site` | `src/features/presence/PresencePage.tsx:43` (classe `tn-prs-assist` sem CSS) |
| "Avaliar" | 44×**17** | `/app/conta/reservas` | `src/features/identity/MyBookingsPage.tsx:41` |
| "Voltar para a conta" | ×20 | `/app/conta/reservas` | identity |
| "Trocar senha", "Tenho um código de vínculo", "Minhas reservas" | ×24 | `/app/conta` | identity |
| "Voltar" | 44×24 | `/app/conta/nova-senha`, `/vincular`, `/novo-negocio` | identity |
| "Voltar para entrar" | ×20 | `/recuperar-senha` | `src/features/identity/AuthPages.tsx:158` |
| "Já tenho conta" | ×24 | `/criar-conta` | identity |
| "Minhas reservas" | ×20 | `/avaliar` | reputation |
| "Voltar ao perfil" | ×20 | `/app/perfil/previa`, `/avaliacoes/:slug` | `src/features/network/PublicPages.tsx:63`, `src/features/reputation/ReviewPages.tsx:452` |
| "Outras cidades" | ×20 | `/diretorio/sp/sao-paulo` | `src/features/discovery/DirectoryPages.tsx:212` |
| `input type=file` da importação | ×25 | `/app/clientes/importar` | crm |

- **Impacto:** baixo. Os alvos de 20 e 17 px ficam abaixo dos 24 px do WCAG 2.5.8, mas devem passar pela exceção de espaçamento, porque estão isolados. Todos falham a regra de 44 px da BRAND.md. A correção é a mesma do item 59 da auditoria UX: `display: inline-flex; min-height: var(--tn-size-touch)`, como já fazem `.tn-auth__links a` e `.tn-setup-step__go`.
- **Screenshots:** `scratchpad/a4/shots/alvos_conta_reservas_375.png`, `scratchpad/a4/shots/alvo_mensagens_ver_sugestoes_375.png`.

### R-08 · Baixo · Textos encurtados com reticências em 320 px
- Barra de abas: "Mensagens" vira "Mensag…" (67 px de texto em 64 px), em todas as telas do app em 320 px (`src/app/shell.css:206`). O comentário em `navigation.ts` diz que as 5 abas cabem em 360 px, mas 320 px não cabem. O nome acessível continua inteiro.
- Barra de confirmação do novo agendamento e do reagendamento: "Corte · escolha o horário" vira "Corte · escolha…" (`src/features/scheduling/scheduling.css:347`).
- Nome do negócio no topo e versão na faixa Demonstração também encurtam. Isso é intencional e o essencial continua visível.
- **Screenshots:** `scratchpad/a4/shots/tabbar_320_light.png`, `scratchpad/a4/shots/agenda_novo_barra_320.png`.

### R-09 · Baixo · Setas tipográficas ainda entram no nome acessível (A11Y-10 aberto)
- `src/features/scheduling/BookingDetailPage.tsx:86` e `BookingFlowPage.tsx:22` e `:39`: "‹ Voltar para a agenda" e "‹ Voltar para o atendimento", sem `aria-hidden` na seta.

### R-10 · Observação (fora de responsividade, não confirmado) · P44 rascunho
- Em `/app/configurar`, a frase "Sou barbeiro, sozinho, de terça a sábado das 9 às 19. Corte 50 reais 30 minutos, barba 30 reais." montou os serviços Corte e Barba com **minutos e preço vazios**. Não conferi se o parser espera outro formato. O layout do rascunho em 320 px não teve rolagem nem alvos pequenos, e o foco foi para "Montar de novo". Screenshot: `scratchpad/a4/shots/setup_rascunho_320.png`.

### O que passou (medido)
- **Rolagem horizontal:** nenhuma, salvo R-02, em 59 rotas × 6 tamanhos × 2 temas.
- **Foco visível:** anel de 3 px `rgb(29,90,166)` em todas as paradas de Tab medidas (`/app`, `/app/agenda`, `/app/clientes`, `/app/configurar`, `/app/metas`, `/app/assistente`, `/app/contas`, `/app/domicilio`, `/app/caixa` e `/criar-conta`, em 1440 e 375, 30 Tabs mais 8 Shift+Tab). Nenhum elemento focado ficou fora da vista ou embaixo do topo fixo. Num campo de data o script chegou a ler "outline none" no meio da sequência, mas na verificação direta o anel aparece (`scratchpad/a4/shots/foco_data_domicilio_375.png`).
- **Folhas:** termos e privacidade (`/app/conta/novo-negocio`) usam `<dialog>` com `showModal`. O foco vai ao título, o Tab fica preso (só alterna entre "Fechar" e a barra do navegador), Esc fecha e o foco volta ao botão que abriu. O menu "⋯" de Clientes abre com Enter no primeiro item, e Esc fecha e devolve o foco.
- **Teclado virtual (simulado):** viewport reduzido de 375×812 para 375×420 e foco no primeiro, no penúltimo e no último campo de 15 telas (`/criar-conta`, `/recuperar-senha`, `/app/agenda/novo`, `/app/configurar`, `/app/assistente`, `/app/contas`, `/app/domicilio`, `/app/metas`, `/app/conta`, `/app/perfil`, `/app/mensagens/simulador`, `/avaliar`, `/indicar` e outras). Todos os campos ficaram visíveis e sem nada por cima, incluindo a barra de abas. O `scroll-padding-bottom` funciona.
- **Telas novas:** além de R-01, R-03, R-05 e dos links de R-07, Domicílio (P29), Metas e insights (P45, na Home e em Metas) e o Assistente (P46) passaram sem rolagem, sem contraste baixo e com alvos de 44 px nos tamanhos medidos.
- **Títulos:** todas as 59 rotas têm `<title>` próprio.

## 4. Regressões em relação às auditorias anteriores

| Item anterior | Situação agora |
|---|---|
| **A11Y-01** (reflow em 320 px), dado como corrigido | **Regressão** na Home (R-02). As 4 rotas originais continuam ok, mas `/app` passou a rolar depois do resumo do dia. O teste só cobre as 4 rotas antigas. |
| **UX 9** ("Selecionado" com uma aparência só: fundo de ação + texto invertido) | **Regressão** no P44 (R-01): tela nova usa `--tn-selected-bg` sem `--tn-selected-text`. |
| **UX 1** e **UX 7** (contraste dos tokens nos dois temas) | **Regressão** no P44 (R-01). R-06 (vidro da barra de abas) não aparecia na auditoria anterior. |
| **UX 59** (links de 44 px e com texto específico) | **Regressão de padrão** nas telas novas: links do P45 (20 px) e do P46 (24 px), em R-07. |
| **UX 3** (rótulo da aba legível) | "Mensagens" encurtado em 320 px (R-08). Não sei se a auditoria anterior mediu 320 px; trate como ponto a conferir. |
| **A11Y-07** (alvos de 24 px em Conta, "Voltar" etc.) | **Ainda aberto**, não é regressão: "Trocar senha", "Tenho um código de vínculo", "Minhas reservas" e "Voltar" continuam com 24 px. "Voltar ao início" da 404 foi corrigido. |
| **A11Y-08** (menu do celular escondendo itens) | Resolvido (o menu virou painel). Apareceu o problema novo R-04, de foco não preso. |
| **A11Y-10** (setas no nome acessível) | Ainda aberto (R-09). |
| **A11Y-03, A11Y-02, A11Y-14, UX 2, UX 16, UX 17, UX 20 e UX 60** | Sem regressão no que foi medido: pular para o conteúdo, títulos, foco não encoberto pelo topo, campos de 16 px no toque, folhas e Custo por cliente em cartões no celular. |

## Lacunas (não medido)
- **WebKit e Safari do iPhone:** não estão instalados em `/opt/pw-browsers`. Não medi zoom real, `100dvh`, safe areas nem comportamento real do teclado no iOS.
- **Teclado virtual real:** a simulação reduz o viewport, como no Android. No iOS o teclado reduz só o *visual viewport* e elementos `position: fixed` se comportam de outro jeito.
- **Leitores de tela reais:** VoiceOver, TalkBack e NVDA não foram testados. Só verifiquei regiões `aria-live` por DOM.
- **Folhas de formulário (`FormPanel`)** de Clientes e Serviços: na demonstração a API do CRM é somente leitura (`createDemoCrmApi`, `readOnly: true`), então "Novo cliente" e "Novo serviço" ficam desabilitados e não abriram. A folha de "Enviar modelo aprovado" (Mensagens) exige número conectado e também não foi aberta.
- **Estados não cobertos:** conversa `/app/mensagens/:contactId` (nenhum link encontrado na demonstração), perfil e site publicados (`/p/:slug`, `/s/:slug`), links com token válido, erros de formulário e confirmações. Esses estados não estavam na varredura.
- A detecção de texto que passa da borda do cartão (R-02 e R-03) rodou só em 320, 375 e 768 px, no tema claro.
- Os campos de hora apareceram em formato AM/PM no Chromium headless, mesmo com `locale: pt-BR`. Não tratei isso como achado, porque pode ser efeito do ambiente.

## Arquivos
- Scripts: `a4/sweep.mjs`, `a4/measure.js`, `a4/routes.mjs`, `a4/interact.mjs`, `a4/escape.mjs` e auxiliares. Dados: `a4/sweep.json` (708 registros), `a4/sweep_v1_500ms.json` (primeira passada, espera curta), `a4/interact.json`, `a4/escape.json` e `a4/analysis.txt`.
- Screenshots: `scratchpad/a4/shots/`. Nos screenshots de página inteira, a barra de abas fixa aparece no meio da imagem: é um efeito da captura, não um problema da tela.
