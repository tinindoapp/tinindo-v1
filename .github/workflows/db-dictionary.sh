#!/usr/bin/env bash
# Gera docs/02_DICIONARIO.md a partir do catálogo de um banco recém-migrado (revisão de 10/11, be-banco-09): o
# dicionário escrito à mão em docs/02 tinha 28 tabelas, sete com nome que não existe no banco. Este não desatualiza:
# o CI roda com --check e falha se o arquivo versionado for diferente do banco que as migrations produzem.
# Não é um workflow; fica aqui para morar junto do CI que o chama.
# Uso: PGHOST=localhost PGUSER=postgres PGPASSWORD=… bash .github/workflows/db-dictionary.sh [--check]
# Requer: psql e um Postgres >= 15 com btree_gist, pgcrypto e pgtap (o mesmo de `npm run db:test:local`).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=docs/02_DICIONARIO.md
DB="tinindo_dict_$$"
export PGDATABASE=postgres
psql -qX -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
trap 'PGDATABASE=postgres psql -qX -c "drop database if exists $DB" >/dev/null' EXIT
export PGDATABASE="$DB"
psql -qX -v ON_ERROR_STOP=1 -c "alter database $DB set search_path = \"\$user\", public, extensions" >/dev/null
for f in scripts/db-local/supabase_shim.sql supabase/migrations/*.sql; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done

TMPF=$(mktemp)
{
  cat <<'MD'
# 02 · Dicionário do banco (gerado)

> Arquivo gerado por `.github/workflows/db-dictionary.sh` a partir do catálogo de um banco recém-migrado.
> **Não edite à mão**: mude o banco por migration e rode o script. O CI falha se este arquivo ficar diferente do banco.
> As invariantes e o porquê do modelo estão em [`02_DADOS_E_INVARIANTES.md`](02_DADOS_E_INVARIANTES.md).

Como ler: `?` depois do tipo = aceita nulo. "Leitura" = políticas de RLS (toda tabela tem RLS ligada e nenhuma política
de escrita; quem grava são as RPCs). "Só acrescenta" = gatilho que proíbe `UPDATE` e `DELETE`.

MD
  psql -qXAt -v ON_ERROR_STOP=1 <<'SQL'
select format(E'## Resumo\n\n| Item | Total |\n|---|---|\n| Tabelas em `public` | %s |\n| Com RLS ligada | %s |\n| Políticas (todas de leitura) | %s |\n| FKs | %s (%s compostas) |\n| Funções em `public` / `app` | %s / %s |\n| Rotinas periódicas (`job_ticks`) | %s |\n',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity),
  (select count(*) from pg_policies p where p.schemaname = 'public'),
  (select count(*) from pg_constraint k where k.connamespace = 'public'::regnamespace and k.contype = 'f'),
  (select count(*) from pg_constraint k where k.connamespace = 'public'::regnamespace and k.contype = 'f' and array_length(k.conkey, 1) > 1),
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace),
  (select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace),
  (select count(*) from public.job_ticks));

select E'## Rotinas periódicas\n\nUma linha por rotina em `public.job_ticks`; `public.jobs_run` roda cada uma isolada (a que falha não derruba as outras).\n\n| Rotina | Função | Fase | Ordem | Lote | Ligada |\n|---|---|---|---|---|---|\n'
  || string_agg(format('| `%s` | `%s` | %s | %s | %s | %s |', j.name, j.fn,
       case j.phase when 'before_outbox' then 'antes da fila' else 'depois da fila' end, j.position,
       case when j.takes_batch then j.batch::text else '—' end, case when j.enabled then 'sim' else 'não' end), E'\n' order by j.phase desc, j.position) || E'\n'
from public.job_ticks j;

select E'## Tabelas\n';
select format(E'### `%s`\n\n%s%s\n%s\n\n- **Chaves e unicidade:** %s\n- **Referências:** %s\n- **Leitura:** %s\n- **Só acrescenta:** %s\n',
  c.relname,
  coalesce(obj_description(c.oid, 'pg_class') || E'\n\n', ''),
  '| Coluna | Tipo |' || E'\n' || '|---|---|',
  (select string_agg(format('| `%s` | %s%s |', a.attname, format_type(a.atttypid, a.atttypmod), case when a.attnotnull then '' else ' ?' end), E'\n' order by a.attnum)
   from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
  coalesce((select string_agg(format('%s (%s)', case k.contype when 'p' then 'PK' else 'única' end,
      (select string_agg(a.attname, ', ' order by u.ord) from unnest(k.conkey) with ordinality u(attnum, ord) join pg_attribute a on a.attrelid = c.oid and a.attnum = u.attnum)),
      '; ' order by k.contype, k.conname)
    from pg_constraint k where k.conrelid = c.oid and k.contype in ('p', 'u')), '—'),
  coalesce((select string_agg(format('(%s) → `%s`%s',
      (select string_agg(a.attname, ', ' order by u.ord) from unnest(k.conkey) with ordinality u(attnum, ord) join pg_attribute a on a.attrelid = c.oid and a.attnum = u.attnum),
      k.confrelid::regclass::text,
      case k.confdeltype when 'c' then ' (cascade)' when 'n' then ' (set null)' else '' end), '; ' order by k.conname)
    from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'), '—'),
  coalesce((select string_agg(format('`%s` (%s)', p.policyname, array_to_string(p.roles, ', ')), '; ' order by p.policyname)
    from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname), 'nenhuma política (só as RPCs leem)'),
  case when exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid where t.tgrelid = c.oid and not t.tgisinternal and f.proname = 'forbid_mutation')
    then 'sim' else 'não' end)
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by c.relname;
SQL
} >"$TMPF"

if [ "${1:-}" = "--check" ]; then
  if ! diff -u "$OUT" "$TMPF" >/dev/null; then
    echo "docs/02_DICIONARIO.md está diferente do banco. Rode: bash .github/workflows/db-dictionary.sh"
    diff -u "$OUT" "$TMPF" | head -40
    rm -f "$TMPF"
    exit 1
  fi
  rm -f "$TMPF"
  echo "docs/02_DICIONARIO.md: igual ao banco"
else
  mv "$TMPF" "$OUT"
  echo "gerado: $OUT ($(wc -l <"$OUT") linhas)"
fi
