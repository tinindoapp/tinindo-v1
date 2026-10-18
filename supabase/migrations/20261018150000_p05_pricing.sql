-- P05 · Preço por regras: regra por horário com teto e piso, cotação versionada com prazo, prévia,
-- aprovação vinculada a hash/versão/validade e publicação. Cálculo em inteiros (doc06), igual ao
-- domínio TS (_shared/domain/pricing/price.ts), conferido pelas mesmas fixtures nos dois lados.
--
-- Cotação NÃO segura horário. Preço confirmado não muda retroativamente: a reserva guarda o preço da
-- cotação usada (uma vez) e regras novas não alteram reservas existentes nem pacotes vendidos.
-- Depende de: fundação, P02 (provider_services), P03 (bookings e funções de reserva, aqui estendidas).

-- ---------------------------------------------------------------------------
-- Cálculo (doc06), em numeric sem perda: piso econômico com ceil e candidato com round half-up.
-- ---------------------------------------------------------------------------

create function app.price_compute(
  p_base bigint,
  p_manual_floor bigint,
  p_cost bigint,
  p_fee_bps integer,
  p_margin_bps integer,
  p_discount_bps integer,
  p_max_discount_bps integer
) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_denom numeric := 10000 - coalesce(p_fee_bps, 0) - coalesce(p_margin_bps, 0);
  v_econ bigint;
  v_floor bigint;
  v_discount integer := least(coalesce(p_discount_bps, 0), coalesce(p_max_discount_bps, 0));
  v_candidate bigint;
  v_final bigint;
