# ADR-0007 · Integração de P01, P02 e P09: ordem das migrations, contratos promovidos e concorrência no CI

Status: aceita · 2026-10-18 · integrador

## Migrations

Ordem (dependências reais, não a numeração dos pacotes):

| Migration | Origem | Depende de |
|---|---|---|
| `20261018120000_p01_identity_onboarding.sql` | `db/proposals/P01/001` | fundação |
| `20261018120100_p02_crm.sql` | `db/proposals/P02/001` | fundação |
| `20261018120200_p01_customer_links.sql` | `db/proposals/P01/002` | P01/001 e `customers` (P02) |
| `20261018120300_p09_network.sql` | `db/proposals/P09/001` | fundação |

- O SQL entrou sem alteração. P09 também já estava mergeado e foi incluído na mesma rodada.
- Nenhum projeto Supabase hospedado existe ainda (ADR-0006), então nada foi aplicado em banco compartilhado; daqui em diante estas migrations são append-only.
- O seed do P02 (serviços e clientes de `fixtures.ts`) foi anexado a `supabase/seed.sql`. O teste de vínculo passou a usar IDs próprios de cliente (`…01a1`, `…01b1`, `…01a2`) para não colidir com o seed.
- Os testes pgTAP foram para `supabase/tests/database/0{1,2,3,9}_*.test.sql`. O stub de `customers` do P01 foi descartado.

## Concorrência no CI

pgTAP numa transação não prova corrida entre conexões. `tests/db-concurrency/NN_*.sh` roda via `npm run db:test:concurrency`, cada script num banco descartável (shim + migrations + seed), e o job `database` passa a executá-lo no Postgres 16 do runner, depois do stack Supabase. O primeiro script é o `concurrency.sh` do P01 (mesma chave, cota sob corrida, código disputado). P03 e seguintes acrescentam os seus.

## Contratos promovidos (aditivo, sem quebra)

- `_shared/contracts/identity.ts`: onboarding e vínculo de cliente (P01).
- `_shared/contracts/crm.ts`: `DeclaredSource`, `CrmCustomer`, listas, arquivamento, importação e `CRM_ROUTES` (P02). `Customer` v1 não mudou; `CrmCustomer` o estende.
- `_shared/contracts/network.ts`: rotas complementares do P09 (perfil do dono, leitura pública, convite).
- `OPERATIONS` e a tabela do doc03 ganharam 17 operações: `onboarding.save`, `customer_link.{issue,redeem,revoke}`, `customer.{archive,list,import_preview,import}`, `service.list`, `profile.{unpublish,get}`, `public.{profile,slots}` e `referral.{inspect,claim,list}`.
- `customer.list` e `service.list` são nomes lógicos; a função `crm` os serve em `GET /crm/customers` e `GET /crm/services` (`CRM_ROUTES`).
- Os arquivos locais dos módulos (`identity/schemas.ts`, `crm/contract.ts`, `network/schemas.ts`) só reexportam e guardam o mapa operação → RPC. O frontend importa de `@contracts`.

## App

- `AppShell`: sem negócio, só a área `/app/conta/**` abre (criar negócio, resgatar vínculo, nova senha). Os outros caminhos mostram os dois atalhos.
- Rotas públicas `/criar-conta` e `/recuperar-senha` fora do shell; links na tela de entrada.
- `supabase/config.toml`: senha mínima de 10 com letras e dígitos; redirects locais com `/**`. SMTP e URLs de homologação continuam como gate de ambiente (ADR-0006).
