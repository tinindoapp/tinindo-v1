#!/usr/bin/env bash
# P08 · Concorrência real das ações do assistente:
#  1. AE-39: duas sessões aprovam e executam a mesma proposta de reagendamento → 1 aprovação, 1 execução,
#     1 reagendamento (versão 2); a outra sessão recebe STALE_VERSION.
#  2. 10 execuções simultâneas da MESMA aprovação (chaves diferentes) → 1 reserva e 10 recibos iguais.
#  3. Execução aprovada x reserva direta no mesmo horário → só uma reserva; o assistente perde com recibo.
#  4. 12 perguntas simultâneas com franquia de 5 → 5 debitadas, 7 QUOTA_EXCEEDED.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE_A=40000000-0000-4000-8000-0000000000a1
CUST_A=30000000-0000-4000-8000-0000000000a1
# Segunda-feira da próxima semana, horário de São Paulo.
at() { echo "((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + $1) + time '$2') at time zone 'America/Sao_Paulo'"; }
iso() { echo "to_char(($1) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"; }
uuid() { grep -vF '"sub"' | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

as_user "$OWNER_A" "select public.scheduling_rules_save('$TENANT_A', '$RES_A',
  (select version from public.resources where id = '$RES_A'),
  '[{\"weekday\":1,\"local_start\":\"09:00\",\"local_end\":\"19:00\"},{\"weekday\":2,\"local_start\":\"09:00\",\"local_end\":\"19:00\"}]',
  'chave-expediente-000001', repeat('e', 64))" >/dev/null

propose_create() { # $1 chave, $2 dia, $3 HH:MM
  as_user "$OWNER_A" "select public.agent_proposal_create('$TENANT_A', null, 'booking.create',
    jsonb_build_object('customer_id', '$CUST_A', 'service_id', '$CORTE_A', 'resource_id', '$RES_A',
      'starts_at', $(iso "$(at "$2" "$3")"), 'ends_at', $(iso "$(at "$2" "$3") + interval '30 minutes'"),
      'expected_price_cents', 6000), 'Agendar', '$1', repeat('a', 64)) #>> '{body,proposal_id}'" | uuid
}
approve() { # $1 proposta, $2 chave
  as_user "$OWNER_A" "select public.action_approve('$TENANT_A', '$1',
    (select payload_hash from public.agent_proposals where id = '$1'), 1, '$2', repeat('b', 64))"
}
execute() { # $1 aprovação, $2 chave
  as_user "$OWNER_A" "select public.action_execute('$TENANT_A', '$1', '$2', repeat('c', 64))"
}

# 1 · AE-39: duas sessões aprovam e executam ao mesmo tempo
B=$(as_user "$OWNER_A" "select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE_A', '$CUST_A', null,
  $(at 1 15:00), $(at 1 15:00) + interval '30 minutes', null, 'confirm', 'reserva-base-0000001', repeat('d', 64))" | uuid)
P=$(as_user "$OWNER_A" "select public.agent_proposal_create('$TENANT_A', null, 'booking.reschedule',
  jsonb_build_object('booking_id', '$B', 'expected_version', 1, 'starts_at', $(iso "$(at 1 16:00)"),
    'ends_at', $(iso "$(at 1 16:00) + interval '30 minutes'")), 'Remarcar', 'proposta-remarcar-00001', repeat('a', 64))
  #>> '{body,proposal_id}'" | uuid)
branch() { # $1 sessão
  local out appr
  out=$(approve "$P" "aprovacao-sessao-00000$1" 2>&1 || true)
  echo "$out" >"$TMP/appr.$1"
  appr=$(echo "$out" | grep -o '"approval_id": "[^"]*"' | uuid || true)
  if [ -n "$appr" ]; then execute "$appr" "execucao-sessao-00000$1" >"$TMP/exec.$1" 2>&1 || true; fi
}
branch 1 &
branch 2 &
wait
check "uma aprovação para a proposta" "$(psql -qXtA -c "select count(*) from public.agent_approvals where proposal_id = '$P'")" 1
check "a outra sessão recebe STALE_VERSION" "$(cat "$TMP"/appr.* | grep -c 'STALE_VERSION' || true)" 1
check "uma execução" "$(psql -qXtA -c "select count(*) from public.agent_receipts r join public.agent_approvals a on a.id = r.approval_id
  where a.proposal_id = '$P' and r.status = 'executed'")" 1
