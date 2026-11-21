# 02 · Dicionário do banco (gerado)

> Arquivo gerado por `.github/workflows/db-dictionary.sh` a partir do catálogo de um banco recém-migrado.
> **Não edite à mão**: mude o banco por migration e rode o script. O CI falha se este arquivo ficar diferente do banco.
> As invariantes e o porquê do modelo estão em [`02_DADOS_E_INVARIANTES.md`](02_DADOS_E_INVARIANTES.md).

Como ler: `?` depois do tipo = aceita nulo. "Leitura" = políticas de RLS (toda tabela tem RLS ligada e nenhuma política
de escrita; quem grava são as RPCs). "Só acrescenta" = gatilho que proíbe `UPDATE` e `DELETE`.

## Resumo

| Item | Total |
|---|---|
| Tabelas em `public` | 140 |
| Com RLS ligada | 140 |
| Políticas (todas de leitura) | 100 |
| FKs | 277 (135 compostas) |
| Funções em `public` / `app` | 310 / 319 |
| Rotinas periódicas (`job_ticks`) | 11 |

## Rotinas periódicas

Uma linha por rotina em `public.job_ticks`; `public.jobs_run` roda cada uma isolada (a que falha não derruba as outras).

| Rotina | Função | Fase | Ordem | Lote | Ligada |
|---|---|---|---|---|---|
| `expired_offers` | `app.wl_expire_offers` | antes da fila | 10 | — | sim |
| `expired_holds` | `public.scheduling_expire_holds` | antes da fila | 20 | — | sim |
| `recurrence` | `app.rc_tick` | antes da fila | 30 | 100 | sim |
| `referrals` | `app.ref_tick` | antes da fila | 40 | 100 | sim |
| `campaigns` | `app.cp_tick` | antes da fila | 50 | 100 | sim |
| `advice` | `app.ga_tick` | antes da fila | 60 | 100 | sim |
| `lifecycle` | `app.lc_tick` | depois da fila | 10 | 100 | sim |
| `insights` | `app.gi_tick` | depois da fila | 20 | 20 | sim |
| `retention` | `app.retention_tick` | depois da fila | 30 | 500 | sim |
| `privacy_erasure` | `app.privacy_erasure_tick` | depois da fila | 40 | 5 | sim |
| `ops_watch` | `app.ops_watch_tick` | depois da fila | 90 | 500 | sim |

## Tabelas

### `abuse_limits`

Limites de abuso da reserva pública (D30 a). Mudar = migration nova.

| Coluna | Tipo |
|---|---|
| `key` | text |
| `value` | integer |
| `note` | text |

- **Chaves e unicidade:** PK (key)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `access_grants`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `order_id` | uuid |
| `operator_user_id` | uuid |
| `scopes` | text[] |
| `justification` | text |
| `expires_at` | timestamp with time zone |
| `granted_by` | uuid |
| `granted_at` | timestamp with time zone |
| `revoked_at` | timestamp with time zone ? |
| `revoked_by` | uuid ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (operator_user_id) → `platform_operators`; (tenant_id, order_id) → `service_orders`
- **Leitura:** `access_grants_select_owner` (authenticated)
- **Só acrescenta:** não

### `advice_decisions`

Decisão do dono sobre uma sugestão por regra e o acompanhamento observacional do indicador. Sem LLM, sem causalidade.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `rule_code` | text |
| `metric_key` | text ? |
| `decision` | text |
| `evidence` | jsonb |
| `metric_before` | jsonb ? |
| `follow_up_at` | timestamp with time zone |
| `metric_after` | jsonb ? |
| `outcome` | text ? |
| `decided_by` | uuid ? |
| `decided_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `advice_decisions_owner_select` (authenticated)
- **Só acrescenta:** não

### `agent_approvals`

Aprovação do dono vinculada a hash e versão. Append-only; uso único via recibo.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `proposal_id` | uuid |
| `payload_hash` | text |
| `proposal_version` | integer |
| `approver_user_id` | uuid |
| `approved_at` | timestamp with time zone |
| `expires_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, proposal_id)
- **Referências:** (tenant_id, proposal_id) → `agent_proposals`; (tenant_id) → `tenants`
- **Leitura:** `agent_approvals_select_owner` (authenticated)
- **Só acrescenta:** não

### `agent_llm_usage`

T11: uso da camada de linguagem por negócio, mês (fuso do negócio) e tarefa. Só números; sem texto, usuário ou conteúdo.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `month` | date |
| `task` | text |
| `calls` | integer |
| `input_tokens` | bigint |
| `output_tokens` | bigint |
| `cost_usd` | numeric(12,6) |
| `unpriced_calls` | integer |
| `updated_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (tenant_id, month, task)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `agent_llm_usage_select_owner` (authenticated)
- **Só acrescenta:** não

### `agent_proposals`

Ação proposta pelo assistente. Só vira efeito com aprovação e execução do dono.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `run_id` | uuid ? |
| `tool` | text |
| `payload` | jsonb |
| `payload_hash` | text |
| `policy_version` | integer |
| `summary` | text |
| `state` | text |
| `expires_at` | timestamp with time zone |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, run_id) → `agent_runs`; (tenant_id) → `tenants`
- **Leitura:** `agent_proposals_select_owner` (authenticated)
- **Só acrescenta:** não

### `agent_quotas`

Franquia mensal de perguntas ao assistente por negócio. Débito atômico em agent_run_start.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `monthly_limit` | integer |
| `period_start` | date |
| `used` | integer |
| `updated_at` | timestamp with time zone |
| `bonus` | integer |
| `bonus_period_start` | date ? |
| `llm_monthly_tokens` | bigint |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `agent_quotas_select_owner` (authenticated)
- **Só acrescenta:** não

### `agent_receipts`

Resultado da execução de uma aprovação. Repetir a execução devolve o mesmo recibo.

| Coluna | Tipo |
|---|---|
| `approval_id` | uuid |
| `tenant_id` | uuid |
| `status` | text |
| `reason_code` | text ? |
| `result_kind` | text ? |
| `result_id` | uuid ? |
| `executed_by` | uuid ? |
| `executed_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (approval_id); única (tenant_id, approval_id)
- **Referências:** (tenant_id, approval_id) → `agent_approvals`; (tenant_id) → `tenants`
- **Leitura:** `agent_receipts_select_owner` (authenticated)
- **Só acrescenta:** não

### `agent_runs`

Uma pergunta debitada. Sem texto da pergunta nem da resposta.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `user_id` | uuid |
| `idem_key` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, user_id, idem_key)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `analytics_baselines`

Ponto de partida congelado para comparar períodos. Append-only.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `label` | text |
| `period` | tstzrange |
| `metrics` | jsonb |
| `coverage` | jsonb |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `analytics_baselines_select_owner` (authenticated)
- **Só acrescenta:** sim

### `assist_events`

Medição do assistente nas telas (T15): evento, superfície e contagem de campos. Sem conteúdo. Só acrescenta.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `event` | text |
| `surface` | text |
| `filled` | integer ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `assist_events_owner_select` (authenticated)
- **Só acrescenta:** sim

### `audit_events`

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `tenant_id` | uuid ? |
| `actor_user_id` | uuid ? |
| `action` | text |
| `object_type` | text |
| `object_id` | uuid ? |
| `request_id` | uuid ? |
| `before` | jsonb ? |
| `after` | jsonb ? |
| `occurred_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `audit_events_select_owner` (authenticated)
- **Só acrescenta:** sim

### `availability_blocks`

Bloqueio pessoal: indisponibilidade, não cliente fictício (doc06).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `resource_id` | uuid |
| `period` | tstzrange |
| `label` | text |
| `removed_at` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, resource_id) → `resources`; (tenant_id) → `tenants`
- **Leitura:** `availability_blocks_select_member` (authenticated)
- **Só acrescenta:** não

### `availability_rules`

Expediente semanal em horário local; o conjunto é trocado inteiro por scheduling_rules_save (versão no recurso).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `resource_id` | uuid |
| `weekday` | smallint |
| `local_start` | time without time zone |
| `local_end` | time without time zone |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, resource_id) → `resources`; (tenant_id) → `tenants`
- **Leitura:** `availability_rules_select_member` (authenticated)
- **Só acrescenta:** não

### `booking_links`

Backend-only. Link com token para o cliente ver a reserva e avaliar sem conta (D20). Guarda só o sha256 do token.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `booking_id` | uuid |
| `token_hash` | text |
| `origin` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (token_hash)
- **Referências:** (tenant_id, booking_id) → `bookings`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `bookings`

Reservas. A constraint bookings_no_overlap é a autoridade final sobre capacidade (um atendimento por vez).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `resource_id` | uuid |
| `customer_id` | uuid ? |
| `guest_ref` | text ? |
| `service_id` | uuid |
| `starts_at` | timestamp with time zone |
| `ends_at` | timestamp with time zone |
| `occupied_range` | tstzrange |
| `blocks_capacity` | boolean |
| `status` | text |
| `hold_expires_at` | timestamp with time zone ? |
| `price_quote_id` | uuid ? |
| `agreed_price_cents` | bigint ? |
| `source` | text |
| `series_id` | uuid ? |
| `status_reason` | text ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id, price_quote_id) → `price_quotes`; (tenant_id, resource_id) → `resources`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `bookings_select_linked_customer` (authenticated); `bookings_select_member` (authenticated)
- **Só acrescenta:** não

### `campaign_members`

Quem entrou na campanha e em que braço (sorteio no servidor). Conversão é medida nos agendamentos, não declarada.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `campaign_id` | uuid |
| `customer_id` | uuid |
| `arm` | text |
| `step_id` | uuid ? |
| `assigned_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (campaign_id, customer_id); única (tenant_id, id)
- **Referências:** (tenant_id, campaign_id) → `campaigns`; (tenant_id, customer_id) → `customers`; (tenant_id, step_id) → `lifecycle_steps`; (tenant_id) → `tenants`
- **Leitura:** `campaign_members_owner_select` (authenticated)
- **Só acrescenta:** sim

