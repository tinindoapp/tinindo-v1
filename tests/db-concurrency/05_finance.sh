#!/usr/bin/env bash
# P07 · Concorrência real do caixa (várias conexões ao mesmo tempo):
#  1. 10 recebimentos simultâneos de R$10 num recebível de R$50 → exatamente R$50 recebidos, nunca mais.
#  2. 10 consumos simultâneos (atendimentos diferentes) num pacote de 3 créditos → 3 débitos, saldo 0.
#  3. O MESMO evento de conclusão consumido 5× ao mesmo tempo, com chaves diferentes → 1 débito.
#  4. 2 estornos simultâneos do mesmo recebimento → 1 estorno.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_B=b0000000-0000-4000-8000-00000000000b
TENANT_B=10000000-0000-4000-8000-00000000000b
RES_B=20000000-0000-4000-8000-00000000000b
TREINO_B=40000000-0000-4000-8000-0000000000b1
CUST_B=30000000-0000-4000-8000-0000000000b1

# 11 atendimentos passados de B, concluídos pela RPC do P03 (gera booking.completed.v1).
psql -qX -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range,
  blocks_capacity, status, agreed_price_cents, source)
select ('62000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '$TENANT_B', '$RES_B', '$CUST_B', '$TREINO_B',
  now() - make_interval(days => g), now() - make_interval(days => g) + interval '60 minutes',
  tstzrange(now() - make_interval(days => g) - interval '15 minutes', now() - make_interval(days => g) + interval '75 minutes', '[)'),
  true, 'confirmed', 12000, 'owner'
from generate_series(1, 11) g;
SQL
for g in $(seq 1 11); do
  as_user "$OWNER_B" "select public.scheduling_booking_complete('$TENANT_B', '62000000-0000-4000-8000-$(printf '%012d' "$g")', 1,
    'conclui-$(printf '%016d' "$g")', repeat('a', 64))" >/dev/null
done
ev() { psql -qXtA -c "select event_id from public.outbox_events where aggregate_id = '62000000-0000-4000-8000-$(printf '%012d' "$1")'
  and event_type = 'booking.completed.v1'"; }

# 1 · recebimentos simultâneos
REC=$(as_user "$OWNER_B" "select public.finance_receivable_create('$TENANT_B', null, 'Teste', 5000, null,
  'recebivel-corrida-000001', repeat('b', 64)) #>> '{body,receivable,id}'" | grep -E '^[0-9a-f-]{36}$')
for i in $(seq 1 10); do
  as_user "$OWNER_B" "select public.finance_record_payment('$TENANT_B', '$REC', 1000, 'pix', now(),
    'pagamento-corrida-$(printf '%07d' "$i")', repeat('c', 64))" >"$TMP/pay.$i" 2>&1 &
done
wait
check "recebido nunca passa do devido" "$(psql -qXtA -c "select coalesce(sum(amount_cents), 0) from public.payment_entries
  where receivable_id = '$REC' and reversal_of is null")" 5000
check "recebível quitado com paid = amount" "$(psql -qXtA -c "select status || ':' || paid_cents from public.receivables where id = '$REC'")" "paid:5000"
check "5 recebimentos negados por excesso" "$(cat "$TMP"/pay.* | grep -c 'POLICY_REJECTED' || true)" 5

# 2 · consumos simultâneos num pacote de 3
PKG=$(as_user "$OWNER_B" "select public.package_sell('$TENANT_B', '$CUST_B', '$TREINO_B', 3, 30000, null,
  'pacote-corrida-00000001', repeat('d', 64)) #>> '{body,package,package_id}'" | grep -E '^[0-9a-f-]{36}$')
for g in $(seq 1 10); do
  as_user "$OWNER_B" "select public.package_consume('$TENANT_B', '$PKG', '62000000-0000-4000-8000-$(printf '%012d' "$g")',
    '$(ev "$g")', 'consumo-corrida-$(printf '%08d' "$g")', repeat('e', 64))" >"$TMP/consume.$g" 2>&1 &
done
wait
check "3 débitos para 3 créditos" "$(psql -qXtA -c "select count(*) from public.session_entries where package_id = '$PKG' and reason = 'consume'")" 3
check "saldo nunca negativo" "$(psql -qXtA -c "select 3 + coalesce(sum(delta), 0) from public.session_entries where package_id = '$PKG'")" 0

# 3 · mesmo evento, chaves diferentes, ao mesmo tempo
PKG2=$(as_user "$OWNER_B" "select public.package_sell('$TENANT_B', '$CUST_B', '$TREINO_B', 5, 50000, null,
  'pacote-corrida-00000002', repeat('f', 64)) #>> '{body,package,package_id}'" | grep -E '^[0-9a-f-]{36}$')
EV11=$(ev 11)
for i in $(seq 1 5); do
  as_user "$OWNER_B" "select public.package_consume('$TENANT_B', '$PKG2', '62000000-0000-4000-8000-000000000011',
    '$EV11', 'mesmo-evento-$(printf '%010d' "$i")', repeat('0', 64))" >"$TMP/same.$i" 2>&1 &
done
wait
check "mesmo evento debita uma vez" "$(psql -qXtA -c "select count(*) from public.session_entries where source_event_id = '$EV11'")" 1
check "todas as repetições respondem com o mesmo saldo" "$(cat "$TMP"/same.* | grep -o '"remaining_credits": [0-9]*' | sort -u)" '"remaining_credits": 4'

# 4 · estornos simultâneos
PAY=$(psql -qXtA -c "select id from public.payment_entries where receivable_id = '$REC' and reversal_of is null limit 1")
for k in 1 2; do
  as_user "$OWNER_B" "select public.finance_reverse_payment('$TENANT_B', '$PAY', 'Corrida', 'estorno-corrida-00000$k', repeat('$k', 64))" \
    >"$TMP/rev.$k" 2>&1 &
done
wait
check "um estorno por recebimento" "$(psql -qXtA -c "select count(*) from public.payment_entries where reversal_of = '$PAY'")" 1
check "recebível volta a parcial" "$(psql -qXtA -c "select status || ':' || paid_cents from public.receivables where id = '$REC'")" "partially_paid:4000"

finish "P07 concorrência"
