-- P06 · Lista de espera e jobs: entrada consentida, candidatos por cancelamento, oferta sequencial com
-- hold exclusivo + cotação, aceite por token (POST idempotente), expiração e worker do outbox com
-- lease, retry com backoff e dead-letter.
--
-- Regras (doc06): uma pessoa de cada vez por horário; abrir o link não reserva; aceitar confirma o hold
-- atomicamente; expiração libera o horário; o dono aprova cada oferta (sem política automática no piloto).
-- Compartilhar o link manualmente NUNCA vira "entregue": só um provedor confirmaria entrega.
-- Waitlist pede holds à agenda pelas funções do P03; não escreve em bookings por conta própria.
-- Depende de: fundação, P02, P03, P05 (cotações).

-- ---------------------------------------------------------------------------
-- Consentimento de contato (finalidade transacional: aviso de vaga)
-- ---------------------------------------------------------------------------

create table public.contact_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid not null,
  purpose text not null check (purpose in ('waitlist_offer')),
  channel text not null check (channel in ('manual_share')),
  -- No piloto o dono registra o consentimento que o cliente deu a ele (declarado, auditado).
  source text not null default 'owner_recorded' check (source in ('owner_recorded')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  recorded_by uuid,
  constraint contact_consents_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.contact_consents is 'Consentimento para contato sobre vaga. Revogar impede novas ofertas.';

-- ---------------------------------------------------------------------------
-- Entradas, candidatos e ofertas
-- ---------------------------------------------------------------------------

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid not null,
  service_id uuid not null,
  acceptable_windows jsonb not null check (jsonb_typeof(acceptable_windows) = 'array'
    and jsonb_array_length(acceptable_windows) between 1 and 14),
  consent_id uuid not null,
  status text not null default 'active' check (status in ('active', 'offered', 'fulfilled', 'withdrawn', 'expired')),
  joined_at timestamptz not null default now(),
  valid_until timestamptz not null,
  created_by uuid,
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint waitlist_entries_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint waitlist_entries_service foreign key (tenant_id, service_id)
    references public.provider_services (tenant_id, id) on delete restrict,
  constraint waitlist_entries_consent foreign key (tenant_id, consent_id)
    references public.contact_consents (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
create unique index waitlist_entries_one_open on public.waitlist_entries (tenant_id, customer_id, service_id)
  where status in ('active', 'offered');
create index waitlist_entries_queue on public.waitlist_entries (tenant_id, service_id, joined_at, id) where status = 'active';
create trigger waitlist_entries_touch before update on public.waitlist_entries
  for each row execute function app.touch_row();

/** Vaga liberada que serve a uma entrada. Gerado pelo worker a partir de booking.cancelled.v1. */
create table public.waitlist_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  entry_id uuid not null,
  slot tstzrange not null,
  source_event_id uuid,
  status text not null default 'open' check (status in ('open', 'offered', 'stale')),
  created_at timestamptz not null default now(),
  constraint waitlist_candidates_entry foreign key (tenant_id, entry_id)
    references public.waitlist_entries (tenant_id, id) on delete restrict,
  unique (tenant_id, entry_id, slot),
  unique (tenant_id, id)
);

create table public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  entry_id uuid not null,
  candidate_id uuid,
  booking_hold_id uuid not null,
  quote_id uuid not null,
  status text not null default 'offered'
    check (status in ('pending_approval', 'offered', 'accepted', 'declined', 'expired', 'invalidated')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  delivery_channel text not null default 'manual_share' check (delivery_channel in ('manual_share')),
  delivery_state text not null default 'prepared'
    check (delivery_state in ('prepared', 'share_opened', 'sent', 'delivered', 'failed', 'delivery_unknown')),
  decided_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  -- Compartilhamento manual não tem confirmação de entrega: nunca 'sent'/'delivered'.
  constraint waitlist_offers_manual_not_delivered check (
    delivery_channel <> 'manual_share' or delivery_state in ('prepared', 'share_opened')
  ),
  constraint waitlist_offers_entry foreign key (tenant_id, entry_id)
    references public.waitlist_entries (tenant_id, id) on delete restrict,
  constraint waitlist_offers_candidate foreign key (tenant_id, candidate_id)
    references public.waitlist_candidates (tenant_id, id) on delete restrict,
  constraint waitlist_offers_hold foreign key (tenant_id, booking_hold_id)
    references public.bookings (tenant_id, id) on delete restrict,
  constraint waitlist_offers_quote foreign key (tenant_id, quote_id)
    references public.price_quotes (tenant_id, id) on delete restrict,
  unique (token_hash),
  unique (tenant_id, id)
);
comment on table public.waitlist_offers is 'Oferta de vaga a uma pessoa: hold exclusivo + cotação + token (só o hash no banco).';
create unique index waitlist_offers_one_open_per_entry on public.waitlist_offers (tenant_id, entry_id)
  where status in ('pending_approval', 'offered');
create index waitlist_offers_expiry on public.waitlist_offers (expires_at) where status = 'offered';
create trigger waitlist_offers_touch before update on public.waitlist_offers
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Internas
-- ---------------------------------------------------------------------------

create function app.wl_entry_json(e public.waitlist_entries) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'tenant_id', e.tenant_id, 'customer_id', e.customer_id, 'service_id', e.service_id,
    'status', e.status, 'joined_at', app.sched_ts(e.joined_at), 'valid_until', app.sched_ts(e.valid_until),
    'acceptable_windows', e.acceptable_windows, 'version', e.version)
