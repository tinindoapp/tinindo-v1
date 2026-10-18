# Auditoria de acessibilidade · WCAG 2.1 AA

Data: 18/10/2026 · Base: `main` em `b7719a7` · App em demonstração offline (sem Supabase), build de produção (`vite preview`).
Escopo: as telas que existem hoje (shell, Início, Agenda, Clientes/Serviços/Importar, Perfil e as páginas públicas, Conta, placeholders de Caixa/Preços/Lista de espera/Assistente, 404). Este relatório **não corrige código**: cada item traz a correção sugerida e o pacote dono do caminho.

## Resumo

| Gravidade | Qtde | Itens |
|---|---|---|
| Alta | 1 | A11Y-01 |
| Média | 5 | A11Y-02 a A11Y-06 |
| Baixa | 7 | A11Y-07 a A11Y-13 |
| Informativo | 2 | A11Y-14, A11Y-15 |

A varredura automática (axe-core, regras WCAG 2.0/2.1 A e AA) passou em 20 rotas × 2 temas e em 7 estados dinâmicos: só restou o aviso de boa prática `region` (A11Y-09). Os problemas reais apareceram nos testes manuais: reflow em 320 px, título da página, foco e alvos de toque. O leitor de tela de verdade e o iPhone Safari (UX-01) **não foram testados** (ver "Lacunas").

Gravidade: **Alta** = um critério AA falha e bloqueia ou atrapalha muito uma tarefa; **Média** = um critério A/AA falha, mas há contorno; **Baixa** = falha parcial, regra da marca (BRAND.md) ou risco latente; **Informativo** = WCAG 2.2 ou boa prática.

## Achados

### A11Y-01 · Alta · Rolagem horizontal em 320 px (1.4.10 Reflow)
- **Onde:** `/app/clientes/importar` (largura do documento 410 px), `/app/conta` (396), `/app/conta/novo-negocio` (395), `/app/perfil` (340). Viewport de 320 × 640.
- **Causa:** inputs nativos (`input[type=file]`, `input` de texto, `select`) dentro de `.tn-field` (`display: grid`) mantêm a largura intrínseca e empurram o cartão inteiro.
- **Correção sugerida:** em `src/components/ui/ui.css` (integrador): `.tn-field { min-width: 0 } .tn-field input, .tn-field select, .tn-field textarea { width: 100%; min-width: 0; max-width: 100% }`. Injetada no navegador, essa regra zerou a rolagem nas quatro telas. Acrescentar ao smoke um teste de `scrollWidth` em 320 px para essas rotas.
- **Dono:** integrador (`src/components/ui/`); conferir P01 (`identity.css`) e P09 (`network.css`) depois.

### A11Y-02 · Média · Título da página é sempre "Tinindo" (2.4.2 Página com título)
- **Onde:** todas as rotas. Quem usa leitor de tela, histórico ou várias abas não sabe em que tela está.
- **Correção sugerida:** título por rota no padrão "Agenda · Tinindo", "Novo agendamento · Tinindo", "Barbearia Exemplo A · Tinindo" (perfil público). Pode ser `handle.title` nas rotas mais um efeito no `AppShell`/router que aplica `document.title`, ou `<title>` do React 19 em cada página.
- **Dono:** integrador (`src/app/router.tsx`, `AppShell.tsx`); cada módulo informa o próprio título.

### A11Y-03 · Média · Não há "Pular para o conteúdo" (2.4.1 Ignorar blocos)
- **Onde:** shell autenticado. Pelo teclado são 10 paradas (logotipo + 9 itens do menu) antes do conteúdo, em toda troca de tela.
- **Correção sugerida:** primeiro elemento do `AppShell`: `<a class="tn-skip" href="#conteudo">Pular para o conteúdo</a>`, visível no foco. O `<main id="conteudo">` já existe. Para o foco chegar, `main` precisa de `tabIndex={-1}`.
- **Dono:** integrador (`src/app/AppShell.tsx`, `shell.css`).

### A11Y-04 · Média · O foco se perde em trocas de rota e depois de ações (2.4.3 Ordem do foco, 4.1.3 Mensagens de status)
- **Medido:** depois de "Confirmar agendamento", o app navega para o detalhe e o foco vai para `<body>`. O mesmo acontece ao abrir "Cancelar atendimento" (o campo Motivo não recebe foco) e no conflito 409. Pelo menu, o foco fica no link clicado e nada anuncia a tela nova.
- **Impacto:** quem usa leitor de tela ou teclado volta ao topo e precisa achar a mensagem "Agendamento confirmado." sozinho.
- **Correção sugerida:** (a) na troca de rota, levar o foco ao `h1` da página (`tabIndex={-1}`) ou ao `main`; (b) ao abrir um painel de confirmação, focar o primeiro campo ou o título do painel; (c) após uma ação, focar a mensagem de resultado (`StatusBanner`) ou o título. Hoje o banner tem `role="status"`, mas nasce junto com a tela nova e por isso não é anunciado de forma confiável.
- **Dono:** integrador (padrão no shell/router) + P04 (`BookingFlowPage.tsx`, `BookingDetailPage.tsx`).

