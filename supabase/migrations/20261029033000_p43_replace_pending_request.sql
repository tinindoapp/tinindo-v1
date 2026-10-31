-- P43 · Recado #64, item 5 · Pedido novo pelo link substitui o anterior, avisando.
-- Antes: quem corrigia o nome ou o WhatsApp depois de pedir colidia com o próprio pedido provisório e via "reservado por
-- outra pessoa". Agora:
-- * Quem já tem um pedido aguardando código no mesmo negócio, com o mesmo WhatsApp, recebe 409 PENDING_REQUEST_EXISTS
--   com o resumo do pedido anterior (serviço, início, prazo e id), e a tela pergunta se troca ou mantém.
-- * Com replace_existing = true, a MESMA transação libera o anterior e cria o novo: o hold anterior vai para 'expired'
--   com status_reason 'replaced', o pedido anterior fica 'replaced' (o código dele deixa de valer e não é mais
--   despachado) e sai booking.hold_released.v1. A resposta traz replaced: true.
-- * A troca passa pelos mesmos limites por contato e por negócio (o pedido novo conta), e o pedido novo herda as
--   tentativas de código já gastas no anterior: trocar não zera tentativas.
-- * Dois pedidos simultâneos do mesmo contato passam um de cada vez pela trava do recurso: termina um só ativo.

alter table public.public_booking_requests drop constraint public_booking_requests_status_check;
alter table public.public_booking_requests
  add constraint public_booking_requests_status_check check (status in ('pending', 'confirmed', 'replaced'));
-- Pedido que este substituiu (só para devolver o mesmo `replaced` numa repetição com a mesma chave).
alter table public.public_booking_requests add column replaced_request_id uuid references public.public_booking_requests (id);
create index public_booking_requests_pending_contact on public.public_booking_requests (tenant_id, contact_phone_e164)
  where status = 'pending';

/** O que o visitante recebe sobre um pedido pendente do mesmo WhatsApp: só o id (inútil sem o código) e o prazo.
 *  Sem serviço nem horário: quem digitar o número de outra pessoa não descobre o que ela marcou (decisão do Felipe, 31/10). */
