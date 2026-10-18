-- P15 · Planos e serviços assistidos: assinatura com versão fixada, franquias aplicadas no servidor, pedidos de serviço
-- com escopo aceito, responsável, minutos medidos com limite, entregas com aprovação e acesso delegado auditado.
-- Invariantes (doc15 "Camada de prestação de serviços", docs/04, docs/11):
-- * platform_offerings/offering_versions ≠ provider_services. Versão publicada é imutável (append-only).
-- * Assinatura e pedido fixam a versão (preço, franquia, escopo): publicar versão nova não muda compromisso antigo.
-- * Franquia aplicada no banco: plano define o limite do assistente (P08); minutos de serviço não passam da franquia.
-- * Minutos são medidos (work_logs); estimativa nunca substitui medição. Reprocessamento é registrado.
-- * Operador Tinindo não tem acesso global: lê dados do negócio só com access_grant do dono (escopo, prazo,
--   justificativa), e cada leitura vira auditoria visível ao dono. Credenciais de terceiros nunca entram aqui.
-- * Cobrança da Tinindo é manual no piloto (sem gateway): assinatura registrada ≠ pagamento recebido.
-- Depende de: fundação, P02 (provider_services, customers), P03 (bookings), P08 (agent_quotas).

-- ---------------------------------------------------------------------------
-- Operadores da Tinindo (mantidos só pelo backend; nenhuma RPC concede este papel)
-- ---------------------------------------------------------------------------

create table public.platform_operators (
  user_id uuid primary key,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.platform_operators is 'Equipe Tinindo. Inserção só por service_role (decisão humana fora do app).';

-- ---------------------------------------------------------------------------
-- Catálogo da Tinindo (planos e serviços assistidos)
-- ---------------------------------------------------------------------------

create table public.platform_offerings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{3,40}$'),
  kind text not null check (kind in ('plan', 'service')),
  created_at timestamptz not null default now()
);

create table public.offering_versions (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.platform_offerings (id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null check (char_length(description) <= 500),
  price_cents bigint not null check (price_cents between 0 and 9007199254740991),
  billing text not null check (billing in ('monthly', 'one_time')),
  -- Escopo: o que está incluído e o que NÃO está (listas de frases curtas).
  included jsonb not null default '[]' check (jsonb_typeof(included) = 'array' and jsonb_array_length(included) <= 20),
  excluded jsonb not null default '[]' check (jsonb_typeof(excluded) = 'array' and jsonb_array_length(excluded) <= 20),
  -- Franquias: perguntas ao assistente por mês (planos) e minutos humanos (serviços).
  agent_questions_month integer check (agent_questions_month between 0 and 100000),
  assisted_minutes integer check (assisted_minutes between 0 and 100000),
  sla_days integer check (sla_days between 1 and 365),
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  constraint offering_versions_quota_by_kind check (
    (agent_questions_month is not null and assisted_minutes is null and billing = 'monthly')
    or (agent_questions_month is null and assisted_minutes is not null and sla_days is not null)
  ),
  unique (offering_id, version_no)
);
comment on table public.offering_versions is 'Versão publicada de plano/serviço: preço, escopo e franquia. Imutável.';
create trigger offering_versions_append_only before update or delete on public.offering_versions
  for each row execute function app.forbid_mutation();

/** Publica nova versão (só backend). Repetir o mesmo conteúdo não cria versão nova. */
create function app.svc_publish_offering(
  p_code text, p_kind text, p_name text, p_description text, p_price_cents bigint, p_billing text,
  p_included jsonb, p_excluded jsonb, p_agent_questions_month integer, p_assisted_minutes integer, p_sla_days integer
) returns public.offering_versions
language plpgsql security definer set search_path = '' as $$
declare
  v_off public.platform_offerings;
  v_last public.offering_versions;
  v_hash text;
  v_row public.offering_versions;
begin
  insert into public.platform_offerings (code, kind) values (p_code, p_kind)
  on conflict (code) do nothing;
  select * into v_off from public.platform_offerings o where o.code = p_code for update;
  if v_off.kind <> p_kind then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
  end if;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object('code', p_code, 'kind', p_kind, 'name', p_name,
    'description', p_description, 'price_cents', p_price_cents, 'billing', p_billing, 'included', p_included,
    'excluded', p_excluded, 'agent_questions_month', p_agent_questions_month, 'assisted_minutes', p_assisted_minutes,
    'sla_days', p_sla_days)::text, 'UTF8')), 'hex');
  select * into v_last from public.offering_versions v where v.offering_id = v_off.id order by v.version_no desc limit 1;
  if found and v_last.scope_hash = v_hash then
    return v_last;
  end if;
  insert into public.offering_versions (offering_id, version_no, name, description, price_cents, billing, included, excluded,
    agent_questions_month, assisted_minutes, sla_days, scope_hash)
  values (v_off.id, coalesce(v_last.version_no, 0) + 1, p_name, p_description, p_price_cents, p_billing, p_included, p_excluded,
    p_agent_questions_month, p_assisted_minutes, p_sla_days, v_hash)
  returning * into v_row;
  return v_row;
end $$;

