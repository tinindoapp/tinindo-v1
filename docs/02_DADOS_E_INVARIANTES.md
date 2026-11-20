# 02 · Modelo de dados e invariantes

## Identidade: o erro que não podemos cometer

Uma pessoa pode ser profissional em um negócio e cliente em vários. `auth.users` é a identidade global de login. `tenant` é o negócio assinante. `tenant_memberships` dá papel dentro do negócio. `customers` é o cadastro privado do negócio e pode existir sem login. `customer_links` vincula uma identidade autenticada àquele cadastro após comprovação de contato.

Nunca permitir que “mesmo telefone” una automaticamente prontuários, pagamentos ou histórico de clientes entre negócios. Telefone não é chave de autorização; números mudam de dono. Cliente vê apenas suas reservas e seus dados explicitamente compartilhados. Perfil público é projeção separada, publicada por consentimento do profissional.

## Dicionário do piloto

Este quadro é o mapa lógico do núcleo, com os nomes que as tabelas têm no banco. O dicionário completo (as 125 tabelas, com colunas, chaves, referências e políticas) é gerado do catálogo em [`02_DICIONARIO.md`](02_DICIONARIO.md) e conferido pelo CI; quando os dois divergirem, vale o gerado.

Todos os registros de domínio têm UUID, `created_at` e, quando editáveis, `updated_at` e `version`. Tabelas privadas incluem `tenant_id NOT NULL`. Tabelas globais/públicas justificam exceção por ADR.

| Entidade | Campos centrais | Invariante |
|---|---|---|
| `tenants` | name, timezone, currency, status, settings_version | BRL e timezone IANA no piloto |
| `tenant_memberships` | tenant_id, user_id, role, active | UNIQUE tenant/user; role no servidor |
| `resources` | tenant_id, name, active | Um profissional/recurso por negócio no piloto |
| `customers` | tenant_id, name, normalized_phone, email, archived_at | Dedupe assistido só dentro do tenant |
| `customer_links` | tenant_id, customer_id, user_id, verified_at | Comprovação; FK composta válida |
| `provider_services` | name, duration_min, buffer_before/after, base_price_cents, min_price_cents, cost_version | Duração positiva e preço não negativo |
| `availability_rules` | resource_id, weekday, local_start/end, effective_dates | Horário local + timezone, não offset fixo |
| `availability_blocks` | resource_id, starts_at, ends_at, type | Bloqueios/férias excepcionais prevalecem |
| `bookings` | resource_id, customer_id, service_id, starts/ends, occupied_range, status, hold_expires_at, price_quote_id, version | Exclusão de sobreposição ativa |
| `pricing_rules` | service_id, weekday/time_window, discount_bps, floor, start/end, approved_by, version | Versão publicada imutável |
| `price_quotes` | service_id, slot, currency, base/final/cost_cents, rule_version, expires_at | Cotação versionada; não é reserva |
| `waitlist_entries` | customer_id, service_id, acceptable_windows, consent_id, status, joined_at | Elegibilidade explícita e prazo |
| `waitlist_offers` | entry_id, booking_hold_id, quote_id, expires_at, token_hash, status | Um aceite efetivo por offer |
| `session_packages` | customer_id, service_id, purchased_credits, total_price_cents, expires_at | Crédito não é receita repetida |
| `session_entries` | package_id, booking_id, delta, reason, reversal_of | Débito/estorno idempotente por evento |
| `receivables` | booking/package_id, due_at, amount_cents, status | Valor devido não implica recebido |
| `payment_entries` | receivable_id, customer_id, amount_cents, method, received_at, source, reversal_of | Append-only; estorno referenciado; cada recebimento aponta direto para um recebível (não há tabela de alocação) e não excede o saldo dele |
| `expense_entries` | amount_cents, paid_at, category, reversal_of | Registro simples, sem DRE contábil |
| `contact_consents` | subject_ref, purpose, channel, source, granted/revoked_at, policy_version | Marketing separado de transacional |
| `public_profiles` | tenant_id, slug, category, area, public_fields, published_at | Só whitelist de campos, publicação opt-in |
| `referrals` | kind, inviter_ref, invite_token_hash, claimed_tenant_id, status | Convite profissional não é review |
| `agent_runs` | actor, tenant, model, prompt_version, usage, result_status | Auditoria redigida, sem segredo |
| `agent_proposals` | tool, payload_hash, payload, version, expires_at, approval_state, approver | Aprovação vinculada ao payload exato |
| `idempotency_records` | tenant, actor, operation, key, request_hash, response | Mesma chave/payload retorna mesmo resultado |
| `outbox_events` | event_type, attempts, next_run_at, leased_until, status | Retry limitado e dead-letter |
| `job_ticks` | name, fn, phase, position, batch, enabled, consecutive_failures, last_error | Uma linha por rotina periódica; cada uma roda isolada (ver "Rotinas periódicas") |
| `audit_events` | actor, tenant, action, object, before/after redigidos | Append-only pelo backend |

