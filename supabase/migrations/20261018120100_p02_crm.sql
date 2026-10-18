-- P02 · Clientes e catálogo (proposta; o integrador numera e move para supabase/migrations/).
-- Padrão da ADR-0003: tabela privada com tenant_id NOT NULL + UNIQUE (tenant_id, id) + RLS;
-- leitura por RPC/RLS de membro; escrita SÓ por RPC transacional (autoriza → idempotência →
-- mutação com versão → auditoria redigida → complete), tudo na mesma transação.
--
-- Depende de: 20261017120000_foundation.sql (app.is_member, app.idempotency_*, app.audit, app.touch_row).
-- Sem eventos de outbox: o contrato v1 (events.ts) não define eventos de CRM e não há consumidor.

-- ---------------------------------------------------------------------------
-- Normalização usada em colunas geradas e no dedupe (imutável).
-- ---------------------------------------------------------------------------

create function app.crm_name_key(p_name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'))
$$;
revoke all on function app.crm_name_key(text) from public;
grant execute on function app.crm_name_key(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Clientes: cadastro privado do negócio. Pode existir sem login (customer_links é do P01).
-- Telefone/e-mail servem para SUGERIR duplicados no mesmo tenant; nunca para merge ou autorização.
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  name_key text generated always as (app.crm_name_key(name)) stored,
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Origem DECLARADA pelo profissional (não verificada, não é atribuição de marketing).
  declared_source text check (declared_source in
    ('referral', 'instagram', 'whatsapp', 'google', 'walk_in', 'condominium', 'returning', 'other')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id)
);
comment on table public.customers is 'CRM privado do negócio. Dedupe só sugerido e só dentro do tenant.';
comment on column public.customers.declared_source is 'Origem declarada pelo profissional; dado informado, não verificado.';

create index customers_tenant_name on public.customers (tenant_id, name_key, id);
create index customers_tenant_phone on public.customers (tenant_id, phone) where phone is not null;
create index customers_tenant_email on public.customers (tenant_id, lower(email)) where email is not null;
create trigger customers_touch before update on public.customers
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Serviços do prestador (ProviderService). Arquivar = active false (histórico preservado
-- para reservas que apontam via FK composta (tenant_id, service_id) — P03).
-- ---------------------------------------------------------------------------

create table public.provider_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  name_key text generated always as (app.crm_name_key(name)) stored,
  duration_min integer not null check (duration_min between 5 and 1440),
  buffer_before_min integer not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min integer not null default 0 check (buffer_after_min between 0 and 240),
  base_price_cents bigint not null check (base_price_cents between 0 and 9007199254740991),
  min_price_cents bigint not null check (min_price_cents between 0 and 9007199254740991),
  estimated_cost_cents bigint check (estimated_cost_cents between 0 and 9007199254740991),
  fee_bps integer check (fee_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint provider_services_floor_le_base check (min_price_cents <= base_price_cents),
  unique (tenant_id, id)
);
comment on table public.provider_services is 'Catálogo do prestador: duração, buffers, preço base, piso e custos. Versionado.';
create index provider_services_tenant_name on public.provider_services (tenant_id, name_key, id);
create unique index provider_services_active_name on public.provider_services (tenant_id, name_key) where active;
create trigger provider_services_touch before update on public.provider_services
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- RLS e grants: membros leem; ninguém escreve direto (só RPC definer).
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.provider_services enable row level security;
revoke all on public.customers, public.provider_services from anon, authenticated;
grant select on public.customers, public.provider_services to authenticated;
grant select, insert, update, delete on public.customers, public.provider_services to service_role;

create policy customers_select_member on public.customers
  for select to authenticated
  using (app.is_member(tenant_id));
create policy provider_services_select_member on public.provider_services
  for select to authenticated
  using (app.is_member(tenant_id));

-- ---------------------------------------------------------------------------
-- Projeções JSON (formato dos contratos Customer / ProviderService)
-- ---------------------------------------------------------------------------

create function app.crm_customer_json(c public.customers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'tenant_id', c.tenant_id, 'name', c.name, 'phone', c.phone, 'email', c.email,
    'declared_source', c.declared_source,
    'archived_at', to_char(c.archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'version', c.version)
$$;

create function app.crm_service_json(s public.provider_services) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'tenant_id', s.tenant_id, 'name', s.name, 'duration_min', s.duration_min,
    'buffer_before_min', s.buffer_before_min, 'buffer_after_min', s.buffer_after_min,
    'base_price_cents', s.base_price_cents, 'min_price_cents', s.min_price_cents,
    'estimated_cost_cents', s.estimated_cost_cents, 'fee_bps', s.fee_bps,
    'active', s.active, 'version', s.version)
$$;

/** Resumo redigido para auditoria: sem nome, telefone ou e-mail (ADR-0004). */
create function app.crm_customer_audit(c public.customers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('version', c.version, 'has_phone', c.phone is not null,
    'has_email', c.email is not null, 'declared_source', c.declared_source,
    'archived', c.archived_at is not null)
$$;

/** Possíveis duplicados no MESMO tenant (telefone, e-mail ou nome normalizado). Nunca merge. */
create function app.crm_customer_matches(
  p_tenant_id uuid, p_exclude uuid, p_name text, p_phone text, p_email text
) returns table (customer_id uuid, reasons text[])
language sql stable set search_path = '' as $$
  select c.id,
         array_remove(array[
           case when p_phone is not null and c.phone = p_phone then 'phone' end,
           case when p_email is not null and lower(c.email) = lower(p_email) then 'email' end,
           case when c.name_key = app.crm_name_key(p_name) then 'name' end
         ], null)
  from public.customers c
  where c.tenant_id = p_tenant_id
    and c.id is distinct from p_exclude
    and ((p_phone is not null and c.phone = p_phone)
      or (p_email is not null and lower(c.email) = lower(p_email))
      or c.name_key = app.crm_name_key(p_name))
  order by (p_phone is not null and c.phone = p_phone) desc,
           (p_email is not null and lower(c.email) = lower(p_email)) desc, c.created_at, c.id
  limit 10
$$;

revoke all on function app.crm_customer_json(public.customers) from public;
revoke all on function app.crm_service_json(public.provider_services) from public;
revoke all on function app.crm_customer_audit(public.customers) from public;
revoke all on function app.crm_customer_matches(uuid, uuid, text, text, text) from public;

/** Valida campos de cliente; devolve código de motivo ou NULL. Usado no upsert e na importação. */
create function app.crm_customer_invalid(
  p_name text, p_phone text, p_email text, p_source text
) returns table (field text, reason text)
language sql immutable set search_path = '' as $$
  select f, r from (values
    ('name', case when p_name is null or char_length(btrim(p_name)) = 0 then 'NAME_REQUIRED'
                  when char_length(btrim(p_name)) > 120 then 'NAME_TOO_LONG' end),
    ('phone', case when p_phone is not null and p_phone !~ '^\+[1-9][0-9]{7,14}$' then 'PHONE_INVALID' end),
    ('email', case when p_email is not null and (char_length(p_email) > 254
                    or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then 'EMAIL_INVALID' end),
    ('declared_source', case when p_source is not null and p_source not in
      ('referral', 'instagram', 'whatsapp', 'google', 'walk_in', 'condominium', 'returning', 'other')
      then 'SOURCE_INVALID' end)
  ) v(f, r)
  where r is not null
$$;
revoke all on function app.crm_customer_invalid(text, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- customer.upsert
-- ---------------------------------------------------------------------------

create function public.crm_customer_upsert(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_expected_version integer,
  p_name text,
  p_phone text,
  p_email text,
  p_declared_source text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_uid uuid := auth.uid();
  v_old public.customers;
  v_new public.customers;
  v_bad record;
  v_status integer;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'customer.upsert', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  select * into v_bad from app.crm_customer_invalid(p_name, p_phone, p_email, p_declared_source) limit 1;
  if found then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', detail = v_bad.reason, hint = v_bad.field;
  end if;
  if (p_customer_id is null) <> (p_expected_version is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'expected_version';
  end if;

  if p_customer_id is null then
    insert into public.customers (tenant_id, name, phone, email, declared_source)
    values (p_tenant_id, btrim(p_name), p_phone, p_email, p_declared_source)
    returning * into v_new;
    v_status := 201;
  else
    select * into v_old from public.customers c
    where c.tenant_id = p_tenant_id and c.id = p_customer_id
    for update;
    if not found then
      -- Cliente de outro negócio ou inexistente: mesma resposta neutra.
      raise exception using errcode = 'PT404', message = 'NOT_FOUND';
    end if;
    if v_old.version <> p_expected_version then
      raise exception using errcode = 'PT409', message = 'STALE_VERSION';
    end if;
    update public.customers c
    set name = btrim(p_name), phone = p_phone, email = p_email, declared_source = p_declared_source
    where c.tenant_id = p_tenant_id and c.id = p_customer_id
    returning * into v_new;
    v_status := 200;
  end if;

  v_body := jsonb_build_object(
    'customer', app.crm_customer_json(v_new),
    'possible_duplicates', coalesce((
      select jsonb_agg(m.customer_id)
      from app.crm_customer_matches(p_tenant_id, v_new.id, v_new.name, v_new.phone, v_new.email) m), '[]'::jsonb));

  perform app.audit(p_tenant_id, case when v_status = 201 then 'customer.create' else 'customer.update' end,
    'customer', v_new.id, p_request_id,
    case when v_old.id is null then null else app.crm_customer_audit(v_old) end, app.crm_customer_audit(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'customer.upsert', p_idem_key, v_status, v_body);
  return jsonb_build_object('status_code', v_status, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- customer.archive (arquivar/desarquivar; nunca apaga: reservas e pagamentos referenciam)
-- ---------------------------------------------------------------------------

create function public.crm_customer_archive(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_expected_version integer,
  p_archived boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_uid uuid := auth.uid();
  v_old public.customers;
  v_new public.customers;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'customer.archive', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_archived is null or p_expected_version is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'archived';
  end if;

  select * into v_old from public.customers c
  where c.tenant_id = p_tenant_id and c.id = p_customer_id
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_old.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;

  update public.customers c
  set archived_at = case when p_archived then coalesce(c.archived_at, now()) else null end
  where c.tenant_id = p_tenant_id and c.id = p_customer_id
  returning * into v_new;

  v_body := jsonb_build_object('customer', app.crm_customer_json(v_new));
  perform app.audit(p_tenant_id, case when p_archived then 'customer.archive' else 'customer.unarchive' end,
    'customer', v_new.id, p_request_id, app.crm_customer_audit(v_old), app.crm_customer_audit(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'customer.archive', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Listagens paginadas por cursor (keyset em name_key, id). Limite 1–100.
-- ---------------------------------------------------------------------------

create function public.crm_customer_list(
  p_tenant_id uuid,
  p_query text default null,
  p_include_archived boolean default false,
  p_after_key text default null,
  p_after_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_digits text := nullif(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '');
  v_rows public.customers[];
  v_last public.customers;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if (p_after_key is null) <> (p_after_id is null) or char_length(v_q) > 120 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cursor';
  end if;

  select coalesce(array_agg(x order by x.name_key, x.id), '{}') into v_rows from (
    select c.* from public.customers c
    where c.tenant_id = p_tenant_id
      and (p_include_archived or c.archived_at is null)
      and (v_q is null
        or strpos(c.name_key, v_q) > 0
        or strpos(lower(coalesce(c.email, '')), v_q) > 0
        or (v_digits is not null and char_length(v_digits) >= 4 and strpos(coalesce(c.phone, ''), v_digits) > 0))
      and (p_after_key is null or (c.name_key, c.id) > (p_after_key, p_after_id))
    order by c.name_key, c.id
    limit v_limit + 1
  ) x;

  if cardinality(v_rows) > v_limit then
    v_rows := v_rows[1:v_limit];
    v_last := v_rows[v_limit];
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(app.crm_customer_json(r) order by r.name_key, r.id) from unnest(v_rows) r), '[]'::jsonb),
    'next', case when v_last.id is null then null
                 else jsonb_build_object('key', v_last.name_key, 'id', v_last.id) end);
end $$;

create function public.crm_service_list(
  p_tenant_id uuid,
  p_include_inactive boolean default false,
  p_after_key text default null,
  p_after_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows public.provider_services[];
  v_last public.provider_services;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if (p_after_key is null) <> (p_after_id is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cursor';
  end if;
  select coalesce(array_agg(x order by x.name_key, x.id), '{}') into v_rows from (
    select s.* from public.provider_services s
    where s.tenant_id = p_tenant_id
      and (p_include_inactive or s.active)
      and (p_after_key is null or (s.name_key, s.id) > (p_after_key, p_after_id))
    order by s.name_key, s.id
    limit v_limit + 1
  ) x;
  if cardinality(v_rows) > v_limit then
    v_rows := v_rows[1:v_limit];
    v_last := v_rows[v_limit];
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(app.crm_service_json(r) order by r.name_key, r.id) from unnest(v_rows) r), '[]'::jsonb),
    'next', case when v_last.id is null then null
                 else jsonb_build_object('key', v_last.name_key, 'id', v_last.id) end);
end $$;

-- ---------------------------------------------------------------------------
-- service.save
-- ---------------------------------------------------------------------------

create function public.crm_service_save(
  p_tenant_id uuid,
  p_service_id uuid,
  p_expected_version integer,
  p_name text,
  p_duration_min integer,
  p_buffer_before_min integer,
  p_buffer_after_min integer,
  p_base_price_cents bigint,
  p_min_price_cents bigint,
  p_estimated_cost_cents bigint,
  p_fee_bps integer,
  p_active boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_uid uuid := auth.uid();
  v_old public.provider_services;
  v_new public.provider_services;
  v_field text;
  v_status integer;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'service.save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  -- Mesmas regras do contrato ServiceSaveInput, revalidadas aqui (o banco é a última palavra).
  v_field := case
    when p_name is null or char_length(btrim(p_name)) not between 1 and 120 then 'name'
    when p_duration_min is null or p_duration_min not between 5 and 1440 then 'duration_min'
    when p_buffer_before_min is null or p_buffer_before_min not between 0 and 240 then 'buffer_before_min'
    when p_buffer_after_min is null or p_buffer_after_min not between 0 and 240 then 'buffer_after_min'
    when p_base_price_cents is null or p_base_price_cents not between 0 and 9007199254740991 then 'base_price_cents'
    when p_min_price_cents is null or p_min_price_cents not between 0 and 9007199254740991
      or p_min_price_cents > p_base_price_cents then 'min_price_cents'
    when p_estimated_cost_cents is not null and p_estimated_cost_cents not between 0 and 9007199254740991 then 'estimated_cost_cents'
    when p_fee_bps is not null and p_fee_bps not between 0 and 10000 then 'fee_bps'
    when p_active is null then 'active'
    when (p_service_id is null) <> (p_expected_version is null) then 'expected_version'
  end;
  if v_field is not null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = v_field;
  end if;
  if p_active and exists (
    select 1 from public.provider_services s
    where s.tenant_id = p_tenant_id and s.active and s.name_key = app.crm_name_key(p_name)
      and s.id is distinct from p_service_id
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'já existe serviço ativo com este nome', hint = 'name';
  end if;

  if p_service_id is null then
    insert into public.provider_services (tenant_id, name, duration_min, buffer_before_min, buffer_after_min,
      base_price_cents, min_price_cents, estimated_cost_cents, fee_bps, active)
    values (p_tenant_id, btrim(p_name), p_duration_min, p_buffer_before_min, p_buffer_after_min,
      p_base_price_cents, p_min_price_cents, p_estimated_cost_cents, p_fee_bps, p_active)
    returning * into v_new;
    v_status := 201;
  else
    select * into v_old from public.provider_services s
    where s.tenant_id = p_tenant_id and s.id = p_service_id
    for update;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND';
    end if;
    if v_old.version <> p_expected_version then
      raise exception using errcode = 'PT409', message = 'STALE_VERSION';
    end if;
    update public.provider_services s
    set name = btrim(p_name), duration_min = p_duration_min, buffer_before_min = p_buffer_before_min,
        buffer_after_min = p_buffer_after_min, base_price_cents = p_base_price_cents,
        min_price_cents = p_min_price_cents, estimated_cost_cents = p_estimated_cost_cents,
        fee_bps = p_fee_bps, active = p_active
    where s.tenant_id = p_tenant_id and s.id = p_service_id
    returning * into v_new;
    v_status := 200;
  end if;

  v_body := jsonb_build_object('service', app.crm_service_json(v_new));
  -- Serviço não tem PII: auditoria guarda antes/depois completos.
  perform app.audit(p_tenant_id, case when v_status = 201 then 'service.create' else 'service.update' end,
    'provider_service', v_new.id, p_request_id,
    case when v_old.id is null then null else app.crm_service_json(v_old) end, app.crm_service_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'service.save', p_idem_key, v_status, v_body);
  return jsonb_build_object('status_code', v_status, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Importação CSV mínima. O navegador faz o parse e o preview; o banco revalida cada linha.
-- Linha inválida é REJEITADA e relatada; linha com possível duplicado é PULADA e relatada,
-- salvo decisão explícita `create` do profissional. Nada é mesclado. Tudo numa transação.
-- p_rows: [{line, name, phone, email, declared_source, on_duplicate: 'skip'|'create'}], ≤ 500.
-- ---------------------------------------------------------------------------

create function public.crm_customer_import_preview(p_tenant_id uuid, p_rows jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'rows';
  end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'line', (r->>'line')::integer,
      'matches', coalesce((
        select jsonb_agg(jsonb_build_object('customer_id', m.customer_id, 'name', c.name,
                                            'reasons', to_jsonb(m.reasons)))
        from app.crm_customer_matches(p_tenant_id, null, coalesce(r->>'name', ''),
               nullif(r->>'phone', ''), nullif(r->>'email', '')) m
        join public.customers c on c.tenant_id = p_tenant_id and c.id = m.customer_id), '[]'::jsonb))
      order by ord)
    from jsonb_array_elements(p_rows) with ordinality as e(r, ord)), '[]'::jsonb));
end $$;

create function public.crm_customer_import(
  p_tenant_id uuid,
  p_rows jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_uid uuid := auth.uid();
  r record;
  v_line integer;
  v_name text;
  v_phone text;
  v_email text;
  v_source text;
  v_bad record;
  v_matches uuid[];
  v_new public.customers;
  v_seen_phone text[] := '{}';
  v_seen_email text[] := '{}';
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'customer.import', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'rows';
  end if;

  for r in select e.v, e.ord from jsonb_array_elements(p_rows) with ordinality as e(v, ord) order by e.ord loop
    v_line := case when jsonb_typeof(r.v->'line') = 'number' then (r.v->>'line')::integer else r.ord::integer end;
    v_name := btrim(r.v->>'name');
    v_phone := nullif(btrim(r.v->>'phone'), '');
    v_email := nullif(btrim(r.v->>'email'), '');
    v_source := nullif(btrim(r.v->>'declared_source'), '');

    select * into v_bad from app.crm_customer_invalid(v_name, v_phone, v_email, v_source) limit 1;
    if found then
      v_rejected := v_rejected || jsonb_build_object('line', v_line, 'field', v_bad.field, 'reason', v_bad.reason);
      continue;
    end if;
    if (v_phone is not null and v_phone = any (v_seen_phone))
       or (v_email is not null and lower(v_email) = any (v_seen_email)) then
      v_rejected := v_rejected || jsonb_build_object('line', v_line,
        'field', case when v_phone is not null and v_phone = any (v_seen_phone) then 'phone' else 'email' end,
        'reason', 'DUPLICATE_IN_FILE');
      continue;
    end if;

    select coalesce(array_agg(m.customer_id), '{}') into v_matches
    from app.crm_customer_matches(p_tenant_id, null, v_name, v_phone, v_email) m;
    if cardinality(v_matches) > 0 and coalesce(r.v->>'on_duplicate', 'skip') <> 'create' then
      v_skipped := v_skipped || jsonb_build_object('line', v_line, 'duplicate_of', to_jsonb(v_matches));
      continue;
    end if;

    insert into public.customers (tenant_id, name, phone, email, declared_source)
    values (p_tenant_id, v_name, v_phone, v_email, v_source)
    returning * into v_new;
    v_created := v_created || jsonb_build_object('line', v_line, 'customer_id', v_new.id,
      'possible_duplicates', to_jsonb(v_matches));
    if v_phone is not null then v_seen_phone := v_seen_phone || v_phone; end if;
    if v_email is not null then v_seen_email := v_seen_email || lower(v_email); end if;
  end loop;

  v_body := jsonb_build_object('created', v_created, 'skipped', v_skipped, 'rejected', v_rejected);
  perform app.audit(p_tenant_id, 'customer.import', 'customer', null, p_request_id, null,
    jsonb_build_object('created', jsonb_array_length(v_created), 'skipped', jsonb_array_length(v_skipped),
                       'rejected', jsonb_array_length(v_rejected)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'customer.import', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios: RPCs públicas só para authenticated; anon nunca.
-- ---------------------------------------------------------------------------

revoke all on function public.crm_customer_upsert(uuid, uuid, integer, text, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.crm_customer_archive(uuid, uuid, integer, boolean, text, text, uuid) from public, anon;
revoke all on function public.crm_customer_list(uuid, text, boolean, text, uuid, integer) from public, anon;
revoke all on function public.crm_service_list(uuid, boolean, text, uuid, integer) from public, anon;
revoke all on function public.crm_service_save(uuid, uuid, integer, text, integer, integer, integer, bigint, bigint, bigint, integer, boolean, text, text, uuid) from public, anon;
revoke all on function public.crm_customer_import_preview(uuid, jsonb) from public, anon;
revoke all on function public.crm_customer_import(uuid, jsonb, text, text, uuid) from public, anon;

grant execute on function public.crm_customer_upsert(uuid, uuid, integer, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.crm_customer_archive(uuid, uuid, integer, boolean, text, text, uuid) to authenticated;
grant execute on function public.crm_customer_list(uuid, text, boolean, text, uuid, integer) to authenticated;
grant execute on function public.crm_service_list(uuid, boolean, text, uuid, integer) to authenticated;
grant execute on function public.crm_service_save(uuid, uuid, integer, text, integer, integer, integer, bigint, bigint, bigint, integer, boolean, text, text, uuid) to authenticated;
grant execute on function public.crm_customer_import_preview(uuid, jsonb) to authenticated;
grant execute on function public.crm_customer_import(uuid, jsonb, text, text, uuid) to authenticated;
