#!/usr/bin/env bash
# P43 · Reserva pelo link público, com várias conexões anônimas ao mesmo tempo:
#  1. 20 visitantes pedem o MESMO horário → 1 reserva provisória e 19 SLOT_CONFLICT.
#  2. 10 repetições simultâneas do MESMO pedido (mesma chave) → 1 pedido e 10 respostas iguais.
#  3. 5 confirmações simultâneas com o código certo → 1 reserva confirmada e 1 evento.
#  4. Código errado conta tentativa; depois de 5, nem o certo confirma. Código de outro pedido não confirma.
#  5. Pedido vencido não confirma e o horário volta a ficar livre.
#  6. Limite por contato no negócio; o contato não vira cliente do CRM nem contato do canal.
#  6b. O mesmo contato pede dois horários ao mesmo tempo → um pedido e um PENDING_REQUEST_EXISTS; trocando ao mesmo tempo → um só ativo.
#  7. O despacho leva o código ao contato informado, pelo canal do negócio.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
# Roda via scripts/db-concurrency.sh, que prepara PGDATABASE (migrations + seed) e exporta TMP.
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE_A=40000000-0000-4000-8000-0000000000a1
SLUG=barbearia-exemplo-a
# Segunda-feira da próxima semana, horário de São Paulo.
at() { echo "((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + $1) + time '$2') at time zone 'America/Sao_Paulo'"; }
as_anon() {
  psql -qXtA -v ON_ERROR_STOP=1 <<SQL
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
$1;
commit;
SQL
}
ask() { # $1 chave, $2 dia, $3 HH:MM, $4 telefone, $5 hash do pedido (opcional)
  as_anon "select public.public_booking_request('$SLUG', '$CORTE_A', $(at "$2" "$3"), 'Visitante', '$4', '$1',
    repeat('${5:-${1: -1}}', 64))"
}
ask_replace() { # como ask, trocando o pedido pendente do mesmo contato (replace_existing)
  as_anon "select public.public_booking_request('$SLUG', '$CORTE_A', $(at "$2" "$3"), 'Visitante', '$4', '$1',
    repeat('${1: -1}', 64), null, true)"
}
ask_slow() { # como ask (ou ask_replace com $5 = true), segurando o commit 0,5 s: força as transações a se sobreporem
  as_anon "select public.public_booking_request('$SLUG', '$CORTE_A', $(at "$2" "$3"), 'Visitante', '$4', '$1',
    repeat('${1: -1}', 64), null, ${5:-false}); select pg_sleep(0.5)"
}
confirm() { # $1 pedido, $2 código
  as_anon "select public.public_booking_confirm('$1', '$2')"
}
request_of() { psql -qXtA -c "select q.id from public.public_booking_requests q join public.bookings b on b.id = q.booking_id
  where b.starts_at = $(at "$1" "$2") order by q.created_at desc limit 1"; }
code_of() { psql -qXtA -c "select code from public.public_booking_requests where id = '$1'"; }

as_user "$OWNER_A" "select public.scheduling_rules_save('$TENANT_A', '$RES_A',
  (select version from public.resources where id = '$RES_A'),
  '[{\"weekday\":1,\"local_start\":\"09:00\",\"local_end\":\"19:00\"}]', 'chave-expediente-000043', repeat('e', 64))" >/dev/null
psql -qX -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
values ('$TENANT_A', '$SLUG', 'barber', 'Centro', array['display_name', 'booking_link'], now());
insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
values ('$TENANT_A', 'simulated', '+5511900000000', '+5511900000000', 'active', now());
SQL
CUSTOMERS_BEFORE=$(psql -qXtA -c "select count(*) from public.customers")

# 1 · 20 visitantes, mesmo horário
for i in $(seq 1 20); do
  ask "disputa-link-$(printf '%06d' "$i")" 0 "10:00" "+55119100000$(printf '%02d' "$i")" >"$TMP/dispute.$i" 2>&1 &
done
wait
check "20 pedidos simultâneos seguram 1 horário" "$(psql -qXtA -c "select count(*) from public.bookings
  where starts_at = $(at 0 10:00) and blocks_capacity and source = 'public_link'")" 1
