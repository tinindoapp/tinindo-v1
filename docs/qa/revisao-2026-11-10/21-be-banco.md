# 21 · Modelo de dados e SQL (be-banco)

## Resumo

**Veredito: misto.** O núcleo do piloto (agenda, clientes, preço, recebimentos) está modelado no tamanho certo e bem protegido; a largura em volta dele é exagerada para 6 a 10 profissionais.

- **O que está certo e deve ficar intacto:** RLS ligada nas 123 tabelas, nenhuma política ou permissão de escrita para `anon`/`authenticated`, as 274 funções de `public` com `SECURITY DEFINER` e `search_path = ''`, as 232 RPCs de usuário logado com checagem de autorização no corpo, dinheiro em `bigint` de centavos (42 colunas), `timestamptz` em tudo (287 colunas), fuso por negócio validado por gatilho, restrição de exclusão para conflito de horário, idempotência com unicidade no escopo certo, livros-caixa append-only por gatilho. As 5 consultas quentes usam índice e rodam abaixo de 1 ms com 2.400 reservas por negócio.
- **Defeitos que afetam o fluxo principal (2):** o livro do caixa corta em 200 linhas pela ordem errada e faz sumir da tela justamente os recebíveis em aberto mais novos (be-banco-01); a busca de cliente não ignora acento, então "joao" não acha "João" (be-banco-02).
- **Fragilidade estrutural (1):** `public.jobs_run` roda 8 rotinas de módulos diferentes numa transação só; um erro em qualquer módulo periférico derruba a fila de eventos, os lembretes e as expirações. A mesma função foi reescrita inteira 7 vezes (be-banco-03).
- **Permissão latente (1):** a linha que deveria tirar o `EXECUTE` padrão de `PUBLIC` no schema `app` não tem efeito no Postgres; 38 funções auxiliares ficaram abertas, 10 delas `SECURITY DEFINER`. Hoje a API não alcança o schema `app`, por isso é latente (be-banco-04).
- **Largura:** 123 tabelas, 539 funções, 97 gatilhos, 21.256 linhas de SQL. O núcleo do piloto ocupa 6.034 linhas (28%); 72% é periferia (fiscal, site, equipe, materiais, domicílio, campanhas, indicações, diretório, avaliações, operação de serviço). Nada disso custa em tempo de consulta, mas custa em cada mudança transversal e no `jobs_run` de cada minuto.
- **Sem retenção:** nenhuma tabela técnica tem expurgo, não existe função de exportação ou exclusão por negócio, e o `docs/02` manda definir isso antes de dados reais (be-banco-05).
- Todo SQL de correção abaixo foi executado no banco local dentro de transação com `rollback` (pasta `…/audit/sql-propostos/`, saída em `t_correcoes.out` e `t_jobs_isolamento.out`).

## Como foi medido

- Banco `aud_banco` no Postgres 16 local (shim + 38 migrations + seed), mais um volume sintético do auditor anterior (`volume.sql`): 30 negócios com 400 clientes, 2.400 reservas, cerca de 1.900 recebimentos e 240 despesas cada (12.003 clientes e 72.000 reservas no total).
- Catálogo consultado em `catalogo1.out`, `catalogo2.out`, `catalogo3.out`, `fk_sem_indice.out`, `colunas_sem_uso_sql.out` (mesma pasta de trabalho).
- Conferência por amostra do que o auditor anterior deixou: refiz o teste do livro truncado e o da busca com acento; os dois deram o mesmo resultado.
- A suíte pgTAP não foi executada (é de outro auditor). O banco `aud_banco` foi apagado ao final.

Pasta de trabalho: `auditoria-local/trabalho/be-banco/`.

## Retrato do modelo (fatos do catálogo)

