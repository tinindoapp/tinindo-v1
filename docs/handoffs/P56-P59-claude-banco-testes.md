# Handoff · P56 Banco e operação · P59 Testes do caminho real

Sessão: `claude/nifty-clarke-921fl8` (uma das cinco sessões em paralelo de 20/11, para @fffalleiros) · 2026-11-20
Branch: `claude/nifty-clarke-921fl8` → PR para `main`. Decisões aplicadas: **D31 (a)** manter o teto de 200 e avisar o corte; **D32 (b)** portas contra handlers agora, e a jornada (a) também, porque coube.
Área desta sessão: `supabase/migrations` (só novas), `supabase/tests`, `tests/db-concurrency`, `tests/integration`, `tests/e2e` (infraestrutura e jornada nova), `.github/workflows`, `docs/02`. Nada em `src/` nem em `supabase/functions`.

**Nada foi aplicado na homologação nem em produção.** Migrations rodaram só em bancos descartáveis locais.

Reserva: P56 e P59 não estão no quadro do `coord.py` (o quadro vai até P46; a numeração da Onda 6/7 é provisória, `00-REPLANEJAMENTO.md` seção 5). Não fiz `claim`; o trabalho foi autorizado pelo Felipe na mensagem da sessão. O integrador cria as linhas quando publicar a numeração.

## Entregue

### 1. Rotinas periódicas isoladas (`job_ticks`, linha P, be-banco-03)

- `20261120030000_p56_job_ticks.sql`: tabela `public.job_ticks` (nome, função, lote, fase antes/depois da fila, ordem, `enabled`, mais `consecutive_failures`, `last_error`, `last_failed_at`), função `app.jobs_run_ticks(fase)` que roda cada rotina em bloco próprio (savepoint), e `public.jobs_run` reescrita **pela última vez** lendo o registro. Retorno com as mesmas chaves de antes, mais `tick_errors` (`{}` quando nada falhou).
- A anotação da falha usa `for update skip locked`: dois workers em paralelo não esperam um pelo outro só para anotar. Por isso `consecutive_failures` conta as rodadas que conseguiram anotar (entre 1 e o número de workers numa rodada simultânea), não necessariamente todas.
- Pacote novo **insere uma linha** em `job_ticks`; não reescreve `jobs_run`. Módulo escondido: `update … set enabled = false` em migration.
- pgTAP `36_job_ticks` (27): acesso fechado, as oito rotinas na mesma ordem, função e assinatura de cada uma, `CHECK` do nome, retorno com as chaves de sempre, falha nas duas fases desfeita sem derrubar hold, fila, régua e insights, contador e último erro, zera ao corrigir, desligada não roda.
- Concorrência `31_job_ticks.sh` (15 verificações): 4 workers simultâneos com uma rotina que falha no começo de cada fase e segura bloqueio de linha que outra rotina usa: nenhum aborta, hold expira uma vez, evento entregue uma vez, sem atualização perdida nem deadlock, nada do que falhou fica; desligar no meio da rodada não derruba ninguém. Rodou 3 vezes seguidas, mais a suíte completa.

### 2. Aviso de corte nas listas (D31 (a), be-banco-06)

- `20261120031000_p56_listas_truncated.sql`: as 15 funções de `public` com teto devolvem `truncated: { <lista>: true|false }` (true quando há mais linhas que o devolvido; mesmo filtro da lista com `offset <teto>`). Lista, ordem e teto não mudam. Cada função é a definição vigente (tirada do catálogo) com esse único acréscimo, e traz `-- substitui <arquivo>:<linha>`.
  Funções: `agent_finance_read`, `channel_conversation`, `channel_inbox`, `finance_ledger`, `lifecycle_steps_list`, `materials_bookings`, `materials_movements`, `package_list`, `payment_charges_list`, `recurrence_list`, `resources_commissions`, `sales_quote_list`, `service_ops_queue`, `service_ops_snapshot`, `waitlist_list`.
- Fica de fora `my_bookings` (devolve `TABLE`; avisar o corte muda a assinatura).
- pgTAP `37_list_truncated` (17): teto exato = false, teto + 1 = true, lista continua em 200, quem sai é o mais antigo, outro negócio e fora do período não contam. **Trava:** função nova de `public` com `limit 200` sem `truncated` faz o arquivo falhar.
- Integração `48_p56_listas_truncated`: pela RPC o `truncated` aparece; pelo handler a resposta continua dentro do contrato de sempre.
- **As telas não mudaram, e o `truncated` ainda não chega ao navegador**: o handler valida a saída pelo contrato e o zod descarta campo que o contrato não declara. Declarar no contrato é `supabase/functions/_shared/contracts`, fora da minha área: recado para-felipe (abaixo). O caso 2 do teste de integração trava o estado atual e diz o que trocar quando o contrato mudar.