-- Planos públicos já prometidos (docs/00): Grátis e Completo de fundador a R$79/mês. A franquia do assistente
-- fica no padrão atual do P08 (200/mês) até o dono do projeto definir franquias por plano.
select app.svc_publish_offering('free', 'plan', 'Grátis', 'Perfil e gestão básica para experimentar a Tinindo.', 0, 'monthly',
  '["Agenda, clientes e caixa registrado", "Perfil público", "Exportação básica dos seus dados"]',
  '["Atendimento humano", "Serviços assistidos", "Emissão fiscal"]', 200, null, null);
select app.svc_publish_offering('founder', 'plan', 'Completo (fundador)', 'Preço de fundador por 12 meses para adesões elegíveis.',
  7900, 'monthly',
  '["Tudo do Grátis", "Assistente com franquia mensal", "Ofertas de vaga e recuperação de agenda"]',
  '["Atendimento humano ilimitado", "Serviços assistidos (contratados à parte)", "Emissão fiscal", "Marketing pago"]',
  200, null, null);

-- ---------------------------------------------------------------------------
-- Assinatura do negócio
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  offering_version_id uuid not null references public.offering_versions (id) on delete restrict,
  -- Cópia do compromisso aceito: não muda se o catálogo mudar.
  price_cents bigint not null check (price_cents >= 0),
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'replaced', 'cancelled')),
  -- Piloto: cobrança da Tinindo manual/link externo; registrar assinatura não significa pagamento.
  billing_source text not null default 'manual' check (billing_source = 'manual'),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid,
  constraint subscriptions_ended check ((status = 'active') = (ended_at is null)),
  unique (tenant_id, id)
);
create unique index subscriptions_one_active on public.subscriptions (tenant_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Pedidos de serviço assistido, minutos, entregas e acesso delegado
-- ---------------------------------------------------------------------------

create table public.service_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  offering_version_id uuid not null references public.offering_versions (id) on delete restrict,
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  price_cents bigint not null check (price_cents >= 0),
  minutes_quota integer not null check (minutes_quota >= 0),
  -- Pedido já nasce com o escopo aceito (o dono aceita a versão que viu ao pedir).
  status text not null default 'scope_accepted' check (status in ('scope_accepted', 'awaiting_access', 'in_progress',
    'client_review', 'delivered', 'cancelled', 'blocked')),
  assignee_user_id uuid references public.platform_operators (user_id) on delete restrict,
  due_at timestamptz,
  notes text check (char_length(notes) <= 500),
  blocked_reason text check (char_length(blocked_reason) <= 280),
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id)
);
create index service_orders_open on public.service_orders (status, created_at)
  where status not in ('delivered', 'cancelled');
create trigger service_orders_touch before update on public.service_orders
  for each row execute function app.touch_row();

/** Histórico de estados: reabrir ou bloquear gera registro, nunca apaga. */
create table public.service_order_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  order_id uuid not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  note text check (char_length(note) <= 280),
  occurred_at timestamptz not null default now(),
  constraint service_order_events_order foreign key (tenant_id, order_id)
    references public.service_orders (tenant_id, id) on delete restrict
);
create index service_order_events_order on public.service_order_events (order_id, id);
create trigger service_order_events_append_only before update or delete on public.service_order_events
  for each row execute function app.forbid_mutation();

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  operator_user_id uuid not null references public.platform_operators (user_id) on delete restrict,
  minutes integer not null check (minutes between 1 and 480),
  kind text not null check (kind in ('human', 'automation')),
  -- Retrabalho/reprocessamento é medido separadamente (custo real, não escondido).
  reprocess boolean not null default false,
  note text check (char_length(note) <= 280),
  logged_at timestamptz not null default now(),
  constraint work_logs_order foreign key (tenant_id, order_id)
    references public.service_orders (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
create index work_logs_order on public.work_logs (order_id);
create index work_logs_tenant_period on public.work_logs (tenant_id, logged_at);
create trigger work_logs_append_only before update or delete on public.work_logs
  for each row execute function app.forbid_mutation();

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  version_no integer not null check (version_no >= 1),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  -- Evidência descrita (ex.: "12 serviços e horários cadastrados"). Sem credenciais nem dados de clientes.
  evidence text not null check (char_length(btrim(evidence)) between 1 and 500),
  delivered_by uuid not null,
  delivered_at timestamptz not null default now(),
  constraint deliverables_order foreign key (tenant_id, order_id)
    references public.service_orders (tenant_id, id) on delete restrict,
  unique (order_id, version_no),
  unique (tenant_id, id)
);
create trigger deliverables_append_only before update or delete on public.deliverables
  for each row execute function app.forbid_mutation();