| Item | Medida |
|---|---|
| Tabelas em `public` | 123 (todas com RLS; 28 sem política, ou seja, fechadas para leitura direta) |
| Políticas | 100, todas `SELECT` para `authenticated`; nenhuma de escrita |
| Permissões de tabela | `authenticated`: `SELECT` em 89 tabelas; `anon`: nenhuma; escrita: nenhuma |
| Funções | 274 em `public` (todas `SECURITY DEFINER`, `search_path=""`), 265 em `app` (161 `SECURITY DEFINER`) |
| `EXECUTE` em `public` | `anon` em 17 (pontos públicos com token ou slug), `authenticated` em 249, só `service_role` em 25 |
| FKs | 257: 124 compostas, 133 simples (a maioria para `tenants`, `auth.users` e catálogos sem negócio) |
| `ON DELETE` | 245 `RESTRICT`, 8 `CASCADE`, 3 `SET NULL`, 1 `NO ACTION` |
| Checks | 563 (126 do tipo `status in (...)`); enums: nenhum |
| Dinheiro | 42 colunas `*_cents`, todas `bigint`; 5 sem check de faixa (todas em tabelas de conciliação e simulação) |
| Tempo | 287 `timestamptz`, 15 `date`, 2 `time` (regras de horário local); nenhum `timestamp` sem fuso |
| Fuso | `tenants.timezone` com gatilho `validate_timezone`; 53 funções usam `at time zone`; nenhum `current_date` ou `now()::date` |
| Exclusão de conflito | `bookings_no_overlap` e `team_allocations_no_overlap` (gist por negócio, recurso e intervalo) |
| Idempotência | `idempotency_records` único em (negócio, ator, operação, chave) com `NULLS NOT DISTINCT`; webhooks únicos por (provedor, id externo); pedido público único por (negócio, chave) |
| Gatilhos | 97: 59 `touch_row`, 31 `forbid_mutation` (append-only), 7 de regra |
| Maior função | `app.an_metrics`, 122 linhas; nenhuma passa de 150 |
| pgTAP | 33 arquivos, 1.779 asserções planejadas |

## Achados

### be-banco-01 · O livro do caixa corta em 200 pela ordem errada e esconde recebíveis em aberto (alta, defeito)

**Fato.** `public.finance_ledger` (`supabase/migrations/20261018140000_p07_finance.sql:792-807`) monta a lista de recebíveis com "em aberto de qualquer data + criados no período", ordena por `due_at` crescente e corta em 200 (linha 801). Quando o conjunto passa de 200, quem sai são os de vencimento mais novo. A tela do caixa tira a lista "A receber" filtrando esse mesmo retorno (`src/features/finance/FinancePage.tsx:206`), e a tela de cobrança faz igual (`src/features/payments/serverPort.ts:26`). O resumo (`finance_summary`) soma direto na tabela e não sofre corte.

**Medida** (`t_ledger_truncado.sql`, reexecutado): negócio com 210 atendimentos cobrados em um mês, 200 pagos e os 10 mais recentes em aberto. O resumo devolve 10 em aberto (R$ 600,00); o livro devolve 200 recebíveis e **0 em aberto**. A tela mostra o total a receber e uma lista vazia.

**Quando acontece.** No teto do piloto (200 atendimentos por mês) ou antes, se houver recebíveis antigos em aberto acumulados ou se o período escolhido for maior que um mês. O contrato fixa o teto (`supabase/functions/_shared/contracts/finance.ts:127`, `z.array(Receivable).max(200)`), então o corte existe por desenho; o defeito é a ordem do corte e a falta de aviso.

**Correção** (`correcoes/03_finance_ledger.sql`, migration nova com `create or replace` do corpo atual trocando só a ordenação da subconsulta de recebíveis):

```sql
order by (r.status in ('open', 'partially_paid')) desc,
         case when r.status in ('open', 'partially_paid') then r.due_at end nulls last,
         r.created_at desc
limit 200
```

Em aberto entram primeiro (vencidos antes), e os fechados do período entram do mais novo para o mais antigo. Testado: mesma forma de saída, 200 itens, contrato intacto. Em seguida, como mudança de contrato do integrador, acrescentar `truncated: { receivables, payments, expenses }` para a tela avisar quando houver corte.

### be-banco-02 · A busca de cliente não ignora acento e a ordem alfabética depende da collation (alta, defeito)

**Fato.** `app.crm_name_key` só passa para minúsculas e junta espaços (`20261018120100_p02_crm.sql:13-15`); `crm_customer_list` compara com `strpos(c.name_key, v_q)` (linha 334).

**Medida** (`t_busca_acento.sql`): cliente "João Conceição". Busca "joão" acha 1; "JOÃO" acha 1; **"joao" acha 0; "conceicao" acha 0**. Telefone funciona com 4 dígitos ou mais ("4321" acha, "321" não, por regra).

