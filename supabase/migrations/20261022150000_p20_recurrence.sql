-- P20 · Planos recorrentes do profissional: o negócio oferece planos (ex.: 4 cortes a cada 30 dias por R$ 200) e a
-- cliente assina. Cada ciclo abre um pacote de sessões (P07) com os créditos do plano e um recebível pelo preço
-- ACEITO; a renovação é feita pelo worker no fim do ciclo. Cancelar preserva o que foi aceito e o saldo do ciclo
-- corrente; mudar o preço do plano não altera assinaturas em curso.
-- Invariantes (docs/02, docs/05, docs/17, tasks/P20):
-- * Termos congelados na adesão (snapshot + hash): nome, serviço, sessões por ciclo, dias do ciclo e preço.
-- * Um ciclo = um pacote (P07) + um recebível. Consumo de sessões é o do P07 (package.consume), débito único.
-- * Renovação idempotente (um ciclo por número) e só por quem venceu; cancelamento ao fim do ciclo não renova.
-- * Cobrança: recebível por ciclo; o dono cobra pelo P14 ou registra manual. Nada de cobrança automática no PSP.
-- * Créditos não usados não passam para o próximo ciclo (pacote vence no fim do ciclo).
-- Depende de: fundação, P02 (customers, provider_services), P06 (outbox, jobs_run), P07 (session_packages, receivables).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.recurrence_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sessions_per_cycle integer not null check (sessions_per_cycle between 1 and 31),
  cycle_days integer not null default 30 check (cycle_days in (7, 14, 30)),
  price_cents bigint not null check (price_cents between 1 and 9007199254740991),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint recurrence_plans_service foreign key (tenant_id, service_id) references public.provider_services (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.recurrence_plans is 'Plano oferecido pelo profissional. Mudar o plano não muda assinaturas em curso (termos congelados).';
create trigger recurrence_plans_touch before update on public.recurrence_plans for each row execute function app.touch_row();

create table public.recurrence_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  plan_id uuid not null,
  customer_id uuid not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  -- Termos aceitos, congelados: {plan_name, service_id, service_name, sessions_per_cycle, cycle_days, price_cents}.
  terms jsonb not null check (jsonb_typeof(terms) = 'object'),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  accepted_source text not null default 'owner_declared' check (accepted_source in ('owner_declared')),
  started_at timestamptz not null,
  next_renewal_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 280),
  cycles_count integer not null default 0 check (cycles_count >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint recurrence_subscriptions_plan foreign key (tenant_id, plan_id) references public.recurrence_plans (tenant_id, id) on delete restrict,
  constraint recurrence_subscriptions_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint recurrence_subscriptions_cancelled check ((status = 'cancelled') = (cancelled_at is not null)),
  unique (tenant_id, id)
);
comment on table public.recurrence_subscriptions is 'Assinatura de um plano por uma cliente. Termos aceitos congelados; renovação pelo worker.';
create unique index recurrence_subscriptions_one_live on public.recurrence_subscriptions (tenant_id, customer_id, plan_id) where status = 'active';
create index recurrence_subscriptions_due on public.recurrence_subscriptions (next_renewal_at) where status = 'active';
create trigger recurrence_subscriptions_touch before update on public.recurrence_subscriptions for each row execute function app.touch_row();

create table public.recurrence_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  subscription_id uuid not null,
  cycle_no integer not null check (cycle_no >= 1),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  package_id uuid not null,
  receivable_id uuid not null,
  created_at timestamptz not null default now(),
  constraint recurrence_cycles_subscription foreign key (tenant_id, subscription_id) references public.recurrence_subscriptions (tenant_id, id) on delete restrict,
  constraint recurrence_cycles_package foreign key (tenant_id, package_id) references public.session_packages (tenant_id, id) on delete restrict,
  constraint recurrence_cycles_receivable foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id) on delete restrict,
  constraint recurrence_cycles_time check (ends_at > starts_at),
  unique (subscription_id, cycle_no),
  unique (tenant_id, id)
);
comment on table public.recurrence_cycles is 'Um ciclo = um pacote de sessões (P07) + um recebível pelo preço aceito. Append-only.';
create trigger recurrence_cycles_append_only before update or delete on public.recurrence_cycles for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.rc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.rc_plan_json(p public.recurrence_plans) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'service_id', p.service_id, 'service_name', (select s.name from public.provider_services s where s.id = p.service_id),
    'name', p.name, 'sessions_per_cycle', p.sessions_per_cycle, 'cycle_days', p.cycle_days, 'price_cents', p.price_cents, 'active', p.active,
    'subscribers', (select count(*) from public.recurrence_subscriptions x where x.plan_id = p.id and x.status = 'active'),
    'created_at', app.fin_ts(p.created_at), 'version', p.version)