$$;

create function app.wl_offer_json(o public.waitlist_offers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'entry_id', o.entry_id, 'booking_hold_id', o.booking_hold_id,
    'quote_id', o.quote_id, 'status', o.status, 'expires_at', app.sched_ts(o.expires_at),
    'delivery_state', o.delivery_state, 'version', o.version)
$$;

/** O horário cabe hoje na agenda (expediente, bloqueios, reservas ativas com buffers)? Só leitura. */
create function app.wl_slot_free(p_tenant_id uuid, p_resource_id uuid, p_service_id uuid, p_starts timestamptz)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_svc public.provider_services;
  v_end timestamptz;
begin
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found or p_starts <= clock_timestamp() then
    return false;
  end if;
  v_end := p_starts + make_interval(mins => v_svc.duration_min);
  return tstzrange(p_starts, v_end, '[)') <@ app.sched_open_hours(p_tenant_id, p_resource_id, p_starts, v_end)
    and not (tstzrange(p_starts - make_interval(mins => v_svc.buffer_before_min),
                       v_end + make_interval(mins => v_svc.buffer_after_min), '[)')
             && app.sched_busy(p_tenant_id, p_resource_id, p_starts - interval '1 day', v_end + interval '1 day'));
end $$;

/**
 * Gera candidatos para uma vaga liberada: entradas ativas, válidas, com consentimento vigente, cuja
 * janela semanal contém o início e cujo serviço cabe no horário. Ordem estável por entrada (joined_at, id).
 * Idempotente: (entrada, horário) é único.
 */