**Inferência a conferir na homologação.** No banco local (`C.UTF-8`) a ordenação por `name_key` devolve `ana, Bruno, Zeca, Álvaro, Érica`: nomes com inicial acentuada vão para o fim da lista. Rode `select datcollate from pg_database where datname = current_database()` na homologação; se for `C.UTF-8`, o defeito também existe lá. A correção abaixo elimina a dependência.

**Correção** (`correcoes/02_crm_busca_sem_acento.sql`):

```sql
create function app.crm_search_key(p_text text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g')),
                   'áàâãäåçéèêëíìîïñóòôõöúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')
$$;
revoke all on function app.crm_search_key(text) from public;
grant execute on function app.crm_search_key(text) to authenticated, service_role;
alter table public.customers add column search_key text generated always as (app.crm_search_key(name)) stored;
create index customers_tenant_search on public.customers (tenant_id, search_key, id);
```

e `create or replace function public.crm_customer_list` com o mesmo corpo, trocando `name_key` por `search_key` no filtro, na ordenação e no cursor, e o termo por `app.crm_search_key(v_q)`. Não usa a extensão `unaccent` de propósito (ela é `STABLE` e não serve em coluna gerada). Testado: "joao", "conceicao", "JOÃO" e "4321" acham 1 cada. `name_key` continua existindo (é usado por `crm_customer_matches` para sugerir duplicados; vale trocar lá também numa segunda migration).

### be-banco-03 · `jobs_run` sem isolamento entre módulos e reescrita inteira 7 vezes (alta, reforcar)

**Fato.** A versão vigente (`20261103150000_p45_insights.sql:1024`) chama, na mesma transação e sem bloco de exceção: `app.wl_expire_offers`, `public.scheduling_expire_holds`, `app.rc_tick`, `app.ref_tick`, `app.cp_tick`, `app.ga_tick` (linhas 1040-1045), depois a fila de eventos, depois `app.lc_tick` (1072) e `app.gi_tick` (1074). Só o laço da fila tem tratamento de erro. A função foi redefinida em 7 migrations (p06, p13, p20, p21, p19, p22, p45), cada uma copiando o corpo inteiro para acrescentar uma linha.

**Medida** (`t_jobs_isolamento.sql`): simulei um erro em `app.gi_tick` (motor de insights, módulo periférico). Resultado na `main`: `jobs_run ABORTOU inteira: falha simulada no motor de insights`, e o hold vencido de teste continuou `held`. Ou seja, um defeito em indicações, campanhas, conselhos ou insights para a entrega de mensagens, a régua de lembretes, a expiração de ofertas e as renovações, a cada minuto, até alguém corrigir. (A agenda em si não trava: `app.sched_busy` ignora hold vencido e `app.sched_release_expired` libera na hora de gravar.)

**Custo hoje:** 3 execuções seguidas no banco de volume (32 negócios): 408 ms, 295 ms e 35 ms.

**Correção** (`correcoes/06_jobs_registro.sql`, 92 linhas, testada): tabela `public.job_ticks` (nome, função, lote, fase, posição, `enabled`), função `app.jobs_run_ticks(fase)` que executa cada rotina em bloco próprio (`begin … exception when others`) e devolve resultados e erros, e `jobs_run` reescrita **pela última vez** usando o registro. As chaves do retorno ficam as mesmas (`done, retried, dead, expired_holds, expired_offers, lifecycle, recurrence, referrals, campaigns, advice, insights`) mais `tick_errors`. Com o mesmo erro simulado: `expired_holds=1 tick_errors={"insights": "falha simulada no motor de insights"}` e o hold foi liberado. Pacote novo passa a fazer `insert into public.job_ticks …` em vez de reescrever a função; módulo escondido no piloto pode ser desligado com `update public.job_ticks set enabled = false` (em migration). A Edge Function `jobs` (`supabase/functions/jobs/handler.ts:37`) deve registrar `tick_errors` com nível de erro.

### be-banco-04 · O `REVOKE` padrão do schema `app` não tem efeito: 38 funções auxiliares com `EXECUTE` para `PUBLIC` (media, defeito)

**Fato.** `20261017120000_foundation.sql:17` faz `alter default privileges in schema app revoke execute on functions from public`. No Postgres, privilégio padrão por schema só soma ao padrão global; ele não consegue tirar o `EXECUTE` que `PUBLIC` recebe por padrão. Prova no catálogo: `pg_default_acl` está vazio depois das 38 migrations, e 38 das 265 funções de `app` têm `proacl` nulo (ACL padrão, com `PUBLIC`). As outras 227 estão fechadas porque cada migration lembrou do `revoke all … from public` explícito. Em `public` nenhuma função ficou com ACL nula.

