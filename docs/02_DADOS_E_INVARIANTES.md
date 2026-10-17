# 02 · Modelo de dados e invariantes

## Identidade: o erro que não podemos cometer

Uma pessoa pode ser profissional em um negócio e cliente em vários. `auth.users` é a identidade global de login. `tenant` é o negócio assinante. `tenant_memberships` dá papel dentro do negócio. `customers` é o cadastro privado do negócio e pode existir sem login. `customer_links` vincula uma identidade autenticada àquele cadastro após comprovação de contato.

Nunca permitir que “mesmo telefone” una automaticamente prontuários, pagamentos ou histórico de clientes entre negócios. Telefone não é chave de autorização; números mudam de dono. Cliente vê apenas suas reservas e seus dados explicitamente compartilhados. Perfil público é projeção separada, publicada por consentimento do profissional.

## Dicionário do piloto

Todos os registros de domínio têm UUID, `created_at` e, quando editáveis, `updated_at` e `version`. Tabelas privadas incluem `tenant_id NOT NULL`. Tabelas globais/públicas justificam exceção por ADR.

| Entidade | Campos centrais | Invariante |
|---|---|---|
| `tenants` | name, timezone, currency, status, settings_version | BRL e timezone IANA no piloto |
| `tenant_memberships` | tenant_id, user_id, role, active | UNIQUE tenant/user; role no servidor |
| `resources` | tenant_id, name, active | Um profissional/recurso por negócio no piloto |
| `customers` | tenant_id, name, normalized_phone, email, archived_at | Dedupe assistido só dentro do tenant |
| `customer_links` | tenant_id, customer_id, user_id, verified_at | Comprovação; FK composta válida |
| `services` | name, duration_min, buffer_before/after, base_price_cents, min_price_cents, cost_version | Duração positiva e preço não negativo |
| `availability_rules` | resource_id, weekday, local_start/end, effective_dates | Horário local + timezone, não offset fixo |
| `availability_exceptions` | resource_id, starts_at, ends_at, type | Bloqueios/férias excepcionais prevalecem |
| `bookings` | resource_id, customer_id, service_id, starts/ends, occupied_range, status, hold_expires_at, price_quote_id, version | Exclusão de sobreposição ativa |
| `price_rules` | service_id, weekday/time_window, discount_bps, floor, start/end, approved_by, version | Versão publicada imutável |
| `price_quotes` | service_id, slot, currency, base/final/cost_cents, rule_version, expires_at | Cotação versionada; não é reserva |
| `waitlist_entries` | customer_id, service_id, acceptable_windows, consent_id, status, joined_at | Elegibilidade explícita e prazo |
| `waitlist_offers` | entry_id, booking_hold_id, quote_id, expires_at, token_hash, status | Um aceite efetivo por offer |
| `session_packages` | customer_id, service_id, purchased_credits, total_price_cents, expires_at | Crédito não é receita repetida |
| `session_entries` | package_id, booking_id, delta, reason, reversal_of | Débito/estorno idempotente por evento |
| `receivables` | booking/package_id, due_at, amount_cents, status | Valor devido não implica recebido |
| `payment_entries` | customer_id, amount_cents, method, received_at, source, reversal_of | Append-only; estorno referenciado |
| `payment_allocations` | payment_id, receivable_id, amount_cents | Não exceder pagamento/saldo; transação |
| `expense_entries` | amount_cents, paid_at, category, reversal_of | Registro simples, sem DRE contábil |
| `consents` | subject_ref, purpose, channel, source, granted/revoked_at, policy_version | Marketing separado de transacional |
| `public_profiles` | tenant_id, slug, category, area, public_fields, published_at | Só whitelist de campos, publicação opt-in |
| `referrals` | kind, inviter_ref, invite_token_hash, claimed_tenant_id, status | Convite profissional não é review |
| `agent_runs` | actor, tenant, model, prompt_version, usage, result_status | Auditoria redigida, sem segredo |
| `action_proposals` | tool, payload_hash, payload, version, expires_at, approval_state, approver | Aprovação vinculada ao payload exato |
| `idempotency_records` | tenant, actor, operation, key, request_hash, response | Mesma chave/payload retorna mesmo resultado |
| `outbox_events` / `jobs` | event/type, attempts, next_run, leased_until, status | Retry limitado e dead-letter |
| `audit_events` | actor, tenant, action, object, before/after redigidos | Append-only pelo backend |
| `plan_entitlements` | tenant, plan, period, limits, usage | Backend aplica cota; frontend só exibe |

É um mapa lógico; não exigir uma tabela para cada conceito quando uma estrutura mais simples mantiver a semântica. Separar pelo menos auth, agenda, cotação, pagamentos e aprovações. Reviews detalhadas, ranking, pedidos de serviço humano, fiscal e conciliação entram em migrações posteriores.

## Integridade e índices

- FKs compostas `(tenant_id, customer_id)` e `(tenant_id, service_id)` referenciam UNIQUE `(tenant_id,id)` no pai, mesmo com UUID global. Isso impede uma reserva do tenant A apontar para cliente B.
- Índices iniciando por tenant nas listas: `(tenant_id, starts_at)`, `(tenant_id, customer_id, starts_at DESC)`, `(tenant_id, due_at)`, `(tenant_id, status, next_run_at)` conforme query real.
- UNIQUE `(provider, external_event_id)` para inbox/webhooks; idempotência também considera o canal/provedor e identidade esperados.
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

## Pacote de sessões e caixa

Ao vender 10 sessões por R$1.000, registrar um recebível/pagamento de R$1.000. Ao consumir cada sessão, reduzir crédito uma única vez; não gerar mais R$100 de caixa. Pode haver valor gerencial alocado por sessão, identificado como tal. Cancelamento segue política de crédito; estorno vincula o evento original. Sem saldo negativo de crédito ou pagamento aplicado duas vezes.

## Evolução de schema

Migration é append-only depois de aplicada. Um integrador numera/revisa/aplica a sequência. Cada módulo propõe SQL em sua pasta; não roda `db push` em projeto compartilhado. Expandir → publicar código compatível → migrar dados → retirar antigo só em release posterior. Views públicas com colunas explícitas e política de segurança própria; não presumir que a RLS de uma tabela protege qualquer view.

## Retenção e portabilidade

Definir retenção por categoria e finalidade antes de dados reais; não inventar prazo legal universal. Exportação por negócio em CSV/JSON e exclusão com trilha de execução, preservando o que tiver obrigação aplicável. Backups e logs também entram no inventário. Exportar só o tenant solicitante, sem objetos públicos/CRM de terceiros. Fotos e anexos privados em buckets privados com URLs temporárias e limites de tipo/tamanho.

## Complemento da reconciliação

Entidades futuras de prestação de serviços estão em doc15: platform_offerings, offering_versions, service_orders, work_items, work_logs, deliverables, acceptances, access_grants e usage_ledger. Não misturar com provider_services. Orçamentos P11 terão snapshot versionado, validade, aceite idempotente e revalidação de disponibilidade.