create table public.deliverable_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  deliverable_id uuid not null unique,
  decision text not null check (decision in ('approved', 'changes_requested')),
  note text check (char_length(note) <= 280),
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  constraint deliverable_reviews_deliverable foreign key (tenant_id, deliverable_id)
    references public.deliverables (tenant_id, id) on delete restrict
);
create trigger deliverable_reviews_append_only before update or delete on public.deliverable_reviews
  for each row execute function app.forbid_mutation();

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  operator_user_id uuid not null references public.platform_operators (user_id) on delete restrict,
  scopes text[] not null check (cardinality(scopes) between 1 and 3 and scopes <@ array['catalog', 'agenda', 'customers']),
  justification text not null check (char_length(btrim(justification)) between 1 and 280),
  expires_at timestamptz not null,
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  constraint access_grants_window check (expires_at > granted_at and expires_at <= granted_at + interval '30 days'),
  constraint access_grants_order foreign key (tenant_id, order_id)
    references public.service_orders (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
create index access_grants_active on public.access_grants (operator_user_id, order_id) where revoked_at is null;

/** Só a revogação muda depois de criado. */
create function app.svc_grant_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.revoked_at is not null
     or (to_jsonb(new) - 'revoked_at' - 'revoked_by') <> (to_jsonb(old) - 'revoked_at' - 'revoked_by') then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'access_grants só aceita revogação';
  end if;
  return new;
end $$;
create trigger access_grants_guard before update or delete on public.access_grants
  for each row execute function app.svc_grant_guard();

-- ---------------------------------------------------------------------------
-- JSON e regras internas
-- ---------------------------------------------------------------------------

create function app.svc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.svc_operator() returns public.platform_operators
language plpgsql stable security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
begin
  select * into v_op from public.platform_operators o where o.user_id = auth.uid() and o.active;
  if not found then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return v_op;
end $$;

create function app.svc_version_json(v public.offering_versions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'code', o.code, 'kind', o.kind, 'version_no', v.version_no, 'name', v.name,
    'description', v.description, 'price_cents', v.price_cents, 'billing', v.billing, 'included', v.included,
    'excluded', v.excluded, 'agent_questions_month', v.agent_questions_month, 'assisted_minutes', v.assisted_minutes,
    'sla_days', v.sla_days, 'scope_hash', v.scope_hash, 'published_at', app.sched_ts(v.published_at))
  from public.platform_offerings o where o.id = v.offering_id
$$;

/** Versão atual de cada oferta (a única que aceita novas adesões). */
create function app.svc_is_latest(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.offering_versions v where v.id = p_version_id
    and v.version_no = (select max(x.version_no) from public.offering_versions x where x.offering_id = v.offering_id))
$$;

create function app.svc_minutes_used(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'minutes_used', coalesce(sum(w.minutes), 0),
    'human_minutes', coalesce(sum(w.minutes) filter (where w.kind = 'human'), 0),
    'reprocess_minutes', coalesce(sum(w.minutes) filter (where w.reprocess), 0))
  from public.work_logs w where w.order_id = p_order_id
$$;

create function app.svc_grant_json(g public.access_grants) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', g.id, 'order_id', g.order_id, 'operator_user_id', g.operator_user_id,
    'operator_name', (select o.display_name from public.platform_operators o where o.user_id = g.operator_user_id),
    'scopes', to_jsonb(g.scopes), 'justification', g.justification, 'expires_at', app.sched_ts(g.expires_at),
    'granted_at', app.sched_ts(g.granted_at), 'revoked_at', app.fin_ts(g.revoked_at),
    'active', g.revoked_at is null and g.expires_at > clock_timestamp())
$$;

create function app.svc_order_json(s public.service_orders) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'tenant_id', s.tenant_id, 'status', s.status,
    'offering', app.svc_version_json(v), 'scope_hash', s.scope_hash, 'price_cents', s.price_cents,
    'minutes_quota', s.minutes_quota, 'assignee_user_id', s.assignee_user_id,
    'assignee_name', (select o.display_name from public.platform_operators o where o.user_id = s.assignee_user_id),
    'due_at', app.fin_ts(s.due_at), 'notes', s.notes, 'blocked_reason', s.blocked_reason,
    'created_at', app.sched_ts(s.created_at), 'version', s.version)
    || app.svc_minutes_used(s.id)
  from public.offering_versions v where v.id = s.offering_version_id
$$;

create function app.svc_active_grant(p_order_id uuid, p_operator uuid) returns public.access_grants
language sql stable security definer set search_path = '' as $$
  select g.* from public.access_grants g
  where g.order_id = p_order_id and g.operator_user_id = p_operator and g.revoked_at is null and g.expires_at > clock_timestamp()
  order by g.expires_at desc limit 1
$$;

create function app.svc_transition(p_order public.service_orders, p_to text, p_note text) returns public.service_orders
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.service_orders;
begin
  update public.service_orders s set status = p_to,
    blocked_reason = case when p_to = 'blocked' then p_note else null end
  where s.id = p_order.id returning * into v_row;
  insert into public.service_order_events (tenant_id, order_id, from_status, to_status, actor_user_id, note)
  values (p_order.tenant_id, p_order.id, p_order.status, p_to, auth.uid(), p_note);
  return v_row;
end $$;

