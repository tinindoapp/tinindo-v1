# P54 · Regras de layout no ciclo principal · handoff

Sessão Claude Code (conta do Felipe), 20/11/2026. Branch `claude/consolidate-lib-migrate-modules-jbw7y4`.
Base: linha P54 de `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md` e docs 06, 07 e 11 da mesma revisão.
Decisões aplicadas: D11 (b), D12 (b), D15, D16 e D17 (b).

## Entregue

| PR | O que |
|---|---|
| #139 (1/3) | Padrões no kit (`src/components/ui`, `src/styles`) e a Hoje |
| #144 (2/3) | Clientes, ficha do cliente e Retorno |
| este PR (3/3) | Caixa, e2e de `tests/e2e/qa` no Caixa novo, este handoff, medidas e capturas |

### 1. Padrões no kit

| Padrão | Onde | Regra |
|---|---|---|
| Abertura de tela | `PageHeader` (`index.tsx`): `eyebrow`, `title`, `subtitle`, `actions`, `filter`, `help` | Sempre nessa ordem, sem cartão e sem aviso de ambiente (D11 b). |
| Seção | `Section` (`count`, `collapsed`) | 32 px entre seções (40 no largo), 16 px entre blocos. Um tamanho de h2. A contagem fica fora do nome da região. |
| Lista | `ActionRow`, `CappedList`, `ListCutNote`, `List timeline` | No máximo uma ação visível por linha e o resto no "⋯". Link e botão da linha são irmãos. 5 itens e "Ver todos (N)". "Mostrando os 200 mais recentes." quando o servidor cortou. |
| Resumo de número | `Summary`, `SummaryHero`, `SummaryRows` | O número principal sozinho, grande e tabular, com rótulo em caixa-alta (D17 b). Os outros em linhas. Sem ladrilho no celular. |
| Barra de ações | `ActionBar`, `Button size="compact"` | Uma ação principal. Fantasma com cor de link e sublinhado. Botão de linha compacto, mas com 44 px de toque. |
| Preto só para ação | tokens `--tn-selected-*` em `global.css` | Segmentado, chip e sub-aba: o valor escolhido é fundo sutil com contorno (texto a 16,10:1 no claro e 13,41:1 no escuro). No celular o segmentado não quebra mais de linha. |
| Selo de estado com tom | `StatusBadge` (`success`, `warning`, `danger`, `info`, `neutral`) | Ícone e texto, fundo a 12% do tom sobre o cartão. Nunca pílula preta. |
| Tokens de papel | `global.css` | `--tn-gap-item/block/section/opener`, `--tn-row-min` (56 px), `--tn-measure` (68ch), `--tn-text-number-sm` (20 px), `--tn-text-lead` (18 px). h3 com 16 px em qualquer contêiner. Números tabulares no `body`. |

Testes do kit: `src/components/ui/layout.test.tsx`.

### 2. Telas, 390×844, demonstração, tema claro

Limite: duas alturas de celular, 1.688 px.

| Tela | Antes | Depois | Telas |
|---|---|---|---|
| Hoje `/app` | 1.553 px | 1.608 px | 1,84 → 1,91 |
| Caixa `/app/caixa` | 3.830 px | **1.677 px** | 4,54 → 1,99 |
| Clientes `/app/clientes` | 1.067 px | 844 px | 1,26 → 1,00 |
| Ficha do cliente | 3.093 px | **1.618 px** | 3,66 → 1,92 |
| Retorno `/app/relacionamento/retorno` | 1.204 px | 1.097 px | 1,43 → 1,30 |

A Hoje já cabia depois do P48. Subiu 55 px porque os números viraram uma seção com título ("Números"). Ganhou a linha do tempo do dia e os selos da D15.