create function app.pbk_request_summary(q public.public_booking_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('request_id', q.id, 'expires_at', app.sched_ts(q.expires_at))
$$;
revoke all on function app.pbk_request_summary(public.public_booking_requests) from public;

/** {replaced: true} quando o pedido substituiu outro; senão, objeto vazio. Sem dizer qual era o anterior. */
create function app.pbk_replaced_json(q public.public_booking_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when q.replaced_request_id is not null then jsonb_build_object('replaced', true) else '{}'::jsonb end
$$;
revoke all on function app.pbk_replaced_json(public.public_booking_requests) from public;

drop function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid);

create function public.public_booking_request(
  p_slug text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_contact_name text,
  p_contact_phone text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null,
  p_replace_existing boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.pbk_tenant(p_slug);
  v_res uuid;
  v_svc public.provider_services;
  v_conn public.channel_connections;
  v_prev public.public_booking_requests;
  v_pending public.public_booking_requests;
  v_old public.bookings;
  v_customer uuid;
  v_name text := btrim(p_contact_name);
  v_b public.bookings;
  v_code text;
  v_q public.public_booking_requests;
begin
  if v_tenant is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_idem_key is null or char_length(p_idem_key) not between 16 and 128 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'idempotency_key';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'request_hash';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'contact.name';
  end if;
  if p_contact_phone is null or p_contact_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'contact.phone_e164';
  end if;
  select * into v_svc from public.provider_services s where s.tenant_id = v_tenant and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  -- Recurso único do piloto, como scheduling_public_slots.
  select r.id into v_res from public.resources r where r.tenant_id = v_tenant and r.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  -- Trava o recurso ANTES de olhar a chave e o pedido pendente: repetições e pedidos concorrentes do mesmo contato
  -- passam um de cada vez. A trava também expira holds vencidos do recurso.
  perform app.sched_lock_resource(v_tenant, v_res);
  -- Um pedido por vez por contato neste negócio. A trava do recurso acima só serializa o mesmo profissional: com dois,
  -- pedidos simultâneos do mesmo WhatsApp não se veriam (nenhum pendente para travar) e os dois ficariam aguardando código.
  perform pg_advisory_xact_lock(hashtextextended('public_booking_contact:' || v_tenant::text || ':' || p_contact_phone, 0));

  select * into v_prev from public.public_booking_requests q where q.tenant_id = v_tenant and q.idem_key = p_idem_key;
  if found then
    if v_prev.request_hash <> p_request_hash then
      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object('status_code', 201, 'body', app.pbk_request_json(v_prev) || app.pbk_replaced_json(v_prev));
  end if;

  select * into v_conn from public.channel_connections c where c.tenant_id = v_tenant and c.status = 'active';
  if not found then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'channel';
  end if;
  if (select count(*) from public.public_booking_requests q
      where q.tenant_id = v_tenant and q.created_at > clock_timestamp() - interval '1 hour') >= 30
     or (select count(*) from public.public_booking_requests q
         where q.tenant_id = v_tenant and q.contact_phone_e164 = p_contact_phone
           and q.created_at > clock_timestamp() - interval '1 hour') >= 3
     or (select count(*) from public.public_booking_requests q
         where q.contact_phone_e164 = p_contact_phone and q.created_at > clock_timestamp() - interval '1 hour') >= 6 then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'rate_limit';
  end if;

  -- Pedido do mesmo contato ainda aguardando código neste negócio (o hold dele continua segurando o horário).
  select q.* into v_pending from public.public_booking_requests q
  join public.bookings b on b.tenant_id = q.tenant_id and b.id = q.booking_id
  where q.tenant_id = v_tenant and q.contact_phone_e164 = p_contact_phone and q.status = 'pending'
    and q.expires_at > clock_timestamp() and b.status = 'held'
  order by q.created_at desc limit 1
  for update of q;
  if v_pending.id is not null then
    if not coalesce(p_replace_existing, false) then
      -- Sem gravar nada: a tela avisa que há um pedido pendente (sem dizer qual) e pergunta se troca. O handler traduz o envelope 4xx.
      return jsonb_build_object('status_code', 409, 'error', 'PENDING_REQUEST_EXISTS', 'field', 'contact.phone_e164',
        'details', app.pbk_request_summary(v_pending));
    end if;
    update public.bookings b set status = 'expired', blocks_capacity = false, hold_expires_at = null, status_reason = 'replaced'
    where b.tenant_id = v_tenant and b.id = v_pending.booking_id
    returning * into v_old;
    update public.public_booking_requests q set status = 'replaced', expires_at = clock_timestamp() where q.id = v_pending.id;
    perform app.emit_event(v_tenant, 'booking.hold_released.v1', v_old.id, v_old.version,
      coalesce(p_request_id, gen_random_uuid()), jsonb_build_object('booking_id', v_old.id, 'reason', 'replaced'));
    perform app.audit(v_tenant, 'public.replace', 'public_booking_request', v_pending.id, p_request_id, null,
      jsonb_build_object('booking_id', v_old.id, 'status', 'replaced'));
  end if;

  -- Visitante logado com vínculo ativo neste negócio reserva como o próprio cliente; senão, só o nome informado.
  if auth.uid() is not null then
    select l.customer_id into v_customer from public.customer_links l
    where l.tenant_id = v_tenant and l.user_id = auth.uid() and l.revoked_at is null;
  end if;

  v_b := app.sched_insert_booking(v_tenant, v_res, p_service_id, v_customer,
    case when v_customer is null then v_name end,
    p_starts_at, p_starts_at + make_interval(mins => v_svc.duration_min), null, 'hold', 'public_link', null, p_request_id);

  v_code := app.pbk_new_code();
  insert into public.public_booking_requests (tenant_id, booking_id, connection_id, contact_name, contact_phone_e164,
    code, code_hash, expires_at, idem_key, request_hash, attempts, replaced_request_id)
  values (v_tenant, v_b.id, v_conn.id, v_name, p_contact_phone, v_code, app.token_sha256(v_code), v_b.hold_expires_at,
    p_idem_key, p_request_hash, coalesce(v_pending.attempts, 0), v_pending.id)
  returning * into v_q;
  -- Auditoria sem nome, telefone nem código.
  perform app.audit(v_tenant, 'public.book', 'public_booking_request', v_q.id, p_request_id, null,
    jsonb_build_object('booking_id', v_b.id, 'linked_customer', v_customer is not null, 'replaced', v_pending.id is not null));
  return jsonb_build_object('status_code', 201, 'body', app.pbk_request_json(v_q) || app.pbk_replaced_json(v_q));
end $$;

revoke all on function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid, boolean) to anon, authenticated;
