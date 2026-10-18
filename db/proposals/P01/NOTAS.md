# P01 · Notas das propostas de banco

| Arquivo | Depende de | Conteúdo |
|---|---|---|
| `001_identity_onboarding.sql` | fundação (`20261017120000_foundation.sql`) | `tenant_onboarding`, `policy_acceptances`, `business_create`, `onboarding_save`, utilitários em `app` |
| `002_customer_links.sql` | 001 **e `public.customers` do P02** | `customer_links`, `customer_link_invites`, `customer_link_issue/redeem/revoke`, `my_customer_links()`, `app.linked_customer_id()` |
| `tests/000_stub_p02_customers.sql` | — | **Só teste local.** Stub mínimo de `customers` (tenant_id, id, name, archived_at, `UNIQUE (tenant_id, id)`). Não incluir em migrations |

## Ordem de inclusão sugerida

1. `001` logo após a fundação: não depende de nenhum outro pacote.
2. A migration de `customers` do P02.
3. `002`. Ela usa de `customers` só `tenant_id`, `id`, `archived_at` e a chave `UNIQUE (tenant_id, id)`. Se o P02 usar outro nome de coluna para arquivamento, ajustar as duas consultas em `customer_link_issue` e `customer_link_redeem`.

## Como testar

```bash
# Postgres ≥ 15 com btree_gist, pgcrypto e pgtap (mesmo requisito de scripts/db-test-local.sh)
PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash db/proposals/P01/tests/run-local.sh
PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash db/proposals/P01/tests/concurrency.sh
```

`run-local.sh` roda duas ordens: banco limpo (como `supabase db reset`: migrations e depois seed) e banco já migrado com dados (seed antes da 001, como homologação). Em cada ordem também roda `supabase/tests/database/00_foundation.test.sql`. Não copia nada para `supabase/`.

`concurrency.sh` usa várias conexões ao mesmo tempo. O pgTAP numa transação só não cobre isso.

## Decisões que o integrador deve revisar

- **Idempotência sem tenant prévio.** `idempotency_records.tenant_id` é `NOT NULL`, e `business.create` ainda não tem tenant. O id do tenant novo é `app.uuid_from_text(actor || ':business.create:' || key)` (sha256 com formato v4). A repetição cai no mesmo tenant e reaproveita `app.idempotency_claim/complete` sem mudar a tabela da fundação. O id não é segredo: autorização é sempre por membership.
- **Lock por ator** (`pg_advisory_xact_lock`) em `business_create`. Ele serializa as criações de um mesmo login. Sem ele, chaves diferentes em paralelo furavam a cota: o `concurrency.sh` criou 6 negócios com cota 3 antes da correção.
- **Cota de 3 negócios ativos por dono** (`app.max_owned_tenants()`), contra abuso e custo, não como regra comercial. Responde `429 QUOTA_EXCEEDED`.
- **O código de vínculo não fica na resposta guardada.** A repetição de `customer_link.issue` devolve `code: null`. É um desvio consciente de "repetição devolve a resposta original", para não guardar o código em texto em `idempotency_records`. A UI orienta a gerar outro código.
- **`onboarding_save` cria a linha que faltar.** O seed roda depois das migrations, então os tenants A/B do seed não têm `tenant_onboarding` no banco limpo. O backfill da 001 cobre ambientes já migrados.
- `customer_link_invites`, como `idempotency_records`, não tem política nenhuma (backend-only).
- Nenhum evento de outbox novo: `business.created` não está em `EventType` (contrato). A criação fica registrada em `audit_events`.
- `pg_catalog.sha256` exige Postgres ≥ 11, e `extensions.gen_random_bytes` exige o pgcrypto no schema `extensions` (padrão Supabase).

## Impacto em dados existentes

Não há dados reais (ADR-0001). A 001 só adiciona tabelas e faz o backfill de `tenant_onboarding` vazio. A 002 só adiciona tabelas. Nada é alterado nem removido.