**Caixa:**
- **Abertura:** "Registrar" é a única ação principal; o seletor de mês é o filtro.
- **Resumo:** "Sobrou no mês" em número grande, e hoje, semana, mês, gasto e a receber em linhas.
- **Sem cobrança:** uma linha por atendimento, com "Recebi R$ X no Pix ▾" visível; "Cobrar depois" e "Usar crédito" vão para o "⋯".
- **A receber:** "Registrar recebimento" visível; "Cancelar cobrança" vai para o "⋯".
- **Histórico do mês (recolhido):** um segmentado mostra Recebimentos, Despesas ou Pacotes, uma lista por vez, com 5 itens e "Ver todos". "Estornar" fica no "⋯".
- **Saíram:** o subtítulo, o aviso "Dados de exemplo" e o alerta repetido "Cobrar agora".
- **Arquivos novos:** `FinancePage.tsx` foi dividido em `shared.tsx`, `forms.tsx`, `sections/Pending.tsx` e `sections/History.tsx`.
- **Altura com o histórico aberto:** sobe cerca de 400 px. Ele nasce recolhido justamente para a tela caber.

**Ficha do cliente:**
- **Abertura:** "Agendar" é a ação principal; WhatsApp e Ligar ficam como fantasma.
- **Resumo de retorno:** a última visita em número grande, e concluídos, faltas e próximo atendimento em linhas.
- **Próximos e Anteriores:** em linhas com selo e link para o atendimento. Anteriores mostra 5 e "Ver todos".
- **Contato:** fica no fim.

**Clientes:** linha compacta com WhatsApp visível e Ligar, Editar e Arquivar no "⋯".

**Retorno:** linhas com uma ação cada, e os nomes com alvo de 44 px.

### 3. Medidas: antes e depois

Script: `docs/handoffs/P54/medir.cjs`. Ele mede a altura da página, o contraste WCAG de todo texto (com a opacidade dos pais composta), os alvos de toque e os elementos com fundo preto. Dados brutos em `P54/medidas-*.json`.

| Tela | Contraste mínimo, claro (antes → depois) | Contraste mínimo, escuro (antes → depois) | Falhas de contraste | Alvos < 44 px (antes → depois) | Preto preenchido que não é ação, claro (antes → depois) |
|---|---|---|---|---|---|
| Hoje | 6,12 → 6,12 | 9,04 → 9,04 | 0 → 0 | 0 → 0 | 2 → 2 |
| Caixa | 6,12 → 6,12 | 9,04 → 9,35 | 0 → 0 | 0 → 0 | 1 → 1 |
| Clientes | 6,12 → 6,12 | 9,04 → 9,04 | 0 → 0 | 0 → 0 | 2 → 1 |
| Ficha | 6,12 → 6,12 | 9,04 → 7,62 | 0 → 0 | 0 → 0 | 1 → 1 |
| Retorno | 6,12 → 6,12 | 9,35 → 9,04 | 0 → 0 | 1 → 0 | 1 → 1 |

- **Contraste:** o mínimo de 6,12:1 no claro é o texto de atenção (selo "Reserva provisória" e faixa de demonstração). No escuro, o mínimo da ficha caiu para 7,62:1 por causa do selo "Concluído", que ainda passa com folga.
- **Preto que sobra:** é do shell, fora desta área. É a pílula da aba ativa da barra inferior (`src/app/shell.css:205`); na Hoje conta também o ícone da própria pílula. O segmentado "Todos" de Clientes deixou de ser preto.
- **Como ler a última coluna:** só no claro. No escuro o fundo da página é quase preto e essa contagem não diz nada.

**Capturas** (em `docs/handoffs/P54/`, a 1×; viewport de 390 px):
- `<tela>-antes-dobra.png` e `<tela>-depois-dobra.png`: a primeira tela.
- `<tela>-depois-inteira.png`: a página inteira depois.
- `caixa-antes-inteira.png` e `ficha-antes-inteira.png`: as duas telas que passavam do limite, inteiras.

### 4. Aviso de lista cortada (contrato do #132)