begin
  if p_cost is not null then
    if v_denom <= 0 then
      return jsonb_build_object('ok', false, 'error', 'MARGIN_DENOMINATOR');
    end if;
    v_econ := ceil(p_cost::numeric * 10000 / v_denom)::bigint;
  end if;
  v_floor := greatest(p_manual_floor, coalesce(v_econ, 0));
  if v_floor > p_base then
    return jsonb_build_object('ok', false, 'error', 'FLOOR_ABOVE_BASE', 'floor_cents', v_floor);
  end if;
  v_candidate := floor((p_base::numeric * (10000 - v_discount) + 5000) / 10000)::bigint;
  v_final := greatest(v_candidate, v_floor);
  return jsonb_build_object(
    'ok', true,
    'floor_cents', v_floor,
    'economic_floor_cents', v_econ,
    'floor_is_manual_only', p_cost is null,
    'effective_discount_bps', v_discount,
    'candidate_cents', v_candidate,
    'final_cents', v_final,
    'reason', case when v_discount = 0 then 'BASE_PRICE' when v_final > v_candidate then 'FLOOR_APPLIED'
                   else 'OFF_PEAK_APPROVED' end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.pricing_rule_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  windows jsonb not null check (jsonb_typeof(windows) = 'array' and jsonb_array_length(windows) between 1 and 14),
  discount_bps integer not null check (discount_bps between 0 and 10000),
  max_discount_bps integer not null check (max_discount_bps between 0 and 10000),
  target_margin_bps integer not null default 0 check (target_margin_bps between 0 and 10000),
  valid tstzrange not null check (not isempty(valid) and lower_inc(valid) and not upper_inc(valid)),
  preview jsonb not null,
  -- sha256 do payload normalizado: a aprovação vale para ESTE conteúdo nesta versão.
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'proposed' check (status in ('proposed', 'published', 'discarded')),
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint pricing_rule_proposals_service foreign key (tenant_id, service_id)
    references public.provider_services (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.pricing_rule_proposals is 'Proposta de regra (inativa) com prévia de impacto. Publicar exige aprovação.';
create trigger pricing_rule_proposals_touch before update on public.pricing_rule_proposals
  for each row execute function app.touch_row();

create table public.pricing_rule_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  proposal_id uuid not null,
  proposal_version integer not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint pricing_rule_approvals_proposal foreign key (tenant_id, proposal_id)
    references public.pricing_rule_proposals (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.pricing_rule_approvals is 'Aprovação vinculada a hash + versão + validade. Uso único. Aprovar ≠ publicar.';

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  rule_version integer not null check (rule_version >= 1),
  windows jsonb not null,
  discount_bps integer not null check (discount_bps between 0 and 10000),
  max_discount_bps integer not null check (max_discount_bps between 0 and 10000),
  target_margin_bps integer not null default 0 check (target_margin_bps between 0 and 10000),
  valid tstzrange not null,
  active boolean not null default true,
  proposal_id uuid not null,
  approval_id uuid not null,
  published_by uuid,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint pricing_rules_service foreign key (tenant_id, service_id)
    references public.provider_services (tenant_id, id) on delete restrict,
  constraint pricing_rules_proposal foreign key (tenant_id, proposal_id)
    references public.pricing_rule_proposals (tenant_id, id) on delete restrict,
  constraint pricing_rules_approval foreign key (tenant_id, approval_id)
    references public.pricing_rule_approvals (tenant_id, id) on delete restrict,
  unique (tenant_id, service_id, rule_version),
  unique (tenant_id, id)
);
comment on table public.pricing_rules is 'Regra publicada. Piloto: uma regra ativa por serviço (sem empilhar descontos).';
create unique index pricing_rules_one_active on public.pricing_rules (tenant_id, service_id) where active;
create trigger pricing_rules_touch before update on public.pricing_rules
  for each row execute function app.touch_row();

create table public.price_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  resource_id uuid not null,
  slot tstzrange not null,
  currency char(3) not null default 'BRL' check (currency = 'BRL'),
  base_price_cents bigint not null check (base_price_cents >= 0),
  floor_cents bigint not null check (floor_cents >= 0),
  final_price_cents bigint not null check (final_price_cents >= 0),
  rule_id uuid,
  rule_version integer,
  reason_code text not null check (reason_code in ('BASE_PRICE', 'OFF_PEAK_APPROVED', 'FLOOR_APPLIED')),
  expires_at timestamptz not null,
  used_by_booking uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint price_quotes_final_bounds check (final_price_cents >= floor_cents and final_price_cents <= base_price_cents),
  constraint price_quotes_service foreign key (tenant_id, service_id)
    references public.provider_services (tenant_id, id) on delete restrict,
  constraint price_quotes_resource foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete restrict,
  constraint price_quotes_rule foreign key (tenant_id, rule_id)
    references public.pricing_rules (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.price_quotes is 'Cotação versionada com prazo. Não reserva horário. Usada no máximo uma vez.';
create index price_quotes_expiry on public.price_quotes (tenant_id, expires_at);

alter table public.bookings add constraint bookings_quote foreign key (tenant_id, price_quote_id)
  references public.price_quotes (tenant_id, id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Internas
-- ---------------------------------------------------------------------------

create function app.price_quote_minutes() returns integer
language sql immutable set search_path = '' as $$ select 10 $$;

create function app.price_quote_json(q public.price_quotes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('quote_id', q.id, 'service_id', q.service_id, 'resource_id', q.resource_id,
    'slot', app.sched_range_json(q.slot), 'currency', q.currency, 'base_price_cents', q.base_price_cents,
    'final_price_cents', q.final_price_cents, 'rule_version', q.rule_version, 'reason_code', q.reason_code,
    'expires_at', app.sched_ts(q.expires_at))
$$;

create function app.price_rule_json(r public.pricing_rules) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('rule_id', r.id, 'service_id', r.service_id, 'rule_version', r.rule_version,
    'windows', r.windows, 'discount_bps', r.discount_bps, 'max_discount_bps', r.max_discount_bps,
    'target_margin_bps', r.target_margin_bps, 'valid', app.sched_range_json(r.valid), 'active', r.active,
    'published_at', app.sched_ts(r.published_at), 'version', r.version)
$$;

create function app.price_proposal_json(p public.pricing_rule_proposals) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('proposal_id', p.id, 'service_id', p.service_id, 'discount_bps', p.discount_bps,
    'max_discount_bps', p.max_discount_bps, 'target_margin_bps', p.target_margin_bps, 'windows', p.windows,
    'valid', app.sched_range_json(p.valid), 'preview', p.preview, 'payload_hash', p.payload_hash,
    'status', p.status, 'version', p.version, 'expires_at', app.sched_ts(p.expires_at))
$$;

/** A janela semanal (horário local do tenant) contém o início do horário? */
create function app.price_window_matches(p_windows jsonb, p_starts timestamptz, p_tz text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from jsonb_to_recordset(p_windows) as w(weekday smallint, local_start time, local_end time)
    where w.weekday = extract(dow from (p_starts at time zone p_tz))::smallint
      and (p_starts at time zone p_tz)::time >= w.local_start
      and (p_starts at time zone p_tz)::time < w.local_end
  )
$$;

/** Valida e trava a cotação para uso numa reserva: mesmo serviço/recurso/horário, no prazo e não usada. */
create function app.price_take_quote(p_tenant_id uuid, p_quote_id uuid, p_service_id uuid, p_resource_id uuid,
  p_starts timestamptz, p_ends timestamptz)
returns public.price_quotes
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.price_quotes;
begin
  select * into v_q from public.price_quotes q where q.tenant_id = p_tenant_id and q.id = p_quote_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'quote_id';
  end if;
  if v_q.service_id <> p_service_id or v_q.resource_id <> p_resource_id
     or v_q.slot <> tstzrange(p_starts, p_ends, '[)') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'quote_id', detail = 'cotação de outro horário';
  end if;
  if v_q.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'quote_id', detail = 'cotação vencida';
  end if;
  if v_q.used_by_booking is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'quote_id', detail = 'cotação já usada';
  end if;
  return v_q;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

/** Cotação: preço base ou regra ativa aplicável, sempre ≥ piso. Não segura o horário. */
create function public.pricing_quote(
  p_tenant_id uuid,
  p_service_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_svc public.provider_services;
  v_tz text;
  v_rule public.pricing_rules;
  v_calc jsonb;
  v_q public.price_quotes;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  perform 1 from public.resources r where r.tenant_id = p_tenant_id and r.id = p_resource_id and r.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
  end if;
  if p_starts_at is null or p_ends_at is null
     or p_ends_at - p_starts_at <> make_interval(mins => v_svc.duration_min) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;

  select * into v_rule from public.pricing_rules r
  where r.tenant_id = p_tenant_id and r.service_id = p_service_id and r.active
    and r.valid @> p_starts_at and app.price_window_matches(r.windows, p_starts_at, v_tz);

  v_calc := app.price_compute(v_svc.base_price_cents, v_svc.min_price_cents, v_svc.estimated_cost_cents, v_svc.fee_bps,
    coalesce(v_rule.target_margin_bps, 0), coalesce(v_rule.discount_bps, 0), coalesce(v_rule.max_discount_bps, 0));
  if not (v_calc->>'ok')::boolean then
    -- Custos mudaram depois da publicação e o piso passou da base: sem oferta, preço base (revisar a regra).
    v_rule := null;
    v_calc := jsonb_build_object('floor_cents', v_svc.min_price_cents, 'final_cents', v_svc.base_price_cents,
      'reason', 'BASE_PRICE');
  end if;

  insert into public.price_quotes (tenant_id, service_id, resource_id, slot, base_price_cents, floor_cents,
    final_price_cents, rule_id, rule_version, reason_code, expires_at, created_by)
  values (p_tenant_id, p_service_id, p_resource_id, tstzrange(p_starts_at, p_ends_at, '[)'), v_svc.base_price_cents,
    (v_calc->>'floor_cents')::bigint, (v_calc->>'final_cents')::bigint,
    case when (v_calc->>'reason') = 'BASE_PRICE' then null else v_rule.id end,
    case when (v_calc->>'reason') = 'BASE_PRICE' then null else v_rule.rule_version end,
    v_calc->>'reason', clock_timestamp() + make_interval(mins => app.price_quote_minutes()), auth.uid())
  returning * into v_q;
  return app.price_quote_json(v_q);
end $$;

/** Proposta de regra: valida, calcula a prévia e o hash; a regra continua inativa. */
create function public.pricing_propose_rule(
  p_tenant_id uuid,
  p_service_id uuid,
  p_windows jsonb,
  p_discount_bps integer,
  p_max_discount_bps integer,
  p_target_margin_bps integer,
  p_valid_from timestamptz,
  p_valid_to timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_svc public.provider_services;
  v_windows jsonb;
  v_calc jsonb;
  v_payload jsonb;
  v_row public.pricing_rule_proposals;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'pricing.propose_rule', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_discount_bps is null or p_discount_bps not between 0 and 10000
     or p_max_discount_bps is null or p_max_discount_bps not between 0 and 10000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'discount_bps';
  end if;
  if p_target_margin_bps is null or p_target_margin_bps not between 0 and 10000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'target_margin_bps';
  end if;
  if p_valid_from is null or p_valid_to is null or p_valid_to <= p_valid_from or p_valid_to <= clock_timestamp()
     or p_valid_to - p_valid_from > interval '400 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'valid';
  end if;
  -- Normaliza as janelas (ordem estável): o hash não depende da ordem enviada.
  begin
    select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'local_start', to_char(w.local_start, 'HH24:MI'),
             'local_end', to_char(w.local_end, 'HH24:MI')) order by w.weekday, w.local_start)
    into v_windows
    from jsonb_to_recordset(p_windows) as w(weekday smallint, local_start time, local_end time);
  exception when others then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'windows';
  end;
  if v_windows is null or jsonb_array_length(v_windows) not between 1 and 14 or exists (
       select 1 from jsonb_to_recordset(v_windows) as w(weekday smallint, local_start time, local_end time)
       where w.weekday is null or w.weekday not between 0 and 6 or w.local_start is null or w.local_end is null
          or w.local_end <= w.local_start) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'windows';
  end if;

  v_calc := app.price_compute(v_svc.base_price_cents, v_svc.min_price_cents, v_svc.estimated_cost_cents, v_svc.fee_bps,
    p_target_margin_bps, p_discount_bps, p_max_discount_bps);
  if not (v_calc->>'ok')::boolean then
    -- Piso acima da base ou taxa+margem ≥ 100%: bloquear e pedir revisão, nunca subir preço em silêncio.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED',
      hint = case when v_calc->>'error' = 'MARGIN_DENOMINATOR' then 'target_margin_bps' else 'floor' end;
  end if;

  v_payload := jsonb_build_object('service_id', p_service_id, 'windows', v_windows, 'discount_bps', p_discount_bps,
    'max_discount_bps', p_max_discount_bps, 'target_margin_bps', p_target_margin_bps,
    'valid_from', app.sched_ts(p_valid_from), 'valid_to', app.sched_ts(p_valid_to),
    'base_price_cents', v_svc.base_price_cents, 'service_version', v_svc.version);

  insert into public.pricing_rule_proposals (tenant_id, service_id, windows, discount_bps, max_discount_bps,
    target_margin_bps, valid, preview, payload_hash, expires_at, created_by)
  values (p_tenant_id, p_service_id, v_windows, p_discount_bps, p_max_discount_bps, p_target_margin_bps,
    tstzrange(p_valid_from, p_valid_to, '[)'),
    jsonb_build_object('example_base_cents', v_svc.base_price_cents, 'example_final_cents', (v_calc->>'final_cents')::bigint,
      'floor_cents', (v_calc->>'floor_cents')::bigint, 'floor_is_manual_only', (v_calc->>'floor_is_manual_only')::boolean,
      'economic_floor_cents', v_calc->'economic_floor_cents', 'effective_discount_bps', (v_calc->>'effective_discount_bps')::int,
      'reason', v_calc->>'reason'),
    encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex'),
    clock_timestamp() + interval '24 hours', v_uid)
  returning * into v_row;

  v_body := app.price_proposal_json(v_row);
  perform app.audit(p_tenant_id, 'pricing.propose_rule', 'pricing_rule_proposal', v_row.id, p_request_id, null,
    jsonb_build_object('service_id', p_service_id, 'discount_bps', p_discount_bps, 'max_discount_bps', p_max_discount_bps));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'pricing.propose_rule', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Aprovação explícita do dono: vale para o hash e a versão vistos, por 15 minutos, uma vez. */
create function public.pricing_approve_rule(
  p_tenant_id uuid,
  p_proposal_id uuid,
  p_payload_hash text,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.pricing_rule_proposals;
  v_a public.pricing_rule_approvals;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'pricing.approve_rule', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_p from public.pricing_rule_proposals p where p.tenant_id = p_tenant_id and p.id = p_proposal_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_p.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_p.status <> 'proposed' or v_p.expires_at <= clock_timestamp() or v_p.payload_hash <> p_payload_hash then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'payload_hash';
  end if;
  insert into public.pricing_rule_approvals (tenant_id, proposal_id, proposal_version, payload_hash, approved_by, expires_at)
  values (p_tenant_id, v_p.id, v_p.version, v_p.payload_hash, v_uid, clock_timestamp() + interval '15 minutes')
  returning * into v_a;
  v_body := jsonb_build_object('approval_id', v_a.id, 'proposal_id', v_a.proposal_id, 'approver_user_id', v_a.approved_by,
    'approved_at', app.sched_ts(v_a.approved_at), 'expires_at', app.sched_ts(v_a.expires_at));
  perform app.audit(p_tenant_id, 'pricing.approve_rule', 'pricing_rule_proposal', v_p.id, p_request_id, null,
    jsonb_build_object('approval_id', v_a.id, 'payload_hash', v_a.payload_hash));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'pricing.approve_rule', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Publicação: confere aprovação (hash, versão, prazo, uso único) e piso de novo; troca a regra ativa. */
create function public.pricing_publish_rule(
  p_tenant_id uuid,
  p_proposal_id uuid,
  p_approval_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.pricing_rule_proposals;
  v_a public.pricing_rule_approvals;
  v_svc public.provider_services;
  v_calc jsonb;
  v_rule public.pricing_rules;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'pricing.publish_rule', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  select * into v_p from public.pricing_rule_proposals p where p.tenant_id = p_tenant_id and p.id = p_proposal_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_p.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  select * into v_a from public.pricing_rule_approvals a
  where a.tenant_id = p_tenant_id and a.id = p_approval_id and a.proposal_id = p_proposal_id
  for update;
  if not found or v_a.used_at is not null or v_a.expires_at <= clock_timestamp()
     or v_a.payload_hash <> v_p.payload_hash or v_a.proposal_version <> v_p.version or v_p.status <> 'proposed' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'approval_id';
  end if;
  -- Custos do serviço podem ter mudado depois da prévia: recalcula e bloqueia se o piso passou da base.
  -- O lock do serviço serializa publicações concorrentes (uma regra ativa, versões sem repetição).
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = v_p.service_id and s.active
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  v_calc := app.price_compute(v_svc.base_price_cents, v_svc.min_price_cents, v_svc.estimated_cost_cents, v_svc.fee_bps,
    v_p.target_margin_bps, v_p.discount_bps, v_p.max_discount_bps);
  if not (v_calc->>'ok')::boolean or (v_calc->>'final_cents')::bigint <> (v_p.preview->>'example_final_cents')::bigint then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'preview',
      detail = 'o serviço mudou depois da prévia; gere nova proposta';
  end if;

  update public.pricing_rules r set active = false
  where r.tenant_id = p_tenant_id and r.service_id = v_p.service_id and r.active;
  insert into public.pricing_rules (tenant_id, service_id, rule_version, windows, discount_bps, max_discount_bps,
    target_margin_bps, valid, proposal_id, approval_id, published_by)
  values (p_tenant_id, v_p.service_id,
    coalesce((select max(r.rule_version) from public.pricing_rules r where r.tenant_id = p_tenant_id
              and r.service_id = v_p.service_id), 0) + 1,
    v_p.windows, v_p.discount_bps, v_p.max_discount_bps, v_p.target_margin_bps, v_p.valid, v_p.id, v_a.id, v_uid)
  returning * into v_rule;
  update public.pricing_rule_approvals a set used_at = clock_timestamp() where a.id = v_a.id;
  update public.pricing_rule_proposals p set status = 'published' where p.id = v_p.id;

  v_body := jsonb_build_object('rule', app.price_rule_json(v_rule));
  perform app.audit(p_tenant_id, 'pricing.publish_rule', 'pricing_rule', v_rule.id, p_request_id, null,
    jsonb_build_object('rule_version', v_rule.rule_version, 'discount_bps', v_rule.discount_bps,
      'approval_id', v_a.id, 'payload_hash', v_a.payload_hash));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'pricing.publish_rule', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.pricing_deactivate_rule(
  p_tenant_id uuid,
  p_rule_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.pricing_rules;
  v_new public.pricing_rules;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'pricing.deactivate_rule', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_old from public.pricing_rules r where r.tenant_id = p_tenant_id and r.id = p_rule_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if not v_old.active then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'active';
  end if;
  update public.pricing_rules r set active = false where r.id = p_rule_id returning * into v_new;
  v_body := jsonb_build_object('rule', app.price_rule_json(v_new));
  perform app.audit(p_tenant_id, 'pricing.deactivate_rule', 'pricing_rule', v_new.id, p_request_id, null,
    jsonb_build_object('rule_version', v_new.rule_version));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'pricing.deactivate_rule', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.pricing_list_rules(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'rules', coalesce((select jsonb_agg(app.price_rule_json(r) order by r.active desc, r.published_at desc)
      from (select * from public.pricing_rules r where r.tenant_id = p_tenant_id
            order by r.active desc, r.published_at desc limit 100) r), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(app.price_proposal_json(p) order by p.created_at desc)
      from (select * from public.pricing_rule_proposals p where p.tenant_id = p_tenant_id and p.status = 'proposed'
              and p.expires_at > clock_timestamp() order by p.created_at desc limit 20) p), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Reservas com cotação (P03 estendido)
-- ---------------------------------------------------------------------------

create or replace function app.sched_insert_booking(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_service_id uuid,
  p_customer_id uuid,
  p_guest_ref text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_quote_id uuid,
  p_mode text,
  p_source text,
  p_series_id uuid,
  p_request_id uuid
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_svc public.provider_services;
  v_occ tstzrange;
  v_row public.bookings;
  v_quote public.price_quotes;
  v_hold_until timestamptz;
begin
  if p_mode is null or p_mode not in ('hold', 'confirm') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'mode';
  end if;
  if p_customer_id is not null and p_guest_ref is not null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'guest_ref';
  end if;
  if p_customer_id is not null then
    perform 1 from public.customers c
    where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
    end if;
  end if;
  select * into v_svc from public.provider_services s
  where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_starts_at is null or p_ends_at is null
     or p_ends_at - p_starts_at <> make_interval(mins => v_svc.duration_min) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot',
      detail = 'duração diferente da do serviço';
  end if;
  v_occ := tstzrange(p_starts_at - make_interval(mins => v_svc.buffer_before_min),
                     p_ends_at + make_interval(mins => v_svc.buffer_after_min), '[)');

  perform app.sched_lock_resource(p_tenant_id, p_resource_id);
  perform app.sched_assert_bookable(p_tenant_id, p_resource_id, v_occ, p_starts_at, p_ends_at);
  -- P05: com cotação, o preço é o da cotação (validada e consumida aqui); sem cotação, o preço base.
  if p_quote_id is not null then
    v_quote := app.price_take_quote(p_tenant_id, p_quote_id, p_service_id, p_resource_id, p_starts_at, p_ends_at);
  end if;
  -- Expiração efetiva do hold = menor prazo entre o hold e a cotação (doc06).
  v_hold_until := least(clock_timestamp() + make_interval(mins => app.sched_hold_minutes()),
                        coalesce(v_quote.expires_at, 'infinity'::timestamptz));

  begin
    insert into public.bookings (tenant_id, resource_id, customer_id, guest_ref, service_id, starts_at, ends_at,
      occupied_range, blocks_capacity, status, hold_expires_at, price_quote_id, agreed_price_cents, source,
      series_id, created_by)
    values (p_tenant_id, p_resource_id, p_customer_id, nullif(btrim(p_guest_ref), ''), p_service_id,
      p_starts_at, p_ends_at, v_occ, true,
      case when p_mode = 'hold' then 'held' else 'confirmed' end,
      case when p_mode = 'hold' then v_hold_until end,
      v_quote.id,
      case when p_mode = 'confirm' then coalesce(v_quote.final_price_cents, v_svc.base_price_cents) end,
      p_source, p_series_id, auth.uid())
    returning * into v_row;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT';
  end;
  if v_quote.id is not null then
    update public.price_quotes q set used_by_booking = v_row.id where q.tenant_id = p_tenant_id and q.id = v_quote.id;
  end if;

  if v_row.status = 'confirmed' then
    perform app.emit_event(p_tenant_id, 'booking.confirmed.v1', v_row.id, v_row.version,
      coalesce(p_request_id, gen_random_uuid()), app.sched_event_payload(v_row));
  end if;
  perform app.audit(p_tenant_id, 'booking.create', 'booking', v_row.id, p_request_id, null,
    app.sched_booking_audit(v_row));
  return v_row;
end $$;

create or replace function public.scheduling_booking_confirm(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
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
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.confirm', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  -- O lock do recurso já expira holds vencidos: depois dele, um hold vencido aparece como 'expired'.
  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_old.status <> 'held' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED',
      hint = case when v_old.status = 'expired' then 'hold_expires_at' else 'status' end;
  end if;

  update public.bookings b
  set status = 'confirmed', hold_expires_at = null,
      -- Preço da cotação vinculada ao hold (P05); sem cotação, o preço base do serviço.
      agreed_price_cents = coalesce(
        (select q.final_price_cents from public.price_quotes q where q.tenant_id = b.tenant_id and q.id = b.price_quote_id),
        (select s.base_price_cents from public.provider_services s where s.tenant_id = b.tenant_id and s.id = b.service_id))
  where b.tenant_id = p_tenant_id and b.id = p_booking_id
  returning * into v_new;

  perform app.emit_event(p_tenant_id, 'booking.confirmed.v1', v_new.id, v_new.version,
    coalesce(p_request_id, gen_random_uuid()), app.sched_event_payload(v_new));
  perform app.audit(p_tenant_id, 'booking.confirm', 'booking', v_new.id, p_request_id,
    app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.confirm', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create or replace function public.scheduling_booking_reschedule(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_quote_id uuid,
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
  v_svc public.provider_services;
  v_occ tstzrange;
  v_quote public.price_quotes;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.reschedule', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_old.status not in ('held', 'confirmed') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = v_old.service_id;
  if p_starts_at is null or p_ends_at is null
     or p_ends_at - p_starts_at <> make_interval(mins => v_svc.duration_min) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot',
      detail = 'duração diferente da do serviço';
  end if;
  v_occ := tstzrange(p_starts_at - make_interval(mins => v_svc.buffer_before_min),
                     p_ends_at + make_interval(mins => v_svc.buffer_after_min), '[)');
  perform app.sched_assert_bookable(p_tenant_id, v_old.resource_id, v_occ, p_starts_at, p_ends_at);
  -- P05: com cotação nova o preço muda de forma explícita; sem cotação o preço combinado é mantido.
  if p_quote_id is not null then
    v_quote := app.price_take_quote(p_tenant_id, p_quote_id, v_old.service_id, v_old.resource_id, p_starts_at, p_ends_at);
  end if;

  begin
    update public.bookings b
    set starts_at = p_starts_at, ends_at = p_ends_at, occupied_range = v_occ,
        price_quote_id = coalesce(v_quote.id, b.price_quote_id),
        agreed_price_cents = case when v_quote.id is not null and b.status = 'confirmed' then v_quote.final_price_cents
                                  else b.agreed_price_cents end,
        hold_expires_at = case when v_quote.id is not null and b.status = 'held'
                               then least(b.hold_expires_at, v_quote.expires_at) else b.hold_expires_at end
    where b.tenant_id = p_tenant_id and b.id = p_booking_id
    returning * into v_new;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT';
  end;
  if v_quote.id is not null then
    update public.price_quotes q set used_by_booking = p_booking_id where q.tenant_id = p_tenant_id and q.id = v_quote.id;
  end if;

  perform app.audit(p_tenant_id, 'booking.reschedule', 'booking', v_new.id, p_request_id,
    app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.reschedule', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.price_compute(bigint, bigint, bigint, integer, integer, integer, integer) from public;
revoke all on function app.price_quote_minutes() from public;
revoke all on function app.price_quote_json(public.price_quotes) from public;
revoke all on function app.price_rule_json(public.pricing_rules) from public;
revoke all on function app.price_proposal_json(public.pricing_rule_proposals) from public;
revoke all on function app.price_window_matches(jsonb, timestamptz, text) from public;
revoke all on function app.price_take_quote(uuid, uuid, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function app.price_compute(bigint, bigint, bigint, integer, integer, integer, integer) to service_role;

revoke all on function public.pricing_quote(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.pricing_propose_rule(uuid, uuid, jsonb, integer, integer, integer, timestamptz, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.pricing_approve_rule(uuid, uuid, text, integer, text, text, uuid) from public, anon;
revoke all on function public.pricing_publish_rule(uuid, uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.pricing_deactivate_rule(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.pricing_list_rules(uuid) from public, anon;
grant execute on function public.pricing_quote(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.pricing_propose_rule(uuid, uuid, jsonb, integer, integer, integer, timestamptz, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.pricing_approve_rule(uuid, uuid, text, integer, text, text, uuid) to authenticated;
grant execute on function public.pricing_publish_rule(uuid, uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.pricing_deactivate_rule(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.pricing_list_rules(uuid) to authenticated;

alter table public.pricing_rule_proposals enable row level security;
alter table public.pricing_rule_approvals enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.price_quotes enable row level security;
revoke all on public.pricing_rule_proposals, public.pricing_rule_approvals, public.pricing_rules, public.price_quotes
  from anon, authenticated;
grant select on public.pricing_rule_proposals, public.pricing_rules, public.price_quotes to authenticated;
grant select, insert, update on public.pricing_rule_proposals, public.pricing_rule_approvals, public.pricing_rules,
  public.price_quotes to service_role;

create policy pricing_rule_proposals_select_owner on public.pricing_rule_proposals
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy pricing_rules_select_owner on public.pricing_rules
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy price_quotes_select_owner on public.price_quotes
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
-- pricing_rule_approvals: RLS ligada e nenhuma política (backend-only).
