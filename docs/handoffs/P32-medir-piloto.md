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

## Bloco 3 · Painel do piloto (só a equipe Tinindo)

### Entregue

- **Migration** `…_p32_painel.sql`:
  - `app.pilot_business(negócio, de, até)` e `public.pilot_panel(de, até)` (só operador ativo; período de até 92
    dias; até 200 negócios ativos com `truncated`). Por negócio:
    - o funil do bloco 2;
    - uso no período: dias com uso, telas com contagem, comandos com ok/recusado/erro, os problemas (operação,
      resultado, código, contagem, último) e as telas abertas em 30 dias;
    - custo: assistente em US$ e chamadas (`agent_llm_usage`, por mês inteiro, dito na tela) e mensagens enviadas por
      tipo e as que falharam (contagem; o preço é do provedor e não está no banco);
    - atendimentos e recebimentos **em número**: agendamentos criados, feitos, faltas, cancelados, recebimentos.
    - Nada de nome de cliente, contato, texto ou valor.
- **Função `pilot`**: rota `pilot.panel` (contrato em `contract.ts`).
- **Tela** `/app/resultado/piloto` (`src/features/pilot`), atrás do `OperatorGate`, fora do menu:
  - período de 7 ou 28 dias; um cartão por negócio com o funil (tempo desde o passo anterior e desde a conta),
    o que usou, erros e recusas, **telas do menu que nunca abriu em 30 dias** (compara as telas abertas com o caminho de
    cada módulo do `MODULES`), custo e números;
  - **Exportar CSV**: uma linha por negócio, com BOM para o Excel e defesa contra fórmula (célula que começa com
    `=`, `+`, `-` ou `@` vira texto).
  - Demonstração com três negócios de exemplo, rotulada.

### Decisões

- **Rota sob o Resultado (`/app/resultado/piloto`), carregada sob demanda a partir de `src/features/analytics/module.tsx`.**
  Um módulo próprio exigiria `ModuleId`, catálogo no banco e `src/app/modules.ts`, fora da área; o custo por cliente
  já vive em `/app/resultado/custo` do mesmo jeito. Recado #197 para virar módulo.
- **"Nunca abriu" pela tela principal de cada módulo do menu**, em 30 dias (a retenção dos eventos).
- **Mensagens em contagem.** O preço por mensagem de modelo é do provedor (Meta) e não está gravado; a tela diz isso.

### Testes

| Comando | Resultado |
|---|---|
| `supabase/tests/database/58_p32_painel.test.sql` | 12 verificações: só operador, período validado, seções fixas, telas e recusas, dias com uso, telas em 30 dias, números sem valor, nada de cliente ou contato |
| `tests/integration/56_p32_funil.test.ts` | + painel da semana pela função `pilot` com o banco real; dono recebe 403 |
| `src/features/pilot/pilot.test.tsx` | nunca abertas, duração, CSV (fórmula vira texto, aspas, sem contato), tela e aviso para quem não é da equipe |
| `tests/e2e/analytics/painel-piloto.spec.ts` | desktop, Pixel 7 e 375 px: funil, recusas, fora do menu, download do CSV, troca de período |

## Bloco 4 · Relatório ao profissional ("Sua semana" e "Seu mês")

### Entregue

- **Migration** `…_p32_relatorio.sql`: `public.report_period(negócio, 'week'|'month', data)`, só o dono. Período no fuso
  do negócio: semana de segunda a domingo, mês do calendário; período em andamento termina em "agora" (`in_progress`,
  `until`); período futuro é recusado. Cada número tem `value`, `denominator`, `status` (`ok`/`insufficient`) e `note`:
  - atendimentos feitos, entre os que já começaram (feitos, faltas e confirmados sem desfecho);
  - faltas, entre os com desfecho (feitos e faltas);
  - recebido no período, sem os estornados (mesma regra do P18);
  - a receber: o que está em aberto agora, de qualquer data, com o número de cobranças;
  - quem voltou: clientes atendidos no período que já tinham vindo antes, entre os atendidos no período;
  - quem não voltou: clientes do período anterior sem atendimento feito nem marcado neste, entre os do período anterior;
  - horário mais cheio e mais vazio por dia da semana e hora cheia do expediente; só com pelo menos 5 atendimentos
    (`hours_status` = `insufficient`) e sem expediente cadastrado (`no_hours`).
- **Função `analytics`**: rota `report.get` (`report.ts`).
- **Tela** `/app/resultado/relatorio`, com link na tela de Resultado: abas Sua semana / Seu mês, anterior e seguinte
  (não passa de hoje), cada linha com o número e a base; sem base aparece **"dados insuficientes"**, nunca 0.
- **Compartilhar**: como texto (`navigator.share`, ou copia para a área de transferência) e como imagem PNG desenhada
  no navegador (compartilha o arquivo ou baixa). Só números, período e nome do negócio; nenhum nome de cliente.
- Demonstração com a mesma regra (`computeReport`) sobre a base de exemplo.

### Decisões