Cotas por plano (`plan_entitlements`) não têm tabela: não foram implementadas no piloto.

É um mapa lógico; não exigir uma tabela para cada conceito quando uma estrutura mais simples mantiver a semântica. Separar pelo menos auth, agenda, cotação, pagamentos e aprovações. Reviews detalhadas, ranking, pedidos de serviço humano, fiscal e conciliação entram em migrações posteriores.

## Integridade e índices

- FKs compostas `(tenant_id, customer_id)` e `(tenant_id, service_id)` referenciam UNIQUE `(tenant_id,id)` no pai, mesmo com UUID global. Isso impede uma reserva do tenant A apontar para cliente B.
- Índices iniciando por tenant nas listas: `(tenant_id, starts_at)`, `(tenant_id, customer_id, starts_at DESC)`, `(tenant_id, due_at)`, `(tenant_id, status, next_run_at)` conforme query real.
- UNIQUE `(provider, external_event_id)` para inbox/webhooks; idempotência também considera o canal/provedor e identidade esperados.
- FK de estorno e de substituição também é composta: `reversal_of` em `payment_entries`, `expense_entries`, `session_entries`, `material_movements` e `team_commission_entries`, e `replaced_request_id` em `public_booking_requests`, referenciam `(tenant_id, id)` (P56). Um estorno não aponta para lançamento de outro negócio nem que uma função erre.
- Índice novo só para consulta que existe: no núcleo, além dos acima, `payment_entries (tenant_id, receivable_id)` e `receivables (tenant_id, customer_id, created_at DESC)`. Não criar índice para toda FK: no volume do piloto o ganho é zero e cada índice custa na escrita.
- Status por CHECK/enum; transições em comandos. Não usar JSON livre para dinheiro ou estados centrais.
- Dados monetários em centavos inteiros e percentuais em basis points; serialização com limites de inteiro seguros no contrato. Cálculo arredondado em ponto explícito e testado; nunca float binário para ledger.
- Datas de instante em `timestamptz` UTC; regras recorrentes em horário local + timezone IANA. Períodos de relatório usam limites locais convertidos em UTC, intervalo semiaberto `[início,fim)`.

## Reserva e concorrência

Uma coluna de intervalo ocupado inclui buffers. Constraint conceitual, a implementar em migration testada:

```sql
EXCLUDE USING gist (
  tenant_id WITH =,
  resource_id WITH =,
  occupied_range WITH &&
) WHERE (blocks_capacity = true);
```

Usar extensão `btree_gist`, `tstzrange` com limite `[)` e checks de duração. A coluna `blocks_capacity` é alterada apenas por funções confiáveis; o cliente não a escreve. Holds vencidos não desaparecem por mágica da constraint. Na transação de reservar: bloquear a linha do recurso, liberar holds vencidos relevantes, validar disponibilidade/regras, inserir hold ou reserva e evento. Todos os comandos que alteram capacidade seguem o mesmo protocolo. Um cron limpa resíduos, mas correção não depende dele estar pontual.

Confirmar hold exige `hold_expires_at > now()` **no banco**, token/ator válido e preço ainda aceitável conforme cotação. Serializar a disputa por hold/recurso. Reagendar é atômico: ou novo horário entra e anterior sai, ou nada muda. Um conflito retorna 409, nunca sucesso aparente com sincronização posterior.

## Rotinas periódicas

O worker (`public.jobs_run`, chamado a cada minuto pela Edge Function `jobs`) não chama as rotinas dos módulos direto. Cada rotina é uma linha em `public.job_ticks` (nome, função, fase antes ou depois da fila de eventos, ordem, lote, ligada) e roda em bloco próprio: a que falha desfaz só o que ela mesma escreveu, devolve `null` no resultado e a mensagem em `tick_errors`, e as outras seguem. A falha fica anotada na própria linha (`consecutive_failures`, `last_error`, `last_failed_at`) e o contador zera quando a rotina volta a passar.