### 3. Índices, FKs e privilégios do schema `app` (be-banco-04, 10, 11) e `docs/02`

- `20261120032000_p56_app_privilegios.sql`: `revoke execute on all functions in schema app from public, anon`. `authenticated` fica só com os 7 auxiliares de RLS, storage e coluna gerada.
  **Desvio do relatório:** não usei a forma global `alter default privileges revoke execute on functions from public` que o be-banco-04 propõe. Ela vale para toda função que o papel das migrations criar depois, em qualquer schema, e quebrou 12 arquivos pgTAP (as funções `pg_temp.*` dos testes deixam de ser executáveis por `authenticated`). A garantia para as próximas migrations é o pgTAP 38.
  `21_fiscal.test.sql`: duas linhas chamavam `app.fsc_terms_hash()` como `authenticated`; passaram a ler o hash pela própria RPC (`fiscal_get`). Mudança só no teste.
- `20261120033000_p56_fks_indices.sql`: FKs compostas `(tenant_id, reversal_of)` em `payment_entries`, `expense_entries`, `session_entries`, `material_movements`, `team_commission_entries`, e `(tenant_id, replaced_request_id)` em `public_booking_requests` (com o `unique (tenant_id, id)` que faltava), todas `not valid` + `validate`. Índices `payment_entries_tenant_receivable` e `receivables_tenant_customer` (nomes com o prefixo para não colidir com as FKs `payment_entries_receivable` e `receivables_customer`); `bookings_customer` removido (coberto por `bookings_customer_starts`).
- pgTAP `38_app_privileges_fks` (16): nenhuma função de `app` para `anon`; lista fechada para `authenticated`; nenhuma função de `public` com ACL padrão; `rc_sub_json` dá `permission denied`; RLS e RPCs seguem funcionando; estorno entre negócios recusado; FKs validadas; índices.
- `docs/02_DADOS_E_INVARIANTES.md`: os sete nomes corrigidos (`provider_services`, `availability_blocks`, `pricing_rules`, `contact_consents`, `agent_proposals`; `payment_allocations` e `plan_entitlements` explicados como inexistentes), mais as seções "Rotinas periódicas", "Listas com teto", "Privilégios", FKs de estorno, regra de nome de migration e de comentário `-- substitui`.
- `docs/02_DICIONARIO.md` (novo, gerado): as 125 tabelas com colunas, nulidade, chaves, referências, políticas e append-only, mais a tabela de rotinas. Gerado por `.github/workflows/db-dictionary.sh`; o CI roda `--check` e falha se o arquivo ficar diferente do banco. **Quem mudar o banco roda `bash .github/workflows/db-dictionary.sh` e commita o resultado.**

### 4. CI (linha R e D38)

- `.github/workflows/check-migrations.mjs`, primeiro passo do job `database` (checkout com `fetch-depth: 0`): nome `AAAAMMDDHHMMSS_nome.sql` e carimbo único; contra a base (`origin/main` no PR, commit anterior no push), migration publicada não muda, não some, não troca de nome, e migration nova tem carimbo posterior a todas as da base; pgTAP, concorrência e integração sem número repetido. `--self-test` com 15 casos, incluindo os dois da linha R. Conferido também com mutação (migration velha, pgTAP repetido, migration publicada editada: 3 problemas, exit 1).
- Dicionário conferido no job `database`, depois da integração.
- A jornada com servidor entra no job `e2e` (Postgres do runner), timeout de 15 para 20 min.
- Os **cinco jobs obrigatórios** estão documentados no cabeçalho de `ci-app.yml`, com os nomes que a proteção de branch usa. Não criei um sexto job. **Conferir na proteção da `main`** que os cinco estão marcados como obrigatórios (não tenho acesso às configurações do repositório).

### 5. Testes do caminho real (P59)

- **Jornada do ciclo com gravação real** (`tests/e2e/servidor/`, `bash tests/e2e/servidor/run.sh`): banco descartável, build com servidor em pasta temporária fora do repo, gateway Node de teste (`gateway.ts`) que fala Auth, as três leituras de `/rest/v1` que o app usa e `/functions/v1/*` montando os handlers de produção pelo harness da integração. Na tela: entra, define o expediente, agenda amanhã com cliente novo, "Atendido" → "Recebi no Pix", Caixa, Retorno ("Quem não volta"), recarrega e confere, e no banco reserva `completed`, recebível `paid`, um pagamento pix. Desktop no negócio A, celular (Pixel 7) no B. Falha em qualquer resposta ≥ 400 do gateway ou erro de página. Único preparo por SQL: mover o agendamento 35 dias para trás (o banco só agenda no futuro, só conclui depois do início, e "não volta" exige 30 dias). Detalhes e limites em `tests/e2e/servidor/README.md`. O `playwright.config.ts` da raiz ganhou só `testIgnore` para essa pasta.
  Roda em todo PR e na `main` (D32 pedia "na `main` e à noite"; custa ~30 s, então ficou em todo PR).