create function app.svc_revoke_order_grants(p_order_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.access_grants g set revoked_at = clock_timestamp(), revoked_by = auth.uid()
  where g.order_id = p_order_id and g.revoked_at is null
$$;

/** Trava o pedido do tenant (o tenant do request é seleção; o pedido precisa ser dele). */
create function app.svc_lock_order(p_tenant_id uuid, p_order_id uuid) returns public.service_orders
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.service_orders;
begin
  select * into v_row from public.service_orders s where s.tenant_id = p_tenant_id and s.id = p_order_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return v_row;
end $$;

/** Franquia do plano aplicada no servidor: limite mensal do assistente (P08). */
create function app.svc_apply_plan(p_tenant_id uuid, p_version public.offering_versions) returns void
language sql security definer set search_path = '' as $$
  insert into public.agent_quotas (tenant_id, monthly_limit, period_start)
  values (p_tenant_id, p_version.agent_questions_month, date_trunc('month', now())::date)
  on conflict (tenant_id) do update set monthly_limit = excluded.monthly_limit, updated_at = now()
$$;

-- ---------------------------------------------------------------------------
-- Dono: plano
-- ---------------------------------------------------------------------------

create function public.service_plan_current(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sub public.subscriptions;
  v_ver public.offering_versions;
begin
  perform app.svc_owner(p_tenant_id);
  select * into v_sub from public.subscriptions s where s.tenant_id = p_tenant_id and s.status = 'active';
  if found then
    select * into v_ver from public.offering_versions v where v.id = v_sub.offering_version_id;
  else
    -- Sem assinatura registrada: plano Grátis (versão atual).
    select v.* into v_ver from public.offering_versions v join public.platform_offerings o on o.id = v.offering_id
    where o.code = 'free' order by v.version_no desc limit 1;
  end if;
  return jsonb_build_object(
    'subscription', case when v_sub.id is null then null else jsonb_build_object('id', v_sub.id, 'price_cents', v_sub.price_cents,
      'scope_hash', v_sub.scope_hash, 'started_at', app.sched_ts(v_sub.started_at), 'billing_source', v_sub.billing_source) end,
    'plan', app.svc_version_json(v_ver),
    'plan_is_latest', app.svc_is_latest(v_ver.id),
    'usage', (select jsonb_build_object('agent_questions_used',
        case when q.period_start = date_trunc('month', now())::date then q.used else 0 end,
        'agent_questions_limit', q.monthly_limit, 'period_start', q.period_start::text)
      from public.agent_quotas q where q.tenant_id = p_tenant_id),
    'catalog', coalesce((select jsonb_agg(app.svc_version_json(v) order by o.kind, v.price_cents, o.code)
      from public.offering_versions v join public.platform_offerings o on o.id = v.offering_id
      where v.version_no = (select max(x.version_no) from public.offering_versions x where x.offering_id = v.offering_id)),
      '[]'::jsonb)
  );
end $$;

/** Troca de plano: fixa a versão vista (hash) e aplica a franquia na mesma transação. Não cobra nada. */
create function public.service_plan_subscribe(
  p_tenant_id uuid,
  p_offering_version_id uuid,
  p_scope_hash text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_ver public.offering_versions;
  v_kind text;
  v_old public.subscriptions;
  v_sub public.subscriptions;
  v_body jsonb;
begin
  perform app.svc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'plan.subscribe', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_ver from public.offering_versions v where v.id = p_offering_version_id;
  select o.kind into v_kind from public.platform_offerings o where o.id = v_ver.offering_id;
  if v_ver.id is null or v_kind <> 'plan' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'offering_version_id';
  end if;
  if not app.svc_is_latest(v_ver.id) or v_ver.scope_hash <> p_scope_hash then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  -- Serializa trocas de plano do mesmo negócio.
  -- NO KEY UPDATE: não conflita com o KEY SHARE que as FKs (idempotência, auditoria) já tomaram no tenant.
  perform 1 from public.tenants t where t.id = p_tenant_id for no key update;
  select * into v_old from public.subscriptions s where s.tenant_id = p_tenant_id and s.status = 'active';
  if v_old.offering_version_id = v_ver.id then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'offering_version_id';
  end if;
  if v_old.id is not null then
    update public.subscriptions s set status = 'replaced', ended_at = clock_timestamp() where s.id = v_old.id;
  end if;
  insert into public.subscriptions (tenant_id, offering_version_id, price_cents, scope_hash, created_by)
  values (p_tenant_id, v_ver.id, v_ver.price_cents, v_ver.scope_hash, v_uid)
  returning * into v_sub;
  perform app.svc_apply_plan(p_tenant_id, v_ver);
  v_body := public.service_plan_current(p_tenant_id);
  perform app.audit(p_tenant_id, 'plan.subscribe', 'subscription', v_sub.id, p_request_id,
    case when v_old.id is null then null else jsonb_build_object('offering_version_id', v_old.offering_version_id) end,
    jsonb_build_object('offering_version_id', v_ver.id, 'price_cents', v_ver.price_cents));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'plan.subscribe', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: pedidos, entregas e acesso
-- ---------------------------------------------------------------------------

create function public.service_order_request(
  p_tenant_id uuid,
  p_offering_version_id uuid,
  p_scope_hash text,
  p_notes text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_ver public.offering_versions;
  v_kind text;
  v_row public.service_orders;
  v_body jsonb;
begin
  perform app.svc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'order.request', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select o.kind into v_kind from public.offering_versions v join public.platform_offerings o on o.id = v.offering_id
  where v.id = p_offering_version_id;
  if v_kind is distinct from 'service' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'offering_version_id';
  end if;
  select * into v_ver from public.offering_versions v where v.id = p_offering_version_id;
  if not app.svc_is_latest(v_ver.id) or v_ver.scope_hash <> p_scope_hash then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'notes';
  end if;
  insert into public.service_orders (tenant_id, offering_version_id, scope_hash, price_cents, minutes_quota, notes, requested_by)
  values (p_tenant_id, v_ver.id, v_ver.scope_hash, v_ver.price_cents, v_ver.assisted_minutes, nullif(btrim(coalesce(p_notes, '')), ''), v_uid)
  returning * into v_row;
  insert into public.service_order_events (tenant_id, order_id, from_status, to_status, actor_user_id, note)
  values (p_tenant_id, v_row.id, null, v_row.status, v_uid, 'Pedido com escopo aceito');
  v_body := jsonb_build_object('order', app.svc_order_json(v_row));
  perform app.audit(p_tenant_id, 'order.request', 'service_order', v_row.id, p_request_id, null,
    jsonb_build_object('offering_version_id', v_ver.id, 'scope_hash', v_ver.scope_hash, 'price_cents', v_ver.price_cents));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'order.request', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.service_order_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.svc_owner(p_tenant_id);
  return jsonb_build_object('orders', coalesce((select jsonb_agg(app.svc_order_json(s) || jsonb_build_object(
      'deliverables', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'version_no', d.version_no, 'title', d.title,
          'evidence', d.evidence, 'delivered_at', app.sched_ts(d.delivered_at),
          'review', (select jsonb_build_object('decision', r.decision, 'note', r.note, 'decided_at', app.sched_ts(r.decided_at))
            from public.deliverable_reviews r where r.deliverable_id = d.id)) order by d.version_no desc)
        from public.deliverables d where d.order_id = s.id), '[]'::jsonb),
      'grants', coalesce((select jsonb_agg(app.svc_grant_json(g) order by g.granted_at desc)
        from public.access_grants g where g.order_id = s.id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('from_status', e.from_status, 'to_status', e.to_status,
          'note', e.note, 'occurred_at', app.sched_ts(e.occurred_at)) order by e.id desc)
        from (select * from public.service_order_events e where e.order_id = s.id order by e.id desc limit 20) e), '[]'::jsonb))
    order by s.created_at desc)
    from (select * from public.service_orders s where s.tenant_id = p_tenant_id order by s.created_at desc limit 50) s), '[]'::jsonb));
