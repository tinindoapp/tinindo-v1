-- P43 · Reserva pelo link público: o visitante escolhe serviço e horário no perfil publicado, recebe um código pelo canal
-- do negócio (P12) e confirma. Antes disso, nada é reservado de verdade.
-- Invariantes (docs/02 "Reserva e concorrência", docs/04 "Cliente público e convites", ADR-0030):
-- * O pedido cria um HOLD do motor (P03) com source 'public_link', pela mesma rotina do dono (app.sched_insert_booking):
--   mesma trava do recurso e a constraint bookings_no_overlap como última barreira. Duas pessoas no mesmo horário →
--   uma reserva e SLOT_CONFLICT para a outra.
-- * Pedido repetido (clique duplo, nova tentativa) com a mesma chave devolve o MESMO pedido; mesma chave com outro
--   conteúdo → IDEMPOTENCY_MISMATCH. A checagem roda com o recurso travado, então repetições concorrentes esperam.
-- * Código de 6 dígitos ligado ao pedido (logo, ao horário). Vence com o hold; no máximo 5 tentativas. Código errado
--   conta tentativa sem RAISE (um erro desfaria a contagem), como channel_verify.
-- * Limites por hora: 30 pedidos por perfil, 3 por contato no negócio e 6 por contato em toda a Tinindo.
-- * O contato informado fica só no pedido (backend-only): não vira cliente do CRM nem contato da caixa de entrada.
--   Visitante logado com vínculo ativo (P01) reserva como o próprio cliente e vê a reserva em "Minhas reservas".
-- * Sem canal ativo no negócio não há como entregar o código: o pedido é recusado antes de segurar o horário.
-- Depende de: P03/P05 (sched_insert_booking), P09 (perfil publicado), P12 (canal e despacho), P01 (vínculo).

insert into public.channel_templates (code, category, body, params) values
  ('codigo_reserva', 'utility',
   'Seu código para confirmar {{1}} em {{2}} é {{3}}. Vale por 15 minutos. Se não foi você, ignore esta mensagem.', 3);