### `campaigns`

Campanha com público aprovado (hash), limites no servidor, controle sorteado e janela de medição.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `name` | text |
| `segment` | jsonb |
| `audience_hash` | text |
| `audience_count` | integer |
| `control_pct` | integer |
| `control_count` | integer |
| `treatment_count` | integer |
| `max_sends` | integer |
| `spend_cap_cents` | bigint ? |
| `estimated_cost_cents` | bigint |
| `offer` | jsonb |
| `offer_text` | text |
| `window_days` | integer |
| `status` | text |
| `starts_at` | timestamp with time zone |
| `ends_at` | timestamp with time zone |
| `closed_at` | timestamp with time zone ? |
| `result` | jsonb ? |
| `approved_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `campaigns_owner_select` (authenticated)
- **Só acrescenta:** não

### `channel_connections`

Número do negócio no canal. Um por negócio; um número não serve a dois negócios.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `provider` | text |
| `external_account_id` | text |
| `phone_e164` | text |
| `status` | text |
| `verified_at` | timestamp with time zone ? |
| `disconnected_at` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `channel_connections_select_owner` (authenticated)
- **Só acrescenta:** não

### `channel_contacts`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `connection_id` | uuid |
| `phone_e164` | text |
| `customer_id` | uuid ? |
| `profile_name` | text ? |
| `handling` | text |
| `opt_in_at` | timestamp with time zone ? |
| `opt_in_source` | text ? |
| `opted_out_at` | timestamp with time zone ? |
| `last_inbound_at` | timestamp with time zone ? |
| `last_message_at` | timestamp with time zone ? |
| `unread_count` | integer |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, phone_e164)
- **Referências:** (tenant_id, connection_id) → `channel_connections`; (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`
- **Leitura:** `channel_contacts_select_owner` (authenticated)
- **Só acrescenta:** não

### `channel_messages`

Mensagens do canal. Estados de saída são distintos e só o webhook do provedor avança entregue/lido.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `contact_id` | uuid |
| `direction` | text |
| `kind` | text |
| `body` | text |
| `template_code` | text ? |
| `template_params` | jsonb ? |
| `status` | text |
| `provider_message_id` | text ? |
| `external_event_id` | text ? |
| `failure_reason` | text ? |
| `attempts` | integer |
| `sent_at` | timestamp with time zone ? |
| `delivered_at` | timestamp with time zone ? |
| `read_at` | timestamp with time zone ? |
| `failed_at` | timestamp with time zone ? |
| `unknown_since` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |
| `next_attempt_at` | timestamp with time zone ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, contact_id) → `channel_contacts`; (template_code) → `channel_templates`; (tenant_id) → `tenants`
- **Leitura:** `channel_messages_select_owner` (authenticated)
- **Só acrescenta:** não

### `channel_sim_phone`

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `phone_e164` | text |
| `from_account` | text |
| `body` | text |
| `provider_message_id` | text ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `channel_templates`

Modelos de mensagem (utility). Aprovação por provedor é decisão de backend.

| Coluna | Tipo |
|---|---|
| `code` | text |
| `category` | text |
| `body` | text |
| `params` | integer |
| `approved_providers` | text[] |
| `created_at` | timestamp with time zone |
| `meta_name` | text ? |
| `meta_category` | text ? |
| `meta_language` | text |
| `meta_body` | text ? |
| `meta_params` | integer[] ? |

- **Chaves e unicidade:** PK (code)
- **Referências:** —
- **Leitura:** `channel_templates_select` (authenticated)
- **Só acrescenta:** não

### `channel_verifications`

Backend-only. Sem acesso pela Data API.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `connection_id` | uuid |
| `code` | text ? |
| `code_hash` | text ? |
| `expires_at` | timestamp with time zone |
| `attempts` | integer |
| `dispatch_status` | text |
| `used_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `send_to` | text ? |
| `failure_reason` | text ? |

- **Chaves e unicidade:** PK (id)
- **Referências:** (tenant_id, connection_id) → `channel_connections`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `channel_webhook_events`

Backend-only. Sem payload: só a chave do evento e o desfecho.

| Coluna | Tipo |
|---|---|
| `provider` | text |
| `external_event_id` | text |
| `kind` | text |
| `outcome` | text |
| `received_at` | timestamp with time zone |
| `provider_message_id` | text ? |
| `status` | text ? |
| `reason` | text ? |

- **Chaves e unicidade:** PK (provider, external_event_id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `contact_consents`

Consentimento para contato sobre vaga. Revogar impede novas ofertas.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid |
| `purpose` | text |
| `channel` | text |
| `source` | text |
| `granted_at` | timestamp with time zone |
| `revoked_at` | timestamp with time zone ? |
| `recorded_by` | uuid ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`
- **Leitura:** `contact_consents_select_owner` (authenticated)
- **Só acrescenta:** não

### `content_templates`

Conteúdo pré-aprovado por profissão. Entra por migration (revisão humana), nunca por tela.

| Coluna | Tipo |
|---|---|
| `code` | text |
| `profession` | text |
| `kind` | text |
| `title` | text |
| `body` | text |
| `approved_by` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (code)
- **Referências:** —
- **Leitura:** `content_templates_read` (authenticated)
- **Só acrescenta:** não

### `customer_link_invites`

Backend-only. Só o hash do código fica gravado.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid |
| `token_hash` | text |
| `created_by` | uuid |
| `expires_at` | timestamp with time zone |
| `used_at` | timestamp with time zone ? |
| `used_by` | uuid ? |
| `superseded_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (token_hash)
- **Referências:** (created_by) → `auth.users` (cascade); (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`; (used_by) → `auth.users` (set null)
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `customer_links`

Login de cliente ↔ cadastro privado do negócio, após comprovação. Não é membership.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid |
| `user_id` | uuid |
| `verification_method` | text |
| `verified_at` | timestamp with time zone |
| `revoked_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`; (user_id) → `auth.users` (cascade)
- **Leitura:** `customer_links_select` (authenticated)
- **Só acrescenta:** não

### `customers`

CRM privado do negócio. Dedupe só sugerido e só dentro do tenant.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `name` | text |
| `name_key` | text ? |
| `phone` | text ? |
| `email` | text ? |
| `declared_source` | text ? |
| `archived_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |
| `search_key` | text ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `customers_select_member` (authenticated)
- **Só acrescenta:** não

### `deliverable_reviews`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `deliverable_id` | uuid |
| `decision` | text |
| `note` | text ? |
| `decided_by` | uuid |
| `decided_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (deliverable_id)
- **Referências:** (tenant_id, deliverable_id) → `deliverables`
- **Leitura:** `deliverable_reviews_select_owner` (authenticated)
- **Só acrescenta:** sim

### `deliverables`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `order_id` | uuid |
| `version_no` | integer |
| `title` | text |
| `evidence` | text |
| `delivered_by` | uuid |
| `delivered_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (order_id, version_no); única (tenant_id, id)
- **Referências:** (tenant_id, order_id) → `service_orders`
- **Leitura:** `deliverables_select_owner` (authenticated)
- **Só acrescenta:** sim

### `discovery_listings`

Opt-in do negócio no diretório local. A leitura pública só sai por discovery_search/discovery_cities.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `uf` | character(2) |
| `city_name` | text |
| `city_slug` | text |
| `show_hours` | boolean |
| `status` | text |
| `suspended_reason` | text ? |
| `listed_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `expense_entries`

