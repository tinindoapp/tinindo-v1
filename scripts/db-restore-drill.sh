#!/usr/bin/env bash
# OPS-01 (docs/10): ensaio de restore em ambiente isolado. Migra + semeia um banco, grava dados de cenário,
# faz dump (pg_dump custom), restaura num banco NOVO, confere integridade (contagens, FKs, RLS ligada) e mede o
# tempo. Sem Docker: usa o Postgres local, como db-test-local.sh. O CI roda isto no job de banco.
# Uso: PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres npm run db:restore:drill
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="tinindo_drill_src_$$"
DST="tinindo_drill_dst_$$"
TMP=$(mktemp -d)
export PGDATABASE=postgres
trap 'PGDATABASE=postgres psql -qX -c "drop database if exists $SRC" -c "drop database if exists $DST" >/dev/null; rm -rf "$TMP"' EXIT

psql -qX -v ON_ERROR_STOP=1 -c "create database $SRC" >/dev/null
for db in "$SRC"; do
  PGDATABASE="$db" psql -qX -v ON_ERROR_STOP=1 -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
done
for f in scripts/db-local/supabase_shim.sql supabase/migrations/*.sql supabase/seed.sql; do
  PGDATABASE="$SRC" psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

# Dados de cenário pelas RPCs (como o app faria): expediente, uma reserva e um recebível pago.
PGDATABASE="$SRC" psql -qX -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select public.scheduling_rules_save('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a',
  (select version from public.resources where id = '20000000-0000-4000-8000-00000000000a'),
  '[{"weekday":2,"local_start":"09:00","local_end":"19:00"}]', 'drill-regras-00000001', repeat('a', 64));
select public.scheduling_booking_create('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a',
  '40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', null,
  ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 8) + time '10:00') at time zone 'America/Sao_Paulo',
  ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 8) + time '10:30') at time zone 'America/Sao_Paulo',
  null, 'confirm', 'drill-reserva-0000001', repeat('b', 64));
select public.finance_record_payment('10000000-0000-4000-8000-00000000000a',
  (public.finance_receivable_create('10000000-0000-4000-8000-00000000000a', null, 'Drill', 5000, null, 'drill-recebivel-00001', repeat('c', 64))
    #>> '{body,receivable,id}')::uuid, 5000, 'pix', now(), 'drill-pagamento-00001', repeat('d', 64));
commit;
SQL

count_sql="select (select count(*) from public.bookings) || ' ' || (select count(*) from public.payment_entries) || ' ' ||
  (select count(*) from public.audit_events) || ' ' || (select count(*) from public.outbox_events) || ' ' || (select count(*) from public.idempotency_records)"
before=$(PGDATABASE="$SRC" psql -qXtA -c "$count_sql")

t0=$(date +%s.%N)
pg_dump --format=custom --no-owner --file="$TMP/tinindo.dump" "$SRC"
t1=$(date +%s.%N)
psql -qX -v ON_ERROR_STOP=1 -c "create database $DST" >/dev/null
PGDATABASE="$DST" psql -qX -v ON_ERROR_STOP=1 -c "alter database $DST set search_path = \"\$user\", public, extensions" >/dev/null
# Os papéis do Supabase já existem no servidor (shim); o dump leva schemas, tabelas, funções, políticas e dados.
pg_restore --no-owner --exit-on-error --dbname="$DST" "$TMP/tinindo.dump"
t2=$(date +%s.%N)

after=$(PGDATABASE="$DST" psql -qXtA -c "$count_sql")
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (esperado $3, obtido $2)"; fail=1; fi; }
check "contagens iguais (reservas, recebimentos, auditoria, outbox, idempotência)" "$after" "$before"
check "RLS ligada em todas as tabelas públicas" "$(PGDATABASE="$DST" psql -qXtA -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")" 0
check "políticas restauradas" "$(PGDATABASE="$DST" psql -qXtA -c "select (count(*) > 20)::text from pg_policies where schemaname = 'public'")" true
check "FKs válidas" "$(PGDATABASE="$DST" psql -qXtA -c "select count(*) from pg_constraint where contype = 'f' and not convalidated")" 0
# O app continua utilizável: um comando real no banco restaurado (reserva em outro horário).
usable=$(PGDATABASE="$DST" psql -qXtA -v ON_ERROR_STOP=1 <<'SQL' | tail -1
begin;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select public.scheduling_booking_create('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a',
  '40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', null,
  ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 8) + time '11:00') at time zone 'America/Sao_Paulo',
  ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 8) + time '11:30') at time zone 'America/Sao_Paulo',
  null, 'confirm', 'drill-reserva-0000002', repeat('e', 64)) #>> '{body,booking,status}';
commit;
SQL
)
check "app utilizável após o restore (reserva confirmada)" "$usable" confirmed
check "repetição de comando antigo responde pela idempotência restaurada" "$(PGDATABASE="$DST" psql -qXtA -v ON_ERROR_STOP=1 <<'SQL' | tail -1
begin;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select (public.finance_receivable_create('10000000-0000-4000-8000-00000000000a', null, 'Drill', 5000, null, 'drill-recebivel-00001', repeat('c', 64)) ->> 'status_code');
rollback;
SQL
)" 201

printf 'OPS-01 · dump %.1fs · restore %.1fs · tamanho %s bytes\n' "$(echo "$t1 - $t0" | bc)" "$(echo "$t2 - $t1" | bc)" "$(stat -c %s "$TMP/tinindo.dump")"
[ "$fail" -eq 0 ] && echo "Restore: ok" || { echo "Restore: FALHOU"; exit 1; }