check "19 recebem SLOT_CONFLICT" "$(cat "$TMP"/dispute.* | grep -c 'SLOT_CONFLICT' || true)" 19
check "a reserva é provisória, sem preço e sem cliente" "$(psql -qXtA -c "select status || ':' || coalesce(agreed_price_cents::text, '-')
  || ':' || coalesce(customer_id::text, '-') from public.bookings where starts_at = $(at 0 10:00)")" "held:-:-"

# 2 · mesmo pedido repetido
for i in $(seq 1 10); do
  ask "mesmo-pedido-link-01" 0 "11:00" "+5511920000001" >"$TMP/same.$i" 2>&1 &
done
wait
check "mesma chave concorrente cria 1 pedido" "$(psql -qXtA -c "select count(*) from public.public_booking_requests q
  join public.bookings b on b.id = q.booking_id where b.starts_at = $(at 0 11:00)")" 1
check "10 respostas idênticas" "$(cat "$TMP"/same.* | grep status_code | sort -u | wc -l | tr -d ' ')" 1
check "nenhuma das 10 falhou" "$(cat "$TMP"/same.* | grep -c 'ERROR' || true)" 0
check "a resposta não traz o código nem o telefone" "$(cat "$TMP"/same.1 | grep -cE '"code"|5511920000001' || true)" 0
check "mesma chave com outro horário → IDEMPOTENCY_MISMATCH" \
  "$(ask "mesmo-pedido-link-01" 0 "12:00" "+5511920000001" f 2>&1 | grep -c 'IDEMPOTENCY_MISMATCH' || true)" 1

# 3 · confirmações simultâneas com o código certo
REQ=$(request_of 0 10:00)
CODE=$(code_of "$REQ")
for i in $(seq 1 5); do confirm "$REQ" "$CODE" >"$TMP/conf.$i" 2>&1 & done
wait
check "a reserva foi confirmada com o preço base" "$(psql -qXtA -c "select status || ':' || agreed_price_cents
  from public.bookings where starts_at = $(at 0 10:00) and blocks_capacity")" "confirmed:6000"
check "1 evento de confirmação" "$(psql -qXtA -c "select count(*) from public.outbox_events e
  join public.bookings b on b.id = e.aggregate_id where b.starts_at = $(at 0 10:00) and e.event_type = 'booking.confirmed.v1'")" 1
check "as 5 confirmações respondem 200" "$(cat "$TMP"/conf.* | grep -c '"status_code" *: *200' || true)" 5