Despesas simples, append-only, sem DRE contábil. Estorno é linha nova.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `amount_cents` | bigint |
| `paid_at` | timestamp with time zone |
| `category` | text |
| `description` | text ? |
| `reversal_of` | uuid ? |
| `recorded_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (reversal_of) → `expense_entries`; (tenant_id, reversal_of) → `expense_entries`; (tenant_id) → `tenants`
- **Leitura:** `expense_entries_select_owner` (authenticated)
- **Só acrescenta:** sim

### `field_settings`

Regras do atendimento a domicílio do negócio. Sem endereço nem coordenada.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `enabled` | boolean |
| `default_travel_min` | integer |
| `same_zone_travel_min` | integer |
| `arrival_window_min` | integer |
| `max_km` | numeric(5,1) ? |
| `updated_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `field_settings_select_owner` (authenticated)
- **Só acrescenta:** não

### `field_travel_times`

Minutos entre duas zonas, nos dois sentidos. Sem par cadastrado, vale o padrão.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `zone_a` | uuid |
| `zone_b` | uuid |
| `minutes` | integer |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (zone_a, zone_b)
- **Referências:** (tenant_id, zone_a) → `field_zones`; (tenant_id, zone_b) → `field_zones`; (tenant_id) → `tenants`
- **Leitura:** `field_travel_times_select_owner` (authenticated)
- **Só acrescenta:** não

### `field_visits`

Atendimento a domicílio: reserva do P03 + zona (+ CEP de 5 dígitos). O deslocamento é um bloqueio da agenda.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `booking_id` | uuid |
| `zone_id` | uuid |
| `cep5` | text ? |
| `travel_min` | integer ? |
| `travel_block_id` | uuid ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (booking_id); única (tenant_id, id)
- **Referências:** (tenant_id, travel_block_id) → `availability_blocks`; (tenant_id, booking_id) → `bookings`; (tenant_id) → `tenants`; (tenant_id, zone_id) → `field_zones`
- **Leitura:** `field_visits_select_owner` (authenticated)
- **Só acrescenta:** não

### `field_zones`

Zona de atendimento (bairro) com prefixos de CEP e distância declarada. Precisão limitada por desenho.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `name` | text |
| `cep_prefixes` | text[] |
| `distance_km` | numeric(5,1) |
| `travel_from_base_min` | integer |
| `active` | boolean |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `field_zones_select_owner` (authenticated)
- **Só acrescenta:** não

### `fin_categories`

Categoria própria do negócio (receita ou despesa). As do Caixa (P07) valem sem cadastro.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `kind` | text |
| `name` | text |
| `base` | text ? |
| `active` | boolean |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `fin_categories_select_owner` (authenticated)
- **Só acrescenta:** não

### `fin_classifications`

Categoria própria de um lançamento do Caixa. Uma por lançamento; trocar atualiza a linha (auditado).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `entry_kind` | text |
| `payment_entry_id` | uuid ? |
| `expense_entry_id` | uuid ? |
| `category_id` | uuid |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (expense_entry_id); única (payment_entry_id); única (tenant_id, id)
- **Referências:** (tenant_id, category_id) → `fin_categories`; (tenant_id, expense_entry_id) → `expense_entries`; (tenant_id, payment_entry_id) → `payment_entries`; (tenant_id) → `tenants`
- **Leitura:** `fin_classifications_select_owner` (authenticated)
- **Só acrescenta:** não

### `fin_payable_payments`

Pagamento de uma conta. Um vivo por conta (índice único): pagar duas vezes não baixa duas vezes.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `payable_id` | uuid |
| `expense_entry_id` | uuid |
| `amount_cents` | bigint |
| `paid_at` | timestamp with time zone |
| `reversal_expense_id` | uuid ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (expense_entry_id); única (reversal_expense_id); única (tenant_id, id)
- **Referências:** (tenant_id, expense_entry_id) → `expense_entries`; (tenant_id, payable_id) → `fin_payables`; (tenant_id, reversal_expense_id) → `expense_entries`; (tenant_id) → `tenants`
- **Leitura:** `fin_payable_payments_select_owner` (authenticated)
- **Só acrescenta:** não

### `fin_payable_series`

Conta recorrente mensal. Cada mês vira uma conta a pagar própria (vencimento único por mês).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `description` | text |
| `amount_cents` | bigint |
| `base_category` | text |
| `category_id` | uuid ? |
| `supplier` | text ? |
| `day_of_month` | integer |
| `starts_on` | date |
| `generated_until` | date |
| `ended_at` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, category_id) → `fin_categories`; (tenant_id) → `tenants`
- **Leitura:** `fin_payable_series_select_owner` (authenticated)
- **Só acrescenta:** não

### `fin_payables`

Conta a pagar. Pagar cria uma despesa no Caixa (P07); estornar cria o estorno dela.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `series_id` | uuid ? |
| `description` | text |
| `amount_cents` | bigint |
| `due_on` | date |
| `base_category` | text |
| `category_id` | uuid ? |
| `supplier` | text ? |
| `status` | text |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, category_id) → `fin_categories`; (tenant_id, series_id) → `fin_payable_series`; (tenant_id) → `tenants`
- **Leitura:** `fin_payables_select_owner` (authenticated)
- **Só acrescenta:** não

### `fin_reconciliations`

Conferência do dia por meio e origem: extrato × registrado. Append-only; a última vale.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `day` | date |
| `method` | text |
| `source` | text |
| `statement_cents` | bigint |
| `ledger_cents` | bigint |
| `difference_cents` | bigint |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `fin_reconciliations_select_owner` (authenticated)
- **Só acrescenta:** sim

### `fiscal_credentials`

Status da credencial no provedor fiscal, como o provedor informou. Nenhum certificado ou senha é guardado aqui.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `status` | text |
| `valid_until` | timestamp with time zone ? |
| `environment` | text |
| `checked_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `fiscal_document_events`

Linha do tempo de cada nota (protocolo, autorização, rejeição, cancelamento). Append-only.

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `tenant_id` | uuid |
| `document_id` | uuid |
| `from_status` | text ? |
| `to_status` | text |
| `note` | text ? |
| `at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id)
- **Referências:** (tenant_id, document_id) → `fiscal_documents`; (tenant_id) → `tenants`
- **Leitura:** `fiscal_document_events_owner` (authenticated)
- **Só acrescenta:** sim

### `fiscal_documents`

NFS-e emitida pelo provedor. Emitir não confirma pagamento: não toca recebível nem caixa.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `environment` | text |
| `status` | text |
| `receivable_id` | uuid ? |
| `customer_id` | uuid ? |
| `taker_name` | text |
| `taker_document` | text ? |
| `service_code` | text |
| `description` | text |
| `amount_cents` | bigint |
| `competence_date` | date |
| `provider_ref` | text |
| `protocol` | text ? |
| `number` | text ? |
| `verification_code` | text ? |
| `pdf_url` | text ? |
| `xml_url` | text ? |
| `reject_reason` | text ? |
| `cancel_reason` | text ? |
| `unknown_since` | timestamp with time zone ? |
| `authorized_at` | timestamp with time zone ? |
| `cancelled_at` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (provider_ref); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id, receivable_id) → `receivables`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `fiscal_profiles`

Dados fiscais do prestador para NFS-e. Produção só liberada pelo backend após homologação.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `legal_name` | text |
| `cnpj` | text |
| `regime` | text |
| `municipality_ibge` | text |
| `service_code` | text |
| `production_enabled` | boolean |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `fiscal_representations`

