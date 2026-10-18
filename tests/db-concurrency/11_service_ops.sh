#!/usr/bin/env bash
# P15 · Concorrência real dos serviços assistidos (várias conexões ao mesmo tempo):
#  1. 10 registros simultâneos de 20 min num pedido com franquia de 120 → exatamente 120 min, 4 recusados (429).
#  2. Troca de plano simultânea (Grátis × Completo, 5 rodadas) → uma assinatura ativa, sem deadlock, franquia coerente.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
OP=d0000000-0000-4000-8000-0000000000dd
ver() { psql -qXtA -c "select v.id || ' ' || v.scope_hash from public.offering_versions v join public.platform_offerings o
  on o.id = v.offering_id where o.code = '$1' order by v.version_no desc limit 1"; }

psql -qX -c "insert into public.platform_operators (user_id, display_name) values ('$OP', 'Operadora (exemplo)')" >/dev/null
read -r SVC SVC_HASH <<<"$(ver implantacao_exemplo)"
ORDER=$(as_user "$OWNER_A" "select public.service_order_request('$TENANT_A', '$SVC', '$SVC_HASH', null, 'conc-sv-pedido-000001',
  repeat('a', 64)) #>> '{body,order,id}'" | grep -E '^[0-9a-f-]{36}$')
as_user "$OP" "select public.service_ops_assign('$TENANT_A', '$ORDER', '$OP', null, 'conc-sv-assign-000001', repeat('b', 64))" >/dev/null
as_user "$OWNER_A" "select public.service_access_grant('$TENANT_A', '$ORDER', '{catalog}', now() + interval '1 day', 'Cadastro',
  'conc-sv-grant-0000001', repeat('c', 64))" >/dev/null
as_user "$OP" "select public.service_ops_start('$TENANT_A', '$ORDER', 'conc-sv-start-0000001', repeat('d', 64))" >/dev/null

# 1 · minutos simultâneos
for i in $(seq 1 10); do
  as_user "$OP" "select public.service_ops_log_work('$TENANT_A', '$ORDER', 20, 'human', false, null,
    'conc-sv-work-$(printf '%08d' "$i")', repeat('e', 64))" >"$TMP/w.$i" 2>&1 &
done
wait
check "minutos nunca passam da franquia" "$(psql -qXtA -c "select sum(minutes) from public.work_logs where order_id = '$ORDER'")" 120
check "6 registros gravados" "$(psql -qXtA -c "select count(*) from public.work_logs where order_id = '$ORDER'")" 6
check "4 recusados por franquia" "$(cat "$TMP"/w.* | grep -c 'QUOTA_EXCEEDED' || true)" 4

# 2 · troca de plano simultânea
read -r FREE FREE_HASH <<<"$(ver free)"
read -r FOUNDER FOUNDER_HASH <<<"$(ver founder)"
# 5 rodadas: cada uma alterna os dois planos ao mesmo tempo (o deadlock KEY SHARE × FOR UPDATE aparecia aqui).
for n in 1 2 3 4 5; do
  as_user "$OWNER_A" "select public.service_plan_subscribe('$TENANT_A', '$FREE', '$FREE_HASH', 'conc-sv-plano-free-$n', repeat('f', 64))" >"$TMP/p.$n.1" 2>&1 &
  as_user "$OWNER_A" "select public.service_plan_subscribe('$TENANT_A', '$FOUNDER', '$FOUNDER_HASH', 'conc-sv-plano-fund-$n', repeat('f', 64))" >"$TMP/p.$n.2" 2>&1 &
  wait
done
check "uma assinatura ativa" "$(psql -qXtA -c "select count(*) from public.subscriptions where tenant_id = '$TENANT_A' and status = 'active'")" 1
check "nenhuma troca virou deadlock ou erro inesperado" "$(cat "$TMP"/p.* | grep ERROR | grep -vc POLICY_REJECTED || true)" 0
check "trocas substituem, não apagam" "$(psql -qXtA -c "select (count(*) >= 2)::text from public.subscriptions where tenant_id = '$TENANT_A'")" true
check "franquia = plano ativo" "$(psql -qXtA -c "select (q.monthly_limit = v.agent_questions_month)::text from public.agent_quotas q
  join public.subscriptions s on s.tenant_id = q.tenant_id and s.status = 'active'
  join public.offering_versions v on v.id = s.offering_version_id where q.tenant_id = '$TENANT_A'")" true

finish "P15 concorrência"
