# Runbook · cinco incidentes (docs/09)

Ordem fixa em todos: **conter** (flag ou pausa) → **preservar** (não apagar nada; exportar evidência) → **avaliar afetados** → **corrigir** → **testar regressão** (teste automatizado novo) → registrar no handoff. O dono do negócio continua operando agenda e caixa pela tela quando assistente ou canal caem.

## 1 · Reserva duplicada

- Sinal: dois `bookings` com `blocks_capacity` e `occupied_range` sobrepostos no mesmo recurso. Não deveria existir: `bookings_no_overlap` é a constraint final.
- Conter: nada a desligar; verificar se a constraint continua (`\d public.bookings`).
- Avaliar: `select * from public.bookings b1 join public.bookings b2 on b1.resource_id = b2.resource_id and b1.id < b2.id and b1.occupied_range && b2.occupied_range where b1.blocks_capacity and b2.blocks_capacity`.
- Corrigir: cancelar uma pela RPC (`scheduling_booking_cancel`), nunca por `update`. Abrir bug com o SQL que gerou.
- Regressão: `tests/db-concurrency/03_scheduling.sh` e `tests/integration/11_uat_cabeleireira`.

## 2 · Mensagem indevida (oferta, orçamento ou convite enviado a quem não devia)

- Hoje a Tinindo não envia: o link é compartilhado pelo profissional. Incidente = link gerado para a pessoa errada.
- Conter: `waitlist_cancel_offer` / `sales_quote_cancel` / revogar convite: o token para de funcionar na hora.
- Avaliar: `audit_events` por `object_id` (sem PII) e `delivery_state`.
- Corrigir: nova oferta/orçamento. Não reutilizar token.
- Regressão: pgTAP 07 (ofertas) e 10 (orçamentos).

## 3 · Fila parada (outbox)

- Sinal: `select min(occurred_at), count(*) from public.outbox_events where status in ('pending','processing')` com o mais antigo > 15 min.
- Conter: nada; comandos continuam válidos sem o worker (holds vencem sob lock, aceite confere prazo no banco).
- Avaliar: `select status, count(*) from public.outbox_events group by 1`; `last_error` dos `dead`.
- Corrigir: conferir cron e `JOBS_SECRET`; rodar `jobs` manualmente (POST com o segredo). Evento `dead` com causa corrigida: `update outbox_events set status='pending', attempts=0` só com `service_role` e registro no handoff.
- Regressão: `tests/db-concurrency/07_waitlist.sh` (três workers, lease e retry).

## 4 · Provedor indisponível (banco, LLM, canal, PSP)

- Sinal: 503 `PROVIDER_UNAVAILABLE` nas funções; tela mostra erro honesto, nunca sucesso inventado.
- Conter: flag do provedor para `simulated`/desligado quando existir (P12/P14); sem LLM no piloto, o assistente é determinístico.
- Avaliar: `request_id` nos logs ponta a ponta; quantas operações falharam por rota.
- Corrigir: esperar o provedor; comandos são idempotentes, o cliente pode repetir com a mesma chave.
- Regressão: testes de handler com `rpc` que lança (`PROVIDER_UNAVAILABLE`).

## 5 · Suspeita de vazamento entre negócios

- Sinal: dado de um negócio visível em outro, ou resposta 200 onde deveria ser 403/404.
- Conter: revogar acessos delegados abertos (`service_access_revoke`), despublicar perfil se envolvido, pausar deploys.
- Avaliar: reproduzir com `tests/integration/00_seguranca.test.ts` e `13_uat_cliente_dois` no SHA de produção; listar políticas (`pg_policies`) e grants das RPCs; `audit_events` do período.
- Corrigir: migration com a política/grant certo; nunca desligar RLS para "destravar". Comunicar afetados conforme a política de privacidade.
- Regressão: pgTAP de isolamento de cada módulo + `00_seguranca`.

## Restore (OPS-01)

`npm run db:restore:drill` reproduz: dump custom → restore em banco novo → contagens, RLS, políticas, FKs → comando real → idempotência preservada, com tempo medido. Em produção o mesmo roteiro usa o backup do Supabase restaurado num projeto isolado; nunca em cima do projeto vivo.
