#!/usr/bin/env bash
# Ensaio de backup e restore de um ambiente (P58), automatizado contra o banco local: backup do banco do ambiente →
# restore num banco NOVO e isolado → as mesmas conferências do smoke no restaurado (migrations, rotinas, saúde e versão
# anotada) → contagens iguais às do original → um comando real no restaurado. Mede e anota o tempo de cada parte.
# Nunca restaura em cima do banco de origem. Em produção o backup é o do Supabase, restaurado num projeto isolado
# (release/ENSAIO-ROLLBACK.md, parte A); aqui o roteiro é o mesmo com pg_dump/pg_restore.
#
# Uso: PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres LOCAL_DB=tinindo_publicar bash release/ensaio-restore.sh
#      (o banco precisa ter passado pelo publicar.sh local). ENSAIO_LOG=<arquivo> acrescenta a linha do tempo nele.
set -euo pipefail
cd "$(dirname "$0")/.."
source release/lib/comum.sh
trap trap_erro ERR
carregar_ambiente local
ORIGEM="$LOCAL_DB_URL"
NOVO="tinindo_ensaio_restore_$$"
DESTINO="${LOCAL_DB_URL%/*}/$NOVO"
TMP=$(mktemp -d)
ADMIN="${LOCAL_DB_URL%/*}/postgres"
trap 'psql "$ADMIN" -qXc "drop database if exists $NOVO" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
exigir psql pg_dump pg_restore python3
agora() { date +%s.%N; }
seg() { python3 -c "import sys; print(f'{float(sys.argv[2]) - float(sys.argv[1]):.1f}')" "$1" "$2"; }

CONTAGEM="select json_build_object('bookings', (select count(*) from public.bookings), 'payment_entries', (select count(*) from public.payment_entries),
  'audit_events', (select count(*) from public.audit_events), 'outbox_events', (select count(*) from public.outbox_events),
  'idempotency_records', (select count(*) from public.idempotency_records), 'ops_releases', (select count(*) from public.ops_releases),
  'ops_errors', (select count(*) from public.ops_errors), 'job_ticks', (select count(*) from public.job_ticks))"

passo "1/4 · backup do banco do ambiente local"
psql "$ORIGEM" -qXtAc "select 1" >/dev/null 2>&1 || falha "o banco local não responde (rode antes o publicar.sh local)."
ANTES=$(psql "$ORIGEM" -qXtAc "$CONTAGEM")
SHA_ANOTADO=$(psql "$ORIGEM" -qXtAc "select sha from public.ops_releases order by published_at desc, id desc limit 1")
[[ -n "$SHA_ANOTADO" ]] || falha "o banco não tem versão anotada em public.ops_releases (rode o publicar.sh local)."
t0=$(agora)
pg_dump --format=custom --no-owner --file="$TMP/backup.dump" "$ORIGEM"
t1=$(agora)
msg "   ok: $(stat -c %s "$TMP/backup.dump") bytes em $(seg "$t0" "$t1")s"

passo "2/4 · restore num banco novo, isolado"
psql "$ADMIN" -qX -v ON_ERROR_STOP=1 -c "create database $NOVO" >/dev/null
psql "$DESTINO" -qX -v ON_ERROR_STOP=1 -c "alter database $NOVO set search_path = \"\$user\", public, extensions" >/dev/null
# Os papéis do Supabase já existem no servidor (shim); o backup leva schemas, tabelas, funções, políticas e dados.
pg_restore --no-owner --exit-on-error --dbname="$DESTINO" "$TMP/backup.dump"
t2=$(agora)
msg "   ok: restaurado em $(seg "$t1" "$t2")s"

passo "3/4 · conferências no restaurado"
DEPOIS=$(psql "$DESTINO" -qXtAc "$CONTAGEM")
[[ "$DEPOIS" == "$ANTES" ]] || falha "contagens diferentes: antes $ANTES, depois $DEPOIS"
msg "   ok: contagens iguais ($DEPOIS)"
SEM_RLS=$(psql "$DESTINO" -qXtAc "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")
[[ "$SEM_RLS" == 0 ]] || falha "$SEM_RLS tabela(s) públicas sem RLS no restaurado."
msg "   ok: RLS ligada em todas as tabelas públicas"
# O smoke do ambiente, apontado para o restaurado: migrations, catálogo, rotinas, saúde e versão anotada.
LOCAL_DB="$NOVO" bash release/smoke.sh local --sha "$SHA_ANOTADO" >"$TMP/smoke.log" 2>&1 || { cat "$TMP/smoke.log" >&2; falha "o smoke reprovou no banco restaurado (saída acima)."; }
msg "   ok: smoke no restaurado ($(grep -c '^   ok' "$TMP/smoke.log") itens ok, versão ${SHA_ANOTADO:0:12})"

passo "4/4 · o app volta a gravar no restaurado"
# Um comando real com o papel do app: a captura de erro (anon) grava e a saúde enxerga.
psql "$DESTINO" -qXtA -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
set local role anon;
select public.ops_error_record('front', 'render', null, '/app', null, 'EnsaioRestore', null, null);
commit;
SQL
GRAVOU=$(psql "$DESTINO" -qXtAc "select (app.ops_health_snapshot() -> 'errors' ->> 'front_total')::int >= 1")
[[ "$GRAVOU" == t ]] || falha "o restaurado não aceitou gravação."
t3=$(agora)
msg "   ok: gravação aceita e lida pela saúde"

LINHA="ensaio de restore (local) · backup $(seg "$t0" "$t1")s · restore $(seg "$t1" "$t2")s · até o app voltar $(seg "$t0" "$t3")s · $(stat -c %s "$TMP/backup.dump") bytes · versão ${SHA_ANOTADO:0:12}"
msg ""
msg "$LINHA"
[[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "- $LINHA" >>"$GITHUB_STEP_SUMMARY"
[[ -n "${ENSAIO_LOG:-}" ]] && echo "$(date -u +%Y-%m-%dT%H:%MZ) · $LINHA" >>"$ENSAIO_LOG"
msg "Restore ok. O banco de origem não foi tocado; o restaurado é apagado ao sair."
