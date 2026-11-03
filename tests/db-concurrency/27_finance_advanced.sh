#!/usr/bin/env bash
# P31 · Concorrência real das contas a pagar (várias conexões ao mesmo tempo):
#  1. 10 pagamentos simultâneos da MESMA conta (chaves diferentes) → 1 despesa no Caixa, 1 pagamento vivo.
#  2. 10 repetições simultâneas com a MESMA chave → 1 despesa e respostas iguais.
#  3. 5 estornos simultâneos → 1 estorno no Caixa.
#  4. Pagar × cancelar a mesma conta, 5 rodadas → nunca as duas coisas.
#  5. 5 "gerar próximos meses" simultâneos da mesma série → nenhum mês duplicado.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
H=$(printf 'a%.0s' $(seq 1 64))
# Largada: as conexões esperam um advisory lock e saem juntas (sem isso, abrir conexões serializa a corrida).
WAIT="select pg_advisory_lock_shared(3131); select pg_advisory_unlock_shared(3131);"
gate() {
  psql -qXtA -c "select pg_advisory_lock(3131); select pg_sleep(1.5); select pg_advisory_unlock(3131);" >/dev/null &
  until [ "$(psql -qXtA -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 3131 and granted")" = 1 ]; do :; done
}
payable() { # $1 chave, $2 descrição
  as_user "$OWNER_A" "select public.accounts_payable_save('$TENANT_A', null, null, '$2', 10000, current_date, 'rent', null, null, false, '$1', '$H') #>> '{body,payable,id}'" | grep -E '^[0-9a-f-]{36}$'
}
ver() { psql -qXtA -c "select version from public.fin_payables where id = '$1'"; }
pay() { # $1 chave, $2 conta, $3 versão
  as_user "$OWNER_A" "$WAIT select public.accounts_payable_pay('$TENANT_A', '$2', $3, now(), '$1', '$H')"
}

# 1 · mesma conta, chaves diferentes
P=$(payable conc-fa-payable-0000001 'Aluguel corrida')
V=$(ver "$P")
gate
for i in $(seq 1 10); do pay "conc-fa-pay-race-$(printf '%05d' "$i")" "$P" "$V" >"$TMP/p.$i" 2>&1 & done
wait
check "uma despesa no Caixa" "$(psql -qXtA -c "select count(*) from public.expense_entries where description = 'Aluguel corrida'")" 1
check "um pagamento vivo" "$(psql -qXtA -c "select count(*) from public.fin_payable_payments where payable_id = '$P' and reversal_expense_id is null")" 1
# Conta conexões (arquivos), não linhas: uma recusa pode imprimir o código mais de uma vez (ERROR e CONTEXT).
check "9 conexões recusadas (já paga ou versão vista)" "$(grep -lE 'POLICY_REJECTED|STALE_VERSION' "$TMP"/p.* | wc -l | tr -d ' ')" 9
check "1 conexão aceita" "$(grep -l status_code "$TMP"/p.* | wc -l | tr -d ' ')" 1

# 2 · mesma chave
Q=$(payable conc-fa-payable-0000002 'Luz mesma chave')
V=$(ver "$Q")
gate
for i in $(seq 1 10); do pay conc-fa-same-key-00000001 "$Q" "$V" >"$TMP/k.$i" 2>&1 & done
wait
check "mesma chave: uma despesa" "$(psql -qXtA -c "select count(*) from public.expense_entries where description = 'Luz mesma chave'")" 1
check "respostas idênticas" "$(cat "$TMP"/k.* | grep status_code | sort -u | wc -l | tr -d ' ')" 1

# 3 · estornos simultâneos
V=$(ver "$P")
gate
for i in $(seq 1 5); do
  as_user "$OWNER_A" "$WAIT select public.accounts_payable_reverse('$TENANT_A', '$P', $V, 'conc-fa-reverse-0000$i', '$H')" >"$TMP/r.$i" 2>&1 &
done
wait
check "um estorno no Caixa" "$(psql -qXtA -c "select count(*) from public.expense_entries where description = 'Aluguel corrida' and reversal_of is not null")" 1
check "nenhum pagamento vivo" "$(psql -qXtA -c "select count(*) from public.fin_payable_payments where payable_id = '$P' and reversal_expense_id is null")" 0

# 4 · pagar × cancelar
for round in 1 2 3 4 5; do
  R=$(payable "conc-fa-payable-round-$round" "Rodada $round")
  V=$(ver "$R")
  gate
  pay "conc-fa-round-pay-0000$round" "$R" "$V" >"$TMP/x.$round.pay" 2>&1 &
  as_user "$OWNER_A" "$WAIT select public.accounts_payable_cancel('$TENANT_A', '$R', $V, 'conc-fa-round-can-0000$round', '$H')" >"$TMP/x.$round.can" 2>&1 &
  wait
  both=$(psql -qXtA -c "select count(*) from public.fin_payables p where p.id = '$R' and p.status = 'cancelled'
    and exists (select 1 from public.fin_payable_payments x where x.payable_id = p.id and x.reversal_expense_id is null)")
  won=$(( $(grep -c status_code "$TMP/x.$round.pay" || true) + $(grep -c status_code "$TMP/x.$round.can" || true) ))
  check "rodada $round: só uma das duas, nunca paga e cancelada" "$both/$won" "0/1"
done

# 5 · estender a série em paralelo
S=$(as_user "$OWNER_A" "select public.accounts_payable_save('$TENANT_A', null, null, 'Internet', 12000, current_date, 'utilities', null, null, true, 'conc-fa-series-00000001', '$H') #>> '{body,series,id}'" | grep -E '^[0-9a-f-]{36}$' || true)
if [ -z "$S" ]; then
  # Hoje depois do dia 28: a série começa no dia 28.
  S=$(as_user "$OWNER_A" "select public.accounts_payable_save('$TENANT_A', null, null, 'Internet', 12000, date_trunc('month', current_date)::date + 27, 'utilities', null, null, true, 'conc-fa-series-00000002', '$H') #>> '{body,series,id}'" | grep -E '^[0-9a-f-]{36}$')
fi
SV=$(psql -qXtA -c "select version from public.fin_payable_series where id = '$S'")
gate
for i in $(seq 1 5); do
  as_user "$OWNER_A" "$WAIT select public.accounts_series_update('$TENANT_A', '$S', $SV, 'extend', 'conc-fa-extend-00000$i', '$H')" >"$TMP/s.$i" 2>&1 &
done
wait
check "nenhum mês duplicado na série" "$(psql -qXtA -c "select count(*) - count(distinct due_on) from public.fin_payables where series_id = '$S'")" 0
check "24 meses gerados (12 + 12, uma extensão aceita)" "$(psql -qXtA -c "select count(*) from public.fin_payables where series_id = '$S'")" 24

finish "P31 concorrência"