Autorização do dono para a Tinindo emitir NFS-e em nome dele (termos por hash, validade, revogação).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `scope` | text |
| `terms_hash` | text |
| `granted_by` | uuid |
| `granted_at` | timestamp with time zone |
| `valid_until` | timestamp with time zone |
| `revoked_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `goals`

Meta mensal por indicador do P18. O progresso é o próprio indicador (com denominador), nunca um número declarado.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `metric_key` | text |
| `target` | numeric |
| `direction` | text |
| `period_start` | date |
| `note` | text ? |
| `status` | text |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `goals_owner_select` (authenticated)
- **Só acrescenta:** não

### `idempotency_records`

Backend-only. Sem acesso pela Data API.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `actor_user_id` | uuid ? |
| `operation` | text |
| `key` | text |
| `request_hash` | text |
| `status_code` | integer ? |
| `response` | jsonb ? |
| `created_at` | timestamp with time zone |
| `completed_at` | timestamp with time zone ? |

- **Chaves e unicidade:** única (tenant_id, actor_user_id, operation, key)
- **Referências:** (tenant_id) → `tenants` (cascade)
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `identity_verification_requests`

Pedido de verificação de identidade feito pelo dono. A equipe atende pelo backend. Sem documento.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `requested_by` | uuid |
| `preferred_method` | text |
| `status` | text |
| `requested_at` | timestamp with time zone |
| `closed_at` | timestamp with time zone ? |

- **Chaves e unicidade:** PK (id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `identity_verifications`

Identidade do responsável verificada pela equipe (backend). Nenhum documento é guardado aqui. Não é competência.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `method` | text |
| `verified_by` | text |
| `verified_at` | timestamp with time zone |
| `revoked_at` | timestamp with time zone ? |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `insight_digests`

Resumo semanal do dono por modelo fixo. Um por negócio e semana.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `week_start` | date |
| `body` | text |
| `facts` | jsonb |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, week_start)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `insight_digests_owner_select` (authenticated)
- **Só acrescenta:** não

### `insight_explanations`

Frase "Por quê?" de um insight (P45), escrita pelo modelo (P46, tarefa EXPLAIN) quando o dono abre a sugestão. Uma por versão; só a RPC grava.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `insight_id` | uuid |
| `version` | integer |
| `text` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (tenant_id, insight_id, version)
- **Referências:** (tenant_id, insight_id) → `insights` (cascade); (tenant_id) → `tenants`
- **Leitura:** `insight_explanations_owner_select` (authenticated)
- **Só acrescenta:** não

### `insight_rules`

Catálogo das regras do motor de insights (P45). Só muda por migration; o cálculo está em app.gi_*.

| Coluna | Tipo |
|---|---|
| `code` | text |
| `title` | text |
| `flow` | text |
| `action_kind` | text |
| `priority` | integer |
| `direction` | text |
| `rule_version` | integer |
| `description` | text |

- **Chaves e unicidade:** PK (code)
- **Referências:** —
- **Leitura:** `insight_rules_read` (authenticated)
- **Só acrescenta:** não

### `insight_runs`

Backend-only. Uma rodada do motor por negócio e dia local: a chave primária impede rodada dupla.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `run_date` | date |
| `started_at` | timestamp with time zone |
| `finished_at` | timestamp with time zone ? |
| `result` | jsonb ? |

- **Chaves e unicidade:** PK (tenant_id, run_date)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `insights`

Insight do motor diário (P45). Um por negócio, regra e assunto; só o motor e as RPCs do dono escrevem.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `rule_code` | text |
| `subject_key` | text |
| `state` | text |
| `priority` | integer |
| `title` | text |
| `body` | text |
| `evidence` | jsonb |
| `action` | jsonb |
| `measure` | jsonb ? |
| `first_seen_on` | date |
| `last_seen_on` | date |
| `valid_until` | timestamp with time zone |
| `quiet_until` | timestamp with time zone ? |
| `decision_id` | uuid ? |
| `result` | jsonb ? |
| `acted_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, rule_code, subject_key)
- **Referências:** (tenant_id, decision_id) → `advice_decisions`; (rule_code) → `insight_rules`; (tenant_id) → `tenants`
- **Leitura:** `insights_owner_select` (authenticated)
- **Só acrescenta:** não

### `job_ticks`

Registro das rotinas periódicas do worker (jobs_run). Uma linha por rotina; cada uma roda isolada.

| Coluna | Tipo |
|---|---|
| `name` | text |
| `fn` | text |
| `takes_batch` | boolean |
| `batch` | integer |
| `phase` | text |
| `position` | integer |
| `enabled` | boolean |
| `consecutive_failures` | integer |
| `last_error` | text ? |
| `last_failed_at` | timestamp with time zone ? |

- **Chaves e unicidade:** PK (name); única (phase, position)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `lifecycle_campaigns`

Reativação só como campanha: público aprovado e teto de envios pelo dono.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `kind` | text |
| `audience_hash` | text |
| `audience_count` | integer |
| `max_sends` | integer |
| `template_code` | text |
| `status` | text |
| `approved_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (template_code) → `channel_templates`; (tenant_id) → `tenants`
- **Leitura:** `lifecycle_campaigns_select_owner` (authenticated)
- **Só acrescenta:** não

### `lifecycle_consents`

Consentimento por finalidade, registrado pelo dono (declarado, auditado). Revogar para a régua.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid |
| `purpose` | text |
| `source` | text |
| `granted_at` | timestamp with time zone |
| `revoked_at` | timestamp with time zone ? |
| `recorded_by` | uuid ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`
- **Leitura:** `lifecycle_consents_select_owner` (authenticated)
- **Só acrescenta:** não

### `lifecycle_processed_events`

Backend-only. Consumidor idempotente do outbox (entrega ao menos uma vez).

| Coluna | Tipo |
|---|---|
| `event_id` | uuid |
| `processed_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (event_id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `lifecycle_settings`

Réguas do negócio. Ausente = padrão (ligado, 24 h e 2 h, 2 dias, 60 dias, 30 envios/dia).

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `enabled` | boolean |
| `confirmation` | boolean |
| `reminder_hours` | integer[] |
| `quote_followup_days` | integer |
| `receivable_reminder` | boolean |
| `reactivation_days` | integer |
| `daily_budget` | integer |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `lifecycle_settings_select_owner` (authenticated)
- **Só acrescenta:** não

### `lifecycle_steps`

Um passo de régua. Dedupe por (régua, agregado, chave). Enviado ao canal ≠ entregue.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `rule` | text |
| `step_key` | text |
| `aggregate_type` | text |
| `aggregate_id` | uuid |
| `customer_id` | uuid ? |
| `campaign_id` | uuid ? |
| `due_at` | timestamp with time zone |
| `status` | text |
| `skip_reason` | text ? |
| `template_code` | text |
| `params` | jsonb |
| `body` | text |
| `channel_message_id` | uuid ? |
| `source_event_id` | uuid ? |
| `resolved_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, rule, aggregate_id, step_key)
- **Referências:** (tenant_id, campaign_id) → `lifecycle_campaigns`; (tenant_id, customer_id) → `customers`; (tenant_id, channel_message_id) → `channel_messages`; (template_code) → `channel_templates`; (tenant_id) → `tenants`
- **Leitura:** `lifecycle_steps_select_owner` (authenticated)
- **Só acrescenta:** não

### `material_consumptions`

Uso de materiais num atendimento concluído. Um ativo por atendimento; estorno devolve ao estoque.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `booking_id` | uuid |
| `status` | text |
| `cost_cents` | bigint |
| `source` | text |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, booking_id) → `bookings`; (tenant_id) → `tenants`
- **Leitura:** `material_consumptions_select_owner` (authenticated)
- **Só acrescenta:** não

### `material_items`

Produto ou consumível. Saldo e valor só mudam com um movimento do razão.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `name` | text |
| `kind` | text |
| `unit` | text |
| `active` | boolean |
| `on_hand` | numeric(14,3) |
| `stock_value_cents` | bigint |
| `min_qty` | numeric(14,3) ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `material_items_select_owner` (authenticated)
- **Só acrescenta:** não

### `material_movements`

Razão de estoque, append-only. Estorno é linha nova (reversal_of único).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `item_id` | uuid |
| `kind` | text |
| `quantity` | numeric(14,3) |
| `value_cents` | bigint |
| `purchase_id` | uuid ? |
| `consumption_id` | uuid ? |
| `reversal_of` | uuid ? |
| `note` | text ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, consumption_id) → `material_consumptions`; (tenant_id, item_id) → `material_items`; (tenant_id, purchase_id) → `material_purchases`; (reversal_of) → `material_movements`; (tenant_id, reversal_of) → `material_movements`; (tenant_id) → `tenants`
- **Leitura:** `material_movements_select_owner` (authenticated)
- **Só acrescenta:** sim

### `material_purchases`

Compra de materiais. As linhas são movimentos do razão; a despesa (P07) é opcional.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `supplier` | text ? |
| `purchased_at` | timestamp with time zone |
| `total_cents` | bigint |
| `expense_id` | uuid ? |
| `status` | text |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, expense_id) → `expense_entries`; (tenant_id) → `tenants`
- **Leitura:** `material_purchases_select_owner` (authenticated)
- **Só acrescenta:** não

### `material_service_usage`

Ficha de uso: quanto de cada item um atendimento do serviço consome.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `service_id` | uuid |
| `item_id` | uuid |
| `quantity` | numeric(14,3) |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (service_id, item_id); única (tenant_id, id)
- **Referências:** (tenant_id, item_id) → `material_items`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `material_service_usage_select_owner` (authenticated)
- **Só acrescenta:** não

### `offering_versions`