# 4 · tentativas
REQ2=$(request_of 0 11:00)
CODE2=$(code_of "$REQ2")
WRONG=$(printf '%06d' $(( (10#$CODE2 + 1) % 1000000 )))
check "código de outro pedido não confirma" "$(confirm "$REQ2" "$CODE" | grep -c '"field" *: *"code"' || true)" "$([ "$CODE" = "$CODE2" ] && echo 0 || echo 1)"
for i in 1 2 3 4 5; do confirm "$REQ2" "$WRONG" >/dev/null 2>&1 || true; done
check "tentativas erradas ficam gravadas (no máximo 5)" "$(psql -qXtA -c "select attempts from public.public_booking_requests where id = '$REQ2'")" 5
check "depois de 5 tentativas, nem o código certo confirma" "$(confirm "$REQ2" "$CODE2" 2>&1 | grep -c 'POLICY_REJECTED' || true)" 1
check "o horário continua provisório" "$(psql -qXtA -c "select b.status from public.bookings b
  join public.public_booking_requests q on q.booking_id = b.id where q.id = '$REQ2'")" held

# 5 · pedido vencido
ask "pedido-vencido-link-1" 0 "14:00" "+5511930000001" >/dev/null
REQ3=$(request_of 0 14:00)
CODE3=$(code_of "$REQ3")
psql -qX -c "update public.bookings b set hold_expires_at = now() - interval '1 second' from public.public_booking_requests q
  where q.id = '$REQ3' and b.id = q.booking_id;
  update public.public_booking_requests set expires_at = now() - interval '1 second' where id = '$REQ3'" >/dev/null
check "pedido vencido não confirma" "$(confirm "$REQ3" "$CODE3" 2>&1 | grep -c 'POLICY_REJECTED' || true)" 1
check "o horário vencido volta a ficar livre" "$(ask "novo-pedido-mesmo-h-1" 0 "14:00" "+5511930000002" 2>&1 | grep -c 'status_code' || true)" 1

# 6 · limite por contato (a troca conta no limite) e CRM
ask "limite-contato-link-1" 0 "15:30" "+5511940000001" >"$TMP/limit.1" 2>&1 || true
for i in 2 3 4; do ask_replace "limite-contato-link-$i" 0 "1$((4 + i)):30" "+5511940000001" >"$TMP/limit.$i" 2>&1 || true; done
check "o 4º pedido do mesmo contato na hora é recusado, mesmo trocando" "$(grep -c 'QUOTA_EXCEEDED' "$TMP/limit.4" || true)" 1
check "trocando, o contato fica com um só pedido aguardando" "$(psql -qXtA -c "select count(*) from public.public_booking_requests
  where contact_phone_e164 = '+5511940000001' and status = 'pending'")" 1
check "o contato não vira cliente do CRM" "$(psql -qXtA -c "select count(*) from public.customers")" "$CUSTOMERS_BEFORE"
check "nem contato da caixa de entrada" "$(psql -qXtA -c "select count(*) from public.channel_contacts")" 0

# 6b · mesmo contato, dois pedidos ao mesmo tempo (horários que as seções anteriores deixam livres)
ask_slow "pendente-simult-link-1" 0 "09:00" "+5511950000001" >"$TMP/pend.1" 2>&1 &
ask_slow "pendente-simult-link-2" 0 "12:00" "+5511950000001" >"$TMP/pend.2" 2>&1 &
wait
check "sem trocar: um pedido criado e o outro recebe PENDING_REQUEST_EXISTS" "$(cat "$TMP"/pend.* | grep -c 'PENDING_REQUEST_EXISTS' || true)" 1
ask_replace "pendente-simult-link-3" 0 "13:00" "+5511950000002" >/dev/null
ask_slow "pendente-simult-link-4" 0 "15:00" "+5511950000002" true >"$TMP/pend.4" 2>&1 &
ask_slow "pendente-simult-link-5" 0 "16:00" "+5511950000002" true >"$TMP/pend.5" 2>&1 &
wait
check "trocando ao mesmo tempo: termina um só pedido ativo" "$(psql -qXtA -c "select count(*) from public.public_booking_requests q
  join public.bookings b on b.id = q.booking_id
  where q.contact_phone_e164 = '+5511950000002' and q.status = 'pending' and b.status = 'held'")" 1
check "e um só horário segurado por esse contato" "$(psql -qXtA -c "select count(*) from public.bookings b
  join public.public_booking_requests q on q.booking_id = b.id
  where q.contact_phone_e164 = '+5511950000002' and b.blocks_capacity")" 1

# 7 · despacho do código
OUT=$(psql -qXtA -c "set role service_role; select public.channel_dispatch_claim(50)")
check "o despacho leva códigos de pedidos pendentes" "$(echo "$OUT" | grep -o '"pbk:' | wc -l | tr -d ' ')" \
  "$(psql -qXtA -c "select count(*) from public.public_booking_requests where status = 'pending' and expires_at > now()")"
check "o código vai para o contato informado, com o modelo de reserva" "$(echo "$OUT" | grep -c "\"to\": \"+5511920000001\".*codigo_reserva\|codigo_reserva.*\"to\": \"+5511920000001\"" || true)" 1
check "o pedido confirmado não é reenviado" "$(echo "$OUT" | grep -c "pbk:$REQ\"" || true)" 0
psql -qXtA -c "set role service_role; select public.channel_dispatch_result('pbk:$REQ2', 'sent', 'sim-1', null)" >/dev/null
check "o resultado do envio fica no pedido" "$(psql -qXtA -c "select dispatch_status from public.public_booking_requests where id = '$REQ2'")" sent

finish "P43 concorrência"
