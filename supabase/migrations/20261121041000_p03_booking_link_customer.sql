-- Recado #160 (achado A11): quem reserva pelo link público fica "Sem cliente cadastrado". O dono salva a pessoa como
-- cliente no detalhe do atendimento e o atendimento passa a apontar para esse cadastro, entrando no Retorno e no
-- histórico do cliente. Só atendimento ainda sem cliente; o cliente precisa ser do mesmo negócio e estar ativo.

create function public.scheduling_booking_link_customer(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_customer_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.bookings;
  v_new public.bookings;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.link_customer', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_customer_id is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'customer_id';
  end if;

  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_old.customer_id is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'customer_id';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null
  ) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  -- customer_id e guest_ref são exclusivos (bookings_customer_or_guest): o cadastro substitui a referência do visitante.
  update public.bookings b
  set customer_id = p_customer_id, guest_ref = null
  where b.tenant_id = p_tenant_id and b.id = p_booking_id
  returning * into v_new;

  perform app.audit(p_tenant_id, 'booking.link_customer', 'booking', v_new.id, p_request_id,
    app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.link_customer', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

comment on function public.scheduling_booking_link_customer(uuid, uuid, integer, uuid, text, text, uuid) is
  'Liga um atendimento sem cliente (ex.: pedido pelo link público) a um cliente ativo do negócio. Só o dono.';

revoke all on function public.scheduling_booking_link_customer(uuid, uuid, integer, uuid, text, text, uuid) from public, anon;
grant execute on function public.scheduling_booking_link_customer(uuid, uuid, integer, uuid, text, text, uuid) to authenticated;
