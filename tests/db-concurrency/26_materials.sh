#!/usr/bin/env bash
# P30 · Concorrência real do estoque (várias conexões ao mesmo tempo):
#  1. 5 consumos simultâneos do MESMO atendimento (chaves diferentes) → 1 consumo; o estoque sai uma vez.
#  2. 10 consumos simultâneos de atendimentos diferentes com estoque para 6 → 6 consumos, 4 recusas; estoque nunca negativo.
#  3. 5 estornos simultâneos do mesmo consumo → 1 estorno; o estoque volta uma vez.
#  4. Compras e consumos misturados em paralelo → saldo e valor batem com a soma do razão (sem atualização perdida).
#  5. 10 repetições da mesma compra com a mesma chave → 1 compra, 1 despesa.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE=40000000-0000-4000-8000-0000000000a1
ANA=30000000-0000-4000-8000-0000000000a1
H=$(printf 'a%.0s' $(seq 1 64))
# Largada: as conexões esperam um advisory lock e saem juntas (sem isso, abrir conexões serializa a corrida).
WAIT="select pg_advisory_lock_shared(3030); select pg_advisory_unlock_shared(3030);"
gate() {
  psql -qXtA -c "select pg_advisory_lock(3030); select pg_sleep(1.5); select pg_advisory_unlock(3030);" >/dev/null &
  until [ "$(psql -qXtA -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 3030 and granted")" = 1 ]; do :; done
}
item() { # $1 chave, $2 nome
  as_user "$OWNER_A" "select public.materials_item_save('$TENANT_A', null, null, '$2', 'consumable', 'un', true, null, '$1', '$H') #>> '{body,item,id}'" | grep -E '^[0-9a-f-]{36}$'
}
buy() { # $1 chave, $2 item, $3 quantidade, $4 centavos, $5 despesa
  as_user "$OWNER_A" "$WAIT select public.materials_purchase('$TENANT_A', null, now(), '[{\"item_id\":\"$2\",\"quantity\":$3,\"total_cents\":$4}]', $5, '$1', '$H')"
}
consume() { # $1 chave, $2 atendimento
  as_user "$OWNER_A" "$WAIT select public.materials_consume('$TENANT_A', '$2', null, '$1', '$H')"
}

LUVA=$(item conc-mt-item-000000001 'Luva')
as_user "$OWNER_A" "select public.materials_usage_save('$TENANT_A', '$CORTE', '$LUVA', 1, 'conc-mt-usage-00000001', '$H')" >/dev/null
buy conc-mt-buy-0000000001 "$LUVA" 7 700 false >/dev/null
psql -qX -c "insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
  select '$TENANT_A', '$RES_A', '$ANA', '$CORTE', now() - g * interval '1 hour', now() - g * interval '1 hour' + interval '30 minutes',
    tstzrange(now() - g * interval '1 hour', now() - g * interval '1 hour' + interval '40 minutes', '[)'), true, 'completed', 6000, 'owner'
  from generate_series(1, 11) g" >/dev/null
mapfile -t B < <(psql -qXtA -c "select id from public.bookings where status = 'completed' order by starts_at")

# 1 · mesmo atendimento
gate
for i in $(seq 1 5); do consume "conc-mt-same-booking-$i" "${B[0]}" >"$TMP/s.$i" 2>&1 & done
wait
check "um consumo do atendimento" "$(psql -qXtA -c "select count(*) from public.material_consumptions where booking_id = '${B[0]}'")" 1
check "4 recusas por consumo já registrado" "$(cat "$TMP"/s.* | grep -c 'POLICY_REJECTED' || true)" 4
check "estoque saiu uma vez (7 → 6)" "$(psql -qXtA -c "select on_hand::int from public.material_items where id = '$LUVA'")" 6

# 2 · estoque para 6, 10 atendimentos
gate
for i in $(seq 1 10); do consume "conc-mt-many-$(printf '%010d' "$i")" "${B[$i]}" >"$TMP/m.$i" 2>&1 & done
wait
check "6 consumos novos (7 ativos)" "$(psql -qXtA -c "select count(*) from public.material_consumptions where status = 'active'")" 7
check "4 recusas por estoque" "$(cat "$TMP"/m.* | grep -c 'POLICY_REJECTED' || true)" 4
check "estoque zerado, nunca negativo, valor zerado" "$(psql -qXtA -c "select on_hand::int || '/' || stock_value_cents from public.material_items where id = '$LUVA'")" "0/0"

# 3 · estornos simultâneos
CID=$(psql -qXtA -c "select id from public.material_consumptions where booking_id = '${B[0]}'")
V=$(psql -qXtA -c "select version from public.material_consumptions where id = '$CID'")
gate
for i in $(seq 1 5); do
  as_user "$OWNER_A" "$WAIT select public.materials_consume_reverse('$TENANT_A', '$CID', $V, 'conc-mt-reverse-000$i', '$H')" >"$TMP/r.$i" 2>&1 &
done
wait
check "um estorno" "$(psql -qXtA -c "select count(*) from public.material_movements where kind = 'reversal'")" 1
check "estoque voltou uma vez (0 → 1)" "$(psql -qXtA -c "select on_hand::int || '/' || stock_value_cents from public.material_items where id = '$LUVA'")" "1/100"

# 4 · compras e consumos misturados
gate
for i in $(seq 1 6); do buy "conc-mt-mixed-buy-00$i" "$LUVA" 2 300 false >"$TMP/x.b.$i" 2>&1 & done
consume conc-mt-mixed-consume-1 "${B[0]}" >"$TMP/x.c.1" 2>&1 &
wait
check "saldo = soma do razão" "$(psql -qXtA -c "select (i.on_hand = (select sum(m.quantity) from public.material_movements m where m.item_id = i.id))::int from public.material_items i where i.id = '$LUVA'")" 1
check "valor = soma do razão" "$(psql -qXtA -c "select (i.stock_value_cents = (select sum(m.value_cents) from public.material_movements m where m.item_id = i.id))::int from public.material_items i where i.id = '$LUVA'")" 1
check "12 entradas e 1 saída aplicadas (1 + 12 − 1)" "$(psql -qXtA -c "select on_hand::int from public.material_items where id = '$LUVA'")" 12

# 5 · mesma compra, mesma chave
gate
for i in $(seq 1 10); do buy conc-mt-same-key-0000001 "$LUVA" 5 500 true >"$TMP/k.$i" 2>&1 & done
wait
check "uma compra com a chave" "$(psql -qXtA -c "select count(*) from public.material_purchases where total_cents = 500")" 1
check "uma despesa no Caixa" "$(psql -qXtA -c "select count(*) from public.expense_entries where amount_cents = 500 and category = 'supplies'")" 1
check "respostas idênticas" "$(cat "$TMP"/k.* | grep status_code | sort -u | wc -l | tr -d ' ')" 1

finish "P30 concorrência"