Versão publicada de plano/serviço: preço, escopo e franquia. Imutável.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `offering_id` | uuid |
| `version_no` | integer |
| `name` | text |
| `description` | text |
| `price_cents` | bigint |
| `billing` | text |
| `included` | jsonb |
| `excluded` | jsonb |
| `agent_questions_month` | integer ? |
| `assisted_minutes` | integer ? |
| `sla_days` | integer ? |
| `scope_hash` | text |
| `published_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (offering_id, version_no)
- **Referências:** (offering_id) → `platform_offerings`
- **Leitura:** `offering_versions_select` (authenticated)
- **Só acrescenta:** sim

### `ops_alert_settings`

P58: limites do "precisa de atenção". Uma linha; mudar = migration nova.

| Coluna | Tipo |
|---|---|
| `id` | boolean |
| `queue_late_minutes` | integer |
| `tick_failures` | integer |
| `function_errors_per_hour` | integer |

- **Chaves e unicidade:** PK (id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `ops_alert_state`

P58: último estado calculado pela rotina ops_watch (job_ticks).

| Coluna | Tipo |
|---|---|
| `id` | boolean |
| `state` | text |
| `reasons` | jsonb |
| `since` | timestamp with time zone ? |
| `checked_at` | timestamp with time zone ? |
| `notified_at` | timestamp with time zone ? |

- **Chaves e unicidade:** PK (id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `ops_errors`

P58: erros de tela, de chamada e 5xx das funções. Só rota sem id, código, SHA e request_id; sem dado pessoal. Retenção: ops_errors em retention_policies.

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `occurred_at` | timestamp with time zone |
| `source` | text |
| `kind` | text |
| `fn` | text ? |
| `route` | text ? |
| `status` | integer ? |
| `code` | text ? |
| `build_sha` | text ? |
| `request_id` | uuid ? |

- **Chaves e unicidade:** PK (id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `ops_releases`

P58: cada publicação e reversão (release/publicar.sh, release/reverter.sh). Só service_role grava.

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `published_at` | timestamp with time zone |
| `environment` | text |
| `kind` | text |
| `sha` | text |
| `migrations_until` | text ? |
| `functions` | integer ? |

- **Chaves e unicidade:** PK (id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `outbox_events`

Backend-only. Entrega ao menos uma vez; consumidor deduplica event_id.

| Coluna | Tipo |
|---|---|
| `event_id` | uuid |
| `tenant_id` | uuid |
| `event_type` | text |
| `aggregate_id` | uuid |
| `aggregate_version` | integer |
| `schema_version` | integer |
| `correlation_id` | uuid |
| `payload` | jsonb |
| `occurred_at` | timestamp with time zone |
| `status` | text |
| `attempts` | integer |
| `max_attempts` | integer |
| `next_run_at` | timestamp with time zone |
| `leased_until` | timestamp with time zone ? |
| `last_error` | text ? |

- **Chaves e unicidade:** PK (event_id)
- **Referências:** (tenant_id) → `tenants` (cascade)
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `payment_charges`

Cobrança no PSP por recebível. Paga só com evidência do provedor; unknown exige consulta.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `receivable_id` | uuid |
| `customer_id` | uuid ? |
| `provider` | text |
| `external_id` | text ? |
| `amount_cents` | bigint |
| `description` | text |
| `status` | text |
| `pix_code` | text ? |
| `checkout_url` | text ? |
| `link_token_hash` | text |
| `expires_at` | timestamp with time zone ? |
| `paid_at` | timestamp with time zone ? |
| `paid_cents` | bigint ? |
| `payment_entry_id` | uuid ? |
| `settlement` | text ? |
| `failure_reason` | text ? |
| `unknown_since` | timestamp with time zone ? |
| `refund_status` | text ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id, payment_entry_id) → `payment_entries`; (tenant_id, receivable_id) → `receivables`; (tenant_id) → `tenants`
- **Leitura:** `payment_charges_select_owner` (authenticated)
- **Só acrescenta:** não

### `payment_entries`

Recebimentos manuais, append-only. Estorno é linha nova com reversal_of.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `receivable_id` | uuid |
| `customer_id` | uuid ? |
| `amount_cents` | bigint |
| `method` | text |
| `source` | text |
| `received_at` | timestamp with time zone |
| `reversal_of` | uuid ? |
| `note` | text ? |
| `recorded_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `charge_id` | uuid ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, charge_id) → `payment_charges`; (tenant_id, customer_id) → `customers`; (tenant_id, receivable_id) → `receivables`; (reversal_of) → `payment_entries`; (tenant_id, reversal_of) → `payment_entries`; (tenant_id) → `tenants`
- **Leitura:** `payment_entries_select_owner` (authenticated)
- **Só acrescenta:** sim

### `payment_reconciliations`

Conciliação do dia: relatório do PSP × recebimentos do banco. Append-only; a última vale.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `provider` | text |
| `day` | date |
| `report_count` | integer |
| `report_paid_cents` | bigint |
| `ledger_paid_cents` | bigint |
| `differences` | jsonb |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `payment_reconciliations_select_owner` (authenticated)
- **Só acrescenta:** sim

### `payment_refunds`

Estorno total pedido pelo dono; concluído só com confirmação do PSP (vira linha de reversão no P07).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `charge_id` | uuid |
| `amount_cents` | bigint |
| `reason` | text |
| `status` | text |
| `external_id` | text ? |
| `reversal_entry_id` | uuid ? |
| `failure_reason` | text ? |
| `unknown_since` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, charge_id) → `payment_charges`; (tenant_id, reversal_entry_id) → `payment_entries`; (tenant_id) → `tenants`
- **Leitura:** `payment_refunds_select_owner` (authenticated)
- **Só acrescenta:** não

### `payment_sim_ledger`

Livro do PSP simulado (backend). Evidência fictícia, rotulada na tela.

| Coluna | Tipo |
|---|---|
| `external_id` | text |
| `tenant_id` | uuid |
| `amount_cents` | bigint |
| `status` | text |
| `expires_at` | timestamp with time zone ? |
| `paid_at` | timestamp with time zone ? |
| `refunded_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (external_id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `payment_webhook_events`

Dedupe de notificações do PSP: (provider, external_event_id) só entra uma vez.

| Coluna | Tipo |
|---|---|
| `provider` | text |
| `external_event_id` | text |
| `kind` | text |
| `outcome` | text |
| `received_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (provider, external_event_id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `platform_offerings`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `code` | text |
| `kind` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (code)
- **Referências:** —
- **Leitura:** `platform_offerings_select` (authenticated)
- **Só acrescenta:** não

### `platform_operators`

Equipe Tinindo. Inserção só por service_role (decisão humana fora do app).

| Coluna | Tipo |
|---|---|
| `user_id` | uuid |
| `display_name` | text |
| `active` | boolean |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (user_id)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `policy_acceptances`

Versões de termos/privacidade aceitas por quem criou o negócio.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `user_id` | uuid |
| `policy_version` | text |
| `accepted_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, user_id, policy_version)
- **Referências:** (tenant_id) → `tenants`; (user_id) → `auth.users` (cascade)
- **Leitura:** `policy_acceptances_select` (authenticated)
- **Só acrescenta:** sim

### `presence_deliveries`

Registro das entregas de presença digital com evidência. Append-only. Sem garantia de posição.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `kind` | text |
| `summary` | text |
| `evidence` | jsonb |
| `service_order_id` | uuid ? |
| `actor` | text |
| `actor_user_id` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, service_order_id) → `service_orders`; (tenant_id) → `tenants`
- **Leitura:** `presence_deliveries_owner` (authenticated)
- **Só acrescenta:** sim

### `presence_domain_checks`

Cada consulta DNS feita pelo backend e o que foi observado. Append-only.

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `tenant_id` | uuid |
| `domain_id` | uuid |
| `result` | text |
| `observed` | text[] |
| `checked_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id)
- **Referências:** (tenant_id, domain_id) → `presence_domains`; (tenant_id) → `tenants`
- **Leitura:** `presence_domain_checks_owner` (authenticated)
- **Só acrescenta:** sim

### `presence_domains`

Domínio do cliente ligado ao site. Só vale verificado por DNS. A Tinindo não compra nem registra domínios.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `hostname` | text |
| `verify_token` | text |
| `status` | text |
| `last_check_at` | timestamp with time zone ? |
| `last_check_result` | text ? |
| `verified_at` | timestamp with time zone ? |
| `removed_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `presence_google_access`

Acesso de gerente ao Perfil da Empresa no Google concedido pelo dono. Revogável. A Tinindo nunca é proprietária.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `status` | text |
| `profile_name` | text ? |
| `profile_url` | text ? |
| `access_level` | text |
| `granted_by` | uuid ? |
| `granted_at` | timestamp with time zone ? |
| `revoked_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `presence_site_services`

Serviços que o dono escolheu mostrar no site (nome e duração; preço só se a seção "prices" estiver ligada).

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `service_id` | uuid |
| `position` | smallint |

- **Chaves e unicidade:** PK (tenant_id, service_id)
- **Referências:** (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `presence_site_versions`

Conteúdo aprovado pelo dono, congelado com hash. Append-only.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `version_no` | integer |
| `snapshot` | jsonb |
| `snapshot_hash` | text |
| `approved_by` | uuid |
| `approved_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, version_no)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `presence_site_versions_owner` (authenticated)
- **Só acrescenta:** sim

### `presence_sites`

Rascunho e estado do site do negócio. O conteúdo publicado é a versão apontada (presence_site_versions).

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `headline` | text ? |
| `sections` | text[] |
| `theme` | text |
| `status` | text |
| `published_version_no` | integer ? |
| `published_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `price_quotes`

Cotação versionada com prazo. Não reserva horário. Usada no máximo uma vez.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `service_id` | uuid |
| `resource_id` | uuid |
| `slot` | tstzrange |
| `currency` | character(3) |
| `base_price_cents` | bigint |
| `floor_cents` | bigint |
| `final_price_cents` | bigint |
| `rule_id` | uuid ? |
| `rule_version` | integer ? |
| `reason_code` | text |
| `expires_at` | timestamp with time zone |
| `used_by_booking` | uuid ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, resource_id) → `resources`; (tenant_id, rule_id) → `pricing_rules`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `price_quotes_select_owner` (authenticated)
- **Só acrescenta:** não