Das 38, 10 são `SECURITY DEFINER`: `dsc_owner, fsc_owner, lc_owner, pay_owner, prs_owner, rc_owner, ref_owner, rep_owner, rc_cycle_json, rc_sub_json`. As duas últimas leem tabelas sem conferir o negócio (`20261022150000_p20_recurrence.sql:107` e `:114`).

**Medida** (`t_app_secdef.sql`): usuário autenticado do negócio A, cliente de um negócio de que ele não participa. Pela RLS: 0 linhas visíveis. Por `app.rc_sub_json(...)` com o `customer_id` alheio: devolveu o nome ("Antônio Santos 94").

**Alcance real.** `authenticated` tem `USAGE` em `app` (foundation:16), mas a API só expõe `public` e `graphql_public` (`supabase/config.toml:13`), então isso não é alcançável pelo aplicativo hoje. Vira vazamento entre negócios se alguém expuser `app` na API ou criar uma função `SECURITY INVOKER` em `public` que repasse a chamada. Por isso média e não crítica. Conferir no painel da homologação se "Exposed schemas" é igual ao `config.toml`.

**Correção** (`correcoes/01_app_privilegios.sql`, testada com fumaça como `authenticated` e `anon`):

```sql
alter default privileges revoke execute on functions from public;   -- forma global: a única que tem efeito
revoke execute on all functions in schema app from public, anon;
```

Depois disso: `app` com `PUBLIC`: 0; `authenticated` mantém só os 6 com grant explícito (`is_member`, `member_role`, `linked_customer_id`, `profile_photo_tenant`, `profile_photo_writer`, `crm_name_key`); RLS, `crm_customer_upsert`, `crm_customer_list`, `finance_summary`, `finance_ledger`, `scheduling_booking_list` e `discovery_cities` (anon) continuam funcionando; `app.rc_sub_json` passa a dar `permission denied`. Acrescentar ao pgTAP da fundação: `select is_empty($$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute') $$)`.

### be-banco-05 · Nenhuma tabela técnica tem retenção e não há exportação nem exclusão por negócio (media, decisao)

**Fato.** `docs/02_DADOS_E_INVARIANTES.md:81`: "Definir retenção por categoria e finalidade antes de dados reais […] Exportação por negócio em CSV/JSON e exclusão com trilha de execução". No banco: nenhuma função com nome de exportação, exclusão, expurgo ou anonimização; `DELETE` aparece em 9 funções, todas de configuração (regras de horário, uso de material, etc.). Crescem para sempre: `idempotency_records` (guarda o corpo inteiro da resposta em `response jsonb`, com dados de cliente), `outbox_events` (os `done` nunca saem), `channel_webhook_events`, `payment_webhook_events`, `lifecycle_processed_events`, `channel_messages`, `agent_runs`. Excluir um negócio é impossível sem desligar gatilhos: 245 FKs `RESTRICT` e `audit_events` com gatilho contra `DELETE` e `TRUNCATE`.

No volume do piloto isso não pesa em desempenho. Pesa como obrigação declarada e não cumprida, e como dado pessoal guardado sem prazo.

**Decisão dos donos:** os prazos. Proposta: idempotência 30 dias depois de concluída; eventos `done`, webhooks e eventos processados 90 dias; mensagens e execuções do agente 12 meses; auditoria e livros-caixa ficam.

**Correção proposta** (`correcoes/07_retencao.sql`, testada junto com a 06): `app.retention_tick(p_batch)` apaga em lotes por prazo e entra no registro de rotinas:

```sql
insert into public.job_ticks (name, fn, takes_batch, batch, phase, position)
values ('retention', 'app.retention_tick', true, 500, 'after_outbox', 90);
```

Exportação e exclusão por negócio são um pacote à parte (função `SECURITY DEFINER` só para `service_role`, com trilha em `audit_events`); não escrevi esse SQL porque depende da decisão de o que preservar.

### be-banco-06 · Vinte listas com `limit 200` fixo e nenhum sinal de corte (media, reforcar)