end $$;

create function public.service_order_cancel(
  p_tenant_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_row public.service_orders;
  v_body jsonb;
begin
  perform app.svc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'order.cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  if v_row.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_row.status in ('delivered', 'cancelled') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  v_row := app.svc_transition(v_row, 'cancelled', 'Cancelado pelo cliente');
  perform app.svc_revoke_order_grants(v_row.id);
  v_body := jsonb_build_object('order', app.svc_order_json(v_row));
  perform app.audit(p_tenant_id, 'order.cancel', 'service_order', v_row.id, p_request_id, null, jsonb_build_object('status', v_row.status));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'order.cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Dono aprova a entrega (encerra e revoga acessos) ou pede ajustes (reabre com registro). */
create function public.service_delivery_review(
  p_tenant_id uuid,
  p_order_id uuid,
  p_deliverable_id uuid,
  p_decision text,
  p_note text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_row public.service_orders;
  v_last uuid;
  v_body jsonb;
begin
  perform app.svc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'order.review_delivery', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'decision';
  end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  select d.id into v_last from public.deliverables d where d.order_id = v_row.id order by d.version_no desc limit 1;
  if v_row.status <> 'client_review' or v_last is distinct from p_deliverable_id then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'deliverable_id';
  end if;
  insert into public.deliverable_reviews (tenant_id, deliverable_id, decision, note, decided_by)
  values (p_tenant_id, p_deliverable_id, p_decision, nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  if p_decision = 'approved' then
    v_row := app.svc_transition(v_row, 'delivered', 'Entrega aprovada pelo cliente');
    perform app.svc_revoke_order_grants(v_row.id);
  else
    v_row := app.svc_transition(v_row, 'in_progress', 'Cliente pediu ajustes');
  end if;
  v_body := jsonb_build_object('order', app.svc_order_json(v_row));
  perform app.audit(p_tenant_id, 'order.review_delivery', 'service_order', v_row.id, p_request_id, null,
    jsonb_build_object('deliverable_id', p_deliverable_id, 'decision', p_decision));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'order.review_delivery', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.service_access_grant(
  p_tenant_id uuid,
  p_order_id uuid,
  p_scopes text[],
  p_expires_at timestamptz,
  p_justification text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_row public.service_orders;
  v_g public.access_grants;
  v_body jsonb;
begin
  perform app.svc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'access.grant', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  if v_row.assignee_user_id is null or v_row.status in ('delivered', 'cancelled') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'order_id';
  end if;
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '30 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'expires_at';
  end if;
  if p_scopes is null or cardinality(p_scopes) not between 1 and 3 or not (p_scopes <@ array['catalog', 'agenda', 'customers'])
     or p_justification is null or char_length(btrim(p_justification)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'scopes';
  end if;
  insert into public.access_grants (tenant_id, order_id, operator_user_id, scopes, justification, expires_at, granted_by)
  values (p_tenant_id, v_row.id, v_row.assignee_user_id, (select array_agg(distinct s order by s) from unnest(p_scopes) s),
    btrim(p_justification), p_expires_at, v_uid)
  returning * into v_g;
  v_body := jsonb_build_object('grant', app.svc_grant_json(v_g));
  perform app.audit(p_tenant_id, 'access.grant', 'access_grant', v_g.id, p_request_id, null,
    jsonb_build_object('order_id', v_row.id, 'operator_user_id', v_g.operator_user_id, 'scopes', to_jsonb(v_g.scopes),
      'expires_at', app.sched_ts(v_g.expires_at)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'access.grant', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.service_access_revoke(
  p_tenant_id uuid,
  p_grant_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_g public.access_grants;
  v_body jsonb;
begin
  perform app.svc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'access.revoke', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_g from public.access_grants g where g.tenant_id = p_tenant_id and g.id = p_grant_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_g.revoked_at is null then
    update public.access_grants g set revoked_at = clock_timestamp(), revoked_by = v_uid where g.id = v_g.id returning * into v_g;
    perform app.audit(p_tenant_id, 'access.revoke', 'access_grant', v_g.id, p_request_id, null, null);
  end if;
  v_body := jsonb_build_object('grant', app.svc_grant_json(v_g));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'access.revoke', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** O que a equipe Tinindo fez no negócio: concessões e cada leitura com acesso delegado. */
create function public.service_access_log(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.svc_owner(p_tenant_id);
  return jsonb_build_object('entries', coalesce((select jsonb_agg(jsonb_build_object('action', a.action,
      'actor_name', coalesce((select o.display_name from public.platform_operators o where o.user_id = a.actor_user_id), 'Você'),
      'object_id', a.object_id, 'scopes', a.after->'scopes', 'occurred_at', app.sched_ts(a.occurred_at)) order by a.id desc)
    from (select * from public.audit_events a where a.tenant_id = p_tenant_id
          and a.action in ('access.grant', 'access.revoke', 'access.read', 'ops.start', 'ops.log_work', 'ops.deliver', 'ops.block')
          order by a.id desc limit 100) a), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Operação Tinindo
-- ---------------------------------------------------------------------------

/** Fila da operação: pedidos de todos os negócios, sem dados de clientes dos negócios. */
create function public.service_ops_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
begin
  v_op := app.svc_operator();
  return jsonb_build_object('operator', jsonb_build_object('user_id', v_op.user_id, 'display_name', v_op.display_name),
    'operators', (select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'display_name', o.display_name) order by o.display_name)
      from public.platform_operators o where o.active),
    'orders', coalesce((select jsonb_agg(app.svc_order_json(s) || jsonb_build_object('tenant_name', t.name,
        'has_access', (app.svc_active_grant(s.id, v_op.user_id)).id is not null,
        'access_scopes', coalesce(to_jsonb((app.svc_active_grant(s.id, v_op.user_id)).scopes), '[]'::jsonb))
      order by s.due_at nulls last, s.created_at)
      from (select * from public.service_orders s
            where s.status not in ('delivered', 'cancelled') or s.updated_at > clock_timestamp() - interval '30 days'
            order by s.created_at limit 200) s
      join public.tenants t on t.id = s.tenant_id), '[]'::jsonb));
end $$;

create function public.service_ops_assign(
  p_tenant_id uuid,
  p_order_id uuid,
  p_assignee_user_id uuid,
  p_due_at timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
  v_replay jsonb;
  v_row public.service_orders;
  v_body jsonb;
begin
  v_op := app.svc_operator();
  v_replay := app.idempotency_claim(p_tenant_id, v_op.user_id, 'ops.assign', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  if v_row.status in ('delivered', 'cancelled') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  perform 1 from public.platform_operators o where o.user_id = p_assignee_user_id and o.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'assignee_user_id';
  end if;
  if p_due_at is not null and p_due_at <= clock_timestamp() then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'due_at';
  end if;
  if v_row.assignee_user_id is distinct from p_assignee_user_id then
    -- Troca de responsável: acesso é pessoal, o anterior perde o acesso.
    perform app.svc_revoke_order_grants(v_row.id);
  end if;
  update public.service_orders s set assignee_user_id = p_assignee_user_id, due_at = coalesce(p_due_at, s.due_at)
  where s.id = v_row.id returning * into v_row;
  if v_row.status in ('scope_accepted', 'in_progress') and (app.svc_active_grant(v_row.id, p_assignee_user_id)).id is null then
    v_row := app.svc_transition(v_row, 'awaiting_access', 'Responsável definido; aguardando acesso do cliente');
  end if;
  v_body := jsonb_build_object('order', app.svc_order_json(v_row));
  perform app.audit(p_tenant_id, 'ops.assign', 'service_order', v_row.id, p_request_id, null,
    jsonb_build_object('assignee_user_id', p_assignee_user_id));
  perform app.idempotency_complete(p_tenant_id, v_op.user_id, 'ops.assign', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.service_ops_start(
  p_tenant_id uuid,
  p_order_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
  v_replay jsonb;
  v_row public.service_orders;
  v_body jsonb;
begin
  v_op := app.svc_operator();
  v_replay := app.idempotency_claim(p_tenant_id, v_op.user_id, 'ops.start', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  if v_row.assignee_user_id is distinct from v_op.user_id then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if v_row.status not in ('scope_accepted', 'awaiting_access', 'blocked') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if (app.svc_active_grant(v_row.id, v_op.user_id)).id is null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'access';
  end if;
  v_row := app.svc_transition(v_row, 'in_progress', 'Execução iniciada');
  v_body := jsonb_build_object('order', app.svc_order_json(v_row));
  perform app.audit(p_tenant_id, 'ops.start', 'service_order', v_row.id, p_request_id, null, null);
  perform app.idempotency_complete(p_tenant_id, v_op.user_id, 'ops.start', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Minutos medidos. A franquia do pedido é o teto: acima dela, 429 e nada é gravado. */
create function public.service_ops_log_work(
  p_tenant_id uuid,
  p_order_id uuid,
  p_minutes integer,
  p_kind text,
  p_reprocess boolean,
  p_note text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
  v_replay jsonb;
  v_row public.service_orders;
  v_used integer;
  v_log public.work_logs;
  v_body jsonb;
begin
  v_op := app.svc_operator();
  v_replay := app.idempotency_claim(p_tenant_id, v_op.user_id, 'ops.log_work', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  if v_row.assignee_user_id is distinct from v_op.user_id then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if v_row.status not in ('in_progress', 'client_review') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if p_minutes is null or p_minutes not between 1 and 480 or p_kind is null or p_kind not in ('human', 'automation')
     or (p_note is not null and char_length(p_note) > 280) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'minutes';
  end if;
  select coalesce(sum(w.minutes), 0) into v_used from public.work_logs w where w.order_id = v_row.id;
  if v_used + p_minutes > v_row.minutes_quota then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'minutes';
  end if;
  insert into public.work_logs (tenant_id, order_id, operator_user_id, minutes, kind, reprocess, note)
  values (p_tenant_id, v_row.id, v_op.user_id, p_minutes, p_kind, coalesce(p_reprocess, false), nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_log;
  v_body := jsonb_build_object('order', app.svc_order_json(v_row), 'work_log_id', v_log.id);
  perform app.audit(p_tenant_id, 'ops.log_work', 'service_order', v_row.id, p_request_id, null,
    jsonb_build_object('minutes', p_minutes, 'kind', p_kind, 'reprocess', v_log.reprocess));
  perform app.idempotency_complete(p_tenant_id, v_op.user_id, 'ops.log_work', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.service_ops_deliver(
  p_tenant_id uuid,
  p_order_id uuid,
  p_title text,
  p_evidence text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
  v_replay jsonb;
  v_row public.service_orders;
  v_d public.deliverables;
  v_body jsonb;
begin
  v_op := app.svc_operator();
  v_replay := app.idempotency_claim(p_tenant_id, v_op.user_id, 'ops.deliver', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  if v_row.assignee_user_id is distinct from v_op.user_id then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if v_row.status <> 'in_progress' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120
     or p_evidence is null or char_length(btrim(p_evidence)) not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'evidence';
  end if;
  insert into public.deliverables (tenant_id, order_id, version_no, title, evidence, delivered_by)
  values (p_tenant_id, v_row.id, coalesce((select max(d.version_no) from public.deliverables d where d.order_id = v_row.id), 0) + 1,
    btrim(p_title), btrim(p_evidence), v_op.user_id)
  returning * into v_d;
  v_row := app.svc_transition(v_row, 'client_review', 'Entrega para revisão do cliente');
  v_body := jsonb_build_object('order', app.svc_order_json(v_row), 'deliverable_id', v_d.id);
  perform app.audit(p_tenant_id, 'ops.deliver', 'service_order', v_row.id, p_request_id, null,
    jsonb_build_object('deliverable_id', v_d.id, 'version_no', v_d.version_no));
  perform app.idempotency_complete(p_tenant_id, v_op.user_id, 'ops.deliver', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.service_ops_block(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
  v_replay jsonb;
  v_row public.service_orders;
  v_body jsonb;
begin
  v_op := app.svc_operator();
  v_replay := app.idempotency_claim(p_tenant_id, v_op.user_id, 'ops.block', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_row := app.svc_lock_order(p_tenant_id, p_order_id);
  if v_row.status in ('delivered', 'cancelled', 'blocked') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;
  v_row := app.svc_transition(v_row, 'blocked', btrim(p_reason));
  v_body := jsonb_build_object('order', app.svc_order_json(v_row));
  perform app.audit(p_tenant_id, 'ops.block', 'service_order', v_row.id, p_request_id, null, null);
  perform app.idempotency_complete(p_tenant_id, v_op.user_id, 'ops.block', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/**
 * Leitura com acesso delegado: só o responsável com concessão ativa, só os escopos concedidos, dados mínimos
 * (sem telefone, e-mail ou observações). Cada leitura é auditada e aparece para o dono.
 */
create function public.service_ops_snapshot(p_tenant_id uuid, p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
  v_row public.service_orders;
  v_g public.access_grants;
begin
  v_op := app.svc_operator();
  select * into v_row from public.service_orders s where s.tenant_id = p_tenant_id and s.id = p_order_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_g := app.svc_active_grant(v_row.id, v_op.user_id);
  if v_g.id is null or v_row.status in ('delivered', 'cancelled') then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  perform app.audit(p_tenant_id, 'access.read', 'access_grant', v_g.id, null, null, jsonb_build_object('scopes', to_jsonb(v_g.scopes)));
  return jsonb_build_object('scopes', to_jsonb(v_g.scopes), 'expires_at', app.sched_ts(v_g.expires_at),
    'tenant_name', (select t.name from public.tenants t where t.id = p_tenant_id),
    'catalog', case when 'catalog' = any (v_g.scopes) then coalesce((select jsonb_agg(jsonb_build_object('name', s.name,
        'duration_min', s.duration_min, 'base_price_cents', s.base_price_cents, 'active', s.active) order by s.name)
      from public.provider_services s where s.tenant_id = p_tenant_id), '[]'::jsonb) end,
    'agenda', case when 'agenda' = any (v_g.scopes) then coalesce((select jsonb_agg(jsonb_build_object(
        'starts_at', app.sched_ts(b.starts_at), 'ends_at', app.sched_ts(b.ends_at), 'status', b.status,
        'service_name', (select s.name from public.provider_services s where s.tenant_id = b.tenant_id and s.id = b.service_id))
        order by b.starts_at)
      from (select * from public.bookings b where b.tenant_id = p_tenant_id and b.blocks_capacity
            and b.starts_at >= clock_timestamp() and b.starts_at < clock_timestamp() + interval '14 days'
            order by b.starts_at limit 200) b), '[]'::jsonb) end,
    'customers', case when 'customers' = any (v_g.scopes) then jsonb_build_object(
      'count', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.archived_at is null),
      'names', coalesce((select jsonb_agg(c.name order by c.name) from (select c.name from public.customers c
        where c.tenant_id = p_tenant_id and c.archived_at is null order by c.name limit 200) c), '[]'::jsonb)) end);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.svc_publish_offering(text, text, text, text, bigint, text, jsonb, jsonb, integer, integer, integer) from public;
grant execute on function app.svc_publish_offering(text, text, text, text, bigint, text, jsonb, jsonb, integer, integer, integer) to service_role;
revoke all on function app.svc_grant_guard() from public;
revoke all on function app.svc_owner(uuid) from public;
revoke all on function app.svc_operator() from public;
revoke all on function app.svc_version_json(public.offering_versions) from public;
revoke all on function app.svc_is_latest(uuid) from public;
revoke all on function app.svc_minutes_used(uuid) from public;
revoke all on function app.svc_grant_json(public.access_grants) from public;
revoke all on function app.svc_order_json(public.service_orders) from public;
revoke all on function app.svc_active_grant(uuid, uuid) from public;
revoke all on function app.svc_transition(public.service_orders, text, text) from public;
revoke all on function app.svc_revoke_order_grants(uuid) from public;
revoke all on function app.svc_lock_order(uuid, uuid) from public;
revoke all on function app.svc_apply_plan(uuid, public.offering_versions) from public;

revoke all on function public.service_plan_current(uuid) from public, anon;
revoke all on function public.service_plan_subscribe(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.service_order_request(uuid, uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.service_order_list(uuid) from public, anon;
revoke all on function public.service_order_cancel(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.service_delivery_review(uuid, uuid, uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.service_access_grant(uuid, uuid, text[], timestamptz, text, text, text, uuid) from public, anon;
revoke all on function public.service_access_revoke(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.service_access_log(uuid) from public, anon;
revoke all on function public.service_ops_queue() from public, anon;
revoke all on function public.service_ops_assign(uuid, uuid, uuid, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.service_ops_start(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.service_ops_log_work(uuid, uuid, integer, text, boolean, text, text, text, uuid) from public, anon;
revoke all on function public.service_ops_deliver(uuid, uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.service_ops_block(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.service_ops_snapshot(uuid, uuid) from public, anon;

grant execute on function public.service_plan_current(uuid) to authenticated;
grant execute on function public.service_plan_subscribe(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.service_order_request(uuid, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.service_order_list(uuid) to authenticated;
grant execute on function public.service_order_cancel(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.service_delivery_review(uuid, uuid, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.service_access_grant(uuid, uuid, text[], timestamptz, text, text, text, uuid) to authenticated;
grant execute on function public.service_access_revoke(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.service_access_log(uuid) to authenticated;
grant execute on function public.service_ops_queue() to authenticated;
grant execute on function public.service_ops_assign(uuid, uuid, uuid, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.service_ops_start(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.service_ops_log_work(uuid, uuid, integer, text, boolean, text, text, text, uuid) to authenticated;
grant execute on function public.service_ops_deliver(uuid, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.service_ops_block(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.service_ops_snapshot(uuid, uuid) to authenticated;

alter table public.platform_operators enable row level security;
alter table public.platform_offerings enable row level security;
alter table public.offering_versions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.service_orders enable row level security;
alter table public.service_order_events enable row level security;
alter table public.work_logs enable row level security;
alter table public.deliverables enable row level security;
alter table public.deliverable_reviews enable row level security;
alter table public.access_grants enable row level security;

revoke all on public.platform_operators, public.platform_offerings, public.offering_versions, public.subscriptions,
  public.service_orders, public.service_order_events, public.work_logs, public.deliverables, public.deliverable_reviews,
  public.access_grants from anon, authenticated;
-- Catálogo é público para quem está logado; o resto do negócio, só o dono. Operadores leem pelas RPCs.
grant select on public.platform_offerings, public.offering_versions, public.subscriptions, public.service_orders,
  public.service_order_events, public.work_logs, public.deliverables, public.deliverable_reviews, public.access_grants
  to authenticated;
grant select, insert, update on public.platform_operators, public.platform_offerings, public.subscriptions,
  public.service_orders, public.access_grants to service_role;
grant select, insert on public.offering_versions, public.service_order_events, public.work_logs, public.deliverables,
  public.deliverable_reviews to service_role;

create policy platform_offerings_select on public.platform_offerings for select to authenticated using (true);
create policy offering_versions_select on public.offering_versions for select to authenticated using (true);
create policy subscriptions_select_owner on public.subscriptions
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy service_orders_select_owner on public.service_orders
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy service_order_events_select_owner on public.service_order_events
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy work_logs_select_owner on public.work_logs
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy deliverables_select_owner on public.deliverables
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy deliverable_reviews_select_owner on public.deliverable_reviews
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy access_grants_select_owner on public.access_grants
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
