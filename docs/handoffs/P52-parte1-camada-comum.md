# P52 · Camada comum do front, parte 1 · handoff

Sessão Claude Code (conta do Felipe), 20/11/2026. Branch `claude/consolidate-lib-migrate-modules-jbw7y4`.
Base: linha P52 de `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md`, docs 15 e 16 da mesma revisão, decisões D13 e D32 (b).

## Entregue

| PR | O que |
|---|---|
| #110 (1/6) | `src/lib` com um só de cada, regra de lint, teste das portas de servidor contra o registro |
| #114 (2/6) | Materiais, Caixa, Contas a pagar, Recorrência |
| #121 (3/6) | Clientes (crm), Mensagens, Retorno (lifecycle), Lista de espera |
| #122 (4/6) | Preços, Orçamentos (sales, telas do dono e link público), Resultados (analytics) |
| #124 (5/6) | Campanhas, Indicações, Equipe (resources) |
| este PR (6/6) | Domicílio (field-service), Fiscal, Serviços operados, Metas (growth-advice), este handoff |

### 1. `src/lib`, um só de cada (`src/lib/README.md`)

- **Dinheiro (D13):** `money.ts` (`parseBRL`, `formatCents`, `centsToInput`), já criado na Onda 0. Nenhum módulo da área tem mais cópia própria.
- **Chave e comando idempotente:** `idempotency.ts`. Ele consolida o hook da Onda 0 (`useAttemptValue`, `useIdempotencyKey`) e acrescenta dois:
  - `useCommand()`: ação de um toque. Mantém a chave no erro e a troca no sucesso ou quando a intenção muda.
  - `newIdempotencyKey()`: chave fixa enquanto a tela está aberta.
- **Datas e fuso:** `time.ts`.
  - Relógio único: `now()`, `today(fuso)` e `setClockForTest`.
  - Formatos que os módulos montavam à mão: `formatDate`, `formatDayMonth`, `formatDateTime`, `formatWeekdayDate`, `formatSlot`, `formatStart`, `formatMonth`, `formatCivilDate`.
  - Limites do dia: `localDate`, `startOfLocalDay`, `startOfNextLocalDay`, `noonOfLocalDay`, `endOfLocalDay`, `localToIso`.
- **Erros de API:** `errors.ts`. Cada módulo declara só a sua tabela de frases (`errorExplainer({ "CODIGO.campo": … })`); `errorInfo`, `serverMessage` e `SAFE_RETRY` são comuns. A procura considera só as chaves da própria tabela, para que um `code` como `toString` não vire frase.
- **Telefone:** `phone.ts` (Onda 0).
- **Link público:** `public-link.ts` (`takeLinkToken`). Orçamento e oferta de vaga usam; pagamento e convite são da parte 2.

### 2. Troca das chamadas

Nos 18 módulos da área não sobra `newKey`, `createKeyRing`, `crypto.randomUUID` fora da emulação, cópia de `formatCents`/`parseBRL`, `Intl.NumberFormat` de moeda, nem `new Date()`/`Date.now()` em tela. Duas mudanças de efeito, pedidas pela regra do arquivo de idempotência:

- **Ações de um toque:** antes, cada toque gerava chave nova. Agora, depois de uma falha, tocar de novo manda a mesma chave.
- **Relógio dentro do pedido idempotente:** saiu de dois lugares. O pagamento em Contas a pagar e a validade do acesso em Serviços operados passam a usar `useAttemptValue`, então a nova tentativa manda o mesmo instante.

Textos na tela e corpos enviados não mudaram.
- **Testes de "falhou, tocar de novo manda a mesma chave":** um por tela com teste de tela. São cinco: Caixa, Contas, Recorrência, Serviços operados e Metas.
- **Equivalência de datas:** antes de trocar, a saída antiga e a nova foram comparadas dia a dia, de 2017 a 2028, em 7 a 16 fusos, conforme o módulo.

### 3. Lint (`eslint.config.js`)

Três grupos de `no-restricted-syntax`:

- **`NO_MONEY_COPY`:** declaração de `formatCents`, `parseBRL` e afins; `Intl.NumberFormat` com `style: "currency"`; `Math.round(Number(x) * 100)`.
- **`NO_KEY_GENERATOR`:** `crypto.randomUUID()`; declaração de `newKey`, `createKeyRing` e afins.
- **`NO_LOOSE_CLOCK`:** `new Date()` sem argumento e `Date.now()` em `.tsx`.

Onde valem:

- **Código do app:** `src/features`, `src/app` e `src/components` (testes fora).
- **Emulação:** só a regra de dinheiro vale nela.
- **Arquivos ainda não migrados:** ficam em `LEGACY_MONEY`, `LEGACY_KEY` e `LEGACY_CLOCK`. A seção "Parte 1" dessas listas ficou vazia; o que resta é da parte 2. A lista só diminui.

### 4. Rede de proteção (D32 b)

`tests/contracts/server-ports/harness.ts` monta a porta com um `call` falso e chama todos os métodos. Para cada chamada, confere com `OPERATIONS`:

- a rota existe no registro e está no módulo certo;
- o corpo passa no schema de entrada;
- o schema de saída é o mesmo objeto do registro;
- comando leva a chave que a tela passou, e consulta não leva chave;
- o header do negócio vai quando deve.

A resposta é gerada a partir do schema de saída e validada por ele. Se a porta ganhar um método sem caso no teste, o teste falha.