$$;

create function app.rc_cycle_json(c public.recurrence_cycles) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'cycle_no', c.cycle_no, 'starts_at', app.fin_ts(c.starts_at), 'ends_at', app.fin_ts(c.ends_at),
    'package', app.fin_package_balance(c.tenant_id, c.package_id),
    'receivable', (select app.fin_receivable_json(r) from public.receivables r where r.id = c.receivable_id))
$$;

create function app.rc_sub_json(s public.recurrence_subscriptions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'plan_id', s.plan_id, 'customer_id', s.customer_id,
    'customer_name', (select cu.name from public.customers cu where cu.id = s.customer_id),
    'status', s.status, 'terms', s.terms, 'terms_hash', s.terms_hash, 'accepted_at', app.fin_ts(s.accepted_at), 'accepted_source', s.accepted_source,
    'started_at', app.fin_ts(s.started_at), 'next_renewal_at', app.fin_ts(s.next_renewal_at), 'cancel_at_period_end', s.cancel_at_period_end,
    'cancelled_at', app.fin_ts(s.cancelled_at), 'cancel_reason', s.cancel_reason, 'cycles_count', s.cycles_count,
    'current_cycle', (select app.rc_cycle_json(c) from public.recurrence_cycles c where c.subscription_id = s.id order by c.cycle_no desc limit 1),
    'version', s.version)
$$;

/** Abre um ciclo: pacote de sessões com os créditos aceitos + recebível pelo preço aceito. Idempotente por número. */
create function app.rc_open_cycle(p_sub public.recurrence_subscriptions, p_cycle_no integer, p_starts_at timestamptz, p_correlation uuid) returns public.recurrence_cycles
language plpgsql security definer set search_path = '' as $$
declare
  v_ends timestamptz := p_starts_at + make_interval(days => (p_sub.terms->>'cycle_days')::integer);
  v_pkg public.session_packages;
  v_rec public.receivables;
  v_c public.recurrence_cycles;
begin
  select * into v_c from public.recurrence_cycles c where c.subscription_id = p_sub.id and c.cycle_no = p_cycle_no;
  if found then return v_c; end if;
  insert into public.session_packages (tenant_id, customer_id, service_id, purchased_credits, total_price_cents, expires_at, created_by)
  values (p_sub.tenant_id, p_sub.customer_id, (p_sub.terms->>'service_id')::uuid, (p_sub.terms->>'sessions_per_cycle')::integer, (p_sub.terms->>'price_cents')::bigint, v_ends, p_sub.created_by)
  returning * into v_pkg;
  insert into public.receivables (tenant_id, customer_id, package_id, description, amount_cents, due_at, created_by)
  values (p_sub.tenant_id, p_sub.customer_id, v_pkg.id, left(format('Assinatura %s · ciclo %s', p_sub.terms->>'plan_name', p_cycle_no), 120),
    (p_sub.terms->>'price_cents')::bigint, p_starts_at, p_sub.created_by)
  returning * into v_rec;
  insert into public.recurrence_cycles (tenant_id, subscription_id, cycle_no, starts_at, ends_at, package_id, receivable_id)
  values (p_sub.tenant_id, p_sub.id, p_cycle_no, p_starts_at, v_ends, v_pkg.id, v_rec.id) returning * into v_c;
  update public.recurrence_subscriptions s set cycles_count = p_cycle_no, next_renewal_at = v_ends where s.id = p_sub.id;
  perform app.emit_event(p_sub.tenant_id, 'recurrence.cycle.opened.v1', p_sub.id, p_cycle_no, coalesce(p_correlation, gen_random_uuid()),
    jsonb_build_object('subscription_id', p_sub.id, 'customer_id', p_sub.customer_id, 'cycle_no', p_cycle_no, 'package_id', v_pkg.id,
      'receivable_id', v_rec.id, 'amount_cents', (p_sub.terms->>'price_cents')::bigint, 'ends_at', app.fin_ts(v_ends)));
  perform app.audit(p_sub.tenant_id, 'recurrence.cycle_open', 'recurrence_subscription', p_sub.id, p_correlation, null,
    jsonb_build_object('cycle_no', p_cycle_no, 'amount_cents', (p_sub.terms->>'price_cents')::bigint));
  return v_c;