### `pricing_rule_approvals`

Aprovação vinculada a hash + versão + validade. Uso único. Aprovar ≠ publicar.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `proposal_id` | uuid |
| `proposal_version` | integer |
| `payload_hash` | text |
| `approved_by` | uuid |
| `approved_at` | timestamp with time zone |
| `expires_at` | timestamp with time zone |
| `used_at` | timestamp with time zone ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, proposal_id) → `pricing_rule_proposals`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `pricing_rule_proposals`

Proposta de regra (inativa) com prévia de impacto. Publicar exige aprovação.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `service_id` | uuid |
| `windows` | jsonb |
| `discount_bps` | integer |
| `max_discount_bps` | integer |
| `target_margin_bps` | integer |
| `valid` | tstzrange |
| `preview` | jsonb |
| `payload_hash` | text |
| `status` | text |
| `expires_at` | timestamp with time zone |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `pricing_rule_proposals_select_owner` (authenticated)
- **Só acrescenta:** não

### `pricing_rules`

Regra publicada. Piloto: uma regra ativa por serviço (sem empilhar descontos).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `service_id` | uuid |
| `rule_version` | integer |
| `windows` | jsonb |
| `discount_bps` | integer |
| `max_discount_bps` | integer |
| `target_margin_bps` | integer |
| `valid` | tstzrange |
| `active` | boolean |
| `proposal_id` | uuid |
| `approval_id` | uuid |
| `published_by` | uuid ? |
| `published_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, service_id, rule_version)
- **Referências:** (tenant_id, approval_id) → `pricing_rule_approvals`; (tenant_id, proposal_id) → `pricing_rule_proposals`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `pricing_rules_select_owner` (authenticated)
- **Só acrescenta:** não

### `privacy_erasures`

Backend-only. Pedidos de eliminação (D26): negócio com carência de 7 dias, cliente final na hora. Trilha sem conteúdo.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `scope` | text |
| `customer_id` | uuid ? |
| `status` | text |
| `requested_by` | uuid |
| `requested_at` | timestamp with time zone |
| `execute_after` | timestamp with time zone |
| `cancelled_at` | timestamp with time zone ? |
| `cancelled_by` | uuid ? |
| `done_at` | timestamp with time zone ? |
| `summary` | jsonb ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `privacy_exports`

Backend-only. Pedidos de exportação (D26): quem pediu, estado e caminho do arquivo. Sem o conteúdo.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `scope` | text |
| `customer_id` | uuid ? |
| `status` | text |
| `requested_by` | uuid |
| `storage_path` | text |
| `bytes` | bigint ? |
| `created_at` | timestamp with time zone |
| `ready_at` | timestamp with time zone ? |
| `expires_at` | timestamp with time zone ? |

- **Chaves e unicidade:** PK (id); única (storage_path); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `profile_contents`

Conteúdo aprovado publicado como `bio` do perfil público (P09). Só aparece se o dono escolheu `bio` nos campos públicos.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `template_code` | text |
| `body` | text |
| `published_by` | uuid ? |
| `published_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (template_code) → `content_templates`; (tenant_id) → `tenants`
- **Leitura:** `profile_contents_owner_select` (authenticated)
- **Só acrescenta:** não

### `provider_services`

Catálogo do prestador: duração, buffers, preço base, piso e custos. Versionado.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `name` | text |
| `name_key` | text ? |
| `duration_min` | integer |
| `buffer_before_min` | integer |
| `buffer_after_min` | integer |
| `base_price_cents` | bigint |
| `min_price_cents` | bigint |
| `estimated_cost_cents` | bigint ? |
| `fee_bps` | integer ? |
| `active` | boolean |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `provider_services_select_member` (authenticated)
- **Só acrescenta:** não

### `public_booking_requests`

Backend-only. Pedido do link público: contato informado e código. Sem acesso pela Data API.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `booking_id` | uuid |
| `connection_id` | uuid |
| `contact_name` | text |
| `contact_phone_e164` | text |
| `code` | text ? |
| `code_hash` | text ? |
| `attempts` | integer |
| `status` | text |
| `expires_at` | timestamp with time zone |
| `dispatch_status` | text |
| `idem_key` | text |
| `request_hash` | text |
| `confirmed_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `replaced_request_id` | uuid ? |
| `neighborhood` | text ? |
| `resends` | integer |
| `queued_at` | timestamp with time zone |
| `booking_token` | text ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, idem_key)
- **Referências:** (tenant_id, booking_id) → `bookings`; (tenant_id, connection_id) → `channel_connections`; (replaced_request_id) → `public_booking_requests`; (tenant_id, replaced_request_id) → `public_booking_requests`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `public_origin_hits`

Backend-only. Tentativas de reserva por origem (hash), apagadas em 1 dia.

| Coluna | Tipo |
|---|---|
| `origin_hash` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** —
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `public_profiles`

Projeção pública opt-in do negócio. Nunca copia dados do CRM. Leitura pública só por network_public_profile.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `slug` | text |
| `category` | text |
| `area` | text |
| `public_fields` | text[] |
| `published_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |
| `photo_path` | text ? |
| `photo_alt` | text ? |
| `show_photo` | boolean |
| `show_whatsapp` | boolean |
| `show_prices` | boolean |
| `address` | text ? |
| `home_service` | boolean |
| `opening_hours` | text ? |
| `cancellation_policy` | text ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `public_profiles_select_owner` (authenticated)
- **Só acrescenta:** não

### `receivables`

Valor devido. Não implica recebido. Status derivado de paid_cents.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid ? |
| `booking_id` | uuid ? |
| `package_id` | uuid ? |
| `description` | text |
| `amount_cents` | bigint |
| `paid_cents` | bigint |
| `due_at` | timestamp with time zone ? |
| `status` | text |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, booking_id) → `bookings`; (tenant_id, customer_id) → `customers`; (tenant_id, package_id) → `session_packages`; (tenant_id) → `tenants`
- **Leitura:** `receivables_select_owner` (authenticated)
- **Só acrescenta:** não

### `recurrence_cycles`

Um ciclo = um pacote de sessões (P07) + um recebível pelo preço aceito. Append-only.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `subscription_id` | uuid |
| `cycle_no` | integer |
| `starts_at` | timestamp with time zone |
| `ends_at` | timestamp with time zone |
| `package_id` | uuid |
| `receivable_id` | uuid |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (subscription_id, cycle_no); única (tenant_id, id)
- **Referências:** (tenant_id, package_id) → `session_packages`; (tenant_id, receivable_id) → `receivables`; (tenant_id, subscription_id) → `recurrence_subscriptions`; (tenant_id) → `tenants`
- **Leitura:** `recurrence_cycles_select_owner` (authenticated)
- **Só acrescenta:** sim

### `recurrence_plans`

Plano oferecido pelo profissional. Mudar o plano não muda assinaturas em curso (termos congelados).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `service_id` | uuid |
| `name` | text |
| `sessions_per_cycle` | integer |
| `cycle_days` | integer |
| `price_cents` | bigint |
| `active` | boolean |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `recurrence_plans_select_owner` (authenticated)
- **Só acrescenta:** não

### `recurrence_subscriptions`

Assinatura de um plano por uma cliente. Termos aceitos congelados; renovação pelo worker.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `plan_id` | uuid |
| `customer_id` | uuid |
| `status` | text |
| `terms` | jsonb |
| `terms_hash` | text |
| `accepted_at` | timestamp with time zone |
| `accepted_source` | text |
| `started_at` | timestamp with time zone |
| `next_renewal_at` | timestamp with time zone ? |
| `cancel_at_period_end` | boolean |
| `cancelled_at` | timestamp with time zone ? |
| `cancel_reason` | text ? |
| `cycles_count` | integer |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id, plan_id) → `recurrence_plans`; (tenant_id) → `tenants`
- **Leitura:** `recurrence_subscriptions_select_owner` (authenticated)
- **Só acrescenta:** não

### `referral_activations`

Adesão elegível de um convite de colega: medida pelo backend, nunca declarada. Um benefício por negócio indicado.

| Coluna | Tipo |
|---|---|
| `referral_id` | uuid |
| `inviter_tenant_id` | uuid |
| `invitee_tenant_id` | uuid |
| `status` | text |
| `block_reason` | text ? |
| `checks` | jsonb |
| `claimed_at` | timestamp with time zone |
| `eligible_at` | timestamp with time zone ? |
| `rewarded_at` | timestamp with time zone ? |
| `reward_id` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (referral_id)
- **Referências:** (invitee_tenant_id) → `tenants`; (inviter_tenant_id) → `tenants`; (referral_id) → `referrals`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `referral_rewards`