- Pacote novo **insere uma linha** em `job_ticks` numa migration. Não reescreve `jobs_run`.
- Módulo escondido no piloto: `update public.job_ticks set enabled = false where name = …` em migration.
- A função registrada mora em `app` ou `public`, recebe o lote (`integer`) ou nada, e devolve algo que vire JSON. O nome entra num `execute format`, por isso o `CHECK` só aceita `schema.nome` em letras minúsculas.
- A correção da agenda continua não dependendo do worker (holds vencidos são ignorados e liberados na hora de gravar).

## Listas com teto

As leituras em lista têm teto fixo (200 itens; algumas, 100 ou 50) e os contratos repetem o teto. O teto não é paginação: é limite de segurança. Toda função de `public` com lista de teto devolve também `truncated: { <lista>: true|false }`, com `true` quando existem mais linhas do que as devolvidas (o mesmo filtro da lista, com `offset <teto>`). Clientes (`crm_customer_list`) e agenda (`scheduling_booking_list`) usam cursor e não têm teto. Lista nova com `limit 200` sem `truncated` faz o pgTAP 37 falhar. Exceção conhecida: `my_bookings`, que devolve `TABLE`.

## Privilégios

- `public`: toda função é `SECURITY DEFINER` com `search_path = ''`, e cada migration termina com `revoke all … from public` e os `grant` explícitos. Nenhuma tabela dá escrita a `anon` ou `authenticated`.
- `app`: auxiliares internos. Nenhuma função de `app` é executável por `anon` (nem por `PUBLIC`); `authenticated` executa só os sete auxiliares usados em políticas de RLS, de storage e em coluna gerada (`is_member`, `member_role`, `linked_customer_id`, `profile_photo_tenant`, `profile_photo_writer`, `crm_name_key`, `crm_search_key`). O pgTAP 38 trava essa lista: função nova em `app` sem `revoke all on function … from public` falha no CI.
- `alter default privileges in schema app revoke execute … from public` (da fundação) **não tem efeito** no Postgres; por isso a regra é o `revoke` explícito em cada migration, conferido por teste. A API expõe só `public` e `graphql_public` (`supabase/config.toml`); não expor `app`.

## Pacote de sessões e caixa

Ao vender 10 sessões por R$1.000, registrar um recebível/pagamento de R$1.000. Ao consumir cada sessão, reduzir crédito uma única vez; não gerar mais R$100 de caixa. Pode haver valor gerencial alocado por sessão, identificado como tal. Cancelamento segue política de crédito; estorno vincula o evento original. Sem saldo negativo de crédito ou pagamento aplicado duas vezes.

## Evolução de schema

Migration é append-only depois de aplicada. O nome é `AAAAMMDDHHMMSS_nome.sql`, com a data e a hora do PR, posterior a todas as que já estão na `main`; pgTAP, concorrência e integração têm número único por pasta. O CI confere as duas coisas (`.github/workflows/check-migrations.mjs`) e recusa mudança em migration já publicada. Migration que altera função traz só as funções alteradas, cada uma com o comentário `-- substitui <arquivo>:<linha>; muda: <o quê>`. Não roda `db push` em projeto compartilhado. Depois de mudar o banco, regerar o dicionário: `bash .github/workflows/db-dictionary.sh`. Expandir → publicar código compatível → migrar dados → retirar antigo só em release posterior. Views públicas com colunas explícitas e política de segurança própria; não presumir que a RLS de uma tabela protege qualquer view.

## Retenção e portabilidade

Definir retenção por categoria e finalidade antes de dados reais; não inventar prazo legal universal. Exportação por negócio em CSV/JSON e exclusão com trilha de execução, preservando o que tiver obrigação aplicável. Backups e logs também entram no inventário. Exportar só o tenant solicitante, sem objetos públicos/CRM de terceiros. Fotos e anexos privados em buckets privados com URLs temporárias e limites de tipo/tamanho.

## Complemento da reconciliação

Entidades futuras de prestação de serviços estão em doc15: platform_offerings, offering_versions, service_orders, work_items, work_logs, deliverables, acceptances, access_grants e usage_ledger. Não misturar com provider_services. Orçamentos P11 terão snapshot versionado, validade, aceite idempotente e revalidação de disponibilidade.