**Fato.** `grep -n "limit 200" supabase/migrations/*.sql` devolve 20 ocorrências em 12 arquivos: caixa (p07:801, 804, 807, 854), lista de espera (p06:511), propostas do agente (p08:391), orçamentos (p11:456), operação (p15:717, 957, 961), mensagens (p12:393, 415), cobranças (p14:345, 347), régua (p13:568), assinaturas (p20:438), `my_bookings` (:30), equipe (p28:1066), materiais (p30:642, 661). Nenhuma devolve indicação de que houve corte. Só clientes (`crm_customer_list`) e agenda (`scheduling_booking_list`) têm cursor.

**Recomendação.** Padrão único para as próximas migrations: buscar `limite + 1`, devolver `truncated: true` quando vier a mais, e a tela dizer "mostrando os 200 mais recentes". Começar pelas quatro listas do caixa (junto com be-banco-01) e por `my_bookings`. É mudança de contrato (integrador).

### be-banco-07 · Largura do modelo frente ao piloto: 72% do SQL é periferia (media, decisao)

**Fato.** 123 tabelas, 539 funções, 97 gatilhos. Linhas de migration do núcleo (fundação, identidade, clientes, vínculos, agenda, caixa, preço, lista de espera, agendamento público e ajustes): 6.034 de 21.256 (28%). O resto: mensagens (7 tabelas), site (7), equipe (7), contas a pagar (6), cobrança por provedor (6), agente (5), materiais (5), fiscal (5), régua (5), domicílio (4), assinaturas, orçamentos, indicações, diretório, avaliações, operação de serviço, insights.

**O que isso custa de verdade.** Em consulta, nada: tabela vazia não pesa e os planos do núcleo estão corretos. Custa em três lugares: (1) `jobs_run` executa as rotinas de todos os módulos a cada minuto, e qualquer uma derruba as outras (be-banco-03); (2) funções do núcleo são reescritas para acomodar a periferia (`app.network_profile_json` 4 vezes; `scheduling_booking_confirm`, `scheduling_booking_reschedule` e `app.sched_insert_booking` reescritas pelo pacote de preço); (3) qualquer mudança transversal (exclusão de negócio, fusão de clientes duplicados, retenção) precisa tratar 123 tabelas e 245 FKs `RESTRICT`.

**Recomendação.** Não remover tabela nem função (as migrations são append-only e não há ganho em apagar). Congelar: sem migration nova em módulo que a navegação do piloto não mostra; desligar no registro (`job_ticks.enabled = false`) as rotinas de módulos escondidos; e, se os donos esconderem um módulo, revogar numa migration o `EXECUTE` de `authenticated` nas RPCs dele (devolver é uma linha de `grant`). Quais módulos, é decisão dos donos (veja o relatório de escopo).

### be-banco-08 · Histórico de funções difícil de ler: 566 definições, 20 funções redefinidas, nenhum retrato do estado atual (media, refatorar)

**Fato.** `grep -ioE "create (or replace )?function" supabase/migrations/*.sql` conta 566 definições para 539 funções vivas. Redefinidas em mais de uma migration: `public.jobs_run` (7), `app.network_profile_json` (4) e outras 18 (2 cada). Para saber o corpo vigente de uma função é preciso descobrir qual foi a última migration que a tocou. O auditor anterior precisou de um `pg_dump` de 1,4 MB para isso.

**Proposta, sem violar o append-only:**
1. **Retrato gerado e versionado.** `scripts/db-snapshot.sh` aplica as migrations num banco descartável (como `scripts/db-test-local.sh` já faz) e grava `db/snapshot/tables/<tabela>.sql` e `db/snapshot/functions/<schema>.<nome>.sql` com `pg_get_functiondef`. O CI falha se o retrato estiver desatualizado. O histórico continua nas migrations; a leitura e a revisão de PR passam a ser no retrato (o diff mostra só as linhas que mudaram na função).
2. **Regra de migration de alteração.** Só as funções alteradas, cada uma com um comentário `-- substitui <arquivo>:<linha>; muda: <o quê>`.
3. **Despachantes por registro, não por reescrita:** `jobs_run` (be-banco-03) e, pelo mesmo desenho, `app.jobs_handle` (2 versões) e `app.ga_rules` (2 versões).
4. **Um auxiliar de autorização.** Existem 21 cópias do mesmo `*_owner` de 5 linhas (`fin_owner`, `tm_owner`, `fa_owner`, `mt_owner`, `ga_owner`, `ch_owner`, `fs_owner`, `prs_owner`, `svc_owner`, `lc_owner`, `fsc_owner`, `rc_owner`, `pay_owner`, `sales_owner`, `cp_owner`, `setup_owner`, `an_owner`, `agent_owner`, `rep_owner`, `dsc_owner`, `ref_owner`). Função nova usa `app.is_member(p_tenant_id, array['owner'])` ou um único `app.require_owner`; as antigas ficam como estão.

