#!/usr/bin/env bash
# P13 · Concorrência real do relacionamento:
#  1. O MESMO evento booking.confirmed processado por 3 workers em paralelo → um conjunto de passos (3), não três.
#  2. Com canal conectado e teto diário 2, 3 workers despacham 5 passos vencidos em paralelo → no máximo 2 enviados
#     ao canal, o resto adiado; nenhum passo despachado duas vezes (uma mensagem por passo).
#  3. Duas aprovações da MESMA campanha (mesmo público) em paralelo com chaves diferentes → passos não duplicam
#     (dedupe por régua/agregado/chave) e o público some depois da primeira.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE=40000000-0000-4000-8000-0000000000a1
ANA=30000000-0000-4000-8000-0000000000a1
H=$(printf 'a%.0s' $(seq 1 64))

psql -qX -c "insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
  select '$TENANT_A', '$RES_A', d, '08:00', '20:00' from generate_series(1, 5) d" >/dev/null
psql -qX -c "update public.customers set phone = '+5511988887777' where id = '$ANA'" >/dev/null
# Segunda da próxima semana + N dias, 10:00 em São Paulo.
AT() { psql -qXtA -c "select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + $1) + time '$2') at time zone 'America/Sao_Paulo'"; }

# 1 · mesmo evento, 3 workers
S1=$(AT 1 10:00); E1=$(AT 1 10:30)
B1=$(as_user "$OWNER_A" "select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE', '$ANA', null, '$S1', '$E1', null, 'confirm', 'conc-lc-b1-000000001', '$H') #>> '{body,booking,id}'" | grep -E '^[0-9a-f-]{36}$')
for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(100)" >"$TMP/j1.$w" 2>&1 &
done
wait
check "um conjunto de passos para a reserva (confirmação + 2 lembretes)" "$(psql -qXtA -c "select count(*) from public.lifecycle_steps where aggregate_id = '$B1'")" 3
check "evento processado uma vez" "$(psql -qXtA -c "select count(*) from public.lifecycle_processed_events")" 1
check "nenhum worker falhou" "$(cat "$TMP"/j1.* | grep -c ERROR || true)" 0

# 2 · teto diário sob despacho paralelo
psql -qX -c "insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
  values ('$TENANT_A', 'simulated', '+5511999990001', '+5511999990001', 'active', now());
  insert into public.channel_contacts (tenant_id, connection_id, phone_e164, customer_id, opt_in_at, opt_in_source, last_inbound_at)
  select '$TENANT_A', c.id, '+5511988887777', '$ANA', now(), 'inbound', now() from public.channel_connections c where c.tenant_id = '$TENANT_A';
  insert into public.lifecycle_settings (tenant_id, daily_budget) values ('$TENANT_A', 2);
  update public.lifecycle_steps set status = 'cancelled' where aggregate_id = '$B1';" >/dev/null
for i in 0 1 2 3 4; do
  S=$(AT "$i" 14:00); E=$(AT "$i" 14:30)
  as_user "$OWNER_A" "select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE', '$ANA', null, '$S', '$E', null, 'confirm', 'conc-lc-c$i-000000001', '$H')" >/dev/null
done
# Só as confirmações vencem agora (5); processar os eventos sem despachar ainda não é possível separadamente,
# então: congela o despacho fazendo o teto zero, roda os eventos, devolve o teto 2 e despacha em paralelo.
psql -qX -c "update public.lifecycle_settings set daily_budget = 0 where tenant_id = '$TENANT_A'" >/dev/null
psql -qXtA -c "set role service_role; select public.jobs_run(100)" >/dev/null
check "cinco confirmações adiadas pelo teto zero" "$(psql -qXtA -c "select count(*) from public.lifecycle_steps where rule = 'confirmation' and status = 'deferred'")" 5
psql -qX -c "update public.lifecycle_settings set daily_budget = 2 where tenant_id = '$TENANT_A';
  update public.lifecycle_steps set due_at = now() - interval '1 minute' where rule = 'confirmation' and status = 'deferred'" >/dev/null
for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(100)" >"$TMP/j2.$w" 2>&1 &
done
wait
SENT=$(psql -qXtA -c "select count(*) from public.lifecycle_steps where rule = 'confirmation' and status = 'sent'")
check "no máximo 2 enviados ao canal (teto diário sob paralelismo)" "$([ "$SENT" -le 2 ] && echo ok || echo "$SENT")" ok
check "ao menos 1 enviado" "$([ "$SENT" -ge 1 ] && echo ok || echo "$SENT")" ok
check "uma mensagem no canal por passo enviado" "$(psql -qXtA -c "select count(*) from public.channel_messages where direction = 'outbound'")" "$SENT"
check "o resto ficou adiado, não descartado" "$(psql -qXtA -c "select count(*) from public.lifecycle_steps where rule = 'confirmation' and status in ('sent', 'deferred')")" 5
check "nenhum worker falhou" "$(cat "$TMP"/j2.* | grep -c ERROR || true)" 0

# 3 · aprovação da campanha em paralelo
psql -qX -c "update public.bookings set status = 'cancelled', blocks_capacity = false where customer_id = '$ANA' and id <> '$B1';
  update public.bookings set status = 'completed', starts_at = now() - interval '100 days', ends_at = now() - interval '100 days' + interval '30 minutes',
    occupied_range = tstzrange(now() - interval '100 days', now() - interval '100 days' + interval '40 minutes', '[)') where id = '$B1';
  insert into public.lifecycle_consents (tenant_id, customer_id, purpose) values ('$TENANT_A', '$ANA', 'marketing');" >/dev/null
HASH=$(as_user "$OWNER_A" "select public.lifecycle_audience_preview('$TENANT_A')->>'audience_hash'" | grep -E '^[0-9a-f]{64}$')
for w in 1 2; do
  as_user "$OWNER_A" "select public.lifecycle_campaign_approve('$TENANT_A', '$HASH', 10, 'conc-lc-camp-0000000$w', '$H')" >"$TMP/c.$w" 2>&1 &
done
wait
check "um passo de reativação para a cliente, mesmo com duas aprovações" "$(psql -qXtA -c "select count(*) from public.lifecycle_steps where rule = 'reactivation'")" 1
check "a segunda aprovação foi recusada (público mudou)" "$(cat "$TMP"/c.* | grep -c STALE_VERSION || true)" 1
check "público vazio depois da campanha" "$(as_user "$OWNER_A" "select jsonb_array_length(public.lifecycle_audience_preview('$TENANT_A')->'customers')" | grep -E '^[0-9]+$')" 0

finish "P13 concorrência"
