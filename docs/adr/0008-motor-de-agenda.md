# ADR-0008 · Motor de agenda (P03)

Status: aceita · 2026-10-18 · integrador (implementou o P03)

## Decisões

1. **A autoridade sobre capacidade é a constraint `bookings_no_overlap`** (`EXCLUDE USING gist (tenant_id =, resource_id =, occupied_range &&) WHERE blocks_capacity`). `occupied_range` inclui os intervalos antes/depois do serviço. As RPCs validam expediente e bloqueios, e a constraint barra qualquer sobreposição, inclusive fora delas.
2. **Protocolo único dos comandos de capacidade**: autoriza → `idempotency_claim` → `FOR UPDATE` no recurso → expira holds vencidos do recurso → valida → grava → evento + auditoria → `idempotency_complete`, numa transação. A ordem de locks é sempre recurso → reserva (sem deadlock entre reagendar e reservar).
3. **Hold vence no banco** (`clock_timestamp()`, 15 min). Leituras ignoram hold vencido, e o próximo comando no recurso o marca `expired`. `scheduling_expire_holds()` (só `service_role`) é a varredura para o cron do P06; a correção não depende dela.
4. **Expediente semanal em horário local + timezone do tenant**, trocado inteiro por `schedule.rules_save` com versão otimista no recurso. Reservas existentes não mudam. Pausa = lacuna entre faixas do mesmo dia. Sem datas de vigência no piloto.
5. **Bloqueio pessoal** é tabela própria (`availability_blocks`) e não pode cobrir reserva ativa (409). Remoção é lógica (`removed_at`).
6. **Recorrência**: `booking.create_series`, 2 a 12 semanas na mesma hora local. Cada ocorrência é materializada pelo mesmo protocolo. `all_or_nothing` desfaz tudo num conflito; senão, cria as livres e devolve os conflitos. Nunca há "série confirmada" com falhas escondidas.
7. **Preço até o P05**: `quote_id` precisa ser null e a confirmação congela `provider_services.base_price_cents` em `agreed_price_cents`. O reagendamento mantém o preço combinado. O P05 troca isso por cotação validada (nova migration).
8. **Erros**: horário ocupado, fora do expediente ou bloqueado → `SLOT_CONFLICT`; versão → `STALE_VERSION`; transição inválida, hold vencido ou concluir antes do início → `POLICY_REJECTED` (422) com `hint`; não encontrado → 404 neutro.
9. **Escrita só do dono** (como no P02). Membro lê. O cliente vinculado (P01) lê só as próprias reservas por RLS, sem as colunas de texto livre (motivo, `guest_ref`, autor), que ficam fora do grant. O visitante usa `scheduling_public_slots(slug, …)`, que devolve só horários livres de perfil publicado.
10. **Eventos**: `booking.confirmed.v1` (criação confirmada e confirmação de hold), `booking.cancelled.v1` e `booking.completed.v1`. O payload traz IDs, horários, preço e origem, sem motivo nem nome. O motivo de cancelamento/falta fica na reserva, fora da auditoria.

## Contrato (aditivo)

Operações novas no registro: `booking.confirm`, `booking.no_show`, `booking.create_series`, `booking.list`, `booking.get`, `schedule.settings`, `schedule.rules_save`, `schedule.day_plans`, `schedule.block_create` e `schedule.block_remove`. Todas em `POST /functions/v1/scheduling/<op>`, inclusive as consultas.

## Consequências

- A agenda (P04) usa o servidor quando há Supabase: serviços e clientes vêm do `crm`, e o resto do `scheduling`. A emulação continua só para a demonstração offline.
- O P05 precisa: tabela de cotações, validar `quote_id` em `sched_insert_booking`/`reschedule` e ligar `pricing.quote` na porta da agenda.
- O P06 reutiliza `app.sched_insert_booking` (hold) e `booking.confirm` para ofertas, e agenda `scheduling_expire_holds()`.
