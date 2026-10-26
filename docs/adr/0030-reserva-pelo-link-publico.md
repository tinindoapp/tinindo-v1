# ADR-0030 · Reserva pelo link público

Status: proposta · 2026-10-26 · sessão `gabriel-p43-a` (P43), para aceite do integrador

## Decisões

1. **Pedido não é confirmação.** `public.book` cria uma reserva provisória do motor do P03 (`app.sched_insert_booking`, modo `hold`, `source = 'public_link'`) e um código de 6 dígitos. Só `public.confirm` com o código certo confirma. Sem confirmação, o hold vence sozinho em 15 min (`app.sched_hold_minutes`) e o horário volta a ficar livre.
2. **Mesma concorrência do dono.** O pedido trava o recurso e passa pela constraint `bookings_no_overlap`. Duas pessoas no mesmo horário: uma segura, a outra recebe `SLOT_CONFLICT`. A chave de idempotência é checada com o recurso travado, então clique duplo e nova tentativa devolvem o mesmo pedido; mesma chave com outro conteúdo é `IDEMPOTENCY_MISMATCH`.
3. **Código pelo canal do negócio (P12).** O código sai pela mesma fila e pelo mesmo provedor do canal (`channel_dispatch_claim`/`channel_dispatch_result`, item `pbk:`), com o modelo `codigo_reserva` (utility). Sem canal ativo, o pedido é recusado antes de segurar horário (`POLICY_REJECTED`, campo `channel`). Fora de produção o provedor é o simulado, como no P12.
4. **Tentativas e abuso.** No máximo 5 tentativas por pedido; código errado conta sem desfazer a contagem (envelope 422, como `channel_verify`). Limites por hora: 30 pedidos por perfil, 3 por contato no negócio, 6 por contato em toda a Tinindo (`QUOTA_EXCEEDED`).
5. **Contato não vira CRM.** Nome e telefone ficam só em `public_booking_requests` (RLS ligada, nenhuma política, sem grant para `anon`/`authenticated`). O nome vai para `bookings.guest_ref`, que o dono já tem. Não cria cliente nem contato da caixa de entrada. Auditoria sem nome, telefone nem código.
6. **Vínculo vale quando houver.** Se o visitante está logado e tem vínculo ativo (P01) com o negócio, a reserva vai para o próprio cadastro (`customer_id`) e aparece em "Minhas reservas" (ADR-0029).
7. **Só perfis que mostram o link.** Serviços e pedidos exigem perfil publicado, negócio ativo e `booking_link` entre os campos públicos. `public.services` mostra nome e duração, sem preço.
8. **Preço.** Sem cotação no link: a confirmação congela o preço base do serviço, como `scheduling_booking_confirm` sem `quote_id`.

## Operações

`public.services` (consulta, POST como `public.slots`), `public.book` e `public.confirm` (comandos com `Idempotency-Key`), no módulo `network`. Nenhum evento novo: a confirmação emite `booking.confirmed.v1`.

## Fora desta decisão

- Mostrar ao dono o telefone informado no pedido (hoje ele vê o nome em `guest_ref`; o contrato `Booking` não traz esse campo).
- Preço dinâmico (P05) no link, pagamento antecipado, cancelar ou remarcar pelo visitante.
- Varredura dos pedidos vencidos: não é necessária para a correção (o hold vence no banco), só para limpeza.