check "reserva remarcada uma vez (versão 2, 16:00)" "$(psql -qXtA -c "select version || ':' || (starts_at = $(at 1 16:00))
  from public.bookings where id = '$B'")" "2:true"
check "um reagendamento auditado" "$(psql -qXtA -c "select count(*) from public.audit_events where action = 'booking.reschedule'
  and object_id = '$B'")" 1

# 2 · 10 execuções simultâneas da mesma aprovação
P2=$(propose_create proposta-criar-0000002 1 10:00)
A2=$(approve "$P2" aprovacao-criar-000002 | grep -o '"approval_id": "[^"]*"' | uuid)
for i in $(seq 1 10); do
  execute "$A2" "execucao-paralela-$(printf '%06d' "$i")" >"$TMP/rep.$i" 2>&1 &
done
wait
check "10 execuções geram 1 reserva" "$(psql -qXtA -c "select count(*) from public.bookings where starts_at = $(at 1 10:00)
  and status = 'confirmed' and source = 'agent'")" 1
check "10 recibos executados" "$(cat "$TMP"/rep.* | grep -c '"status": "executed"' || true)" 10
check "todos apontam para a mesma reserva" "$(cat "$TMP"/rep.* | grep -o '"id": "[^"]*"' | sort -u | wc -l | tr -d ' ')" 1

# 3 · execução aprovada x reserva direta no mesmo horário
P3=$(propose_create proposta-criar-0000003 1 11:00)
A3=$(approve "$P3" aprovacao-criar-000003 | grep -o '"approval_id": "[^"]*"' | uuid)
execute "$A3" execucao-disputa-000003 >"$TMP/race.agent" 2>&1 &
as_user "$OWNER_A" "select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE_A', null, 'Visitante',
  $(at 1 11:00), $(at 1 11:00) + interval '30 minutes', null, 'confirm', 'reserva-direta-000003', repeat('f', 64))" \
  >"$TMP/race.owner" 2>&1 &
wait
check "uma reserva no horário" "$(psql -qXtA -c "select count(*) from public.bookings where starts_at = $(at 1 11:00)
  and status = 'confirmed'")" 1
check "se o assistente perdeu, o recibo diz por quê" "$(psql -qXtA -c "select case
  when exists (select 1 from public.bookings where starts_at = $(at 1 11:00) and source = 'agent') then r.status = 'executed'
  else r.status = 'rejected_by_policy' and r.reason_code = 'SLOT_CONFLICT' end
  from public.agent_receipts r where r.approval_id = '$A3'")" t

# 4 · franquia sob disputa
psql -qXtA -c "insert into public.agent_quotas (tenant_id, monthly_limit, period_start)
  values ('$TENANT_A', 5, date_trunc('month', now() at time zone 'UTC')::date)
  on conflict (tenant_id) do update set monthly_limit = 5, used = 0" >/dev/null
for i in $(seq 1 12); do
  as_user "$OWNER_A" "select public.agent_run_start('$TENANT_A', 'pergunta-paralela-$(printf '%06d' "$i")')" >"$TMP/quota.$i" 2>&1 &
done
wait
check "5 perguntas debitadas" "$(psql -qXtA -c "select used from public.agent_quotas where tenant_id = '$TENANT_A'")" 5
check "7 recebem QUOTA_EXCEEDED" "$(cat "$TMP"/quota.* | grep -c 'QUOTA_EXCEEDED' || true)" 7

finish "P08 concorrência"