create function app.wl_candidates_for(p_tenant_id uuid, p_resource_id uuid, p_starts timestamptz, p_event_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text;
  v_count integer := 0;
  r record;
begin
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id and t.status = 'active';
  if not found then return 0; end if;
  for r in
    select e.id, e.service_id, s.duration_min
    from public.waitlist_entries e
    join public.provider_services s on s.tenant_id = e.tenant_id and s.id = e.service_id and s.active
    join public.contact_consents c on c.tenant_id = e.tenant_id and c.id = e.consent_id and c.revoked_at is null
    where e.tenant_id = p_tenant_id and e.status = 'active' and e.valid_until > p_starts
      and app.price_window_matches(e.acceptable_windows, p_starts, v_tz)
    order by e.joined_at, e.id
  loop
    if app.wl_slot_free(p_tenant_id, p_resource_id, r.service_id, p_starts) then
      insert into public.waitlist_candidates (tenant_id, entry_id, slot, source_event_id)
      values (p_tenant_id, r.id, tstzrange(p_starts, p_starts + make_interval(mins => r.duration_min), '[)'), p_event_id)
      on conflict (tenant_id, entry_id, slot) do nothing;
      if found then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end $$;

/** Encerra uma oferta aberta e devolve o horário: cancela o hold (se ainda ativo) e marca o candidato. */
create function app.wl_close_offer(p_offer public.waitlist_offers, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.waitlist_offers o set status = p_status, decided_at = clock_timestamp() where o.id = p_offer.id;
  -- O hold da oferta deixa de ocupar a agenda. Não emite booking.cancelled: os próximos candidatos
  -- desse horário já estão na fila do dono (evita ciclo oferta → cancelamento → candidatos).
  update public.bookings b
  set status = case when p_status = 'expired' then 'expired' else 'cancelled' end,
      blocks_capacity = false, hold_expires_at = case when p_status = 'expired' then b.hold_expires_at end,
      status_reason = case when p_status = 'expired' then null else p_reason end
  where b.tenant_id = p_offer.tenant_id and b.id = p_offer.booking_hold_id and b.status = 'held';
  if p_offer.candidate_id is not null then
    update public.waitlist_candidates c set status = 'stale' where c.id = p_offer.candidate_id;
  end if;
  update public.waitlist_entries e set status = 'active'
  where e.tenant_id = p_offer.tenant_id and e.id = p_offer.entry_id and e.status = 'offered';
end $$;

-- ---------------------------------------------------------------------------
-- RPCs do dono
-- ---------------------------------------------------------------------------

create function public.consent_record(
  p_tenant_id uuid, p_customer_id uuid, p_purpose text, p_channel text,
  p_idem_key text, p_request_hash text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.contact_consents;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'consent.record', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  insert into public.contact_consents (tenant_id, customer_id, purpose, channel, recorded_by)
  values (p_tenant_id, p_customer_id, p_purpose, p_channel, v_uid)
  returning * into v_c;
  v_body := jsonb_build_object('consent_id', v_c.id, 'customer_id', v_c.customer_id, 'purpose', v_c.purpose,
    'channel', v_c.channel, 'granted_at', app.sched_ts(v_c.granted_at));
  perform app.audit(p_tenant_id, 'consent.record', 'contact_consent', v_c.id, p_request_id, null,
    jsonb_build_object('purpose', v_c.purpose, 'channel', v_c.channel));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'consent.record', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.consent_revoke(
  p_tenant_id uuid, p_consent_id uuid, p_idem_key text, p_request_hash text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.contact_consents;
  v_body jsonb;
  r public.waitlist_offers;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'consent.revoke', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  update public.contact_consents c set revoked_at = coalesce(c.revoked_at, clock_timestamp())
  where c.tenant_id = p_tenant_id and c.id = p_consent_id
  returning * into v_c;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  -- Sem consentimento: entradas saem da fila e ofertas abertas são invalidadas (o horário volta).
  for r in select o.* from public.waitlist_offers o join public.waitlist_entries e on e.id = o.entry_id
           where e.tenant_id = p_tenant_id and e.consent_id = p_consent_id and o.status = 'offered' for update of o loop
    perform app.wl_close_offer(r, 'invalidated', 'Consentimento revogado');
  end loop;
  update public.waitlist_entries e set status = 'withdrawn'
  where e.tenant_id = p_tenant_id and e.consent_id = p_consent_id and e.status in ('active', 'offered');
  v_body := jsonb_build_object('consent_id', v_c.id, 'revoked_at', app.sched_ts(v_c.revoked_at));
  perform app.audit(p_tenant_id, 'consent.revoke', 'contact_consent', v_c.id, p_request_id, null, null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'consent.revoke', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.waitlist_join(
  p_tenant_id uuid, p_customer_id uuid, p_service_id uuid, p_windows jsonb, p_consent_id uuid, p_valid_until timestamptz,
  p_idem_key text, p_request_hash text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_windows jsonb;
  v_e public.waitlist_entries;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'waitlist.join', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.contact_consents c
  where c.tenant_id = p_tenant_id and c.id = p_consent_id and c.customer_id = p_customer_id
    and c.purpose = 'waitlist_offer' and c.revoked_at is null;
  if not found then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'consent_id';
  end if;
  perform 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_valid_until is null or p_valid_until <= clock_timestamp() or p_valid_until > clock_timestamp() + interval '180 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'valid_until';
  end if;
  begin
    select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'local_start', to_char(w.local_start, 'HH24:MI'),
             'local_end', to_char(w.local_end, 'HH24:MI')) order by w.weekday, w.local_start)
    into v_windows from jsonb_to_recordset(p_windows) as w(weekday smallint, local_start time, local_end time);
  exception when others then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'acceptable_windows';
  end;
  if v_windows is null or jsonb_array_length(v_windows) not between 1 and 14 or exists (
       select 1 from jsonb_to_recordset(v_windows) as w(weekday smallint, local_start time, local_end time)
       where w.weekday is null or w.weekday not between 0 and 6 or w.local_end <= w.local_start) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'acceptable_windows';
  end if;
  begin
    insert into public.waitlist_entries (tenant_id, customer_id, service_id, acceptable_windows, consent_id, valid_until, created_by)
    values (p_tenant_id, p_customer_id, p_service_id, v_windows, p_consent_id, p_valid_until, v_uid)
    returning * into v_e;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'customer_id',
      detail = 'cliente já está na lista deste serviço';
  end;
  v_body := app.wl_entry_json(v_e);
  perform app.audit(p_tenant_id, 'waitlist.join', 'waitlist_entry', v_e.id, p_request_id, null,
    jsonb_build_object('service_id', p_service_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'waitlist.join', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.waitlist_withdraw(
  p_tenant_id uuid, p_entry_id uuid, p_expected_version integer, p_idem_key text, p_request_hash text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_e public.waitlist_entries;
  r public.waitlist_offers;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'waitlist.withdraw', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_e from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.id = p_entry_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_e.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_e.status not in ('active', 'offered') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  for r in select * from public.waitlist_offers o where o.tenant_id = p_tenant_id and o.entry_id = p_entry_id
           and o.status = 'offered' for update loop
    perform app.wl_close_offer(r, 'invalidated', 'Saiu da lista de espera');
  end loop;
  update public.waitlist_entries e set status = 'withdrawn' where e.id = p_entry_id returning * into v_e;
  v_body := app.wl_entry_json(v_e);
  perform app.audit(p_tenant_id, 'waitlist.withdraw', 'waitlist_entry', v_e.id, p_request_id, null, null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'waitlist.withdraw', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/**
 * Oferta aprovada pelo dono: cria o hold exclusivo pela agenda (P03) com a cotação (P05) e um token de
 * 256 bits (só o hash fica). O token aparece só nesta resposta; a repetição devolve token null.
 */
create function public.waitlist_prepare_offer(
  p_tenant_id uuid, p_entry_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_quote_id uuid,
  p_idem_key text, p_request_hash text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_e public.waitlist_entries;
  v_res uuid;
  v_hold public.bookings;
  v_quote public.price_quotes;
  v_token text;
  v_candidate uuid;
  v_o public.waitlist_offers;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'waitlist.prepare_offer', p_idem_key, p_request_hash);
  if v_replay is not null then
    -- O token não é guardado: a repetição confirma a oferta, mas não reexibe o link.
    return jsonb_set(v_replay, '{body,token}', 'null'::jsonb);
  end if;
  select * into v_e from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.id = p_entry_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'entry_id';
  end if;
  if v_e.status <> 'active' or v_e.valid_until <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'entry_id';
  end if;
  perform 1 from public.contact_consents c where c.tenant_id = p_tenant_id and c.id = v_e.consent_id and c.revoked_at is null;
  if not found then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'consent_id';
  end if;
  select q.resource_id into v_res from public.price_quotes q where q.tenant_id = p_tenant_id and q.id = p_quote_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'quote_id';
  end if;

  -- Hold exclusivo pela agenda: mesmo protocolo de lock/expediente/constraint; cotação validada e consumida.
  v_hold := app.sched_insert_booking(p_tenant_id, v_res, v_e.service_id, v_e.customer_id, null, p_starts_at, p_ends_at,
    p_quote_id, 'hold', 'waitlist', null, p_request_id);
  select * into v_quote from public.price_quotes q where q.id = p_quote_id;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  select c.id into v_candidate from public.waitlist_candidates c
  where c.tenant_id = p_tenant_id and c.entry_id = p_entry_id and c.slot = tstzrange(p_starts_at, p_ends_at, '[)');
  insert into public.waitlist_offers (tenant_id, entry_id, candidate_id, booking_hold_id, quote_id, token_hash, expires_at, created_by)
  values (p_tenant_id, p_entry_id, v_candidate, v_hold.id, p_quote_id, app.token_sha256(v_token),
    -- Menor prazo entre oferta (hold) e cotação.
    least(v_hold.hold_expires_at, v_quote.expires_at), v_uid)
  returning * into v_o;
  update public.waitlist_entries e set status = 'offered' where e.id = p_entry_id;
  if v_candidate is not null then
    update public.waitlist_candidates c set status = 'offered' where c.id = v_candidate;
  end if;

  v_body := app.wl_offer_json(v_o) || jsonb_build_object('token', v_token);
  perform app.audit(p_tenant_id, 'waitlist.prepare_offer', 'waitlist_offer', v_o.id, p_request_id, null,
    jsonb_build_object('entry_id', p_entry_id, 'booking_hold_id', v_hold.id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'waitlist.prepare_offer', p_idem_key, 201,
    app.wl_offer_json(v_o) || jsonb_build_object('token', null));
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** O dono abriu o compartilhamento. Isto NÃO significa que a mensagem foi entregue. */
create function public.waitlist_mark_shared(
  p_tenant_id uuid, p_offer_id uuid, p_idem_key text, p_request_hash text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_o public.waitlist_offers;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'waitlist.mark_shared', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  update public.waitlist_offers o set delivery_state = 'share_opened'
  where o.tenant_id = p_tenant_id and o.id = p_offer_id
  returning * into v_o;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_body := app.wl_offer_json(v_o);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'waitlist.mark_shared', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.waitlist_cancel_offer(
  p_tenant_id uuid, p_offer_id uuid, p_idem_key text, p_request_hash text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_o public.waitlist_offers;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'waitlist.cancel_offer', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_o from public.waitlist_offers o where o.tenant_id = p_tenant_id and o.id = p_offer_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_o.status <> 'offered' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  perform app.wl_close_offer(v_o, 'invalidated', 'Oferta retirada pelo profissional');
  select * into v_o from public.waitlist_offers o where o.id = p_offer_id;
  v_body := app.wl_offer_json(v_o);
  perform app.audit(p_tenant_id, 'waitlist.cancel_offer', 'waitlist_offer', v_o.id, p_request_id, null, null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'waitlist.cancel_offer', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.waitlist_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(app.wl_entry_json(e) order by e.joined_at, e.id)
      from (select * from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.status in ('active', 'offered')
            order by e.joined_at, e.id limit 200) e), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'entry_id', c.entry_id,
        'slot', app.sched_range_json(c.slot), 'status', c.status) order by lower(c.slot), e.joined_at, e.id)
      from public.waitlist_candidates c join public.waitlist_entries e on e.id = c.entry_id
      where c.tenant_id = p_tenant_id and c.status = 'open' and lower(c.slot) > clock_timestamp()
        and e.status = 'active'), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(app.wl_offer_json(o) order by o.created_at desc)
      from (select * from public.waitlist_offers o where o.tenant_id = p_tenant_id
            order by o.created_at desc limit 50) o), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Link da oferta (anônimo, por token): ver não muda nada; aceitar é POST idempotente.
-- ---------------------------------------------------------------------------

create function public.waitlist_offer_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_o public.waitlist_offers;
  v_state text;
begin
  select * into v_o from public.waitlist_offers o where o.token_hash = app.token_sha256(p_token);
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_state := case when v_o.status = 'offered' and v_o.expires_at <= clock_timestamp() then 'expired' else v_o.status end;
  return (
    select jsonb_build_object('business_name', t.name, 'service_name', s.name, 'slot', app.sched_range_json(q.slot),
      'timezone', t.timezone, 'price_cents', q.final_price_cents, 'status', v_state,
      'expires_at', app.sched_ts(v_o.expires_at))
    from public.tenants t
    join public.price_quotes q on q.tenant_id = t.id and q.id = v_o.quote_id
    join public.provider_services s on s.tenant_id = t.id and s.id = q.service_id
    where t.id = v_o.tenant_id
  );
end $$;

/** Aceite: confirma o hold atomicamente. Repetir devolve a mesma reserva; dois aceites → uma reserva. */
create function public.waitlist_accept_offer(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.waitlist_offers;
  v_b public.bookings;
begin
  select * into v_o from public.waitlist_offers o where o.token_hash = app.token_sha256(p_token) for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_o.status = 'accepted' then
    select * into v_b from public.bookings b where b.id = v_o.booking_hold_id;
    return jsonb_build_object('booking', app.sched_booking_json(v_b));
  end if;
  if v_o.status <> 'offered' or v_o.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  perform app.sched_lock_resource(v_o.tenant_id, (select b.resource_id from public.bookings b where b.id = v_o.booking_hold_id));
  select * into v_b from public.bookings b where b.id = v_o.booking_hold_id for update;
  if v_b.status <> 'held' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  update public.bookings b
  set status = 'confirmed', hold_expires_at = null,
      agreed_price_cents = (select q.final_price_cents from public.price_quotes q where q.id = v_o.quote_id)
  where b.id = v_b.id
  returning * into v_b;
  update public.waitlist_offers o set status = 'accepted', decided_at = clock_timestamp() where o.id = v_o.id;
  update public.waitlist_entries e set status = 'fulfilled' where e.id = v_o.entry_id;
  update public.waitlist_candidates c set status = 'stale'
  where c.tenant_id = v_o.tenant_id and c.slot && v_b.occupied_range and c.status = 'open';
  perform app.emit_event(v_o.tenant_id, 'booking.confirmed.v1', v_b.id, v_b.version, gen_random_uuid(), app.sched_event_payload(v_b));
  perform app.audit(v_o.tenant_id, 'waitlist.accept_offer', 'waitlist_offer', v_o.id, null, null,
    jsonb_build_object('booking_id', v_b.id));
  return jsonb_build_object('booking', app.sched_booking_json(v_b));
end $$;

create function public.waitlist_decline_offer(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.waitlist_offers;
begin
  select * into v_o from public.waitlist_offers o where o.token_hash = app.token_sha256(p_token) for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_o.status = 'declined' then
    return jsonb_build_object('status', 'declined');
  end if;
  if v_o.status <> 'offered' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  perform app.wl_close_offer(v_o, 'declined', 'Cliente recusou a oferta');
  perform app.audit(v_o.tenant_id, 'waitlist.decline_offer', 'waitlist_offer', v_o.id, null, null, null);
  return jsonb_build_object('status', 'declined');
end $$;

-- ---------------------------------------------------------------------------
-- Worker: expirações e dispatcher do outbox (lease, retry com backoff, dead-letter)
-- ---------------------------------------------------------------------------

/** Ofertas vencidas: libera o horário e emite waitlist.offer.expired.v1 (uma vez por oferta). */
create function app.wl_expire_offers() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.waitlist_offers;
  v_count integer := 0;
begin
  for r in select * from public.waitlist_offers o where o.status = 'offered' and o.expires_at <= clock_timestamp()
           order by o.expires_at for update skip locked loop
    perform app.wl_close_offer(r, 'expired', 'Oferta vencida');
    perform app.emit_event(r.tenant_id, 'waitlist.offer.expired.v1', r.id, r.version + 1, gen_random_uuid(),
      jsonb_build_object('offer_id', r.id, 'entry_id', r.entry_id, 'booking_hold_id', r.booking_hold_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

/** Processa UM evento. Determinístico e idempotente: reprocessar não duplica efeito. */
create function app.jobs_handle(e public.outbox_events) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
begin
  if e.event_type = 'booking.cancelled.v1' then
    select * into v_b from public.bookings b where b.tenant_id = e.tenant_id and b.id = e.aggregate_id;
    if found and v_b.starts_at > clock_timestamp() then
      perform app.wl_candidates_for(e.tenant_id, v_b.resource_id, v_b.starts_at, e.event_id);
    end if;
  elsif e.event_type = 'waitlist.offer.expired.v1' then
    -- O horário voltou: os próximos candidatos (já gerados) seguem abertos na fila do dono.
    perform 1;
  elsif e.event_type = 'test.poison.v1' then
    raise exception 'evento de teste que sempre falha';
  end if;
  -- Demais tipos não têm consumidor no piloto: concluídos sem efeito.
end $$;

/**
 * Uma rodada do worker. Seguro com vários workers em paralelo (SKIP LOCKED) e após queda (lease vencido
 * volta à fila). Falha: tentativa + backoff exponencial; esgotou max_attempts → 'dead' (dead-letter).
 */
create function public.jobs_run(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired_holds integer;
  v_expired_offers integer;
  v_done integer := 0;
  v_failed integer := 0;
  v_dead integer := 0;
  e public.outbox_events;
begin
  v_expired_offers := app.wl_expire_offers();
  v_expired_holds := public.scheduling_expire_holds();
  for e in
    update public.outbox_events o
    set status = 'processing', leased_until = clock_timestamp() + interval '2 minutes', attempts = o.attempts + 1
    where o.event_id in (
      select x.event_id from public.outbox_events x
      where (x.status = 'pending' and x.next_run_at <= clock_timestamp())
         or (x.status = 'processing' and x.leased_until < clock_timestamp())
      order by x.next_run_at, x.occurred_at
      limit least(greatest(coalesce(p_batch, 50), 1), 500)
      for update skip locked)
    returning o.*
  loop
    begin
      perform app.jobs_handle(e);
      update public.outbox_events o set status = 'done', leased_until = null, last_error = null where o.event_id = e.event_id;
      v_done := v_done + 1;
    exception when others then
      update public.outbox_events o
      set status = case when e.attempts >= e.max_attempts then 'dead' else 'pending' end,
          leased_until = null,
          next_run_at = clock_timestamp() + make_interval(secs => least(3600, 15 * power(2, e.attempts - 1)::integer)),
          last_error = left(sqlerrm, 1000)
      where o.event_id = e.event_id;
      if e.attempts >= e.max_attempts then v_dead := v_dead + 1; else v_failed := v_failed + 1; end if;
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'retried', v_failed, 'dead', v_dead,
    'expired_offers', v_expired_offers, 'expired_holds', v_expired_holds);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.wl_entry_json(public.waitlist_entries) from public;
revoke all on function app.wl_offer_json(public.waitlist_offers) from public;
revoke all on function app.wl_slot_free(uuid, uuid, uuid, timestamptz) from public;
revoke all on function app.wl_candidates_for(uuid, uuid, timestamptz, uuid) from public;
revoke all on function app.wl_close_offer(public.waitlist_offers, text, text) from public;
revoke all on function app.wl_expire_offers() from public;
revoke all on function app.jobs_handle(public.outbox_events) from public;

revoke all on function public.consent_record(uuid, uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.consent_revoke(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.waitlist_join(uuid, uuid, uuid, jsonb, uuid, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.waitlist_withdraw(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.waitlist_prepare_offer(uuid, uuid, timestamptz, timestamptz, uuid, text, text, uuid) from public, anon;
revoke all on function public.waitlist_mark_shared(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.waitlist_cancel_offer(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.waitlist_list(uuid) from public, anon;
revoke all on function public.waitlist_offer_view(text) from public;
revoke all on function public.waitlist_accept_offer(text) from public;
revoke all on function public.waitlist_decline_offer(text) from public;
revoke all on function public.jobs_run(integer) from public, anon, authenticated;

grant execute on function public.consent_record(uuid, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.consent_revoke(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.waitlist_join(uuid, uuid, uuid, jsonb, uuid, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.waitlist_withdraw(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.waitlist_prepare_offer(uuid, uuid, timestamptz, timestamptz, uuid, text, text, uuid) to authenticated;
grant execute on function public.waitlist_mark_shared(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.waitlist_cancel_offer(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.waitlist_list(uuid) to authenticated;
grant execute on function public.waitlist_offer_view(text) to anon, authenticated;
grant execute on function public.waitlist_accept_offer(text) to anon, authenticated;
grant execute on function public.waitlist_decline_offer(text) to anon, authenticated;
grant execute on function public.jobs_run(integer) to service_role;

alter table public.contact_consents enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.waitlist_candidates enable row level security;
alter table public.waitlist_offers enable row level security;
revoke all on public.contact_consents, public.waitlist_entries, public.waitlist_candidates, public.waitlist_offers
  from anon, authenticated;
grant select on public.contact_consents, public.waitlist_entries, public.waitlist_candidates to authenticated;
-- Ofertas: sem a coluna token_hash na leitura direta.
grant select (id, tenant_id, entry_id, candidate_id, booking_hold_id, quote_id, status, expires_at, delivery_channel,
  delivery_state, decided_at, created_at, updated_at, version) on public.waitlist_offers to authenticated;
grant select, insert, update on public.contact_consents, public.waitlist_entries, public.waitlist_candidates,
  public.waitlist_offers to service_role;

create policy contact_consents_select_owner on public.contact_consents
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy waitlist_entries_select_owner on public.waitlist_entries
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy waitlist_candidates_select_owner on public.waitlist_candidates
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy waitlist_offers_select_owner on public.waitlist_offers
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
