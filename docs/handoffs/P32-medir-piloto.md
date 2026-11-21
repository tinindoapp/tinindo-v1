# P32 (parte) · Medir o piloto e devolver valor · handoff

Sessão Claude Code (conta do Felipe), 21/11/2026. Pacote: uso real, painel do piloto, relatório ao profissional e
previsão simples. Um PR por bloco, mesclado com o CI verde (autorizado pelo Felipe).

**Nada foi aplicado na homologação.** Sem contas aqui; tudo foi testado contra o Postgres local (PG 16 com o shim) e na
demonstração.

Reserva: o P32 está no quadro do `coord.py` como "planejado, não ativado"; esta parte foi pedida direto pelo Felipe,
com a área definida no pedido. Sem `claim`, como nos pacotes P54 a P58.

## Bloco 1 · Uso do produto sem dado pessoal

### Entregue

- **Migration** `…_p32_uso.sql`, só aditiva:
  - `public.usage_events`: negócio, tipo (`screen` ou `command`), nome, resultado (`ok`, `refused`, `error`), código do
    catálogo e horário. **Sem coluna de usuário, IP, valor, texto ou corpo.** O `check` só aceita rota que começa em
    `/app` com trechos `[a-z0-9:._-]` e nome de comando `<função>/<operação>`.
  - `public.usage_batches`: id do lote já recebido (o mesmo lote de novo não grava).
  - `public.usage_settings`: o negócio liga ou desliga. **Sem linha = ligada.**
  - Retenção na tabela de prazos do P57: `usage_events` **30 dias**, `usage_batches` 2 dias. Quem apaga é a rotina nova
    `usage_retention` em `job_ticks` (`app.usage_tick`), que registra a contagem em `retention_runs`.
  - `public.usage_record(tenant, batch_id, events)`: qualquer membro do negócio; até 50 eventos por lote e 2.000 por
    negócio por hora; evento fora do formato é descartado sem derrubar o lote; a rota passa de novo por
    `app.ops_clean_route` (P58); o horário do app fica preso entre 24 h atrás e agora.
  - `public.usage_settings_get` e `public.usage_settings_set` (só o dono, com versão e idempotência). **Desligar apaga
    o que já foi medido do negócio.**
- **Função `analytics`**: rotas `usage.record`, `usage.settings` e `usage.settings_set` em
  `supabase/functions/analytics/usage.ts`, **fora do registro v1** (como o `setup.describe` nasceu). Recado aberto para
  o integrador registrar.
- **Captura no app** (`src/lib/telemetry/usage.ts`):
  - **Ponto único de chamada:** `useApi()` em `src/app/api.tsx` devolve o cliente medido. Comando = chamada com chave de
    idempotência (todo comando do registro tem). Concluído vira `ok`; 4xx vira `refused` com o código; 5xx ou rede vira
    `error`. A mensagem do erro, o corpo e a query nunca saem.
  - **Navegação:** observa `pushState`, `replaceState` e `popstate` (o roteador usa o history). Só rotas `/app`.
  - **Vocabulário fechado das telas:** só os trechos fixos das rotas dos módulos (`SCREEN_SEGMENTS`); qualquer outro
    trecho vira `:id`. Um teste varre `module.tsx`, `public-routes.tsx` e `router.tsx` e falha se uma rota nova não
    entrar na lista. Foi o teste de mutação que mostrou a necessidade: um nome digitado num endereço passava pela
    limpeza do P58.
  - Lote de até 20 eventos ou a cada 15 s; ao esconder a aba, envia. Um cliente por sessão (regra do P53), um gravador
    por negócio. Na demonstração, nada sai.
- **Tela:** cartão "Medição de uso do app" no fim de Resultado (`/app/resultado`), com o que anota, o que nunca anota,
  o prazo e o botão de desligar (com confirmação que avisa que apaga).

### Decisões tomadas pelos docs (sem perguntar)

- **Ligada por padrão** no piloto. O doc 10 pede as métricas dos primeiros 14 dias, e o replanejamento (seção 8) diz
  que "não há telemetria". O dono vê o cartão e desliga quando quiser; desligar apaga.
- **30 dias de retenção.** Basta para "a semana" e "telas nunca abertas" no painel. O funil do primeiro dia (bloco 2) não
  depende desses eventos depois de 30 dias.
- **Sem usuário no evento.** O funil e o painel são por negócio; "voltou no dia seguinte" é por dia de uso do negócio.
- **Rotas fora do registro v1** até o integrador registrar, como fizeram o P50 e a parte 2 do assistente.
- **Comando = chamada com `Idempotency-Key`.** Leituras não entram; a recusa de leitura (403, 404) não é uso.