### A11Y-05 · Média · Erro de formulário não leva o foco ao campo e dispara vários alertas (3.3.1 Identificação do erro, 3.3.3 Sugestão)
- **Onde:** `Field` (`src/components/ui/index.tsx`), que coloca `role="alert"` em cada mensagem, e os formulários de cliente/serviço (P02), criar negócio (P01) e perfil (P09). Com três campos inválidos, o leitor anuncia três alertas seguidos e o foco fica no botão.
- **Positivo:** a mensagem é textual e tem `aria-invalid` + `aria-describedby`.
- **Correção sugerida:** no submit inválido, focar o primeiro campo com erro. Usar `role="alert"` só num resumo ("2 campos precisam de ajuste") e deixar as mensagens por campo apenas ligadas por `aria-describedby`.
- **Dono:** integrador (`Field`) + P01/P02/P09 (comportamento do submit).

### A11Y-06 · Média · Botão desabilitado sem dizer o que falta (3.3.2 Rótulos ou instruções)
- **Onde:** "Publicar perfil" fica desabilitado enquanto "Bairro ou região" está vazio, e nenhuma mensagem explica por quê (o endereço inválido tem mensagem; o bairro não). O mesmo vale para "Gerar link de convite/indicação" sem nome. Para leitor de tela, botão desabilitado nem entra na ordem do foco.
- **Correção sugerida:** manter o botão habilitado e validar no envio com mensagem por campo, ou mostrar uma instrução ligada ao botão por `aria-describedby` ("Preencha endereço e bairro para publicar"). Marcar visualmente os campos obrigatórios ("obrigatório" no rótulo).
- **Dono:** P09 (`src/features/network/NetworkHome.tsx`, `PublicPages.tsx`).

### A11Y-07 · Baixa · Alvos de toque abaixo de 44 px (regra da marca; 2.5.5 é AAA)
- **Medido em 320 px:** link do logotipo 120×30; abas Clientes/Serviços/Importar CSV com 39 px de altura; links de texto com 24 px ("Criar outro negócio", "Tenho um código de vínculo", "Trocar senha", "Voltar"); "Voltar ao início" na 404 com **20 px**, abaixo até dos 24 px da WCAG 2.2 (2.5.8). Rádios e checkboxes nativos têm 13 px, mas o rótulo inteiro é clicável (mitigado).
- **Correção sugerida:** `min-height: var(--tn-size-touch)` e `display: inline-flex; align-items: center` nesses links; abas do CRM com `min-height: var(--tn-size-touch)`; `accent-color` e 20–24 px nos rádios/checkboxes, como P09 já faz em `.tn-net-check-row input`.
- **Dono:** integrador (shell/404), P01 (`identity.css`), P02 (`crm.css`).

### A11Y-08 · Baixa · O menu do celular esconde itens sem indicação (1.3.1 / uso)
- **Onde:** em 320 px o menu tem 793 px de conteúdo, com rolagem horizontal e barra oculta (`scrollbar-width: none`). "Perfil" e "Conta" ficam fora da tela, sem pista visual de que existem. Pelo teclado funciona: o foco rola o menu.
- **Correção sugerida:** indicar o excesso (gradiente na borda, seta) ou quebrar em duas linhas; ou um menu "Mais" com os itens menos usados.
- **Dono:** integrador (`shell.css`).

### A11Y-09 · Baixa · Faixa "Demonstração" fora de qualquer landmark (boa prática axe `region`)
- **Onde:** `.tn-demo-banner` em todas as telas, antes do `header`.
- **Correção sugerida:** colocar a faixa dentro do `header`/`banner`, ou envolvê-la num `<aside aria-label="Aviso de demonstração">`. Manter o texto (exigência de AGENTS.md).
- **Dono:** integrador (`src/app/DemoBanner.tsx`).

### A11Y-10 · Baixa · Setas tipográficas entram no nome acessível
- **Onde:** links "‹ Voltar para a agenda" e "‹ Voltar para o atendimento" (P04). O leitor anuncia algo como "aspas angulares à esquerda, Voltar…". Os botões ‹ › da agenda já têm `aria-label` (correto).
- **Correção sugerida:** `<span aria-hidden="true">‹</span> Voltar para a agenda`, ou um ícone SVG com `aria-hidden`.
- **Dono:** P04.

### A11Y-11 · Baixa · "Hoje" usa `aria-pressed`, mas é ação e não alternância (4.1.2 Nome, função, valor)
- **Onde:** `AgendaPage.tsx`, botão "Hoje" com `aria-pressed={date === today}`. O leitor anuncia "Hoje, botão de alternância, pressionado", o que sugere que ele pode ser desligado.
- **Correção sugerida:** remover `aria-pressed` e indicar o dia atual no título ("Hoje · terça-feira…", que já existe) ou com `aria-current="date"` no dia da semana.
- **Dono:** P04.

