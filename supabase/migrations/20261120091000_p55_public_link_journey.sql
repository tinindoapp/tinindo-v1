-- P55 · Jornada do link público e página do cliente (auditorias 05 e 14; decisões D20, D21 e D23).
-- 1. Corrigir o WhatsApp libera o pedido anterior da mesma sessão (p_supersedes): a pessoa não concorre consigo mesma
--    e pode pedir o mesmo horário com o número certo (05 #2).
-- 2. Pedir de novo zera as tentativas de código. O limite continua por contato e por hora (3 no negócio, 6 em toda a
--    Tinindo) e por perfil (30): no máximo 15 palpites por hora num negócio. Na 5ª tentativa errada o horário é liberado
--    e o pedido se encerra ('exhausted'); antes, o pedido ficava preso segurando o horário (05 #1).
-- 3. Estado real do envio do código (public_booking_status) e "Reenviar código" (public_booking_resend): até 2 reenvios
--    por pedido, com 30 s entre eles; reenviar não gera outro código (05 #3).
-- 4. Antes de confirmar, a resposta do pedido traz serviço, duração, preço base (o que a confirmação congela), local e
--    política (05 #5, D23).
-- 5. Atendimento a domicílio: o bairro é obrigatório no pedido e o dono o vê no contato.
-- 6. Campos opcionais do perfil (D21): endereço, "atende em domicílio", horário de funcionamento e política curta.
-- 7. D20: o cliente não tem conta. A confirmação devolve um link com token (`/reserva#t=…`) para ver a reserva e
--    avaliar o atendimento; o dono também gera esse link para atendimentos da Agenda. O token é guardado só como hash.
-- 8. Mensagens ao cliente dizem o nome do negócio (05 #8): o código da reserva leva o nome; os outros modelos ao
--    cliente ganham o marcador {{negocio}}, preenchido com o nome do negócio quando a mensagem entra na fila.
-- Depende de: P43 (pedido pelo link), P09 (perfil), P12 (canal e modelos), P24 (avaliações), P03 (agenda).

-- ---------------------------------------------------------------------------
-- Perfil: campos opcionais (D21)
-- ---------------------------------------------------------------------------

alter table public.public_profiles
  add column address text check (char_length(btrim(address)) between 3 and 160),
  add column home_service boolean not null default false,
  add column opening_hours text check (char_length(btrim(opening_hours)) between 3 and 160),
  add column cancellation_policy text check (char_length(btrim(cancellation_policy)) between 3 and 280);
comment on column public.public_profiles.address is 'Endereço do ponto, publicado como o dono escreveu (D21). NULL = sem ponto informado.';
comment on column public.public_profiles.home_service is 'Atende em domicílio: o link de reserva pede o bairro (D21).';
comment on column public.public_profiles.opening_hours is 'Horário de funcionamento em texto curto ("Seg a sex, 9h às 18h").';
comment on column public.public_profiles.cancellation_policy is 'Política de cancelamento em texto curto, mostrada antes de confirmar (D23).';

/** Detalhes públicos do perfil (D21): só o que o dono escreveu. */
create function app.network_profile_details(p public.public_profiles) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('address', p.address, 'home_service', p.home_service,
    'opening_hours', p.opening_hours, 'cancellation_policy', p.cancellation_policy)
$$;

/** Onde o atendimento acontece: endereço do ponto, domicílio ou nada informado. */
create function app.network_place(p public.public_profiles) returns jsonb
language sql stable set search_path = '' as $$
  select case
    when p.id is null then null
    when p.address is not null then jsonb_build_object('kind', 'address', 'text', p.address)
    when p.home_service then jsonb_build_object('kind', 'home')
  end
$$;

-- Última definição: 20261029034000_p09_profile_photo.sql, mais os detalhes.
create or replace function app.network_profile_json(p public.public_profiles, p_display_name text)
returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', p.slug,
    'category', p.category,
    'area', p.area,
    'public_fields', to_jsonb(p.public_fields),
    'values', jsonb_strip_nulls(jsonb_build_object(
      'display_name', case when 'display_name' = any (p.public_fields) then p_display_name end,
      'bio', case when 'bio' = any (p.public_fields) then (select c.body from public.profile_contents c where c.tenant_id = p.tenant_id) end
    )),
    'published_at', p.published_at,
    -- P24: identidade verificada pela equipe e avaliações de atendimentos verificados; nunca por convite ou benefício.
    'reputation', (select jsonb_build_object('identity_verified', (s->>'identity_verified')::boolean, 'reviews_count', (s->>'reviews_count')::int)
      from app.rep_summary(p.tenant_id) s),
    'version', p.version,
    'details', app.network_profile_details(p),
    -- Visão do dono: as chaves e o que existe por trás delas. O público recebe só o filtrado (network_public_profile).
    'media', jsonb_build_object(
      'photo_path', p.photo_path,
      'photo_alt', coalesce(p.photo_alt, 'Foto de ' || coalesce(p_display_name, (select t.name from public.tenants t where t.id = p.tenant_id))),
      'show_photo', p.show_photo,
      'show_whatsapp', p.show_whatsapp,
      'show_prices', p.show_prices,
      'whatsapp_e164', app.network_whatsapp(p.tenant_id)
    )
  )
$$;
revoke all on function app.network_profile_json(public.public_profiles, text) from public, anon;
revoke all on function app.network_profile_details(public.public_profiles) from public, anon;
revoke all on function app.network_place(public.public_profiles) from public, anon;

/** profile.details: endereço ou domicílio, horário e política. Só o dono. Texto vazio vira "não informado". */
create function public.network_profile_details_set(
  p_tenant_id uuid,
  p_address text,
  p_home_service boolean,
  p_opening_hours text,
  p_cancellation_policy text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_before public.public_profiles;
  v_row public.public_profiles;
  v_name text;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_address, ''))) <> 0 and char_length(btrim(p_address)) not between 3 and 160 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'address';
  end if;
  if char_length(btrim(coalesce(p_opening_hours, ''))) <> 0 and char_length(btrim(p_opening_hours)) not between 3 and 160 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'opening_hours';
  end if;
  if char_length(btrim(coalesce(p_cancellation_policy, ''))) <> 0 and char_length(btrim(p_cancellation_policy)) not between 3 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cancellation_policy';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, auth.uid(), 'profile.details', p_idem_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_before from public.public_profiles p where p.tenant_id = p_tenant_id for update;
  if v_before.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  update public.public_profiles p
  set address = nullif(btrim(p_address), ''), home_service = coalesce(p_home_service, false),
      opening_hours = nullif(btrim(p_opening_hours), ''), cancellation_policy = nullif(btrim(p_cancellation_policy), ''),
      version = p.version + 1
  where p.id = v_before.id
  returning * into v_row;
  select t.name into v_name from public.tenants t where t.id = p_tenant_id;
  v_body := app.network_profile_json(v_row, v_name);
  perform app.audit(p_tenant_id, 'profile.details', 'public_profile', v_row.id, p_request_id,
    jsonb_build_object('address', v_before.address is not null, 'home_service', v_before.home_service,
      'opening_hours', v_before.opening_hours is not null, 'cancellation_policy', v_before.cancellation_policy is not null),
    jsonb_build_object('address', v_row.address is not null, 'home_service', v_row.home_service,
      'opening_hours', v_row.opening_hours is not null, 'cancellation_policy', v_row.cancellation_policy is not null));
  perform app.idempotency_complete(p_tenant_id, auth.uid(), 'profile.details', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;
revoke all on function public.network_profile_details_set(uuid, text, boolean, text, text, text, text, uuid) from public, anon;
grant execute on function public.network_profile_details_set(uuid, text, boolean, text, text, text, text, uuid) to authenticated;

-- Última definição: 20261029034000_p09_profile_photo.sql, mais os detalhes (públicos por natureza depois de escritos).
create or replace function public.network_public_profile(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.public_profiles;
  v_name text;
  v_media jsonb;
begin
  select p.* into v_row
  from public.public_profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.slug = p_slug and p.published_at is not null and t.status = 'active';
  if v_row.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select t.name into v_name from public.tenants t where t.id = v_row.tenant_id;
  v_media := app.network_profile_json(v_row, v_name) -> 'media';
  return (app.network_profile_json(v_row, v_name) - 'version' - 'media') || jsonb_build_object(
    'photo', case when v_row.show_photo and v_row.photo_path is not null
      then jsonb_build_object('path', v_row.photo_path, 'alt', v_media ->> 'photo_alt') end,
    'whatsapp_e164', case when v_row.show_whatsapp then v_media ->> 'whatsapp_e164' end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Pedido pelo link: novas colunas e estados
-- ---------------------------------------------------------------------------

alter table public.public_booking_requests drop constraint public_booking_requests_status_check;
alter table public.public_booking_requests
  add constraint public_booking_requests_status_check check (status in ('pending', 'confirmed', 'replaced', 'cancelled', 'exhausted'));
alter table public.public_booking_requests
  add column neighborhood text check (char_length(btrim(neighborhood)) between 2 and 80),
  add column resends integer not null default 0 check (resends between 0 and 2),
  add column queued_at timestamptz,
  -- Token do link da reserva (D20), em claro só para devolver o mesmo token numa confirmação repetida. A tabela é
  -- backend-only, como o código. O link guarda só o hash (booking_links).
  add column booking_token text check (booking_token ~ '^[A-Za-z0-9_-]{43}$');
update public.public_booking_requests set queued_at = created_at where queued_at is null;
alter table public.public_booking_requests alter column queued_at set default now(), alter column queued_at set not null;

/** Regras do pedido pelo link, num lugar só (a tela mostra "restam N" a partir delas). */
create function app.pbk_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_attempts', 5, 'max_resends', 2, 'resend_wait_seconds', 30)
$$;
revoke all on function app.pbk_rules() from public, anon;

/** Estado do pedido para quem pediu: sem contato e sem código. */
create function app.pbk_state_json(q public.public_booking_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'request_id', q.id,
    'status', case when q.status = 'confirmed' then 'confirmed'
                   when q.status = 'pending' and q.expires_at > clock_timestamp() then 'pending'
                   else 'expired' end,
    'delivery', q.dispatch_status,
    'expires_at', app.sched_ts(q.expires_at),
    'attempts_left', greatest((app.pbk_rules()->>'max_attempts')::int - q.attempts, 0),
    'resends_left', greatest((app.pbk_rules()->>'max_resends')::int - q.resends, 0),
    'resend_available_at', app.sched_ts(q.queued_at + make_interval(secs => (app.pbk_rules()->>'resend_wait_seconds')::int)))
$$;
revoke all on function app.pbk_state_json(public.public_booking_requests) from public, anon;

/** Resposta do pedido: horário e prazo, o que será confirmado (serviço, duração, preço base), local e política. */
create or replace function app.pbk_request_json(q public.public_booking_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app.pbk_state_json(q) || jsonb_build_object(
    'slot', app.sched_range_json(tstzrange(b.starts_at, b.ends_at, '[)')),
    'service_name', s.name,
    'duration_min', s.duration_min,
    -- O preço base que a confirmação congela (mesma regra de public_booking_confirm).
    'price_cents', s.base_price_cents,
    'place', app.network_place(p),
    'policy', p.cancellation_policy)
  from public.bookings b
  join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
  left join public.public_profiles p on p.tenant_id = b.tenant_id
  where b.tenant_id = q.tenant_id and b.id = q.booking_id
$$;

/** Resposta da confirmação: o que o visitante precisa guardar, mais o link da reserva (D20). */
create or replace function app.pbk_confirmed_json(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', 'confirmed',
    'slot', app.sched_range_json(tstzrange(b.starts_at, b.ends_at, '[)')),
    'timezone', t.timezone,
    'service_name', s.name,
    'duration_min', s.duration_min,
    'price_cents', b.agreed_price_cents,
    'business_name', t.name,
    'place', app.network_place(p),
    'policy', p.cancellation_policy)
  from public.tenants t
  join public.provider_services s on s.tenant_id = t.id and s.id = b.service_id
  left join public.public_profiles p on p.tenant_id = t.id
  where t.id = b.tenant_id
$$;

/** Libera o horário de um pedido pendente (troca, correção do número ou tentativas esgotadas). Sem PII na auditoria. */
create function app.pbk_release(q public.public_booking_requests, p_status text, p_reason text, p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.bookings;
begin
  update public.bookings b set status = 'expired', blocks_capacity = false, hold_expires_at = null, status_reason = p_reason
  where b.tenant_id = q.tenant_id and b.id = q.booking_id and b.status = 'held'
  returning * into v_old;
  update public.public_booking_requests x set status = p_status, expires_at = least(x.expires_at, clock_timestamp()) where x.id = q.id;
  if v_old.id is not null then
    perform app.emit_event(q.tenant_id, 'booking.hold_released.v1', v_old.id, v_old.version,
      coalesce(p_request_id, gen_random_uuid()), jsonb_build_object('booking_id', v_old.id, 'reason', p_reason));
  end if;
  perform app.audit(q.tenant_id, 'public.release', 'public_booking_request', q.id, p_request_id, null,
    jsonb_build_object('booking_id', q.booking_id, 'status', p_status));
end $$;
revoke all on function app.pbk_release(public.public_booking_requests, text, text, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Pedido: corrigir o número, zerar tentativas, bairro em domicílio
-- ---------------------------------------------------------------------------

drop function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid, boolean);

create function public.public_booking_request(
  p_slug text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_contact_name text,
  p_contact_phone text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null,
  p_replace_existing boolean default false,
  p_supersedes uuid default null,
  p_neighborhood text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.pbk_tenant(p_slug);
  v_profile public.public_profiles;
  v_res uuid;
  v_svc public.provider_services;
  v_conn public.channel_connections;
  v_prev public.public_booking_requests;
  v_pending public.public_booking_requests;
  v_own public.public_booking_requests;
  v_customer uuid;
  v_name text := btrim(p_contact_name);
  v_hood text := nullif(btrim(p_neighborhood), '');
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
  select * into v_profile from public.public_profiles p where p.tenant_id = v_tenant;
  -- Domicílio: o bairro é obrigatório (o profissional precisa saber para onde vai); fora disso, não é guardado.
  if v_profile.home_service then
    if v_hood is null or char_length(v_hood) not between 2 and 80 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'neighborhood';
    end if;
  else
    v_hood := null;
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

  -- Trava o recurso ANTES de olhar a chave e os pedidos pendentes (repetições e pedidos concorrentes em fila).
  perform app.sched_lock_resource(v_tenant, v_res);
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

  -- "Corrigir o número": o pedido anterior DESTA sessão (o navegador conhece o id) é liberado antes de segurar o
  -- horário de novo, para a pessoa não colidir com o próprio pedido. Id desconhecido ou que já não espera: ignorado.
  if p_supersedes is not null then
    select * into v_own from public.public_booking_requests q
    where q.id = p_supersedes and q.tenant_id = v_tenant and q.status = 'pending'
    for update;
    if v_own.id is not null then
      perform app.pbk_release(v_own, 'cancelled', 'replaced', p_request_id);
    end if;
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
      return jsonb_build_object('status_code', 409, 'error', 'PENDING_REQUEST_EXISTS', 'field', 'contact.phone_e164',
        'details', app.pbk_request_summary(v_pending));
    end if;
    perform app.pbk_release(v_pending, 'replaced', 'replaced', p_request_id);
  end if;

  if auth.uid() is not null then
    select l.customer_id into v_customer from public.customer_links l
    where l.tenant_id = v_tenant and l.user_id = auth.uid() and l.revoked_at is null;
  end if;

  v_b := app.sched_insert_booking(v_tenant, v_res, p_service_id, v_customer,
    case when v_customer is null then v_name end,
    p_starts_at, p_starts_at + make_interval(mins => v_svc.duration_min), null, 'hold', 'public_link', null, p_request_id);

  v_code := app.pbk_new_code();
  -- Pedido novo começa com 0 tentativas: o limite de força bruta vem dos pedidos por contato e por hora.
  insert into public.public_booking_requests (tenant_id, booking_id, connection_id, contact_name, contact_phone_e164,
    code, code_hash, expires_at, idem_key, request_hash, attempts, replaced_request_id, neighborhood, queued_at)
  values (v_tenant, v_b.id, v_conn.id, v_name, p_contact_phone, v_code, app.token_sha256(v_code), v_b.hold_expires_at,
    p_idem_key, p_request_hash, 0, coalesce(v_pending.id, v_own.id), v_hood, clock_timestamp())
  returning * into v_q;
  perform app.audit(v_tenant, 'public.book', 'public_booking_request', v_q.id, p_request_id, null,
    jsonb_build_object('booking_id', v_b.id, 'linked_customer', v_customer is not null,
      'replaced', v_pending.id is not null, 'corrected', v_own.id is not null));
  return jsonb_build_object('status_code', 201, 'body', app.pbk_request_json(v_q) || app.pbk_replaced_json(v_q));
end $$;

revoke all on function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid, boolean, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Link da reserva com token (D20)
-- ---------------------------------------------------------------------------

create table public.booking_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  booking_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  origin text not null check (origin in ('public_link', 'owner')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint booking_links_booking foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete restrict
);
comment on table public.booking_links is
  'Backend-only. Link com token para o cliente ver a reserva e avaliar sem conta (D20). Guarda só o sha256 do token.';
create index booking_links_booking on public.booking_links (tenant_id, booking_id);
alter table public.booking_links enable row level security;
revoke all on public.booking_links from public, anon, authenticated;
grant select, insert on public.booking_links to service_role;

/** Novo link: token de 256 bits (base64url, 43 letras), devolvido uma vez; o banco guarda só o hash. */
create function app.booking_link_new(p_tenant_id uuid, p_booking_id uuid, p_origin text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
begin
  if (select count(*) from public.booking_links l where l.tenant_id = p_tenant_id and l.booking_id = p_booking_id) >= 5 then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'booking_links';
  end if;
  insert into public.booking_links (tenant_id, booking_id, token_hash, origin)
  values (p_tenant_id, p_booking_id, app.token_sha256(v_token), p_origin);
  return v_token;
end $$;
revoke all on function app.booking_link_new(uuid, uuid, text) from public, anon, authenticated;

/** Link de um token (ou nada). Token fora do formato nem chega a ser procurado. */
create function app.booking_link_of(p_token text) returns public.booking_links
language sql stable security definer set search_path = '' as $$
  select l.* from public.booking_links l
  where p_token ~ '^[A-Za-z0-9_-]{43}$' and l.token_hash = app.token_sha256(p_token)
$$;
revoke all on function app.booking_link_of(text) from public, anon, authenticated;

/** Confirmação pelo código: código certo segura o horário, gera o link da reserva e congela o preço base. */
create or replace function public.public_booking_confirm(p_request uuid, p_code text, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.public_booking_requests;
  v_b public.bookings;
  v_token text;
  v_left integer;
begin
  select * into v_q from public.public_booking_requests q where q.id = p_request for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  -- Repetir a confirmação devolve o mesmo resultado, com o mesmo link.
  if v_q.status = 'confirmed' then
    select * into v_b from public.bookings b where b.tenant_id = v_q.tenant_id and b.id = v_q.booking_id;
    return jsonb_build_object('status_code', 200, 'body', app.pbk_confirmed_json(v_b) || jsonb_build_object('booking_token', v_q.booking_token));
  end if;
  if v_q.status = 'exhausted' or v_q.attempts >= (app.pbk_rules()->>'max_attempts')::int then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'attempts';
  end if;
  if v_q.status <> 'pending' or v_q.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  if p_code is null or app.token_sha256(btrim(p_code)) <> v_q.code_hash then
    -- Sem RAISE: a tentativa (e a liberação na última) precisa ficar gravada. O handler traduz o envelope 4xx.
    update public.public_booking_requests q set attempts = q.attempts + 1 where q.id = v_q.id returning * into v_q;
    v_left := (app.pbk_rules()->>'max_attempts')::int - v_q.attempts;
    if v_left <= 0 then
      perform app.pbk_release(v_q, 'exhausted', 'attempts', p_request_id);
      return jsonb_build_object('status_code', 422, 'error', 'POLICY_REJECTED', 'field', 'attempts');
    end if;
    return jsonb_build_object('status_code', 422, 'error', 'POLICY_REJECTED', 'field', 'code',
      'details', jsonb_build_object('attempts_left', v_left));
  end if;

  perform app.sched_lock_resource(v_q.tenant_id,
    (select b.resource_id from public.bookings b where b.tenant_id = v_q.tenant_id and b.id = v_q.booking_id));
  select * into v_b from public.bookings b where b.tenant_id = v_q.tenant_id and b.id = v_q.booking_id for update;
  if v_b.status <> 'held' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  update public.bookings b
  set status = 'confirmed', hold_expires_at = null,
      agreed_price_cents = (select s.base_price_cents from public.provider_services s
                            where s.tenant_id = b.tenant_id and s.id = b.service_id)
  where b.tenant_id = v_b.tenant_id and b.id = v_b.id
  returning * into v_b;
  v_token := app.booking_link_new(v_b.tenant_id, v_b.id, 'public_link');
  update public.public_booking_requests q set status = 'confirmed', confirmed_at = clock_timestamp(), booking_token = v_token
  where q.id = v_q.id;

  perform app.emit_event(v_b.tenant_id, 'booking.confirmed.v1', v_b.id, v_b.version,
    coalesce(p_request_id, gen_random_uuid()), app.sched_event_payload(v_b));
  perform app.audit(v_b.tenant_id, 'public.confirm', 'booking', v_b.id, p_request_id, null, app.sched_booking_audit(v_b));
  return jsonb_build_object('status_code', 200, 'body', app.pbk_confirmed_json(v_b) || jsonb_build_object('booking_token', v_token));
end $$;

-- ---------------------------------------------------------------------------
-- Estado do envio e reenvio do código
-- ---------------------------------------------------------------------------

create function public.public_booking_status(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q public.public_booking_requests;
begin
  select * into v_q from public.public_booking_requests q where q.id = p_request;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return app.pbk_state_json(v_q);
end $$;

create function public.public_booking_resend(p_request uuid, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.public_booking_requests;
begin
  select * into v_q from public.public_booking_requests q where q.id = p_request for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_q.status <> 'pending' or v_q.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  if v_q.resends >= (app.pbk_rules()->>'max_resends')::int then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'resend';
  end if;
  if v_q.queued_at + make_interval(secs => (app.pbk_rules()->>'resend_wait_seconds')::int) > clock_timestamp() then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'resend_wait';
  end if;
  -- O mesmo código volta para a fila (o anterior continua valendo se chegar atrasado).
  update public.public_booking_requests q
  set dispatch_status = 'queued', resends = q.resends + 1, queued_at = clock_timestamp()
  where q.id = v_q.id returning * into v_q;
  perform app.audit(v_q.tenant_id, 'public.resend', 'public_booking_request', v_q.id, p_request_id, null,
    jsonb_build_object('resends', v_q.resends));
  return app.pbk_state_json(v_q);
end $$;

revoke all on function public.public_booking_status(uuid) from public, anon, authenticated;
revoke all on function public.public_booking_resend(uuid, uuid) from public, anon, authenticated;
grant execute on function public.public_booking_status(uuid) to anon, authenticated;
grant execute on function public.public_booking_resend(uuid, uuid) to anon, authenticated;

-- Dono: quem pediu, com o bairro quando é a domicílio.
create or replace function public.public_booking_contact(p_tenant_id uuid, p_booking_id uuid) returns jsonb
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
    'requested_at', app.sched_ts(v_q.created_at), 'status', case when v_q.status = 'confirmed' then 'confirmed' else 'pending' end,
    'neighborhood', v_q.neighborhood);
end $$;

-- ---------------------------------------------------------------------------
-- Dono gera o link da reserva (atendimentos da Agenda)
-- ---------------------------------------------------------------------------

create function public.booking_link_issue(p_tenant_id uuid, p_booking_id uuid, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_token text;
  v_slug text;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select * into v_b from public.bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_b.status in ('held', 'expired') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'booking_status';
  end if;
  v_token := app.booking_link_new(p_tenant_id, p_booking_id, 'owner');
  select p.slug into v_slug from public.public_profiles p where p.tenant_id = p_tenant_id and p.published_at is not null;
  perform app.audit(p_tenant_id, 'booking_link.issue', 'booking', p_booking_id, p_request_id, null, '{}'::jsonb);
  return jsonb_build_object('token', v_token, 'slug', v_slug);
end $$;
revoke all on function public.booking_link_issue(uuid, uuid, uuid) from public, anon;
grant execute on function public.booking_link_issue(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cliente: ver a reserva e avaliar pelo link (sem conta)
-- ---------------------------------------------------------------------------

alter table public.reviews alter column author_user_id drop not null;
alter table public.reviews add column author_link_id uuid;
alter table public.reviews add constraint reviews_author_link foreign key (tenant_id, author_link_id)
  references public.booking_links (tenant_id, id) on delete restrict;
alter table public.reviews add constraint reviews_has_author check (author_user_id is not null or author_link_id is not null);
create index reviews_author_link on public.reviews (tenant_id, author_link_id) where author_link_id is not null;

/** O que o link mostra: o negócio, o atendimento e a avaliação. Nunca nome ou telefone do cliente. */
create function app.booking_link_json(l public.booking_links) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business', jsonb_build_object(
      'name', t.name,
      'slug', case when p.published_at is not null then p.slug end,
      'whatsapp_e164', case when p.published_at is not null and p.show_whatsapp then app.network_whatsapp(t.id) end),
    'service_name', s.name,
    'slot', app.sched_range_json(tstzrange(b.starts_at, b.ends_at, '[)')),
    'timezone', t.timezone,
    'status', b.status,
    'price_cents', b.agreed_price_cents,
    'place', app.network_place(p),
    'policy', p.cancellation_policy,
    'review', jsonb_build_object(
      'window_days', (app.rep_rules()->>'window_days')::int,
      'can_review', b.status = 'completed' and r.id is null
        and b.ends_at > clock_timestamp() - make_interval(days => (app.rep_rules()->>'window_days')::int),
      'existing', case when r.id is not null and r.author_link_id is not null
        and exists (select 1 from public.booking_links x where x.id = r.author_link_id and x.booking_id = l.booking_id)
        then app.rep_public_json(r) || jsonb_build_object('status', r.status) end))
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
  left join public.public_profiles p on p.tenant_id = b.tenant_id
  left join public.reviews r on r.booking_id = b.id
  where b.tenant_id = l.tenant_id and b.id = l.booking_id
$$;
revoke all on function app.booking_link_json(public.booking_links) from public, anon, authenticated;

create function public.booking_link_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_l public.booking_links;
begin
  v_l := app.booking_link_of(p_token);
  if v_l.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return app.booking_link_json(v_l);
end $$;

/** Avaliar pelo link: mesmas regras do review_submit, com o token como prova de que é o cliente do atendimento. */
create function public.booking_link_review_submit(p_token text, p_rating integer, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.booking_links;
  b public.bookings;
  r public.reviews;
  v_service text;
begin
  v_l := app.booking_link_of(p_token);
  if v_l.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'rating'; end if;
  if p_body is not null and char_length(btrim(p_body)) not between 3 and 600 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'body'; end if;
  select * into b from public.bookings x where x.tenant_id = v_l.tenant_id and x.id = v_l.booking_id for share;
  if b.status <> 'completed' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'booking_status'; end if;
  if b.ends_at <= clock_timestamp() - make_interval(days => (app.rep_rules()->>'window_days')::int) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'window';
  end if;
  select * into r from public.reviews x where x.booking_id = b.id;
  if found then
    -- Repetição do mesmo envio pelo mesmo link: devolve o mesmo resultado.
    if r.author_link_id = v_l.id and r.rating = p_rating and r.body is not distinct from nullif(btrim(p_body), '') then
      return jsonb_build_object('review', app.rep_public_json(r) || jsonb_build_object('status', r.status, 'version', r.version));
    end if;
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'already_reviewed';
  end if;
  select s.name into v_service from public.provider_services s where s.tenant_id = b.tenant_id and s.id = b.service_id;
  begin
    insert into public.reviews (tenant_id, booking_id, author_user_id, author_link_id, rating, body, service_name, service_month)
    values (b.tenant_id, b.id, null, v_l.id, p_rating, nullif(btrim(p_body), ''), v_service, date_trunc('month', b.starts_at)::date) returning * into r;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'already_reviewed';
  end;
  perform app.audit(b.tenant_id, 'review.submit', 'review', r.id, null, null, jsonb_build_object('rating', r.rating, 'via', 'link'));
  perform app.emit_event(b.tenant_id, 'review.published.v1', r.id, 1, gen_random_uuid(), jsonb_build_object('rating', r.rating));
  return jsonb_build_object('review', app.rep_public_json(r) || jsonb_build_object('status', r.status, 'version', r.version));
end $$;

/** Retirar pelo link (definitivo, como review_withdraw): só a avaliação feita por um link deste atendimento. */
create function public.booking_link_review_withdraw(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.booking_links;
  r public.reviews;
begin
  v_l := app.booking_link_of(p_token);
  if v_l.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select x.* into r from public.reviews x
  join public.booking_links a on a.tenant_id = x.tenant_id and a.id = x.author_link_id
  where x.booking_id = v_l.booking_id and a.booking_id = v_l.booking_id
  for update of x;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if r.status = 'published' then
    update public.reviews x set status = 'withdrawn', version = x.version + 1 where x.id = r.id returning * into r;
    perform app.audit(r.tenant_id, 'review.withdraw', 'review', r.id, null, null, jsonb_build_object('via', 'link'));
  end if;
  return jsonb_build_object('review', app.rep_public_json(r) || jsonb_build_object('status', r.status, 'version', r.version));
end $$;

revoke all on function public.booking_link_view(text) from public, anon, authenticated;
revoke all on function public.booking_link_review_submit(text, integer, text) from public, anon, authenticated;
revoke all on function public.booking_link_review_withdraw(text) from public, anon, authenticated;
grant execute on function public.booking_link_view(text) to anon, authenticated;
grant execute on function public.booking_link_review_submit(text, integer, text) to anon, authenticated;
grant execute on function public.booking_link_review_withdraw(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mensagens ao cliente dizem o nome do negócio (05 #8)
-- ---------------------------------------------------------------------------

update public.channel_templates set params = 4,
  body = 'Código de {{4}}: {{3}}. Use para confirmar {{1}} em {{2}}. Vale por 15 minutos. Não passe este código para ninguém. Se não foi você, ignore esta mensagem.'
where code = 'codigo_reserva';
-- Os outros modelos ao cliente ganham {{negocio}}, preenchido na fila (gatilho abaixo). Os modelos que já recebem o
-- nome do negócio como parâmetro (reativacao, oferta_campanha) ficam como estão.
update public.channel_templates set body = 'Olá, {{1}}! {{negocio}} confirmou seu horário de {{2}} em {{3}}. Para remarcar, responda aqui. Responda SAIR para não receber mais avisos.' where code = 'confirmacao_agendamento';
update public.channel_templates set body = 'Lembrete de {{negocio}}: {{1}} em {{2}}. Se precisar remarcar, responda esta mensagem.' where code = 'lembrete_agendamento';
update public.channel_templates set body = 'Olá, {{1}}! {{negocio}} preparou seu orçamento. Veja e responda pelo link: {{2}}' where code = 'link_orcamento';
update public.channel_templates set body = 'Olá, {{1}}! Abriu um horário de {{2}} em {{3}} com {{negocio}}. Veja e aceite aqui: {{4}}' where code = 'oferta_vaga';
update public.channel_templates set body = 'Olá, {{1}}! Seu orçamento de {{2}} com {{negocio}} continua disponível até {{3}}. Se tiver dúvida, responda esta mensagem.' where code = 'lembrete_orcamento';
update public.channel_templates set body = 'Olá, {{1}}! Aqui é {{negocio}}. Ficou em aberto {{2}} de {{3}}. Se já pagou, desconsidere. Dúvidas, responda aqui.' where code = 'lembrete_cobranca';
update public.channel_templates set body = 'Olá, {{1}}! Aqui é {{negocio}}. Seu pacote de {{2}} ainda tem {{3}} e vale até {{4}}. Quer marcar? Responda esta mensagem.' where code = 'pacote_vencendo';

/** Troca {{negocio}} pelo nome do negócio da mensagem. Parâmetros são dados: o nome entra como está. */
create function app.ch_fill_business(p_body text, p_tenant_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_body like '%{{negocio}}%'
    then replace(p_body, '{{negocio}}', left(coalesce((select t.name from public.tenants t where t.id = p_tenant_id), 'seu profissional'), 120))
    else p_body end
$$;
revoke all on function app.ch_fill_business(text, uuid) from public, anon, authenticated;

create function app.ch_messages_fill_business() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := app.ch_fill_business(new.body, new.tenant_id);
  return new;
end $$;
revoke all on function app.ch_messages_fill_business() from public, anon, authenticated;
create trigger channel_messages_fill_business before insert on public.channel_messages
  for each row execute function app.ch_messages_fill_business();

-- Despacho (última definição: 20261026164500_p43_public_booking.sql), com o nome do negócio no código da reserva e
-- o reenvio (um pedido que volta para 'queued' sai de novo).
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
  for r in
    update public.public_booking_requests q set dispatch_status = 'sending'
    where q.id in (select x.id from public.public_booking_requests x
                   where x.dispatch_status = 'queued' and x.status = 'pending' and x.expires_at > clock_timestamp()
                   order by x.queued_at limit 20 for update skip locked)
    returning q.id, q.tenant_id, q.booking_id, q.connection_id, q.contact_phone_e164, q.code
  loop
    select jsonb_build_array(s.name, to_char(b.starts_at at time zone t.timezone, 'DD/MM "às" HH24:MI'), r.code, left(t.name, 120)) into v_params
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

-- A régua (P13) e os rascunhos do P45 guardam o texto já renderizado em lifecycle_steps, que o dono vê e manda à mão.
create trigger lifecycle_steps_fill_business before insert or update of body on public.lifecycle_steps
  for each row execute function app.ch_messages_fill_business();