end $$;

/** Uma rodada: renova o que venceu (um ciclo novo por assinatura) e encerra o que pediu cancelamento no fim do ciclo. */
create function app.rc_tick(p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.recurrence_subscriptions;
  v_renewed integer := 0;
  v_closed integer := 0;
begin
  for s in
    select * from public.recurrence_subscriptions x where x.status = 'active' and x.next_renewal_at <= clock_timestamp()
    order by x.next_renewal_at limit p_batch for update skip locked
  loop
    if s.cancel_at_period_end then
      update public.recurrence_subscriptions x set status = 'cancelled', cancelled_at = clock_timestamp(), next_renewal_at = null where x.id = s.id;
      perform app.audit(s.tenant_id, 'recurrence.cancelled', 'recurrence_subscription', s.id, null, null, jsonb_build_object('at_period_end', true));
      v_closed := v_closed + 1;
    else
      perform app.rc_open_cycle(s, s.cycles_count + 1, s.next_renewal_at, gen_random_uuid());
      v_renewed := v_renewed + 1;
    end if;
  end loop;
  return jsonb_build_object('renewed', v_renewed, 'closed', v_closed);
end $$;

-- ---------------------------------------------------------------------------
-- Worker (P06): a renovação roda a cada rodada, junto com o outbox e as réguas (P13)
-- ---------------------------------------------------------------------------

create or replace function public.jobs_run(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired_holds integer;
  v_expired_offers integer;
  v_done integer := 0;
  v_failed integer := 0;
  v_dead integer := 0;
  v_lifecycle jsonb;
  v_recurrence jsonb;
  e public.outbox_events;
begin
  v_expired_offers := app.wl_expire_offers();
  v_expired_holds := public.scheduling_expire_holds();
  -- Renovação antes do outbox: o ciclo novo emite evento e a régua (P13) o vê na mesma rodada.
  v_recurrence := app.rc_tick(100);
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
  v_lifecycle := app.lc_tick(100);
  return jsonb_build_object('done', v_done, 'retried', v_failed, 'dead', v_dead,
    'expired_offers', v_expired_offers, 'expired_holds', v_expired_holds, 'lifecycle', v_lifecycle, 'recurrence', v_recurrence);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: planos
-- ---------------------------------------------------------------------------

create function public.recurrence_plan_save(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_expected_version integer,
  p_service_id uuid,
  p_name text,
  p_sessions_per_cycle integer,
  p_cycle_days integer,
  p_price_cents bigint,
  p_active boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.recurrence_plans;
  v_body jsonb;
begin
  perform app.rc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'recurrence.plan_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_plan_id is null then
    insert into public.recurrence_plans (tenant_id, service_id, name, sessions_per_cycle, cycle_days, price_cents, active, created_by)
    values (p_tenant_id, p_service_id, btrim(p_name), p_sessions_per_cycle, coalesce(p_cycle_days, 30), p_price_cents, coalesce(p_active, true), v_uid)
    returning * into v_p;
  else
    select * into v_p from public.recurrence_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id for update;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND';
    end if;
    if v_p.version <> p_expected_version then
      raise exception using errcode = 'PT409', message = 'STALE_VERSION';
    end if;
    -- Mudar o plano não muda assinaturas em curso: elas guardam os termos aceitos.
    update public.recurrence_plans p set service_id = p_service_id, name = btrim(p_name), sessions_per_cycle = p_sessions_per_cycle,
      cycle_days = coalesce(p_cycle_days, p.cycle_days), price_cents = p_price_cents, active = coalesce(p_active, p.active)
    where p.id = v_p.id returning * into v_p;
  end if;
  perform app.audit(p_tenant_id, 'recurrence.plan_save', 'recurrence_plan', v_p.id, p_request_id, null,
    jsonb_build_object('sessions_per_cycle', v_p.sessions_per_cycle, 'cycle_days', v_p.cycle_days, 'price_cents', v_p.price_cents, 'active', v_p.active));
  v_body := jsonb_build_object('plan', app.rc_plan_json(v_p));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'recurrence.plan_save', p_idem_key, case when p_plan_id is null then 201 else 200 end, v_body);
  return jsonb_build_object('status_code', case when p_plan_id is null then 201 else 200 end, 'body', v_body);
exception when check_violation then
  raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'plan';
end $$;

create function public.recurrence_plan_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.rc_owner(p_tenant_id);
  return jsonb_build_object('plans', coalesce((select jsonb_agg(app.rc_plan_json(p) order by p.active desc, p.created_at)
    from public.recurrence_plans p where p.tenant_id = p_tenant_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Dono: assinaturas
-- ---------------------------------------------------------------------------

/** Adesão declarada pelo dono (a cliente aceitou pessoalmente): congela os termos e abre o primeiro ciclo agora. */
create function public.recurrence_subscribe(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_customer_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.recurrence_plans;
  v_terms jsonb;
  v_s public.recurrence_subscriptions;
  v_body jsonb;
begin
  perform app.rc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'recurrence.subscribe', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_p from public.recurrence_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'plan_id';
  end if;
  if not v_p.active then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'plan_id';
  end if;
  perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  v_terms := jsonb_build_object('plan_name', v_p.name, 'service_id', v_p.service_id,
    'service_name', (select s.name from public.provider_services s where s.id = v_p.service_id),
    'sessions_per_cycle', v_p.sessions_per_cycle, 'cycle_days', v_p.cycle_days, 'price_cents', v_p.price_cents);
  begin
    insert into public.recurrence_subscriptions (tenant_id, plan_id, customer_id, terms, terms_hash, started_at, created_by)
    values (p_tenant_id, v_p.id, p_customer_id, v_terms, encode(sha256(convert_to(v_terms::text, 'UTF8')), 'hex'), clock_timestamp(), v_uid)
    returning * into v_s;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'subscription', detail = 'a cliente já assina este plano';
  end;
  perform app.rc_open_cycle(v_s, 1, v_s.started_at, coalesce(p_request_id, gen_random_uuid()));
  select * into v_s from public.recurrence_subscriptions s where s.id = v_s.id;
  perform app.audit(p_tenant_id, 'recurrence.subscribe', 'recurrence_subscription', v_s.id, p_request_id, null,
    jsonb_build_object('plan_id', v_p.id, 'price_cents', v_p.price_cents, 'sessions_per_cycle', v_p.sessions_per_cycle));
  v_body := jsonb_build_object('subscription', app.rc_sub_json(v_s));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'recurrence.subscribe', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/**
 * Cancelamento preserva o aceito: no fim do ciclo (padrão) a assinatura segue até o ciclo vencer e não renova;
 * imediato encerra agora, mas o pacote do ciclo corrente continua válido até o fim do ciclo (saldo preservado).
 */
create function public.recurrence_cancel(
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_expected_version integer,
  p_at_period_end boolean,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_s public.recurrence_subscriptions;
  v_body jsonb;
begin
  perform app.rc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'recurrence.cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_s from public.recurrence_subscriptions s where s.tenant_id = p_tenant_id and s.id = p_subscription_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_s.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_s.status <> 'active' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if coalesce(p_at_period_end, true) then
    update public.recurrence_subscriptions s set cancel_at_period_end = true, cancel_reason = left(btrim(p_reason), 280) where s.id = v_s.id returning * into v_s;
  else
    update public.recurrence_subscriptions s set status = 'cancelled', cancelled_at = clock_timestamp(), next_renewal_at = null, cancel_reason = left(btrim(p_reason), 280)
    where s.id = v_s.id returning * into v_s;
  end if;
  perform app.audit(p_tenant_id, 'recurrence.cancel', 'recurrence_subscription', v_s.id, p_request_id, null,
    jsonb_build_object('at_period_end', coalesce(p_at_period_end, true)));
  v_body := jsonb_build_object('subscription', app.rc_sub_json(v_s));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'recurrence.cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Desfaz um pedido de cancelamento ao fim do ciclo, enquanto a assinatura ainda está ativa. */
create function public.recurrence_resume(
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_s public.recurrence_subscriptions;
  v_body jsonb;
begin
  perform app.rc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'recurrence.resume', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_s from public.recurrence_subscriptions s where s.tenant_id = p_tenant_id and s.id = p_subscription_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_s.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_s.status <> 'active' or not v_s.cancel_at_period_end then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.recurrence_subscriptions s set cancel_at_period_end = false, cancel_reason = null where s.id = v_s.id returning * into v_s;
  perform app.audit(p_tenant_id, 'recurrence.resume', 'recurrence_subscription', v_s.id, p_request_id, null, null);
  v_body := jsonb_build_object('subscription', app.rc_sub_json(v_s));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'recurrence.resume', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.recurrence_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.rc_owner(p_tenant_id);
  return jsonb_build_object('subscriptions', coalesce((select jsonb_agg(app.rc_sub_json(s) order by s.status, s.next_renewal_at nulls last, s.created_at desc)
    from (select * from public.recurrence_subscriptions s where s.tenant_id = p_tenant_id order by s.created_at desc limit 200) s), '[]'::jsonb));
end $$;

create function public.recurrence_cycles_list(p_tenant_id uuid, p_subscription_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.rc_owner(p_tenant_id);
  if not exists (select 1 from public.recurrence_subscriptions s where s.tenant_id = p_tenant_id and s.id = p_subscription_id) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('cycles', coalesce((select jsonb_agg(app.rc_cycle_json(c) order by c.cycle_no desc)
    from public.recurrence_cycles c where c.tenant_id = p_tenant_id and c.subscription_id = p_subscription_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.rc_open_cycle(public.recurrence_subscriptions, integer, timestamptz, uuid), app.rc_tick(integer) from public, anon, authenticated;

revoke all on function public.recurrence_plan_save(uuid, uuid, integer, uuid, text, integer, integer, bigint, boolean, text, text, uuid) from public, anon;
revoke all on function public.recurrence_plan_list(uuid) from public, anon;
revoke all on function public.recurrence_subscribe(uuid, uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.recurrence_cancel(uuid, uuid, integer, boolean, text, text, text, uuid) from public, anon;
revoke all on function public.recurrence_resume(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.recurrence_list(uuid) from public, anon;
revoke all on function public.recurrence_cycles_list(uuid, uuid) from public, anon;
grant execute on function public.recurrence_plan_save(uuid, uuid, integer, uuid, text, integer, integer, bigint, boolean, text, text, uuid) to authenticated;
grant execute on function public.recurrence_plan_list(uuid) to authenticated;
grant execute on function public.recurrence_subscribe(uuid, uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.recurrence_cancel(uuid, uuid, integer, boolean, text, text, text, uuid) to authenticated;
grant execute on function public.recurrence_resume(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.recurrence_list(uuid) to authenticated;
grant execute on function public.recurrence_cycles_list(uuid, uuid) to authenticated;

alter table public.recurrence_plans enable row level security;
alter table public.recurrence_subscriptions enable row level security;
alter table public.recurrence_cycles enable row level security;
grant select on public.recurrence_plans, public.recurrence_subscriptions, public.recurrence_cycles to authenticated;
create policy recurrence_plans_select_owner on public.recurrence_plans for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy recurrence_subscriptions_select_owner on public.recurrence_subscriptions for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy recurrence_cycles_select_owner on public.recurrence_cycles for select to authenticated using (app.is_member(tenant_id, array['owner']));