- **Contraste medido nos dois temas** (`tests/e2e/foundation/padroes.spec.ts`): razão WCAG entre o texto e o primeiro fundo opaco dos ancestrais, compondo alfa e opacidade; 4,5:1 (3:1 para texto grande); pula gradiente e imagem; isenta controle desativado. Celular e desktop, claro e escuro. Exceções conhecidas numa lista que também falha se a exceção deixar de ocorrer.
  **Uma exceção:** `/app/configurar`, etiqueta "opcional" (`span.tn-setup-step__tag`), 4,49:1 no tema claro (`--tn-text-muted` sobre `--tn-surface-sunken`; `src/features/setup/setup.css:34`). Recado para-felipe.
- **Varredura de rotas** (`tests/e2e/foundation/rotas.ts` + `a11y.spec.ts`): a lista sai do roteador (`src/app/router.tsx` lido pela AST do TypeScript, seguindo `MODULES` e as rotas públicas). 61 padrões: 51 telas varridas em 320 px (rolagem, texto além da borda e texto cortado) e com título próprio "· Tinindo"; 9 com parâmetro numa lista conferida contra o roteador. Nenhuma exceção.
  O `padroes.spec` continua varrendo menu + 3 públicas (não as rotas fora do menu); trocar é uma linha (`sweepRoutes`), não troquei para não trazer reprovação nova neste PR.
- **Smoke de homologação** (`tests/e2e-staging/smoke.spec.ts`): com `STAGING_REQUIRED=1`, variável ausente falha citando qual falta (inclusive SHA e bundle); sem ela, segue pulando com motivo. Provado contra o preview local: exit 1 com a lista das seis variáveis.

## Testes, comandos e resultados (branch mesclado com a `main` em b752d60)

| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 123 arquivos, 871 passaram |
| `npm run test:contracts` | 832 passaram, 38 pulados (avaliação com provedor real), 2 falhas esperadas |
| `npm run db:test:local` (pgTAP, PG 16 + shim) | todos passaram, incluindo 36, 37 e 38 |
| `npm run db:test:concurrency` | 282 verificações, todas ok (31_job_ticks também 3 vezes isolado) |
| `npm run test:integration` | 25 arquivos, 145 passaram |
| `E2E_PORT=4273 npx playwright test tests/e2e/foundation --trace off` | 36 passaram, 6 pulados (só desktop ou só celular) |
| `bash tests/e2e/servidor/run.sh` | 2 passaram (desktop e mobile); 5 execuções seguidas no worktree e 1 no branch mesclado |
| `node .github/workflows/check-migrations.mjs --self-test` e `--base origin/main` | ok |
| `bash .github/workflows/db-dictionary.sh --check` | igual ao banco |

Não rodei: `supabase test db` (sem Docker aqui; o CI roda no PG 17 do stack), `deno check` (sem deno), e2e completo da demonstração (só `foundation`; o CI roda tudo).

## Recados abertos (para-felipe)

1. Contrato `truncated` nas 14 saídas + aviso "mostrando os 200 mais recentes" nas telas + `tick_errors` com nível de erro no log da Edge Function `jobs`.
2. Contraste da etiqueta "opcional" em `/app/configurar`.

## Pendências e sugestões fora da área

- `package.json`: script `test:staging` e `test:e2e:servidor`; `release/CHECKLIST.md` seção 2: rodar o smoke com `STAGING_REQUIRED=1`; `docs/10_TESTES_E_ACEITE.md:66` ainda dá UX-01 (contraste) como provado antes desta medida.
- Retenção (be-banco-05) é P57 e depende de D25; `app.retention_tick` entra como linha nova em `job_ticks`.
- Observação sem asserção da jornada: depois de mover o agendamento por SQL e recarregar, o bloco "Avise o cliente" mostrou a data antiga e "Quando" a nova. Pode ser efeito do preparo por SQL; não verificado com "Reagendar" pela tela.
- A jornada não prova Auth real (GoTrue), runtime Deno, CORS real, PostgREST real, worker nem canal.

## Próximo passo

Integrador: confirmar os cinco checks obrigatórios na proteção da `main`; criar P56/P59 no quadro; pegar os dois recados. Quem escrever migration nova a partir daqui: carimbo do momento do PR, linha em `job_ticks` em vez de reescrever `jobs_run`, `truncated` em lista com teto, `revoke all … from public` em função de `app`, e regerar o dicionário.