### be-banco-09 · `docs/02` não descreve o banco que existe (media, refatorar)

**Fato.** O dicionário de `docs/02_DADOS_E_INVARIANTES.md` (linhas 15-42) tem 28 linhas. Sete nomes não existem no banco: `services` (é `provider_services`), `availability_exceptions` (é `availability_blocks`), `price_rules` (é `pricing_rules`), `payment_allocations` (não existe; o pagamento aponta direto para um recebível), `consents` (é `contact_consents`), `action_proposals` (é `agent_proposals`), `plan_entitlements` (não existe). Das 123 tabelas reais, 28 aparecem no documento. `db/proposals` tem só P01, P02 e P09, embora o `README.md` de lá diga que todo pacote escreve a proposta ali.

**Recomendação.** Gerar o dicionário a partir do catálogo junto com o retrato da be-banco-08 (`db/snapshot/DICIONARIO.md`: tabela, colunas, checks, FKs, política) e reduzir o `docs/02` às invariantes, apontando para o gerado. Corrigir os sete nomes. Declarar `db/proposals` encerrado no README (o fluxo real foi migration direta pelo integrador).

### be-banco-10 · Seis FKs simples de auto-referência fogem da regra de FK composta (baixa, defeito)

**Fato.** `AGENTS.md:28` exige FKs compostas. Seis FKs entre tabelas com `tenant_id` usam só o `id`: `reversal_of` em `session_entries` (p07:51), `payment_entries` (p07:130), `expense_entries` (p07:153), `team_commission_entries` (p28:178), `material_movements` (p30:104) e `public_booking_requests.replaced_request_id` (p43_replace:17). O banco aceitaria um estorno apontando para o lançamento de outro negócio; hoje só as funções gravam e elas conferem, por isso é baixa.

**Correção** (`correcoes/04_fk_compostas_estorno.sql`, testada; os dados do volume validaram):

```sql
alter table public.payment_entries add constraint payment_entries_reversal_same_tenant
  foreign key (tenant_id, reversal_of) references public.payment_entries (tenant_id, id) on delete restrict not valid;
alter table public.payment_entries validate constraint payment_entries_reversal_same_tenant;
-- idem para expense_entries, session_entries, material_movements, team_commission_entries
alter table public.public_booking_requests add constraint public_booking_requests_tenant_id_id_key unique (tenant_id, id);
alter table public.public_booking_requests add constraint public_booking_requests_replaced_same_tenant
  foreign key (tenant_id, replaced_request_id) references public.public_booking_requests (tenant_id, id) not valid;
alter table public.public_booking_requests validate constraint public_booking_requests_replaced_same_tenant;
```

### be-banco-11 · Índices: dois faltando no núcleo, um redundante; o resto não precisa de ação agora (baixa, reforcar)

**Fato.** 120 das 257 FKs não têm índice que comece pelas colunas da FK (`fk_sem_indice.out`); a maioria está na periferia e todas têm `tenant_id` na frente de algum outro índice. No núcleo: `payment_entries (tenant_id, receivable_id)` e `receivables (tenant_id, customer_id)` não têm índice; `bookings_customer` é redundante com `bookings_customer_starts` (mesmo prefixo, mesmo predicado).

**EXPLAIN das consultas quentes** (`explain_seed.out`, `explain_volume.out`): agenda do dia usa `bookings_tenant_start` (0,13 ms); ocupação usa `bookings_no_overlap` com index-only scan (0,46 ms); busca de cliente percorre os clientes do negócio por `customers_tenant_name` e filtra (0,31 ms com 400 clientes); recebido no mês usa `payment_entries_period` (0,18 ms); a receber usa `receivables_open` (0,24 ms); histórico do cliente usa `bookings_customer` (0,11 ms). Com o seed puro (3 clientes, 0 reservas) os planos são os mesmos, mas não provam nada.

**Correção** (`correcoes/05_indices.sql`, testada):

```sql
create index payment_entries_receivable on public.payment_entries (tenant_id, receivable_id) where receivable_id is not null;
create index receivables_customer on public.receivables (tenant_id, customer_id, created_at desc);
drop index public.bookings_customer;
```

