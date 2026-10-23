#!/usr/bin/env bash
# P21 · Concorrência real das indicações:
#  1. Dois convites (de A e de um terceiro) aceitos pelo MESMO negócio B com uso real; 3 workers avaliam em paralelo
#     → UM benefício (o primeiro aceito), o outro bloqueado por duplicidade; um bônus de 50 na franquia.
#  2. Rodadas repetidas em paralelo não concedem de novo.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
OWNER_B=b0000000-0000-4000-8000-00000000000b
TENANT_A=10000000-0000-4000-8000-00000000000a
TENANT_B=10000000-0000-4000-8000-00000000000b
RES_B=20000000-0000-4000-8000-00000000000b
SVC_B=40000000-0000-4000-8000-0000000000b1
H=$(printf 'a%.0s' $(seq 1 64))

# Uso real em B.
psql -qX -c "insert into public.customers (tenant_id, name) select '$TENANT_B', 'Cliente ' || g from generate_series(1, 3) g;
  insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
  select '$TENANT_B', '$RES_B', (select id from public.customers where tenant_id = '$TENANT_B' limit 1), '$SVC_B',
    now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '60 minutes',
    tstzrange(now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '60 minutes', '[)'), true, 'completed', 10000, 'owner'
  from generate_series(2, 3) g" >/dev/null
# Dois convites aceitos por B: o de A (primeiro) e o de um terceiro negócio C.
psql -qX -c "insert into public.tenants (id, name, profession, timezone) values ('10000000-0000-4000-8000-00000000000c', 'C', 'barber', 'America/Sao_Paulo');
  insert into public.referrals (kind, inviter_user_id, inviter_tenant_id, invitee_name, origin, token_hash, status, expires_at, claimed_by_user_id, claimed_tenant_id, claimed_at, idem_key, request_hash)
  values ('professional_invites_peer', '$OWNER_A', '$TENANT_A', 'B', 'web', repeat('1', 64), 'claimed', now() + interval '30 days', '$OWNER_B', '$TENANT_B', now() - interval '2 days', 'conc-ref-a-0000000001', '$H'),
         ('professional_invites_peer', '$OWNER_A', '10000000-0000-4000-8000-00000000000c', 'B', 'web', repeat('2', 64), 'claimed', now() + interval '30 days', '$OWNER_B', '$TENANT_B', now() - interval '1 day', 'conc-ref-c-0000000001', '$H')" >/dev/null

for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(100)" >"$TMP/j.$w" 2>&1 &
done
wait
check "um benefício para o negócio B indicado" "$(psql -qXtA -c "select count(*) from public.referral_rewards")" 1
check "o benefício é do primeiro convite aceito (A)" "$(psql -qXtA -c "select count(*) from public.referral_rewards where tenant_id = '$TENANT_A'")" 1
check "o outro convite ficou bloqueado por duplicidade" "$(psql -qXtA -c "select count(*) from public.referral_activations where status = 'blocked' and block_reason = 'duplicate'")" 1
check "bônus de 50 na franquia de A (uma vez)" "$(psql -qXtA -c "select bonus from public.agent_quotas where tenant_id = '$TENANT_A'")" 50
check "um evento de benefício" "$(psql -qXtA -c "select count(*) from public.outbox_events where event_type = 'referral.rewarded.v1'")" 1
check "nenhum worker falhou" "$(cat "$TMP"/j.* | grep -c ERROR || true)" 0

for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(100)" >"$TMP/k.$w" 2>&1 &
done
wait
check "rodadas repetidas não concedem de novo" "$(psql -qXtA -c "select count(*) || '/' || (select bonus from public.agent_quotas where tenant_id = '$TENANT_A') from public.referral_rewards")" "1/50"

finish "P21 concorrência"
