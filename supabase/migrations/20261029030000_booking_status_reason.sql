-- Recado #64, item 1 · Booking.status_reason na visão do dono.
-- O motivo já era gravado em cancelar e em marcar falta (P03), mas sched_booking_json não o devolvia: depois de
-- recarregar, o detalhe do atendimento perdia o motivo. Agora booking.get, booking.list e as demais respostas do dono
-- trazem status_reason quando o atendimento está cancelled ou no_show; nos outros estados vem null (o motivo de uma falta
-- desfeita, por exemplo, não aparece num atendimento confirmado). Projeções do cliente e do link público não usam esta
-- função e continuam sem o motivo. Eventos e auditoria também ficam sem ele.

create or replace function app.sched_booking_json(b public.bookings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id,
    'tenant_id', b.tenant_id,
    'resource_id', b.resource_id,
    'customer_id', b.customer_id,
    'service_id', b.service_id,
    'starts_at', app.sched_ts(b.starts_at),
    'ends_at', app.sched_ts(b.ends_at),
    'status', b.status,
    'status_reason', case when b.status in ('cancelled', 'no_show') then b.status_reason end,
    'hold_expires_at', case when b.hold_expires_at is null then null else app.sched_ts(b.hold_expires_at) end,
    'price_quote_id', b.price_quote_id,
    'agreed_price_cents', b.agreed_price_cents,
    'source', b.source,
    'version', b.version
  )
$$;