Não criar índice para as outras FKs agora: no volume do piloto o ganho é zero e cada índice custa em escrita.

### be-banco-12 · O seed não serve para medir plano e não há volume versionado (baixa, reforcar)

**Fato.** `supabase/seed.sql` (59 linhas) cria 2 negócios, 3 clientes, serviços e recursos; nenhuma reserva, recebível ou pagamento. Qualquer EXPLAIN com o seed devolve 0 linhas.

**Recomendação.** Versionar o volume sintético que já existe na pasta de trabalho (`volume.sql`: 30 negócios × 400 clientes × 2.400 reservas) como `scripts/db-local/volume.sql`, fora do `seed.sql`, e um teste leve que rode as 5 consultas e falhe se aparecer `Seq Scan` em `bookings`, `customers`, `payment_entries` ou `receivables`.

### be-banco-13 · Três colunas mortas (baixa, remover_ou_esconder)

**Fato.** Nenhuma tabela está sem uso (todas as 123 são citadas em alguma função). Sete colunas não aparecem em nenhuma função SQL (`colunas_sem_uso_sql.out`); quatro são carimbos de tempo com `default` (`processed_at`, `dismissed_at`, `detected_at`) ou versão de esquema, e ficam. Três não têm leitor nem escritor em SQL nem em TypeScript: `tenants.settings_version`, `waitlist_offers.delivery_channel`, `insight_rules.action_kind`.

**Recomendação.** Não remover agora (risco maior que o ganho). Marcar com `comment on column … is 'sem uso em 10/11/2026; candidata a remoção'` numa migration e remover quando o retrato da be-banco-08 existir.

## O que manter (não mexer na refatoração)

1. **RLS sem política de escrita + tudo por RPC `SECURITY DEFINER` com `search_path = ''`.** 123 tabelas com RLS, 100 políticas só de leitura, nenhuma permissão de escrita em tabela. As 232 RPCs de usuário logado têm chamada de autorização no corpo (varredura por expressão regular: 0 sem).
2. **Restrição de exclusão da agenda** (`bookings_no_overlap`) com `bookings_capacity_by_status`, `bookings_occupied` e expiração preguiçosa de hold (`app.sched_busy` ignora hold vencido; `app.sched_release_expired` libera antes de gravar). A agenda não depende do job para ficar correta.
3. **Dinheiro em `bigint` de centavos com teto de 2^53-1** e checks cruzados em `receivables` (`receivables_status_matches`, `receivables_paid_le_amount`, um recebível por reserva).
4. **Livros append-only por gatilho** (`forbid_mutation` em 30 tabelas) com estorno único por lançamento (`*_one_reversal`).
5. **Idempotência**: escopo (negócio, ator, operação, chave), hash do pedido, conflito explícito (`IDEMPOTENCY_MISMATCH`).
6. **`text` + `CHECK` em vez de enum** (126 checks de estado): evolui com migration simples e não trava o append-only. Não converter.
7. **`timestamptz` em tudo e fuso por negócio** validado por gatilho.
8. **Índices do núcleo** (`bookings_tenant_start`, gist de ocupação, `payment_entries_period`, `receivables_open`, `customers_tenant_phone`).
9. **Funções curtas**: nenhuma passa de 150 linhas; a maior tem 122.

## O que não foi coberto

- A suíte pgTAP (33 arquivos, 1.779 asserções) não foi executada; é de outro auditor.
- Banco da homologação: nada foi consultado lá. Ficam por conferir a collation, os "Exposed schemas" da API e os privilégios padrão que o Supabase hospedado aplica (o shim local não os replica).
- Agendamento do `jobs` (Supabase Cron, ADR-0011): fica fora do repositório; não conferi se está ativo.
- Concorrência (bloqueios em pagamento, corrida de reserva) e os 26 scripts de concorrência: não rodei.
- Os 17 pontos públicos para `anon` (limite de tentativas, tokens): área do auditor de segurança.
- Políticas de `storage` (foto de perfil) e o conteúdo exato gravado em `audit_events` (a projeção `app.crm_customer_audit` não foi lida).
- Leitura linha a linha das funções da periferia (fiscal, site, equipe, materiais, domicílio): só catálogo e varreduras.
- Exportação ou exclusão por negócio do lado TypeScript (Edge Functions): só confirmei que não existe no SQL.
