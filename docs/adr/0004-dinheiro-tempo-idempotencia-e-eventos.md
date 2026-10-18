# ADR-0004 · Dinheiro, tempo, idempotência e eventos

Status: aceita · 2026-10-17 · P00

## Dinheiro

- `Money = {amount_cents: int ≥ 0 ≤ MAX_SAFE_INTEGER, currency: "BRL"}`. Percentuais em basis points (0–10000). Nunca float. No banco, `bigint`/`integer` em centavos.
- Arredondamento (`round_half_up` e piso por `ceil`) é regra do P05 em `_shared/domain/pricing/`, implementada com inteiros e coberta por fixtures do doc06.
- Preço confirmado fica congelado em `agreed_price_cents` na reserva.

## Tempo

- Instantes: ISO 8601 **com offset** no contrato e `timestamptz` no banco. Intervalos são semiabertos `[início, fim)`. `TimeRange` compara instantes, não strings.
- Regras recorrentes usam horário local (`HH:MM`) + timezone IANA do tenant, validada no banco por trigger.
- Relógio determinístico das fixtures: `FIXED_NOW = 2026-10-20T12:00:00Z` (terça, 09:00 em São Paulo).

## Concorrência otimista

Toda tabela editável tem `version` (incrementada por trigger em todo UPDATE) e `updated_at`. Comandos recebem `expected_version`; divergência retorna `409 STALE_VERSION`.

## Idempotência

Escopo `(tenant_id, actor_user_id, operation, key)`, com `UNIQUE NULLS NOT DISTINCT` (worker sem actor). O módulo guarda o sha256 do corpo normalizado. `app.idempotency_claim` devolve NULL na primeira chamada e a resposta gravada na repetição; com hash diferente, `PT409 IDEMPOTENCY_MISMATCH`. Chamadas concorrentes com a mesma chave esperam a primeira transação. Claim, mutação, outbox e complete acontecem **na mesma transação**.

## Eventos (outbox)

`public.outbox_events` é gravado por `app.emit_event` na transação da mudança. Tem envelope do doc01, `status pending|processing|done|dead`, `attempts`, `next_run_at` e `leased_until`. A entrega é ao menos uma vez e o consumidor deduplica `event_id`. Um único mecanismo inicial: tabela + Cron. O dispatcher (lease com `FOR UPDATE SKIP LOCKED`, backoff, dead-letter) é **proposta do P06** em `db/proposals/P06/`.

## Auditoria

`public.audit_events` é append-only (trigger bloqueia UPDATE, DELETE e TRUNCATE). Antes e depois chegam já redigidos, sem telefone e sem texto de mensagem. O dono lê a auditoria do próprio negócio.