Benefício concedido: crédito de franquia do assistente no mês. Append-only. Não é avaliação.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `referral_id` | uuid |
| `kind` | text |
| `amount` | integer |
| `period_start` | date |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (referral_id); única (tenant_id, id)
- **Referências:** (referral_id) → `referrals`; (tenant_id) → `tenants`
- **Leitura:** `referral_rewards_select_owner` (authenticated)
- **Só acrescenta:** sim

### `referrals`

Indicação de cliente (pending, privada) e convite de colega (atribuição). Não é avaliação. Token só em hash.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `kind` | text |
| `inviter_user_id` | uuid |
| `inviter_tenant_id` | uuid ? |
| `invitee_name` | text |
| `invitee_category` | text ? |
| `origin` | text |
| `token_hash` | text |
| `status` | text |
| `expires_at` | timestamp with time zone |
| `claimed_by_user_id` | uuid ? |
| `claimed_tenant_id` | uuid ? |
| `claimed_at` | timestamp with time zone ? |
| `idem_key` | text |
| `request_hash` | text |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (inviter_user_id, idem_key); única (token_hash)
- **Referências:** (claimed_by_user_id) → `auth.users` (set null); (claimed_tenant_id) → `tenants` (set null); (inviter_tenant_id) → `tenants`; (inviter_user_id) → `auth.users` (cascade)
- **Leitura:** `referrals_select_inviter` (authenticated)
- **Só acrescenta:** não

### `resources`

Profissional/recurso que ocupa capacidade. Piloto: um ativo por negócio.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `name` | text |
| `active` | boolean |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `resources_select_member` (authenticated)
- **Só acrescenta:** não

### `retention_policies`

Prazos de retenção (D25, sujeitos ao advogado). Mudar prazo = migration nova. Lida por app.retention_tick.

| Coluna | Tipo |
|---|---|
| `category` | text |
| `days` | integer |
| `starts_at` | text |
| `decision` | text |
| `note` | text |

- **Chaves e unicidade:** PK (category)
- **Referências:** —
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `retention_runs`

Relatório da retenção: categoria, quando e quantas linhas. Sem conteúdo, sem negócio, sem titular.

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `ran_at` | timestamp with time zone |
| `category` | text |
| `affected` | integer |

- **Chaves e unicidade:** PK (id)
- **Referências:** (category) → `retention_policies`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `review_reports`

Denúncias de avaliação. Só a moderação (backend) decide; denunciar não esconde nada.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `review_id` | uuid |
| `reporter_user_id` | uuid |
| `reason` | text |
| `note` | text ? |
| `status` | text |
| `resolved_at` | timestamp with time zone ? |
| `resolution_note` | text ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id)
- **Referências:** (tenant_id, review_id) → `reviews`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `reviews`

Experiência de cliente com atendimento concluído e vínculo verificado. Não é comprável nem editável pelo profissional.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `booking_id` | uuid |
| `author_user_id` | uuid ? |
| `rating` | smallint |
| `body` | text ? |
| `service_name` | text |
| `service_month` | date |
| `status` | text |
| `hidden_reason` | text ? |
| `reply_body` | text ? |
| `reply_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |
| `author_link_id` | uuid ? |

- **Chaves e unicidade:** PK (id); única (booking_id); única (tenant_id, id)
- **Referências:** (tenant_id, author_link_id) → `booking_links`; (author_user_id) → `auth.users` (cascade); (tenant_id, booking_id) → `bookings`; (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** não

### `sales_quote_decisions`

Aceite/recusa do cliente, vinculado a versão + hash. Append-only.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `quote_id` | uuid |
| `version_no` | integer |
| `snapshot_hash` | text |
| `decision` | text |
| `channel` | text |
| `booking_id` | uuid ? |
| `decided_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (quote_id); única (tenant_id, id)
- **Referências:** (tenant_id, booking_id) → `bookings`; (tenant_id, quote_id) → `sales_quotes`; (tenant_id) → `tenants`; (quote_id, version_no) → `sales_quote_versions`
- **Leitura:** `sales_quote_decisions_select_owner` (authenticated)
- **Só acrescenta:** sim

### `sales_quote_versions`

Snapshot imutável de cada versão do orçamento. Mudança = versão nova.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `quote_id` | uuid |
| `version_no` | integer |
| `title` | text |
| `items` | jsonb |
| `total_cents` | bigint |
| `valid_until` | timestamp with time zone |
| `slot_service_id` | uuid ? |
| `slot_resource_id` | uuid ? |
| `slot_starts_at` | timestamp with time zone ? |
| `slot_ends_at` | timestamp with time zone ? |
| `notes` | text ? |
| `snapshot_hash` | text |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (quote_id, version_no); única (tenant_id, id)
- **Referências:** (tenant_id, quote_id) → `sales_quotes`; (tenant_id, slot_resource_id) → `resources`; (tenant_id, slot_service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `sales_quote_versions_select_owner` (authenticated)
- **Só acrescenta:** sim

### `sales_quotes`

Orçamento (cabeça). O conteúdo está em sales_quote_versions; aceito não implica pago.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid |
| `status` | text |
| `current_version` | integer |
| `token_hash` | text ? |
| `sent_at` | timestamp with time zone ? |
| `decided_at` | timestamp with time zone ? |
| `decided_version` | integer ? |
| `booking_id` | uuid ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (token_hash)
- **Referências:** (tenant_id, booking_id) → `bookings`; (tenant_id, customer_id) → `customers`; (tenant_id) → `tenants`
- **Leitura:** `sales_quotes_select_owner` (authenticated)
- **Só acrescenta:** não

### `service_order_events`

| Coluna | Tipo |
|---|---|
| `id` | bigint |
| `tenant_id` | uuid |
| `order_id` | uuid |
| `from_status` | text ? |
| `to_status` | text |
| `actor_user_id` | uuid ? |
| `note` | text ? |
| `occurred_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id)
- **Referências:** (tenant_id, order_id) → `service_orders`
- **Leitura:** `service_order_events_select_owner` (authenticated)
- **Só acrescenta:** sim

### `service_orders`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `offering_version_id` | uuid |
| `scope_hash` | text |
| `price_cents` | bigint |
| `minutes_quota` | integer |
| `status` | text |
| `assignee_user_id` | uuid ? |
| `due_at` | timestamp with time zone ? |
| `notes` | text ? |
| `blocked_reason` | text ? |
| `requested_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (assignee_user_id) → `platform_operators`; (offering_version_id) → `offering_versions`; (tenant_id) → `tenants`
- **Leitura:** `service_orders_select_owner` (authenticated)
- **Só acrescenta:** não

### `session_entries`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `package_id` | uuid |
| `booking_id` | uuid ? |
| `delta` | integer |
| `reason` | text |
| `source_event_id` | uuid ? |
| `reversal_of` | uuid ? |
| `note` | text ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, booking_id) → `bookings`; (tenant_id, package_id) → `session_packages`; (reversal_of) → `session_entries`; (tenant_id, reversal_of) → `session_entries`; (tenant_id) → `tenants`
- **Leitura:** `session_entries_select_owner` (authenticated)
- **Só acrescenta:** sim

### `session_packages`

Pacote pré-pago. Saldo = purchased_credits + soma de session_entries.delta.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid |
| `service_id` | uuid |
| `purchased_credits` | integer |
| `total_price_cents` | bigint |
| `expires_at` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `session_packages_select_owner` (authenticated)
- **Só acrescenta:** não

### `setup_dismissals`