| Tela | Lista | Situação |
|---|---|---|
| Caixa | A receber, Recebimentos, Despesas | Aplicado (já existia desde o #132; agora no padrão do kit). |
| Caixa | Pacotes | **Falta.** O contrato tem `truncated.packages`, mas `port.packages()` devolve só a lista e descarta o campo. |
| Caixa | Sem cobrança (`finance.uncharged`) | O contrato não tem `truncated` (`.max(100)`). |
| Retorno | Lembretes a mandar | Aplicado. |
| Relacionamento | Fila de passos | Aplicado. |
| Retorno | Quem não volta | A leitura de clientes (`retorno.ts`, `customers()`) para em 10 páginas sem avisar. A fonte não expõe isso. |
| Clientes e ficha | — | `crm.ts` não tem saída com teto. A lista pagina por cursor sem limite. A ficha diz quando a leitura do histórico veio incompleta. |

### 5. Decisões dos donos

| Decisão | Situação |
|---|---|
| D11 (b) | **Aplicada na área.** Saiu o aviso de demonstração por tela de Caixa, Clientes, ficha, Serviços, Importar, Retorno e Relacionamento. "Rodar a régua (simulação)" foi para o fim do Relacionamento. Ficou de propósito o "Demonstração: editar e arquivar ficam bloqueados." dentro do "⋯" de Clientes, porque explica por que os itens estão desligados. |
| D12 (b) | **Parcial.** A Hoje só aponta: uma sugestão e "Ver todas" para Metas. A repetição está fora da área: Metas mostra "Resumo da semana", que também está em Mensagens. |
| D15 | **Aplicada na Hoje e na ficha** (Concluído verde, Confirmado neutro). A Agenda segue com o mapa próprio (`scheduling/agenda.ts:35-42`, concluído em azul). |
| D16 | **Não há alternador de tema.** Os blocos `data-theme` de `global.css` ficaram, porque `src/app/contrast-tokens.test.ts:105` exige que existam. |
| D17 (b) | **Aplicada.** Número grande tabular com rótulo em caixa-alta (Caixa e ficha), números tabulares por padrão e linha do tempo do dia na Hoje. |

## O que aplicar depois

### Agenda (`src/features/scheduling`, fora da área desta sessão)

1. **D15:** trocar `STATUS_TONE` (`agenda.ts:35-42`) e o selo `.tn-sched-badge` pelo `StatusBadge` do kit, com `completed: "success"` e `confirmed: "neutral"`. A Hoje já usa esse mapa (`src/app/pages/Home.tsx`, `STATUS_TONE`), e o ideal é que as duas telas leiam um mapa só.
2. **Abertura da Agenda** (doc 11 §3.5): uma linha com "Hoje · ter., 20/10", as setas e Dia/Semana como `filter` do `PageHeader`. Sai o h1 "Agenda" repetido no celular. A ajuda e o fuso vão para o `help`. Meta: primeiro horário com y ≤ 280 px, hoje em y=541.
3. **D11 (b):** tirar "Dados de exemplo." de `ScreenNotes` (`scheduling/parts.tsx:41`). O aviso de fuso fica.
4. **Linha do tempo:** a Agenda tem a própria. Avaliar trocar por `List timeline` do kit para a mesma assinatura da Hoje (D17 b).
5. **`Novo agendamento?cliente=<id>`:** a ficha já leva para lá, mas `BookingFlowPage.tsx` só lê `data` e `inicio`. Ler `cliente` e já marcar o cliente.
6. **Horários** (doc 11 §3.7): "Bloqueios" antes do expediente, com chips Manhã, Tarde e Dia inteiro.

### Páginas públicas (`src/features/network`, `sales/QuoteLinkPage`, `waitlist/OfferPage`, `payments/PayLinkPage`)

1. Abertura com `PageHeader` e um botão principal por tela. Na reserva em etapas, o principal é "Continuar"/"Confirmar".
2. `StatusBadge` no lugar de estados escritos como pílula preta (doc 06 achado 09: fiscal, presença e diretório).
3. Perfil público (`network/PublicProfileView.tsx`, 691 linhas): resumo do profissional no topo e a lista de serviços com `ActionRow` (uma ação: "Agendar").
4. As telas de token (orçamento, oferta, pagamento) já têm um cartão e 2 ou 3 estilos de texto (doc 07 §7). Manter, só trocar o selo e o botão pelos do kit.

### Configuração (`src/features/setup`)

1. Doc 07 §4.9: progresso, depois os passos pendentes abertos, depois os feitos recolhidos em uma linha (`Section collapsed count`). "Descreva seu negócio" e "Modelos de serviço" entram no passo correspondente. Meta: 1.200 px (hoje 2.485).
2. Um botão principal, o do próximo passo. Os feitos sem botão preto.
3. O cartão "Deixe seu negócio pronto" da Hoje (`setup/SetupCard.tsx`) usa barra preta como progresso. Pode ficar (`<meter>` com a cor de ação, já decidido), mas o link do passo deve ser fantasma do kit.

### Shell e outros (fora da área; recado `para-felipe`)

- **Barra de abas:** a aba ativa é pílula preta (`src/app/shell.css:205`, `--tn-selected-indicator`) e o selo de não lidas também (`shell.css:217` e `:230`). Pela regra "preto só para ação", a aba ativa passaria a fundo sutil com contorno, como as sub-abas do kit, e o selo a `StatusBadge`/tom de atenção. Mexe em `src/app`.
- **D16:** se o tema segue só o sistema, os blocos `:root[data-theme="dark"]` de `global.css` e `tokens.css` são código morto. Tirar exige mudar `src/app/contrast-tokens.test.ts:105` e `brand/tokens`.
- **D12:** em Metas, juntar "Sugestões para você" com "do mês" e tirar "Resumo da semana", que fica em Mensagens (doc 07 §4.4).
- **Caixa, pacotes:** repassar `truncated.packages` em `finance/port.ts` (`packages()` devolve só a lista) para mostrar o aviso.
- **Retorno:** `retorno.ts` precisa dizer quando parou em 10 páginas de clientes.
- **Outras telas acima de duas alturas** (doc 07 §4): Metas (4.530 px), Relacionamento (3.310), Resultado (2.994), Site (2.861), Contas (2.711), Configurar (2.485) e Preços (2.387). Os padrões do kit cobrem todas.
- **Kit, pedidos dos módulos:**
  - `ActionRow` com conteúdo embaixo da linha (formulário, confirmação) e atributos no `<li>` (`id`, `data-focus`). O Caixa fez um `Row` local.
  - `ConfirmAction` aberto a partir de um item do "⋯". O Caixa fez um `InlineConfirm` local.
  - `MenuAction` com `href`: "Ligar" usa `location.assign("tel:")`.
  - `Section` com título que recebe foco. O Caixa fez um `FinSection` local.
  - `PageHeader help` com rótulo próprio.
  - `CollectActions` com variante só "Recebi … ▾". O Caixa recriou o botão dividido.

## Testes, comandos e resultados

Cada PR foi verificado numa cópia limpa do commit, sem as mudanças ainda não commitadas:

- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:contracts` e build.
- e2e com os projetos do CI (piloto, recursos e guardados) em **desktop e 375 px**. Foi uma cópia de `playwright.config.ts` com o Chromium pré-instalado e o perfil de celular em 375×812.
- **#139:** 1019 unitários e 316 e2e passaram (34 pulados, que já eram).
- **#144:** 1041 unitários e 316 e2e passaram.
- **Este PR:** números na descrição.
- Integração e banco: pelo CI; nenhuma função ou migration mudou.

e2e que mudaram de seletor, sem mudar o que verificam:

- `foundation/a11y.spec.ts:165` (valor da Hoje cabe em 320 e 375 px).
- `growth-advice/insights.spec.ts` (ordem dos blocos da Hoje).
- `tests/e2e/qa/*`: o Caixa novo pede abrir o histórico, usar o "⋯" e as linhas do resumo. Os helpers `openCaixaHistory` e `caixaSummaryValue` estão em `qa/helpers.ts`. Em `uat-barbeiro` 9a, "Dados de exemplo." passou a ser verificado como **ausente** (D11 b).

## Contratos, migrations, flags

Nenhum contrato, migration ou flag mudou. Nada foi aplicado na homologação.

## Coordenação

- **Quadro:** o `coord.py` não tem P54 (vai até P46), então não houve `claim`.
- **Merge:** feito pela sessão com o CI verde, autorizado pelo Felipe no pedido.
- **Subagentes:** dois em paralelo, um no Caixa e outro em Clientes e Retorno, cada um só nas pastas do seu módulo.