- **"A receber" é o aberto agora**, não "do período": cobrança não tem data de vencimento confiável em todos os fluxos;
  a nota diz isso.
- **Mínimos**: 1 de base para as proporções; 5 atendimentos para o horário mais cheio/vazio (com menos, qualquer hora
  "ganha" por acaso).
- **Horário por hora cheia do expediente** (`availability_rules`), contando feitos, faltas e confirmados; empate vai para
  o dia e a hora mais cedo.
- **Sem envio pela Tinindo**: o compartilhar usa o do aparelho; nada sai do servidor.

### Testes

| Comando | Resultado |
|---|---|
| `supabase/tests/database/59_p32_relatorio.test.sql` | 17 verificações: só o dono, tipo fechado, futuro recusado, limites no fuso, feitos e faltas com base, estorno fora, a receber, voltou/não voltou, mais cheio/vazio, insuficiente ≠ 0 |
| `tests/integration/57_p32_relatorio.test.ts` | semana e mês pelo contrato; 403 para outro dono, cliente e estranho; 400 para período inválido e futuro |
| `src/features/analytics/reportPort.test.ts`, `ReportPage.test.tsx` | regra da demonstração igual à do banco; navegação; texto compartilhado sem contato; cópia sem `share`; erro vira aviso |
| `tests/e2e/analytics/relatorio.spec.ts` | desktop, Pixel 7 e 375 px: link do Resultado, navegação, mês, insuficiente, texto e imagem PNG |

## Bloco 5 · Previsão simples e honesta

### Entregue

- **Migration** `…_p32_previsao.sql`: `public.forecast_week(negócio, data)`, só o dono, só leitura. Prevê a semana
  seguinte à semana de `data` (no fuso do negócio). A semana em andamento não entra na base.
  - **Só com pelo menos 8 semanas fechadas** desde o primeiro agendamento. Com menos, devolve `insufficient` com
    quantas semanas há, sem nenhum número.
  - **Ocupação esperada por dia da semana**: média das 8 últimas semanas fechadas. Conta atendimentos (feitos, faltas
    e confirmados) e mede a ocupação como minutos ocupados sobre minutos de expediente. Mostra também o que já está
    marcado. Dia sem expediente fica sem número.
  - **Risco de falta por dia da semana e hora cheia do expediente**: faltas sobre (feitos + faltas) nas 8 semanas.
    Com menos de 3 atendimentos no horário, usa a taxa geral do negócio, marcada como `overall`.
  - **Acerto (teste temporal)**: para cada uma das 4 últimas semanas fechadas que têm 8 semanas antes dela, compara a
    previsão daquela semana (mesma regra, sem olhar o futuro) com o que aconteceu, por dia da semana. Compara também
    com a referência ingênua "igual à semana anterior". Devolve o erro e o acerto de cada uma (acerto = 1 − erro
    absoluto ÷ realizado) e `beats_baseline`.
- **Função `analytics`**: rota `forecast.get` (`forecast.ts`).
- **Tela** `/app/resultado/previsao`, com link na tela de Resultado:
  - ocupação por dia, com esperados e já marcados;
  - até 5 horários de maior risco, só os com base própria, e a média geral;
  - o acerto contra a referência. Quando a média não ganha da referência, a tela diz para usar com cautela.
- **Nenhuma ação automática.** A tela diz isso; a função não grava nada (pgTAP confere).
- Demonstração com a mesma regra (`computeForecast`). A base de exemplo tem cerca de 5 semanas, então mostra "dados
  insuficientes".

### Decisões

- **Média simples de 8 semanas por dia da semana** como "regra + média histórica". O aceite do P32 pede que o modelo
  supere a referência num teste temporal; por isso o acerto vem sempre ao lado da referência "igual à semana
  anterior", em vez de prometer que a média é melhor.
- **3 atendimentos** como base mínima por horário, abaixo disso vale a média geral. É o mesmo cuidado do bloco 4:
  número com pouca base vira acaso.
- **Sem gravar previsões passadas.** O acerto é recalculado a partir dos dados, com a mesma regra e sem olhar o
  futuro de cada semana. Assim nenhuma tabela nova precisa de retenção.

### Testes

| Comando | Resultado |
|---|---|
| `supabase/tests/database/60_p32_previsao.test.sql` | 16 verificações: só o dono, futuro recusado, menos de 8 semanas sem previsão, semana prevista no fuso, ocupação e já marcados, dia sem expediente, risco por horário e média geral, 4 semanas de acerto (80% contra 60% da referência), nada gravado |
| `tests/integration/58_p32_previsao.test.ts` | contrato com o banco real; 403 para outro dono, cliente e estranho; 400 para futuro e formato |
| `src/features/analytics/forecastPort.test.ts`, `ForecastPage.test.tsx` | mesma regra e mesmos números do pgTAP; demonstração insuficiente; tela com ocupação, risco com base e acerto; erro vira aviso |
| `tests/e2e/analytics/previsao.spec.ts` | desktop, Pixel 7 e 375 px: link do Resultado, "dados insuficientes" sem número, sem rolagem lateral |