- **Cobertura:** 18 arquivos, um por módulo da área.
- **Conferido por mutação:** cinco defeitos injetados, cinco pegos.

## Achados (não corrigidos)

1. **Registro atrás do handler do CRM:** `customer.get` não está em `OPERATIONS`, e `customer.upsert` está com o schema antigo. Os dois ficam como `it.fails` em `server-ports/crm.test.ts`. Issue #111 (`para-felipe`).
2. **Serviços operados:** `service-ops/OpsPage.tsx` mostra "Acesso até …" com `toLocaleDateString("pt-BR")` sem fuso, ou seja, no fuso do aparelho.
3. **Caixa:** `finance/money.ts` `endOfLocalDay` dá 1 hora a menos nos dias em que o horário de verão começa à meia-noite. Hoje isso não acontece no Brasil (5 datas em São Paulo entre 2017 e 2019). Mantido; o `endOfLocalDay` da lib dá o valor certo.
4. **Equipe:** `resources/labels.ts` `localMidnight` e `localInstant` mandam ISO sem milissegundos ao servidor. Não troquei pelos da lib (que mandam `.000Z`) para não mudar o corpo.
5. **Chave que troca também no erro:** em `campaigns` `NewCampaign`, `resources` `BookingForm` e `growth-advice` `GoalForm`, a nova tentativa depois de uma falha sai com chave nova. Foi mantido porque a prévia e os horários são recalculados ali. `lifecycle/RetornoPage.tsx` guarda uma chave por passo que nunca é descartada; também mantido.

## Para a parte 2 (P53)

**Módulos fora da área** (ainda têm `newKey`, cópia de dinheiro ou relógio solto; ver as listas de legado do lint):

- scheduling, network, presence, reputation, setup, agent e identity;
- payments e discovery, que não estavam em nenhuma das duas listas do pedido e por isso não foram tocados.
- **Link público:** `payments/PayLinkPage.tsx` e `network/PublicPages.tsx` ainda têm a sua cópia de `takeToken`.
- **Telefone:** `scheduling/agenda.ts` e `network/PublicProfileView.tsx` ainda têm cópias do analisador.

**`module.tsx` e `src/app`** (fora da área por pedido):

- `analytics/module.tsx` tem `realNow`, na lista `LEGACY_CLOCK`.
- `payments`, `lifecycle` e `messaging` começam com o fuso da fixture (`tenantA.timezone`). Resolve com o contexto do negócio na sessão (R5).
- Os 42 `createApiClient` e as buscas a `/context` continuam como estavam (R4/R5).

**Origem do fuso e do relógio:**

- Os `serverPort` ainda têm `now: () => new Date()` (finance, pricing, sales, waitlist, analytics, service-ops), e `field-service/serverPort.ts` tem `todayIn`. Saem quando o relógio vier da sessão.
- Fuso padrão `"America/Sao_Paulo"` embutido enquanto a base carrega, em vários labels e telas (campaigns, referrals, fiscal, growth-advice, recurrence, waitlist, lifecycle, sales, pricing, analytics). Mantive com wrappers finos; sai com o contexto do negócio na sessão.

**Chave perdida quando a lista recarrega:** `useCommand` guarda a chave no componente. Se o erro faz a lista recarregar e recriar a linha, a chave se perde. Resolve junto com `useResource`, que mantém a árvore montada (R7).

**Ainda com cópia própria de data, por não haver formato equivalente na lib:**

- `waitlist` `localWeekdayTime` e `field-service` `dayLabel`;
- `fiscal` `formatDate` (`dateStyle: "short"`);
- `referrals` `formatMonth` (MM/AAAA);
- `finance-advanced` `periodLabel`;
- `analytics` `localDayStart` e `monthStartOffset`.

**Arreio de portas:**

- `tenantExceptions` foi acrescentado para a fila do operador. `service-ops.test.ts` ainda usa o contorno com dois `call`; dá para simplificar.
- A chave derivada de `waitlist.join` (`${key}-consent`) é testada fora do `exercisePort`.

**Rede de proteção D32 (a)**, a jornada contra o Supabase local, é de P59.

## Testes, comandos e resultados

Cada commit foi verificado numa worktree limpa, sem as mudanças ainda não commitadas:

- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:contracts` e `npm run build`;
- e2e dos módulos do grupo em desktop, Pixel 7 e 375 px. A config local `playwright.local.config.ts` (fora do git) usa o Chromium pré-instalado e acrescenta o perfil de 375 px.

Integração, banco e e2e completo rodam no CI de cada PR; nenhum PR muda função ou migration. Números de cada PR estão na descrição dele.

## Contratos, migrations, flags

Nenhum contrato, migration ou flag mudou. Nada foi aplicado na homologação.

## Coordenação

- **Quadro:** `coord.py` não tem P52 (o quadro vai até P46), então não houve `claim`. Pacote reservado só por este pedido.
- **Merge:** feito pela sessão com o CI verde, autorizado pelo Felipe no pedido.
- **Push forçado:** foi negado pelo modo automático. Depois do squash do #110, a ponta antiga da branch foi juntada com um merge `-s ours`, sem mudar conteúdo.

## Próximo passo

P53 (parte 2): migrar os módulos listados acima, esvaziar as listas de legado do lint e fazer R4, R5 e R7 do doc 15.
