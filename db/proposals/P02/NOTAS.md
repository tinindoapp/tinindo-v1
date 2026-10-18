# P02 · Notas para o integrador

## O que incluir

| Arquivo | Destino sugerido | Observação |
|---|---|---|
| `001_crm.sql` | `supabase/migrations/<timestamp>_p02_crm.sql` | Depende só da fundação (`20261017120000_foundation.sql`). Não altera tabela existente. |
| `tests/001_crm.test.sql` | `supabase/tests/database/02_crm.test.sql` | 57 asserções pgTAP. Supõe o seed com `seed.sql` abaixo. |
| `seed.sql` | anexar a `supabase/seed.sql` | Serviços = `services` de `fixtures.ts`; clientes = `FX.customers`. Sintético (`exemplo.test`). |

Ordem: migration → seed → testes. Validado localmente em Postgres 16 + shim (`npm run db:test:local`, 33 + 57 ok). O CI usa Postgres 17 do Supabase; `supabase db lint` não foi rodado aqui (sem Docker).

## Esquema

- `public.customers`: CRM privado (nome, telefone E.164, e-mail, `declared_source`, `archived_at`, versão). Dedupe sugerido por telefone, e-mail ou nome normalizado, **só dentro do tenant**. Nunca há merge.
- `public.provider_services`: duração 5–1440 min, buffers 0–240, base/piso/custo em centavos `bigint`, taxa em bps, `active` (arquivar = inativo). Nome único entre ativos do tenant. P03 deve referenciar com FK composta `(tenant_id, service_id) → provider_services (tenant_id, id)`.
- RLS: membros (owner/staff) leem; não há grant de escrita para `authenticated`. Escrita só por RPC `security definer` com `app.is_member(..., ['owner'])`.
- RPCs: `crm_customer_upsert`, `crm_customer_archive`, `crm_customer_list`, `crm_service_save`, `crm_service_list`, `crm_customer_import_preview` e `crm_customer_import`. Os comandos seguem o padrão da ADR-0003: autoriza → `idempotency_claim` → mutação com `FOR UPDATE` + `expected_version` → `app.audit` → `idempotency_complete`, tudo numa transação.
- Auditoria de cliente redigida (sem nome, telefone ou e-mail). A de serviço guarda antes/depois (não tem PII).
- Sem outbox: `events.ts` não tem evento de CRM e não há consumidor. Quando P03/P08 precisarem, propor `customer.upserted.v1`/`service.saved.v1`.

## Proposta de contrato (compatível, aditiva)

Hoje a extensão vive em `supabase/functions/crm/contract.ts`, sem tocar `_shared/contracts`:

1. `Customer` e `CustomerUpsertInput` ganham `declared_source` opcional/nullable (enum `DeclaredSource`). A saída atual já é lida pelo schema v1 (teste em `tests/contracts/crm`).
2. Registrar no `operations.ts` (ou documentar como rotas locais do módulo): `customer.archive` (comando), `customer.list` e `service.list` (consultas com cursor), `customer.import_preview` (consulta) e `customer.import` (comando idempotente). O teste de registro × doc03 precisa do doc03 atualizado junto.

Consumidores conhecidos: P03 (FK de serviço, duração e buffers), P05 (base, piso, custo e taxa), P07 (cliente em recebíveis), P08 (ferramentas do agente) e P01 (`customer_links` aponta para `customers`).

## Riscos

- Nome normalizado como sinal de duplicado gera falso positivo (homônimos). Só sugere; na importação a pessoa escolhe "Criar mesmo assim" por linha.
- Importação de 500 linhas roda numa transação só. Se crescer, paginar no cliente.