### Fora da área (precisou mexer, por regra do CI)

- `supabase/tests/database/36_job_ticks.test.sql`: a lista fechada de rotinas e as chaves do retorno do `jobs_run`
  ganharam `usage_retention`, como o P57 e o P58 fizeram.
- `docs/02_DICIONARIO.md`, regerado.

### Testes

| Comando | Resultado |
|---|---|
| `src/lib/telemetry/usage.test.ts` | 19 casos: nomes, lote, ponto único, vocabulário e **teste de mutação** (10 tipos de dado pessoal plantados em tela, comando, corpo, erro e query; nenhum sai) |
| `supabase/tests/database/56_p32_uso.test.sql` | 24 verificações: RLS, sem leitura nem escrita direta, colunas, prazos, vocabulário fechado, lote repetido, isolamento, desligar, teto por hora e retenção |
| `tests/db-concurrency/33_usage_batch.sh` | mesmo lote em 8 abas grava uma vez; 8 lotes diferentes, nenhum perdido; desligar no meio sem erro |
| `tests/integration/55_p32_uso.test.ts` | 3 casos pela função `analytics` com o banco real |
| `tests/contracts/pilot/usage-contracts.test.ts` | rotas ↔ parâmetros das RPCs, `security definer`, sem anon |
| `tests/e2e/analytics/medicao-uso.spec.ts` | desktop, Pixel 7 e 375 px; na demonstração nenhuma chamada de uso sai |

## Bloco 2 · Funil do primeiro dia

### Entregue

- **Migration** `…_p32_funil.sql`:
  - `public.usage_days` (negócio, dia no fuso do negócio): só a data em que o app foi usado. Gravada pelo
    `usage_record` (redefinido, mesmo corpo do bloco 1 mais esta linha) e apagada ao desligar a medição. Fica com o
    negócio (sem prazo na tabela do P57: não tem hora, usuário nem conteúdo).
  - `app.pilot_funnel_of(negócio)`: sete passos pela **data real** de cada dado, sem flag gravada à mão:
    1. `signup` criou a conta (`tenants.created_at`);
    2. `configured` expediente, serviço com preço e antecedência de cancelamento (`app.setup_state` do P44; a data do último dos três);
    3. `link_published` perfil publicado (P09/P44);
    4. `first_booking` primeiro agendamento, de qualquer origem;
    5. `first_service` primeiro atendimento concluído (auditoria `booking.complete`);
    6. `first_payment` primeiro recebimento sem estorno;
    7. `returned` voltou no dia seguinte (uso do app em `usage_days` ou ação na auditoria no dia seguinte ao da conta,
       no fuso do negócio). Só sim ou não.
    - Cada passo traz `minutes_since_previous` (desde o último passo feito) e `minutes_since_signup`.
  - `public.pilot_funnel()`: só operador ativo (`app.svc_operator`), até 200 negócios com `truncated` (regra do P56).
- **Função nova `pilot`** (`supabase/functions/pilot`): rota `pilot.funnel` sem negócio selecionado; o contrato
  fica em `contract.ts` da própria função, fora do registro v1 (recado). Usa `withBuild`, como as outras.

### Decisões

- **"Voltou no dia seguinte" pelo negócio, não pela pessoa:** não há usuário no evento (bloco 1). Uso do app ou ação
  na auditoria contam; assim vale mesmo com a medição desligada (a auditoria já existe).
- **"Configurou" = os três obrigatórios do P44 menos o perfil**, que vira o passo seguinte ("publicou o link").

### Fora da área

- `supabase/tests/database/37_list_truncated.test.sql`: a contagem de leituras com `truncated` sobe (17 com o
  `pilot_funnel`).
- `tests/integration/harness.ts`: a função `pilot` entra no mapa de handlers.

### Testes

| Comando | Resultado |
|---|---|
| `supabase/tests/database/57_p32_funil.test.sql` | 16 verificações: só datas e contagens, sete passos na ordem, negócio novo 1 de 7, "voltou" pelo dia seguinte no fuso (mesmo dia não conta), data real do agendamento, tempo nunca negativo, só operador lê |
| `tests/integration/56_p32_funil.test.ts` | dono recebe 403; operador vê os sete passos, sem contato nem valor |
| `supabase/functions/pilot/handler.test.ts` e `tests/contracts/pilot/pilot-contracts.test.ts` | sem negócio, leitura, parâmetros da RPC, resposta fora do contrato vira 500 |
