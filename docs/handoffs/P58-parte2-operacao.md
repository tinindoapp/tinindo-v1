# P58 parte 2 · Operação: saber quando algo quebra e conseguir voltar atrás · handoff

Sessão Claude Code (conta do Felipe), 21/11/2026. Branch `claude/consolidate-lib-migrate-modules-jbw7y4`.
Base: linha P58 de `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md` ("captura de erro e alerta da fila", "ambiente de produção") e D36 (a). A parte 1 é `docs/handoffs/P58-claude-publicar.md`.

**Nada foi publicado nem aplicado na homologação, e nada foi criado em produção.** Esta sessão não tem as contas. Os scripts foram testados com `--conferir` e contra um Postgres local (PG 16 com o shim).

Reserva: o P58 não está no quadro do `coord.py`, que vai até P46. Sem `claim`, como nas partes anteriores.

## Entregue

### 1. Captura de erro, sem serviço externo

- **Tabela** `public.ops_errors` (migration `…_p58_operacao.sql`):
  - Campos: origem (`front` ou `function`), tipo, função, rota sem id, status, código do catálogo, SHA e `request_id`. Só vocabulário fechado, por `check`.
  - Uma linha por (origem, `request_id`).
  - Retenção de **14 dias**: categoria nova `ops_errors` em `retention_policies` (P57). Quem apaga é a rotina `ops_watch`, que registra a contagem em `retention_runs`.
- **RPC** `public.ops_error_record`, aberta a `anon` e `authenticated`, porque o erro de tela pode vir antes do login:
  - Valor fora do formato vira nulo; a captura nunca derruba quem chama.
  - A rota passa por `app.ops_clean_route`: uuid, número com 3 ou mais dígitos, `@` e trecho com mais de 40 caracteres viram `:id`, e a query sai.
  - Teto: 500 linhas por origem a cada 10 minutos.
- **Funções:** `supabase/functions/_shared/http/capture.ts` e `withBuild` em `build.ts`, que as 29 funções já usam. Não precisou tocar em nenhum `index.ts` de módulo.
  - Resposta 5xx vira linha com função e rota (do caminho), status, código do envelope, SHA e `request_id` da resposta.
  - Exceção sem resposta vira 500 `INTERNAL_ERROR` no envelope v1 e também é gravada.
  - Grava pela RPC com a chave pública que a função já tem, em segundo plano (`EdgeRuntime.waitUntil`) e com limite de 2 s. Gravador que falha não muda a resposta.
  - `OPS_CAPTURE=off` desliga.
- **Front:** `src/lib/telemetry`, com `createTelemetry`, `createAppTelemetry`, `restSender` e `cleanRoute`.
  - Grava erro de tela (só o nome do tipo, nunca a mensagem), chamada 5xx ou sem rede (pelo `fetch` embrulhado, com função, código e `request_id`) e erro solto.
  - Até 20 registros por carregamento, sem repetir o mesmo erro em 60 s.
  - **Ainda não está ligado ao app:** `src/app` e `src/main.tsx` estão fora da área. O código pronto está em `src/lib/telemetry/README.md` e no recado (abaixo).

### 2. Saúde da operação

- **Leitura única** `app.ops_health_snapshot()`:
  - fila: vencidos, atraso do mais antigo vencido, pendentes com o mais antigo, em processamento, mortos e mortos em 24 h, mortos por tipo;
  - todas as rotinas do `job_ticks`, com falhas seguidas e `last_error` (200 caracteres);
  - erros por função e do navegador na última hora;
  - última versão de `public.ops_releases`;
  - estado do alerta e limites.
- **Acesso:** `public.ops_health()` entrega a leitura só a operador ativo (`app.svc_operator`); dono de negócio recebe `FORBIDDEN`.
- **Painel** `/app/servicos-tinindo/operacao/saude` (`HealthPage.tsx`, `health.ts`), atrás do `OperatorGate` e com link a partir da Operação Tinindo. Mostra:
  - "Tudo certo" ou "Precisa de atenção", com cada motivo em frase e o caminho do runbook;
  - fila, com o atraso no `SummaryHero`;
  - rotinas com falha;
  - erros por origem;
  - versão publicada e estado da rotina do alerta.
  - A resposta é conferida por zod. A demonstração tem uma porta própria, com dados de exemplo.