Passos opcionais dispensados pelo dono. Passo obrigatório nunca entra aqui.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `step` | text |
| `dismissed_by` | uuid ? |
| `dismissed_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (tenant_id, step)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `setup_dismissals_select_member` (authenticated)
- **Só acrescenta:** não

### `setup_service_templates`

Modelos de serviço por profissão, aprovados por migration. Sugestão marcável; nada é criado sem confirmação do dono.

| Coluna | Tipo |
|---|---|
| `code` | text |
| `profession` | text |
| `kind` | text |
| `name` | text |
| `duration_min` | integer |
| `buffer_before_min` | integer |
| `buffer_after_min` | integer |
| `price_from_cents` | bigint ? |
| `price_to_cents` | bigint ? |
| `ord` | integer |
| `approved_by` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (code)
- **Referências:** —
- **Leitura:** `setup_service_templates_read` (authenticated)
- **Só acrescenta:** sim

### `setup_step_completions`

Backend-only. Uma linha por (negócio, passo) quando o passo foi visto concluído; o evento sai junto, uma vez.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `step` | text |
| `completed_at` | timestamp with time zone |
| `detected_at` | timestamp with time zone |
| `seconds_since_signup` | bigint |

- **Chaves e unicidade:** PK (tenant_id, step)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** nenhuma política (só as RPCs leem)
- **Só acrescenta:** sim

### `subscriptions`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `offering_version_id` | uuid |
| `price_cents` | bigint |
| `scope_hash` | text |
| `status` | text |
| `billing_source` | text |
| `started_at` | timestamp with time zone |
| `ended_at` | timestamp with time zone ? |
| `created_by` | uuid ? |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (offering_version_id) → `offering_versions`; (tenant_id) → `tenants`
- **Leitura:** `subscriptions_select_owner` (authenticated)
- **Só acrescenta:** não

### `team_allocations`

Uso de um recurso por uma reserva/turma. team_allocations_no_overlap é a autoridade final.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `resource_id` | uuid |
| `booking_id` | uuid ? |
| `class_id` | uuid ? |
| `occupied_range` | tstzrange |
| `active` | boolean |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (booking_id, resource_id); única (class_id, resource_id); única (tenant_id, id)
- **Referências:** (tenant_id, booking_id) → `team_bookings`; (tenant_id, class_id) → `team_classes`; (tenant_id, resource_id) → `team_resources`; (tenant_id) → `tenants`
- **Leitura:** `team_allocations_select_owner` (authenticated)
- **Só acrescenta:** não

### `team_bookings`

Reserva composta da equipe (profissional + recursos). As alocações estão em team_allocations.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `service_id` | uuid |
| `customer_id` | uuid ? |
| `professional_id` | uuid |
| `starts_at` | timestamp with time zone |
| `ends_at` | timestamp with time zone |
| `occupied_range` | tstzrange |
| `status` | text |
| `agreed_price_cents` | bigint |
| `commission_bps` | integer |
| `receivable_id` | uuid ? |
| `status_reason` | text ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, customer_id) → `customers`; (tenant_id, professional_id) → `team_resources`; (tenant_id, receivable_id) → `receivables`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `team_bookings_select_owner` (authenticated)
- **Só acrescenta:** não

### `team_class_seats`

Vaga de uma cliente numa turma. Lotação conferida sob lock da turma.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `class_id` | uuid |
| `customer_id` | uuid |
| `status` | text |
| `receivable_id` | uuid ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, class_id) → `team_classes`; (tenant_id, customer_id) → `customers`; (tenant_id, receivable_id) → `receivables`; (tenant_id) → `tenants`
- **Leitura:** `team_class_seats_select_owner` (authenticated)
- **Só acrescenta:** não

### `team_classes`

Turma: um horário com profissional (+ sala) e vagas. Vagas em team_class_seats.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `service_id` | uuid |
| `professional_id` | uuid |
| `room_id` | uuid ? |
| `title` | text |
| `starts_at` | timestamp with time zone |
| `ends_at` | timestamp with time zone |
| `occupied_range` | tstzrange |
| `capacity` | integer |
| `seat_price_cents` | bigint |
| `commission_bps` | integer |
| `status` | text |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, professional_id) → `team_resources`; (tenant_id, room_id) → `team_resources`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `team_classes_select_owner` (authenticated)
- **Só acrescenta:** não

### `team_commission_entries`

Comissões lançadas (append-only). Uma por conclusão; estorno é linha nova, uma vez.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `professional_id` | uuid |
| `booking_id` | uuid ? |
| `class_id` | uuid ? |
| `kind` | text |
| `base_cents` | bigint |
| `bps` | integer |
| `amount_cents` | bigint |
| `reversal_of` | uuid ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, booking_id) → `team_bookings`; (tenant_id, class_id) → `team_classes`; (tenant_id, professional_id) → `team_resources`; (reversal_of) → `team_commission_entries`; (tenant_id, reversal_of) → `team_commission_entries`; (tenant_id) → `tenants`
- **Leitura:** `team_commission_entries_select_owner` (authenticated)
- **Só acrescenta:** sim

### `team_commission_rules`

Comissão do profissional para um serviço (sobrepõe a padrão). Vale para reservas novas.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `professional_id` | uuid |
| `service_id` | uuid |
| `bps` | integer |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (professional_id, service_id); única (tenant_id, id)
- **Referências:** (tenant_id, professional_id) → `team_resources`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `team_commission_rules_select_owner` (authenticated)
- **Só acrescenta:** não

### `team_resources`

Profissionais, salas, cadeiras e equipamentos da equipe. Escrita só por RPC.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `kind` | text |
| `name` | text |
| `active` | boolean |
| `commission_bps` | integer ? |
| `agenda_resource_id` | uuid ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, agenda_resource_id) → `resources`; (tenant_id) → `tenants`
- **Leitura:** `team_resources_select_owner` (authenticated)
- **Só acrescenta:** não

### `tenant_memberships`

Papel de um login dentro de um negócio. Papel decidido no servidor.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `user_id` | uuid |
| `role` | text |
| `active` | boolean |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (tenant_id, user_id)
- **Referências:** (tenant_id) → `tenants`; (user_id) → `auth.users` (cascade)
- **Leitura:** `tenant_memberships_select` (authenticated)
- **Só acrescenta:** não

### `tenant_modules`

Chave de módulo por negócio (P51). Sem linha = desligado. Escrita só por RPC; módulo guardado só pelo backend.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `module` | text |
| `enabled` | boolean |
| `updated_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id, module)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `tenant_modules_select_member` (authenticated)
- **Só acrescenta:** não

### `tenant_onboarding`

Diagnóstico operacional mínimo (objetivo, política de cancelamento). Privado do negócio.

| Coluna | Tipo |
|---|---|
| `tenant_id` | uuid |
| `goal` | text ? |
| `cancellation_notice_hours` | integer ? |
| `late_cancellation_fee_bps` | integer ? |
| `completed_at` | timestamp with time zone ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (tenant_id)
- **Referências:** (tenant_id) → `tenants`
- **Leitura:** `tenant_onboarding_select_member` (authenticated)
- **Só acrescenta:** não

### `tenants`

Negócio assinante. Moeda BRL e timezone IANA no piloto.

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `name` | text |
| `profession` | text |
| `timezone` | text |
| `currency` | character(3) |
| `status` | text |
| `settings_version` | integer |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id)
- **Referências:** —
- **Leitura:** `tenants_select_member` (authenticated)
- **Só acrescenta:** não

### `waitlist_candidates`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `entry_id` | uuid |
| `slot` | tstzrange |
| `source_event_id` | uuid ? |
| `status` | text |
| `created_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, entry_id, slot); única (tenant_id, id)
- **Referências:** (tenant_id, entry_id) → `waitlist_entries`; (tenant_id) → `tenants`
- **Leitura:** `waitlist_candidates_select_owner` (authenticated)
- **Só acrescenta:** não

### `waitlist_entries`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `customer_id` | uuid |
| `service_id` | uuid |
| `acceptable_windows` | jsonb |
| `consent_id` | uuid |
| `status` | text |
| `joined_at` | timestamp with time zone |
| `valid_until` | timestamp with time zone |
| `created_by` | uuid ? |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (tenant_id, consent_id) → `contact_consents`; (tenant_id, customer_id) → `customers`; (tenant_id, service_id) → `provider_services`; (tenant_id) → `tenants`
- **Leitura:** `waitlist_entries_select_owner` (authenticated)
- **Só acrescenta:** não

### `waitlist_offers`

Oferta de vaga a uma pessoa: hold exclusivo + cotação + token (só o hash no banco).

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `entry_id` | uuid |
| `candidate_id` | uuid ? |
| `booking_hold_id` | uuid |
| `quote_id` | uuid |
| `status` | text |
| `token_hash` | text |
| `expires_at` | timestamp with time zone |
| `delivery_channel` | text |
| `delivery_state` | text |
| `decided_at` | timestamp with time zone ? |
| `created_by` | uuid ? |
| `created_at` | timestamp with time zone |
| `updated_at` | timestamp with time zone |
| `version` | integer |

- **Chaves e unicidade:** PK (id); única (tenant_id, id); única (token_hash)
- **Referências:** (tenant_id, candidate_id) → `waitlist_candidates`; (tenant_id, entry_id) → `waitlist_entries`; (tenant_id, booking_hold_id) → `bookings`; (tenant_id, quote_id) → `price_quotes`; (tenant_id) → `tenants`
- **Leitura:** `waitlist_offers_select_owner` (authenticated)
- **Só acrescenta:** não

### `work_logs`

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `tenant_id` | uuid |
| `order_id` | uuid |
| `operator_user_id` | uuid |
| `minutes` | integer |
| `kind` | text |
| `reprocess` | boolean |
| `note` | text ? |
| `logged_at` | timestamp with time zone |

- **Chaves e unicidade:** PK (id); única (tenant_id, id)
- **Referências:** (operator_user_id) → `platform_operators`; (tenant_id, order_id) → `service_orders`
- **Leitura:** `work_logs_select_owner` (authenticated)
- **Só acrescenta:** sim

