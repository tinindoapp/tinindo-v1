# Handoff · P03 Motor de agenda

Sessão: `claude-int-p03` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-18
Branch: `claude/p03-motor-agenda` → PR para `main`. Decisões em `docs/adr/0008-motor-de-agenda.md`.

## Resultado

- **Banco** (`supabase/migrations/20261018130000_p03_scheduling.sql`): `availability_rules`, `availability_blocks` e `bookings`, com FKs compostas para recurso, cliente (P02) e serviço (P02), RLS e a constraint de exclusão com buffers. Há RPCs de disponibilidade, criação (hold/confirm), confirmação de hold, reagendamento atômico, cancelamento, conclusão, falta/reversão, série semanal, listagem por cursor, detalhe, expediente, plano do dia, bloqueios, horários públicos por slug e varredura de holds.
- **Edge Function `scheduling`**: 15 operações, com validação no contrato, `Idempotency-Key` nos comandos, hash canônico, JWT do usuário e log sem PII. `network` liga `public.slots` ao motor real (anon, só horários).
- **Contratos**: 10 operações novas (ADR-0008) e `DayPlan`, `AvailabilityBlock` e `ScheduleSettings`.
- **Agenda (P04) ligada ao motor**: `serverPort` lê serviços e clientes (P02), reservas, plano do dia e contexto (P03). A cotação fica `null` até o P05, e a tela mostra "Preço base do serviço" com aviso. Nova tela **Horários** (`/app/agenda/horarios`): expediente semanal e bloqueios.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| 20 disputas geram uma reserva | `tests/db-concurrency/03_scheduling.sh`: 1 reserva, 19 `SLOT_CONFLICT`, 1 evento |
| Holds expiram no banco | pgTAP: hold vencido some da leitura, vira `expired` sob lock, confirmação negada (422) |
| Reagendamento falho preserva o original | pgTAP e corrida reagendar × reservar (os dois desfechos observados em execuções diferentes) |
| Eventos e idempotência | pgTAP: replay igual, mismatch 409, um evento por confirmação/cancelamento/conclusão; corrida de 10× mesma chave e 2 cancelamentos simultâneos |
| P01/P02 conectados | FKs compostas para `customers`/`provider_services`; cliente/serviço de B negados em A; RLS do cliente vinculado; agenda lê do `crm` |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npm test` | unit 236/236 · contratos 106/106 |
| `npm run build` | ok |
| `npm run test:e2e` | 34/34 (novo: Horários, desktop + mobile) |
| `deno check --frozen …/*/index.ts` | ok (6 funções) |
| `npm run db:test:local` | fundação, P01, P02, vínculo, **P03 (93)** e P09: tudo ok |
| `npm run db:test:concurrency` | P01 7/7 · P03 11/11 |
| Mutação: sem a constraint de exclusão | 8 asserções pgTAP e 5 de concorrência falham |

Não executado aqui: `supabase test db`/`db lint` no PG 17 (sem Docker). Rodam no CI.

## Mocks e conexões pendentes

- Sem Supabase, a agenda segue na emulação rotulada ("Dados de exemplo"). A emulação agora também edita expediente e bloqueios.
- Lista de clientes da agenda: até 1000 (10 páginas). Busca no fluxo fica para depois.
- Política de cancelamento na tela ainda é o texto de exemplo do P04. A real está em `tenant_onboarding` (P01) e não é lida pela agenda.
- Sem UI de falta (`booking.no_show`) nem de série (`booking.create_series`): as operações existem e estão testadas, e a UI entra em pacote posterior.

## Flags

Nenhuma.

## Próximo passo

P07 (recebíveis) consome `booking.completed.v1`/`booking.confirmed.v1`. P05 liga cotação ao `booking.create`. P06 usa holds e `scheduling_expire_holds()`.