- **Versão publicada:** `public.ops_releases`, gravada pelo `publicar.sh` e pelo `reverter.sh`.
- **Smoke:** seção nova "Saúde da operação". Reprova com qualquer motivo de atenção e quando a versão anotada não é a esperada; imprime fila, erros e estado da rotina. Duas checagens novas em "Funções e cron":
  - `X-Tinindo-Build` de cada função igual ao commit (recado #135);
  - o `publicar.sh` agora grava `BUILD_SHA` no passo 3, o que faltava para o cabeçalho existir.

### 3. Alerta

- **Rotina:** `app.ops_watch_tick` é **linha nova no `job_ticks`** (`after_outbox`, posição 90). Não reescreve `jobs_run`.
- **Limites:** ficam em `public.ops_alert_settings` (uma linha; mudar é migration nova). A rotina marca "precisa de atenção" com qualquer um destes motivos:
  - `queue_late`: evento vencido mais antigo esperando há mais de **15 min**;
  - `tick_failing`: rotina ligada com **3** falhas seguidas;
  - `errors_over_ceiling`: mais de **20** 5xx das funções na última hora.
  - A leitura acrescenta `watch_stale` quando a própria rotina não roda há 5 min.
- **Estado:** fica em `public.ops_alert_state`. `notify = true` só na passagem de ok para atenção, e só um worker ganha a troca (`update … where state <> 'attention'`). O aviso sai uma vez.
- **Função `jobs`:** loga `level: error` com `ops_attention` sempre que há motivo. O e-mail pelo Resend (`jobs/alert.ts`) só sai com `OPS_ALERT_EMAIL=on`, `OPS_ALERT_EMAIL_TO` e `OPS_ALERT_RESEND_KEY`; **desligado por padrão**. Leva os motivos e o link do painel. Falha no envio não muda a resposta.

### 4. Voltar atrás

- **Script:** `release/reverter.sh <ambiente> <sha> [--conferir]` (`npm run reverter`). Republica o frontend e as funções do commit numa `git worktree` temporária, com `npm ci` pelo lockfile dele. Também grava `BUILD_SHA` e usa o `wrangler` com a configuração de hoje. O banco não volta.
- **Conferências antes de mexer:**
  - o commit está na história da `main`;
  - todas as migrations dele estão aplicadas no ambiente;
  - as migrations posteriores que apagam ou renomeiam algo são listadas;
  - tag e palavra digitada em produção.
- **No fim:** anota `revert` em `ops_releases`, roda o smoke esperando o commit e mostra o tempo total.
- **Ensaio de backup e restore** `release/ensaio-restore.sh` (`npm run ensaio:restore`): backup do banco do ambiente local, restore num banco novo, contagens, RLS, o **smoke inteiro no restaurado** e uma gravação com o papel `anon`. O tempo de cada parte fica no resumo do CI.

  | Ensaio local, 21/11 | Tempo |
  |---|---|
  | Backup | 0,3 s |
  | Restore | 1,9 s |
  | App de volta | **3,4 s** |

  `npm run db:restore:drill` (OPS-01, com dados do seed) continua igual: dump 0,2 s, restore 1,5 s.
- **Testes dos scripts** `release/testes-locais.sh` (`npm run test:release`): 20 casos contra o Postgres local. Rodam no job de banco do CI, com o ensaio de restore. Cobrem:
  - smoke ok;
  - smoke reprovando com erros acima do teto, com fila atrasada e com versão diferente;
  - reverter com `--conferir` (sem anotar), real (anotado), com commit inexistente, commit fora da `main` e sem commit;
  - as travas de produção abaixo.

### 5. Produção preparada, sem publicar

- `release/ambientes/producao.env.exemplo`, com `EXIGE_MAIN=1`, `EXIGE_TAG=1` e `CONFIRMAR=producao`, e `release/ambientes/wrangler.producao.jsonc.exemplo`.
- `release/PRODUCAO.md`: lista do que criar (D36 a) e a primeira publicação, em passos.
- **Travas** (`release/lib/comum.sh`), testadas:
  - sem `producao.env`, não há ambiente;
  - com `PREENCHER` no arquivo, para antes de qualquer conta;
  - sem tag `vAAAA.MM.DD-N`, recusa;
  - sem terminal (pipe ou CI), recusa: **não existe variável para pular a pergunta**;
  - palavra errada, recusa; `producao` digitado, segue;
  - `--conferir` não pergunta.

### 6. Documentação

- `release/RUNBOOK.md`, seção nova "Quando o alerta acende", em cinco passos:
  1. abrir o painel ou rodar o smoke;
  2. ver se começou com uma publicação (e reverter, se sim);
  3. tabela por motivo;
  4. gatilhos de reversão imediata;
  5. fechar o incidente.
  - Mais o aviso por e-mail e o que a captura guarda.
- `docs/09`: "Voltar atrás e produção", e captura, saúde e alerta em "Observabilidade e suporte".
- `PUBLICAR.md`, `CHECKLIST.md` e `ENSAIO-ROLLBACK.md`: a parte B agora usa o `reverter.sh`, e a tabela de registro tem os tempos locais.

## Decisões tomadas pelos docs (sem perguntar)

- **RPC aberta a `anon`.** É o único jeito de gravar erro de tela antes do login e erro das funções, que só têm a chave pública. A chave de serviço fica só no `jobs` (regra do repositório).
  - Risco aceito: alguém pode inflar a contagem de erros e acender o alerta falso. A gravação tem teto (500 por origem a cada 10 min) e só aceita vocabulário fechado.
  - Se incomodar, a próxima volta é uma função de captura com segredo próprio.
- **Limites do alerta (15 min, 3 falhas, 20 por hora).** Vêm do RUNBOOK (fila parada > 15 min) e do P56 (3 falhas no smoke). O teto de 20 por hora é uma escolha para o piloto, com 10 a 50 profissionais. Mudar é migration nova em `ops_alert_settings`.
- **Retenção de 14 dias.** "Retenção curta" do pedido, registrada como D25/P58 em `retention_policies`, para o advogado ver junto com as demais.
- **Fila atrasada medida pelo `next_run_at` vencido, não pelo `occurred_at`.** Evento em espera de nova tentativa (backoff) não é atraso. O mais antigo pendente aparece no painel do mesmo jeito.
- **Painel pela Data API (`supabase.rpc`), e não por rota nova na função `service-ops`.** A rota nova mexeria em `supabase/functions/service-ops` e em `_shared/contracts`, fora da área. A tela confere a resposta por zod, e a integração prova que o banco devolve o formato do painel.
- **E-mail no `jobs`, com segredos próprios** (`OPS_ALERT_*`), sem reutilizar o SMTP do Auth. O remetente padrão é o domínio já verificado (`EMAIL-RESEND.md`).
- **Reverter com a configuração do `wrangler` de hoje** (domínio e conta), e não a do commit antigo.
- **O ensaio de restore do pedido virou `release/ensaio-restore.sh`.** O `scripts/db-restore-drill.sh` fica fora da área e não mudou.

## Fora da área (precisou mexer, por regra do CI)

- `supabase/tests/database/36_job_ticks.test.sql`: a lista fechada de rotinas e as chaves do retorno do `jobs_run` ganharam `ops_watch`, como o P57 fez com as dele.
- `supabase/tests/database/48_p58_operacao.test.sql` (novo, 44 verificações) e `tests/integration/54_p58_operacao.test.ts` (novo, 3 casos): os números 44 e 53 estavam livres.
- `docs/02_DICIONARIO.md`, regerado (`bash .github/workflows/db-dictionary.sh`), porque o CI confere.

## Recado (`para-felipe`)

Issue #162, "[recado] P58: ligar a captura de erro do front na raiz do app", com o código de `src/lib/telemetry/README.md`:

- `src/app/telemetry.ts` (novo);
- `install(window)` em `src/main.tsx`;
- `fetch: telemetry.wrapFetch(...)` em `session.tsx` e `api.tsx`;
- `captureRender` em `RouteError` e `ModuleError`.

Critério de pronto: erro forçado na homologação aparece no painel.

## Pendências

- **Wrangler de produção:** criar `wrangler.producao.jsonc` na raiz a partir do modelo, quando a conta existir (`PRODUCAO.md`, passo 3).
- **Não testado** (exige contas): `secrets set BUILD_SHA`, `functions deploy` e `wrangler deploy` a partir da worktree no `reverter.sh`; `X-Tinindo-Build` e a saúde no smoke contra a homologação; o envio pelo Resend. O código dos passos hospedados é o mesmo do `publicar.sh`.
- **Captura em runtime real:** sem Deno aqui (o CI roda `deno check`), não rodei `EdgeRuntime.waitUntil` de verdade. Fora do Supabase, cai no `await`.
- **`watch_stale`** só aparece depois que a rotina rodou ao menos uma vez. Num ambiente cujo cron nunca rodou, quem pega é a checagem de cron do smoke.
- **Sem dados de seed no ensaio de restore:** o banco do `publicar.sh local` não tem seed. O cenário com dados é o do `db:restore:drill`.

## Testes, comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` · `npm run build` | ok |
| `npm run test:unit` | 1093 passaram (inclui capture/withBuild 8, jobs/alert 5, telemetry 8, HealthPage 5) |
| `npm run test:contracts` | 846 passaram, 38 pulados (os de sempre) |
| `npm run db:test:local` (pgTAP) | todos passaram, incluindo o 44 (44 verificações) e o 36 atualizado |
| `npm run db:test:concurrency` | todos passaram |
| `npm run test:integration` | 30 arquivos, 166 passaram |
| `node .github/workflows/check-migrations.mjs --base origin/main` · `db-dictionary.sh --check` | ok |
| `bash release/publicar.sh local` (banco novo) · de novo | smoke ok com a saúde; "nada a aplicar" |
| `bash release/testes-locais.sh` | 20 de 20 |
| `bash release/ensaio-restore.sh` | ok, tempos acima |
| `publicar.sh homolog --conferir` · `reverter.sh homolog <sha> --conferir` | plano completo, nada alterado |
| `bash tests/e2e/servidor/run.sh` | 2 de 2 |
| e2e completo, desktop e 375 px (`playwright.ci-local.config.ts`) | 320 passaram, 34 pulados (os de sempre) |

## Contratos, migrations e flags

- **Migration:** uma nova, `…_p58_operacao.sql`, só aditiva: 4 tabelas, 1 linha em `job_ticks`, 1 em `retention_policies`, 7 funções.
- **Contratos:** nenhum contrato de `_shared/contracts` mudou.
- **Flags e segredos novos**, todos opcionais e desligados por padrão: `OPS_CAPTURE=off` desliga a captura; `OPS_ALERT_EMAIL`, `OPS_ALERT_EMAIL_TO`, `OPS_ALERT_RESEND_KEY`, `OPS_ALERT_EMAIL_FROM` e `OPS_ENV_NAME`. `BUILD_SHA` passa a ser gravado pelo publicar.

## Próximo passo

1. Integrador: ligar a captura do front (recado).
2. Gabriel ou Felipe:
   - publicar a homologação (`npm run publicar -- homolog`);
   - cadastrar a equipe em `platform_operators`;
   - abrir o painel;
   - rodar `npm run reverter -- homolog <sha anterior> --conferir` e a parte B do `ENSAIO-ROLLBACK.md`.
3. D36: criar o que está em `release/PRODUCAO.md`.