### A11Y-12 · Baixa (latente) · O logotipo não acompanha `data-theme="dark"` (1.4.11 Contraste não textual)
- **Onde:** `Wordmark` troca de versão só por `prefers-color-scheme`. Com `data-theme="dark"` (suportado por `tokens.css` e citado na BRAND.md) e o sistema em modo claro, continua a versão de tinta preta (#111) sobre o fundo escuro (#111). Hoje não há seletor de tema na interface, então o problema ainda não aparece.
- **Correção sugerida:** escolher a fonte da imagem pelo tema resolvido (atributo no `html`) ou desenhar as duas e alternar por CSS `[data-theme="dark"]`.
- **Dono:** integrador (`src/components/ui/index.tsx`).

### A11Y-13 · Baixa · Validade da cotação sem aviso nem renovação (2.2.1 Tempo ajustável) — a confirmar
- **Onde:** "Valor válido até HH:MM" no novo agendamento (10 min na emulação). Ninguém é avisado quando o prazo vence, e não há como estender. Quem preenche devagar (leitor de tela, deficiência motora) pode confirmar sobre uma cotação vencida.
- **Correção sugerida:** ao vencer, recalcular a cotação de forma automática e anunciar ("O valor foi atualizado: R$ …") em `aria-live="polite"`, sem perder serviço, horário e cliente já escolhidos. Validar quando o P03 servir cotações reais.
- **Dono:** P04 (com P03/P05).

### A11Y-14 · Informativo · O cabeçalho fixo pode cobrir o elemento focado (2.4.11, WCAG 2.2)
- **Onde:** `.tn-shell__header` com `position: sticky` (56 px) e vidro. Ao navegar com Shift+Tab numa página longa, o foco pode ficar atrás do cabeçalho.
- **Correção sugerida:** `html { scroll-padding-top: calc(56px + var(--tn-space-2)) }`.
- **Dono:** integrador.

### A11Y-15 · Informativo · Muitas regiões `role="status"` estáticas
- **Onde:** avisos fixos de demonstração ("Dados de exemplo…", "Demonstração sem servidor…") usam `StatusBanner` com `role="status"`. Não falham critério, mas regiões vivas fixas criam ruído e enfraquecem os anúncios que importam (A11Y-04).
- **Correção sugerida:** prop `live={false}` no `StatusBanner` para avisos estáticos (sem `role`, com o mesmo visual), deixando `status`/`alert` para mudanças de estado.
- **Dono:** integrador (`StatusBanner`) + módulos que usam aviso fixo.

## O que já está correto

- `lang="pt-BR"`; landmarks `banner`, `navigation "Principal"`, `main`; `aria-current="page"` no menu e nas abas do CRM.
- Anel de foco visível (3 px, `--tn-focus` #1D5AA6 no claro), conferido em todas as paradas de Tab do shell; contraste dos tokens aprovado em `brand/tokens/contrast-report.md` (claro e escuro).
- Rótulos associados a todos os campos; erros com `aria-invalid` + `aria-describedby`; grupos com `fieldset/legend` (serviço, horários, profissão, objetivo).
- Estado nunca só por cor: `StatusBanner` e o selo de status da agenda têm ícone + texto, com prefixo oculto "Informação:", "Erro:".
- Horários selecionáveis com `aria-pressed`; ocupação como `meter` com nome; linha do tempo como lista nomeada.
- `prefers-reduced-motion` respeitado (transição cai a ~0); texto a 200% e espaçamento de texto 1.4.12 sem rolagem horizontal na agenda.
- Perfil público e convite sem dados privados; a faixa "Demonstração" está presente em todas as telas.

## Método e evidências

- Build de produção (`npm run build` + `vite preview`), Chromium 1194 do Playwright 1.56.1. Viewports: 1280×720 (desktop), Pixel 7 e 320×640.
- **Automático:** axe-core 4.10.2 injetado pelo Playwright (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `best-practice`), sem entrar em `package.json`. 20 rotas em tema claro e escuro, mais estados: semana da agenda, erro e confirmação do agendamento, painel de cancelamento com erro, conflito 409, perfil publicado + convite gerado, prévia do perfil, prévia de importação. Resultado: 0 violações A/AA; 1 aviso `region` por tela.
- **Manual (scriptado):** sequência de Tab no shell e estilo do foco; elemento focado após cada ação; `scrollWidth` em 320 px por rota (e com a correção de A11Y-01 injetada); tamanho de todos os alvos interativos; `document.title` por rota; menu do celular; texto a 200% e espaçamento 1.4.12; `prefers-reduced-motion`; `data-theme="dark"`.
- Revisão de código: `src/components/ui`, `src/app`, `src/features/*/` (CSS e marcação ARIA).

## Lacunas (não verificado)

- Leitores de tela reais: VoiceOver no iPhone Safari e no macOS, NVDA/JAWS no Windows, TalkBack. **UX-01 de docs/10 continua aberto.**
- iPhone Safari real (zoom, teclado virtual sobre campos, `100dvh`).
- Modo de alto contraste do Windows (`forced-colors`), controle por voz, `prefers-reduced-transparency` no vidro.
- Fluxos que dependem de servidor: login real, gravação no CRM, assistente (P08), caixa (P07), lista de espera (P06). Auditar quando saírem do placeholder, em especial os cinco estados do agente e a tela de aprovação.