create table public.public_booking_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  booking_id uuid not null,
  connection_id uuid not null,
  contact_name text not null check (char_length(btrim(contact_name)) between 1 and 80),
  contact_phone_e164 text not null check (contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code text not null check (code ~ '^[0-9]{6}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 5),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  -- Mesmo prazo do hold: depois dele o código não confirma (o hold já foi liberado).
  expires_at timestamptz not null,
  dispatch_status text not null default 'queued' check (dispatch_status in ('queued', 'sending', 'sent', 'failed', 'delivery_unknown')),
  idem_key text not null check (char_length(idem_key) between 16 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint public_booking_requests_booking foreign key (tenant_id, booking_id)
    references public.bookings (tenant_id, id) on delete restrict,
  constraint public_booking_requests_connection foreign key (tenant_id, connection_id)
    references public.channel_connections (tenant_id, id) on delete restrict,
  constraint public_booking_requests_confirmed check ((status = 'confirmed') = (confirmed_at is not null)),
  unique (tenant_id, idem_key)
);
comment on table public.public_booking_requests is
  'Backend-only. Pedido do link público: contato informado e código. Sem acesso pela Data API.';
create index public_booking_requests_tenant_recent on public.public_booking_requests (tenant_id, created_at);
create index public_booking_requests_phone_recent on public.public_booking_requests (contact_phone_e164, created_at);
create index public_booking_requests_queue on public.public_booking_requests (created_at) where dispatch_status = 'queued';

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

/** Negócio de um perfil publicado que mostra o link de reserva. NULL = não aceita reserva pelo link. */
create function app.pbk_tenant(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.tenant_id
  from public.public_profiles p join public.tenants t on t.id = p.tenant_id
  where p.slug = p_slug and p.published_at is not null and t.status = 'active'
    and 'booking_link' = any (p.public_fields)
$$;

/**
 * Código de 6 dígitos com sorteio criptográfico (pgcrypto) e sem viés: descarta os valores de 32 bits acima do último
 * múltiplo de 1.000.000, para que todo código tenha a mesma chance.
 */
create function app.pbk_new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v bigint;
begin
  loop
    v := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint;
    exit when v < 4294000000;
  end loop;
  return lpad((v % 1000000)::text, 6, '0');
end $$;

/** Resposta do pedido: horário e prazo, sem contato nem código. */
create function app.pbk_request_json(q public.public_booking_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'request_id', q.id,
    'slot', app.sched_range_json(tstzrange(b.starts_at, b.ends_at, '[)')),
    'expires_at', app.sched_ts(q.expires_at),
    'delivery', q.dispatch_status)
  from public.bookings b where b.tenant_id = q.tenant_id and b.id = q.booking_id
$$;

/** Resposta da confirmação: o que o visitante precisa guardar. */
create function app.pbk_confirmed_json(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', 'confirmed',
    'slot', app.sched_range_json(tstzrange(b.starts_at, b.ends_at, '[)')),
    'timezone', t.timezone,
    'service_name', s.name)
  from public.tenants t join public.provider_services s on s.tenant_id = t.id and s.id = b.service_id
  where t.id = b.tenant_id
$$;

-- ---------------------------------------------------------------------------
-- RPCs públicas (Edge Function `network`, como anon ou com o JWT do visitante)
-- ---------------------------------------------------------------------------

/** Serviços que o visitante pode escolher. Só nome e duração: preço, piso e custos ficam fora. */
create function public.public_booking_services(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := app.pbk_tenant(p_slug);
begin
  if v_tenant is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('services', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration_min', s.duration_min) order by s.name_key, s.id)
    from (select * from public.provider_services s where s.tenant_id = v_tenant and s.active
          order by s.name_key, s.id limit 50) s), '[]'::jsonb));
end $$;

create function public.public_booking_request(
  p_slug text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_contact_name text,
  p_contact_phone text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.pbk_tenant(p_slug);
  v_res uuid;
  v_svc public.provider_services;
  v_conn public.channel_connections;
  v_prev public.public_booking_requests;
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

  -- Trava o recurso ANTES de olhar a chave: repetições concorrentes do mesmo pedido passam uma de cada vez.
  perform app.sched_lock_resource(v_tenant, v_res);
  select * into v_prev from public.public_booking_requests q where q.tenant_id = v_tenant and q.idem_key = p_idem_key;
  if found then
    if v_prev.request_hash <> p_request_hash then
      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object('status_code', 201, 'body', app.pbk_request_json(v_prev));
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
    code, code_hash, expires_at, idem_key, request_hash)
  values (v_tenant, v_b.id, v_conn.id, v_name, p_contact_phone, v_code, app.token_sha256(v_code), v_b.hold_expires_at,
    p_idem_key, p_request_hash)
  returning * into v_q;
  -- Auditoria sem nome, telefone nem código.
  perform app.audit(v_tenant, 'public.book', 'public_booking_request', v_q.id, p_request_id, null,
    jsonb_build_object('booking_id', v_b.id, 'linked_customer', v_customer is not null));
  return jsonb_build_object('status_code', 201, 'body', app.pbk_request_json(v_q));
end $$;

create function public.public_booking_confirm(p_request uuid, p_code text, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.public_booking_requests;
  v_b public.bookings;
begin
  select * into v_q from public.public_booking_requests q where q.id = p_request for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  -- Repetir a confirmação devolve o mesmo resultado (o código certo já foi aceito).
  if v_q.status = 'confirmed' then
    select * into v_b from public.bookings b where b.tenant_id = v_q.tenant_id and b.id = v_q.booking_id;
    return jsonb_build_object('status_code', 200, 'body', app.pbk_confirmed_json(v_b));
  end if;
  if v_q.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  if v_q.attempts >= 5 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'attempts';
  end if;
  if p_code is null or app.token_sha256(btrim(p_code)) <> v_q.code_hash then
    -- Sem RAISE: a tentativa precisa ficar gravada. O handler traduz o envelope 4xx.
    update public.public_booking_requests q set attempts = q.attempts + 1 where q.id = v_q.id;
    return jsonb_build_object('status_code', 422, 'error', 'POLICY_REJECTED', 'field', 'code');
  end if;

  -- O lock do recurso expira holds vencidos: depois dele, um hold vencido aparece como 'expired'.
  perform app.sched_lock_resource(v_q.tenant_id,
    (select b.resource_id from public.bookings b where b.tenant_id = v_q.tenant_id and b.id = v_q.booking_id));
  select * into v_b from public.bookings b where b.tenant_id = v_q.tenant_id and b.id = v_q.booking_id for update;
  if v_b.status <> 'held' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  update public.bookings b
  set status = 'confirmed', hold_expires_at = null,
      -- Sem cotação no link público: o preço base do serviço, congelado na confirmação (mesma regra do P03).
      agreed_price_cents = (select s.base_price_cents from public.provider_services s
                            where s.tenant_id = b.tenant_id and s.id = b.service_id)
  where b.tenant_id = v_b.tenant_id and b.id = v_b.id
  returning * into v_b;
  update public.public_booking_requests q set status = 'confirmed', confirmed_at = clock_timestamp() where q.id = v_q.id;

  perform app.emit_event(v_b.tenant_id, 'booking.confirmed.v1', v_b.id, v_b.version,
    coalesce(p_request_id, gen_random_uuid()), app.sched_event_payload(v_b));
  perform app.audit(v_b.tenant_id, 'public.confirm', 'booking', v_b.id, p_request_id, null, app.sched_booking_audit(v_b));
  return jsonb_build_object('status_code', 200, 'body', app.pbk_confirmed_json(v_b));
end $$;

-- ---------------------------------------------------------------------------
-- Dono: quem pediu pelo link (nome e WhatsApp informados), para poder falar com a pessoa
-- ---------------------------------------------------------------------------

create function public.public_booking_contact(p_tenant_id uuid, p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q public.public_booking_requests;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select * into v_q from public.public_booking_requests q
  where q.tenant_id = p_tenant_id and q.booking_id = p_booking_id
  order by q.created_at desc limit 1;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('name', v_q.contact_name, 'phone_e164', v_q.contact_phone_e164,
    'requested_at', app.sched_ts(v_q.created_at), 'status', v_q.status);
end $$;

-- ---------------------------------------------------------------------------
-- Despacho (P12 estendido): o código sai pela mesma fila e pelo mesmo provedor do canal do negócio
-- ---------------------------------------------------------------------------

create or replace function public.channel_dispatch_claim(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb := '[]';
  v_params jsonb;
  r record;
begin
  for r in
    update public.channel_messages m set status = 'sending', attempts = m.attempts + 1
    where m.id in (select x.id from public.channel_messages x where x.status = 'queued' order by x.created_at
                   limit least(greatest(coalesce(p_batch, 50), 1), 200) for update skip locked)
    returning m.id, m.tenant_id, m.contact_id, m.body, m.kind, m.template_code, m.template_params
  loop
    v_items := v_items || jsonb_build_array((select jsonb_build_object('ref', 'msg:' || r.id, 'provider', c.provider,
      'external_account_id', c.external_account_id, 'to', k.phone_e164, 'body', r.body, 'kind', r.kind,
      'template_code', r.template_code, 'template_params', r.template_params)
      from public.channel_contacts k join public.channel_connections c on c.id = k.connection_id where k.id = r.contact_id));
  end loop;
  for r in
    update public.channel_verifications v set dispatch_status = 'sending'
    where v.id in (select x.id from public.channel_verifications x where x.dispatch_status = 'queued' and x.expires_at > clock_timestamp()
                   order by x.created_at limit 20 for update skip locked)
    returning v.id, v.connection_id, v.code
  loop
    v_items := v_items || jsonb_build_array((select jsonb_build_object('ref', 'ver:' || r.id, 'provider', c.provider,
      'external_account_id', c.external_account_id, 'to', c.phone_e164, 'body', app.ch_render('verificacao_numero', jsonb_build_array(r.code)),
      'kind', 'template', 'template_code', 'verificacao_numero', 'template_params', jsonb_build_array(r.code))
      from public.channel_connections c where c.id = r.connection_id));
  end loop;
  -- P43: código da reserva pelo link público, para o contato informado no pedido.
  for r in
    update public.public_booking_requests q set dispatch_status = 'sending'
    where q.id in (select x.id from public.public_booking_requests x
                   where x.dispatch_status = 'queued' and x.status = 'pending' and x.expires_at > clock_timestamp()
                   order by x.created_at limit 20 for update skip locked)
    returning q.id, q.tenant_id, q.booking_id, q.connection_id, q.contact_phone_e164, q.code
  loop
    select jsonb_build_array(s.name, to_char(b.starts_at at time zone t.timezone, 'DD/MM "às" HH24:MI'), r.code) into v_params
    from public.bookings b
    join public.tenants t on t.id = b.tenant_id
    join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
    where b.tenant_id = r.tenant_id and b.id = r.booking_id;
    v_items := v_items || jsonb_build_array((select jsonb_build_object('ref', 'pbk:' || r.id, 'provider', c.provider,
      'external_account_id', c.external_account_id, 'to', r.contact_phone_e164,
      'body', app.ch_render('codigo_reserva', v_params),
      'kind', 'template', 'template_code', 'codigo_reserva', 'template_params', v_params)
      from public.channel_connections c where c.tenant_id = r.tenant_id and c.id = r.connection_id));
  end loop;
  return jsonb_build_object('items', v_items);
end $$;

create or replace function public.channel_dispatch_result(p_ref text, p_outcome text, p_provider_message_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_m public.channel_messages;
begin
  if p_outcome not in ('sent', 'failed', 'delivery_unknown') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'outcome';
  end if;
  v_id := split_part(p_ref, ':', 2)::uuid;
  if p_ref like 'ver:%' then
    update public.channel_verifications v set dispatch_status = p_outcome where v.id = v_id;
    return jsonb_build_object('ref', p_ref, 'status', p_outcome);
  end if;
  if p_ref like 'pbk:%' then
    update public.public_booking_requests q set dispatch_status = p_outcome where q.id = v_id;
    return jsonb_build_object('ref', p_ref, 'status', p_outcome);
  end if;
  select * into v_m from public.channel_messages m where m.id = v_id and m.status in ('sending', 'delivery_unknown') for update;
  if not found then
    return jsonb_build_object('ref', p_ref, 'status', 'ignored');
  end if;
  update public.channel_messages m
  set status = p_outcome,
      provider_message_id = coalesce(p_provider_message_id, m.provider_message_id),
      sent_at = case when p_outcome = 'sent' then clock_timestamp() else m.sent_at end,
      failed_at = case when p_outcome = 'failed' then clock_timestamp() else m.failed_at end,
      failure_reason = case when p_outcome = 'failed' then left(p_reason, 200) else m.failure_reason end,
      unknown_since = case when p_outcome = 'delivery_unknown' then coalesce(m.unknown_since, clock_timestamp()) else null end
  where m.id = v_m.id returning * into v_m;
  if p_outcome = 'failed' then
    perform app.emit_event(v_m.tenant_id, 'channel.message.failed.v1', v_m.id, v_m.version, gen_random_uuid(),
      jsonb_build_object('message_id', v_m.id, 'contact_id', v_m.contact_id, 'reason', v_m.failure_reason));
  end if;
  return jsonb_build_object('ref', p_ref, 'status', v_m.status);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function public.public_booking_services(text) from public, anon, authenticated;
revoke all on function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.public_booking_confirm(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.public_booking_contact(uuid, uuid) from public, anon;
grant execute on function public.public_booking_contact(uuid, uuid) to authenticated;
grant execute on function public.public_booking_services(text) to anon, authenticated;
grant execute on function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.public_booking_confirm(uuid, text, uuid) to anon, authenticated;
revoke all on function app.pbk_tenant(text) from public;
revoke all on function app.pbk_new_code() from public;
revoke all on function app.pbk_request_json(public.public_booking_requests) from public;
revoke all on function app.pbk_confirmed_json(public.bookings) from public;

alter table public.public_booking_requests enable row level security;
revoke all on public.public_booking_requests from anon, authenticated;
grant select, insert, update on public.public_booking_requests to service_role;
-- public_booking_requests: RLS ligada e nenhuma política para usuários.
