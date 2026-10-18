-- P08 · Assistente do dono: leituras agregadas para as ferramentas, propostas de ação com hash/versão/prazo,
-- aprovação vinculante de uso único, execução idempotente com recibo e cota mensal por negócio.
--
-- Regras (docs/04, docs/05):
-- * O assistente só LÊ por estas RPCs e só PROPÕE. Nada muda sem action.approve + action.execute do dono.
-- * Aprovar ≠ executar: a execução repete a checagem atual (agenda, preço, versão) e pode recusar
--   (rejected_by_policy). Aprovação vale para o hash e a versão vistos, por 15 minutos, uma vez.
-- * Execução reaproveita as funções do P03/P05 (mesmos locks, eventos e auditoria); origem 'agent'.
-- * Nenhum texto livre do usuário é guardado aqui (sem pergunta, sem resposta); auditoria só com IDs.
-- * Não existe SQL livre: a lista de ferramentas é fechada (check em agent_proposals.tool).
-- Depende de: fundação, P01, P02, P03, P05, P06, P07.

-- ---------------------------------------------------------------------------
-- Cota mensal e execuções do assistente
-- ---------------------------------------------------------------------------

create table public.agent_quotas (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  monthly_limit integer not null default 200 check (monthly_limit between 0 and 100000),
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.agent_quotas is 'Franquia mensal de perguntas ao assistente por negócio. Débito atômico em agent_run_start.';

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null,
  idem_key text not null check (char_length(idem_key) between 16 and 128),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, idem_key),
  unique (tenant_id, id)
);
comment on table public.agent_runs is 'Uma pergunta debitada. Sem texto da pergunta nem da resposta.';
create trigger agent_runs_append_only before update or delete on public.agent_runs
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Propostas, aprovações e recibos
-- ---------------------------------------------------------------------------

create table public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  run_id uuid,
  tool text not null check (tool in ('booking.create', 'booking.reschedule', 'booking.cancel', 'pricing.propose_rule')),
  -- Payload normalizado exatamente como será executado.
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  policy_version integer not null check (policy_version >= 1),
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  state text not null default 'pending'
    check (state in ('pending', 'approved', 'rejected', 'expired', 'invalidated', 'executed')),
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint agent_proposals_run foreign key (tenant_id, run_id)
    references public.agent_runs (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.agent_proposals is 'Ação proposta pelo assistente. Só vira efeito com aprovação e execução do dono.';
create index agent_proposals_pending on public.agent_proposals (tenant_id, created_at) where state = 'pending';
create trigger agent_proposals_touch before update on public.agent_proposals
  for each row execute function app.touch_row();

create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  proposal_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  proposal_version integer not null check (proposal_version >= 1),
  approver_user_id uuid not null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint agent_approvals_proposal foreign key (tenant_id, proposal_id)
    references public.agent_proposals (tenant_id, id) on delete restrict,
  -- Uma aprovação por proposta: nunca duas aprovações executáveis para o mesmo payload.
  unique (tenant_id, proposal_id),
  unique (tenant_id, id)
);
comment on table public.agent_approvals is 'Aprovação do dono vinculada a hash e versão. Append-only; uso único via recibo.';
create trigger agent_approvals_append_only before update or delete on public.agent_approvals
  for each row execute function app.forbid_mutation();

create table public.agent_receipts (
  approval_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  status text not null check (status in ('executed', 'rejected_by_policy', 'failed')),
  reason_code text check (reason_code ~ '^[A-Z_]{3,40}$'),
  result_kind text check (char_length(result_kind) <= 40),
  result_id uuid,
  executed_by uuid,
  executed_at timestamptz not null default now(),
  constraint agent_receipts_approval foreign key (tenant_id, approval_id)
    references public.agent_approvals (tenant_id, id) on delete restrict,
  constraint agent_receipts_ref check ((result_kind is null) = (result_id is null)),
  unique (tenant_id, approval_id)
);
comment on table public.agent_receipts is 'Resultado da execução de uma aprovação. Repetir a execução devolve o mesmo recibo.';
create trigger agent_receipts_append_only before update or delete on public.agent_receipts
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Internas
-- ---------------------------------------------------------------------------

create function app.agent_policy_version() returns integer
language sql immutable set search_path = '' as $$ select 1 $$;

create function app.agent_proposal_minutes() returns integer
language sql immutable set search_path = '' as $$ select 30 $$;

create function app.agent_approval_minutes() returns integer
language sql immutable set search_path = '' as $$ select 15 $$;

/** sha256 do payload normalizado (jsonb) + versão da política. */
create function app.agent_hash(p_payload jsonb, p_policy integer) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_payload::text || '|policy:' || p_policy::text, 'UTF8')), 'hex')
$$;

create function app.agent_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.agent_proposal_json(p public.agent_proposals) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('proposal_id', p.id, 'tenant_id', p.tenant_id, 'tool', p.tool, 'payload', p.payload,
    'payload_hash', p.payload_hash, 'policy_version', p.policy_version, 'version', p.version,
    'expires_at', app.sched_ts(p.expires_at),
    -- Prazo vencido aparece como expirado mesmo antes de alguém tocar na linha.
    'approval_state', case when p.state = 'pending' and p.expires_at <= clock_timestamp() then 'expired' else p.state end,
    'summary', p.summary)
$$;

create function app.agent_approval_json(a public.agent_approvals) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('approval_id', a.id, 'proposal_id', a.proposal_id, 'approver_user_id', a.approver_user_id,
    'approved_at', app.sched_ts(a.approved_at), 'expires_at', app.sched_ts(a.expires_at))
$$;

create function app.agent_receipt_json(r public.agent_receipts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('approval_id', r.approval_id, 'status', r.status,
    'result_ref', case when r.result_id is null then null
                       else jsonb_build_object('kind', r.result_kind, 'id', r.result_id) end,
    'executed_at', app.sched_ts(r.executed_at))
$$;

/** Campos obrigatórios de cada ferramenta (forma). O conteúdo é revalidado na execução pelas RPCs reais. */
create function app.agent_payload_ok(p_tool text, p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case p_tool
    when 'booking.create' then p ?& array['service_id', 'resource_id', 'starts_at', 'ends_at', 'expected_price_cents']
      and jsonb_typeof(p->'expected_price_cents') = 'number'
    when 'booking.reschedule' then p ?& array['booking_id', 'expected_version', 'starts_at', 'ends_at']
      and jsonb_typeof(p->'expected_version') = 'number'
    when 'booking.cancel' then p ?& array['booking_id', 'expected_version', 'reason']
      and jsonb_typeof(p->'expected_version') = 'number'
    when 'pricing.propose_rule' then p ?& array['rules', 'valid_from', 'valid_to']
      and jsonb_typeof(p->'rules') = 'array' and jsonb_array_length(p->'rules') between 1 and 20
    else false
  end
$$;

/**
 * Executa a ferramenta da proposta com as funções do módulo dono do dado. Erros de negócio sobem como
 * PTxxx para o chamador transformar em rejected_by_policy. Devolve {kind, id} do objeto afetado.
 */
create function app.agent_execute(p public.agent_proposals, p_approval_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := 'agent-exec-' || p_approval_id::text;
  v_q jsonb;
  v_b public.bookings;
  v_res jsonb;
  v_rule jsonb;
  v_first uuid;
begin
  if p.tool = 'booking.create' then
    -- Cotação nova no momento da execução: preço diferente do aprovado não executa.
    v_q := public.pricing_quote(p.tenant_id, (p.payload->>'service_id')::uuid, (p.payload->>'resource_id')::uuid,
      (p.payload->>'starts_at')::timestamptz, (p.payload->>'ends_at')::timestamptz);
    if (v_q->>'final_price_cents')::bigint <> (p.payload->>'expected_price_cents')::bigint then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'price',
        detail = 'preço mudou depois da proposta';
    end if;
    v_b := app.sched_insert_booking(p.tenant_id, (p.payload->>'resource_id')::uuid, (p.payload->>'service_id')::uuid,
      (p.payload->>'customer_id')::uuid, null, (p.payload->>'starts_at')::timestamptz,
      (p.payload->>'ends_at')::timestamptz, (v_q->>'quote_id')::uuid, 'confirm', 'agent', null, p_request_id);
    return jsonb_build_object('kind', 'booking', 'id', v_b.id);
  elsif p.tool = 'booking.reschedule' then
    v_res := public.scheduling_booking_reschedule(p.tenant_id, (p.payload->>'booking_id')::uuid,
      (p.payload->>'expected_version')::integer, (p.payload->>'starts_at')::timestamptz,
      (p.payload->>'ends_at')::timestamptz, null, v_key, p.payload_hash, p_request_id);
    return jsonb_build_object('kind', 'booking', 'id', v_res->'body'->'booking'->>'id');
  elsif p.tool = 'booking.cancel' then
    v_res := public.scheduling_booking_cancel(p.tenant_id, (p.payload->>'booking_id')::uuid,
      (p.payload->>'expected_version')::integer, p.payload->>'reason', v_key, p.payload_hash, p_request_id);
    return jsonb_build_object('kind', 'booking', 'id', v_res->'body'->'booking'->>'id');
  elsif p.tool = 'pricing.propose_rule' then
    -- Cria propostas de regra no P05 (inativas): publicar continua sendo uma decisão na tela de preços.
    for v_rule in select * from jsonb_array_elements(p.payload->'rules') loop
      v_res := public.pricing_propose_rule(p.tenant_id, (v_rule->>'service_id')::uuid, v_rule->'windows',
        (v_rule->>'discount_bps')::integer, (v_rule->>'max_discount_bps')::integer,
        coalesce((v_rule->>'target_margin_bps')::integer, 0), (p.payload->>'valid_from')::timestamptz,
        (p.payload->>'valid_to')::timestamptz,
        'agent-exec-' || encode(sha256(convert_to(p_approval_id::text || (v_rule->>'service_id'), 'UTF8')), 'hex'),
        p.payload_hash, p_request_id);
      v_first := coalesce(v_first, (v_res->'body'->>'proposal_id')::uuid);
    end loop;
    return jsonb_build_object('kind', 'pricing_proposal', 'id', v_first);
  end if;
  raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'tool';
end $$;

-- ---------------------------------------------------------------------------
-- RPCs de leitura (ferramentas). Todas exigem vínculo; o tenant vem da sessão validada.
-- ---------------------------------------------------------------------------

/**
 * Início de uma pergunta: vínculo + débito atômico da franquia mensal. A mesma chave não debita de novo.
 * Também devolve o contexto (papel, nome e fuso) para o servidor do assistente.
 */
create function public.agent_run_start(p_tenant_id uuid, p_idem_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text := app.member_role(p_tenant_id);
  v_run public.agent_runs;
  v_q public.agent_quotas;
  v_month date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
  v_t public.tenants;
  v_replay boolean := false;
begin
  if v_uid is null or v_role is null then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_idem_key is null or char_length(p_idem_key) not between 16 and 128 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'idempotency_key';
  end if;
  insert into public.agent_quotas (tenant_id, period_start) values (p_tenant_id, v_month)
  on conflict (tenant_id) do nothing;
  select * into v_q from public.agent_quotas q where q.tenant_id = p_tenant_id for update;

  select * into v_run from public.agent_runs r
  where r.tenant_id = p_tenant_id and r.user_id = v_uid and r.idem_key = p_idem_key;
  if found then
    v_replay := true;
  else
    if v_q.period_start < v_month then
      update public.agent_quotas q set period_start = v_month, used = 0, updated_at = now()
      where q.tenant_id = p_tenant_id returning * into v_q;
    end if;
    if v_q.used >= v_q.monthly_limit then
      raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED';
    end if;
    update public.agent_quotas q set used = q.used + 1, updated_at = now()
    where q.tenant_id = p_tenant_id returning * into v_q;
    insert into public.agent_runs (tenant_id, user_id, idem_key) values (p_tenant_id, v_uid, p_idem_key)
    returning * into v_run;
  end if;

  select * into v_t from public.tenants t where t.id = p_tenant_id;
  return jsonb_build_object('run_id', v_run.id, 'replay', v_replay, 'role', v_role, 'tenant_name', v_t.name,
    'timezone', v_t.timezone, 'quota', jsonb_build_object('limit', v_q.monthly_limit, 'used', v_q.used,
      'renews_at', app.sched_ts(((v_q.period_start + interval '1 month')::timestamp) at time zone 'UTC')));
end $$;

/** agenda.read: expediente, bloqueios e reservas ativas da janela (até 62 dias). */
create function public.agent_agenda_read(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plans jsonb;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_plans := public.scheduling_day_plans(p_tenant_id, p_from, p_to);
  return jsonb_build_object(
    'resource_id', v_plans->'resource_id',
    'timezone', v_plans->'timezone',
    'days', v_plans->'days',
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'service_id', b.service_id,
        'customer_id', b.customer_id, 'starts_at', app.sched_ts(b.starts_at), 'ends_at', app.sched_ts(b.ends_at),
        'occupied', app.sched_range_json(b.occupied_range), 'status', b.status,
        'agreed_price_cents', b.agreed_price_cents, 'version', b.version) order by b.starts_at, b.id)
      from (select * from public.bookings b
            where b.tenant_id = p_tenant_id and b.starts_at >= p_from and b.starts_at < p_to
              and b.status in ('held', 'confirmed', 'completed', 'no_show')
            order by b.starts_at, b.id limit 500) b), '[]'::jsonb),
    'as_of', app.sched_ts(clock_timestamp()));
end $$;

/**
 * Contexto do negócio para entender o pedido: serviços, clientes (nome e origem declarada), regras de preço
 * ativas, política de cancelamento e um resumo da lista de espera (só contagens, sem recado de cliente).
 */
create function public.agent_directory(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := app.member_role(p_tenant_id);
  v_total integer;
begin
  if v_role is null then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select count(*) into v_total from public.customers c where c.tenant_id = p_tenant_id and c.archived_at is null;
  return jsonb_build_object(
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration_min', s.duration_min,
        'buffer_before_min', s.buffer_before_min, 'buffer_after_min', s.buffer_after_min,
        'base_price_cents', s.base_price_cents, 'min_price_cents', s.min_price_cents,
        'estimated_cost_cents', s.estimated_cost_cents, 'fee_bps', s.fee_bps) order by s.name_key, s.id)
      from public.provider_services s where s.tenant_id = p_tenant_id and s.active), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'declared_source', c.declared_source) order by c.name_key, c.id)
      from (select * from public.customers c where c.tenant_id = p_tenant_id and c.archived_at is null
            order by c.name_key, c.id limit 500) c), '[]'::jsonb),
    'customers_total', v_total,
    'pricing_rules', coalesce((select jsonb_agg(jsonb_build_object('service_id', r.service_id,
        'rule_version', r.rule_version, 'windows', r.windows, 'discount_bps', r.discount_bps,
        'max_discount_bps', r.max_discount_bps, 'target_margin_bps', r.target_margin_bps,
        'valid', app.sched_range_json(r.valid)) order by r.service_id)
      from public.pricing_rules r where r.tenant_id = p_tenant_id and r.active), '[]'::jsonb),
    'cancellation', (select jsonb_build_object('notice_hours', o.cancellation_notice_hours,
        'late_fee_bps', o.late_cancellation_fee_bps)
      from public.tenant_onboarding o where o.tenant_id = p_tenant_id and o.cancellation_notice_hours is not null),
    -- Lista de espera é do dono (RLS do P06): equipe não recebe nem a contagem.
    'waitlist', case when v_role = 'owner' then (select jsonb_build_object('active', count(*) filter (where e.status = 'active'),
        'offered', count(*) filter (where e.status = 'offered'),
        'by_service', coalesce(jsonb_agg(distinct e.service_id) filter (where e.status in ('active', 'offered')), '[]'::jsonb))
      from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.valid_until > clock_timestamp()) end,
    'as_of', app.sched_ts(clock_timestamp()));
end $$;

/** finance.summary: só o dono. Valores registrados no período, contas em aberto (agora) e pacotes. */
create function public.agent_finance_read(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pay record;
  v_exp record;
  v_open record;
  v_recv_count integer;
  v_first timestamptz;
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  select coalesce(sum(p.amount_cents), 0) as cents, count(*) as n into v_pay
  from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= p_from and p.received_at < p_to
    and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id);
  select coalesce(sum(e.amount_cents), 0) as cents, count(*) as n,
         coalesce(sum(e.amount_cents) filter (where e.category = 'supplies'), 0) as supplies_cents,
         count(*) filter (where e.category = 'supplies') as supplies_n
  into v_exp
  from public.expense_entries e
  where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= p_from and e.paid_at < p_to
    and not exists (select 1 from public.expense_entries x where x.reversal_of = e.id);
  select coalesce(sum(r.amount_cents - r.paid_cents), 0) as cents, count(*) as n, min(r.due_at) as next_due
  into v_open
  from public.receivables r where r.tenant_id = p_tenant_id and r.status in ('open', 'partially_paid');
  select count(*) into v_recv_count from public.receivables r
  where r.tenant_id = p_tenant_id and r.created_at >= p_from and r.created_at < p_to;
  select min(x.at) into v_first from (
    select min(p.received_at) as at from public.payment_entries p where p.tenant_id = p_tenant_id
    union all select min(e.paid_at) from public.expense_entries e where e.tenant_id = p_tenant_id
    union all select min(r.created_at) from public.receivables r where r.tenant_id = p_tenant_id) x;

  return jsonb_build_object(
    'period', jsonb_build_object('starts_at', app.fin_ts(p_from), 'ends_at', app.fin_ts(p_to)),
    'received_cents', v_pay.cents, 'payments_count', v_pay.n,
    'spent_cents', v_exp.cents, 'expenses_count', v_exp.n,
    'supplies_cents', v_exp.supplies_cents, 'supplies_count', v_exp.supplies_n,
    'receivable_open_cents', v_open.cents, 'receivable_open_count', v_open.n,
    'receivable_next_due_at', app.fin_ts(v_open.next_due),
    'records_count', v_pay.n + v_exp.n + v_recv_count,
    'first_record_at', app.fin_ts(v_first),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'customer_id', p.customer_id,
        'service_id', p.service_id, 'purchased_credits', p.purchased_credits,
        'remaining_credits', p.purchased_credits + coalesce((select sum(e.delta) from public.session_entries e
          where e.tenant_id = p.tenant_id and e.package_id = p.id), 0),
        'expires_at', app.fin_ts(p.expires_at)) order by p.created_at desc)
      from (select * from public.session_packages p where p.tenant_id = p_tenant_id
            order by p.created_at desc limit 200) p), '[]'::jsonb),
    'as_of', app.fin_ts(clock_timestamp()));
end $$;

-- ---------------------------------------------------------------------------
-- Proposta, aprovação e execução
-- ---------------------------------------------------------------------------

/** Grava a proposta pendente (nenhum efeito no negócio). Hash = sha256(payload normalizado + política). */
create function public.agent_proposal_create(
  p_tenant_id uuid,
  p_run_id uuid,
  p_tool text,
  p_payload jsonb,
  p_summary text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_row public.agent_proposals;
  v_body jsonb;
begin
  perform app.agent_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'agent.propose', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_tool is null or not app.agent_payload_ok(p_tool, coalesce(p_payload, '{}'::jsonb)) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'payload';
  end if;
  if p_summary is null or char_length(btrim(p_summary)) not between 1 and 1000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'summary';
  end if;
  if p_run_id is not null then
    perform 1 from public.agent_runs r where r.tenant_id = p_tenant_id and r.id = p_run_id;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'run_id';
    end if;
  end if;

  insert into public.agent_proposals (tenant_id, run_id, tool, payload, payload_hash, policy_version, summary,
    expires_at, created_by)
  values (p_tenant_id, p_run_id, p_tool, p_payload, app.agent_hash(p_payload, app.agent_policy_version()),
    app.agent_policy_version(), btrim(p_summary),
    clock_timestamp() + make_interval(mins => app.agent_proposal_minutes()), v_uid)
  returning * into v_row;

  perform app.audit(p_tenant_id, 'agent.propose', 'agent_proposal', v_row.id, p_request_id, null,
    jsonb_build_object('tool', v_row.tool, 'payload_hash', v_row.payload_hash));
  v_body := app.agent_proposal_json(v_row);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'agent.propose', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/**
 * Aprovação do dono para o hash e a versão vistos. Aprovar muda a versão da proposta: uma segunda aprovação
 * com a mesma versão recebe STALE_VERSION (nunca duas aprovações executáveis). Não executa nada.
 */
create function public.action_approve(
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
  v_p public.agent_proposals;
  v_a public.agent_approvals;
  v_body jsonb;
begin
  perform app.agent_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'action.approve', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  select * into v_p from public.agent_proposals p where p.tenant_id = p_tenant_id and p.id = p_proposal_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_p.version <> p_expected_version or v_p.state <> 'pending' then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if p_payload_hash is null or p_payload_hash <> v_p.payload_hash
     or v_p.payload_hash <> app.agent_hash(v_p.payload, v_p.policy_version)
     or v_p.policy_version <> app.agent_policy_version() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'payload_hash';
  end if;
  if v_p.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;

  insert into public.agent_approvals (tenant_id, proposal_id, payload_hash, proposal_version, approver_user_id, expires_at)
  values (p_tenant_id, v_p.id, v_p.payload_hash, v_p.version, v_uid,
    clock_timestamp() + make_interval(mins => app.agent_approval_minutes()))
  returning * into v_a;
  update public.agent_proposals p set state = 'approved'
  where p.tenant_id = p_tenant_id and p.id = v_p.id returning * into v_p;

  perform app.emit_event(p_tenant_id, 'agent.action.approved.v1', v_p.id, v_p.version,
    coalesce(p_request_id, gen_random_uuid()),
    jsonb_build_object('proposal_id', v_p.id, 'approval_id', v_a.id, 'tool', v_p.tool, 'payload_hash', v_p.payload_hash));
  perform app.audit(p_tenant_id, 'action.approve', 'agent_proposal', v_p.id, p_request_id,
    jsonb_build_object('state', 'pending'), jsonb_build_object('state', 'approved', 'approval_id', v_a.id));
  v_body := app.agent_approval_json(v_a);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'action.approve', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/**
 * Executa uma aprovação: checagem atual (prazo, estado, hash) + execução pela função do módulo dono.
 * Conflito de agenda, versão ou preço vira recibo rejected_by_policy e invalida a proposta (nova proposta
 * é necessária). Repetir com a mesma aprovação devolve o mesmo recibo, sem segundo efeito.
 */
create function public.action_execute(
  p_tenant_id uuid,
  p_approval_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_a public.agent_approvals;
  v_p public.agent_proposals;
  v_r public.agent_receipts;
  v_status text;
  v_reason text;
  v_ref jsonb;
  v_state text;
  v_body jsonb;
begin
  perform app.agent_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'action.execute', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  -- Ordem de locks: aprovação → proposta → (recurso/reserva dentro do módulo).
  select * into v_a from public.agent_approvals a where a.tenant_id = p_tenant_id and a.id = p_approval_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select * into v_r from public.agent_receipts r where r.tenant_id = p_tenant_id and r.approval_id = v_a.id;
  if found then
    v_body := app.agent_receipt_json(v_r);
    perform app.idempotency_complete(p_tenant_id, v_uid, 'action.execute', p_idem_key, 200, v_body);
    return jsonb_build_object('status_code', 200, 'body', v_body);
  end if;
  select * into v_p from public.agent_proposals p where p.tenant_id = p_tenant_id and p.id = v_a.proposal_id for update;

  if v_a.expires_at <= clock_timestamp() then
    v_status := 'rejected_by_policy'; v_reason := 'APPROVAL_EXPIRED'; v_state := 'expired';
  elsif v_p.state <> 'approved' or v_p.payload_hash <> v_a.payload_hash
        or v_p.payload_hash <> app.agent_hash(v_p.payload, v_p.policy_version) then
    v_status := 'rejected_by_policy'; v_reason := 'STALE_VERSION'; v_state := 'invalidated';
  else
    begin
      v_ref := app.agent_execute(v_p, v_a.id, p_request_id);
      v_status := 'executed'; v_state := 'executed';
    exception
      when sqlstate 'PT400' or sqlstate 'PT404' or sqlstate 'PT409' or sqlstate 'PT422' or data_exception then
        get stacked diagnostics v_reason = message_text;
        v_status := 'rejected_by_policy'; v_state := 'invalidated';
        if v_reason !~ '^[A-Z_]{3,40}$' then v_reason := 'VALIDATION_ERROR'; end if;
    end;
  end if;

  if v_p.state is distinct from v_state then
    update public.agent_proposals p set state = v_state where p.tenant_id = p_tenant_id and p.id = v_p.id;
  end if;
  insert into public.agent_receipts (approval_id, tenant_id, status, reason_code, result_kind, result_id, executed_by)
  values (v_a.id, p_tenant_id, v_status, v_reason, v_ref->>'kind', (v_ref->>'id')::uuid, v_uid)
  returning * into v_r;

  perform app.audit(p_tenant_id, 'action.execute', 'agent_proposal', v_p.id, p_request_id,
    jsonb_build_object('state', v_p.state),
    jsonb_build_object('state', v_state, 'receipt', v_status, 'reason', v_reason, 'result_id', v_r.result_id));
  v_body := app.agent_receipt_json(v_r);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'action.execute', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS: o dono lê; ninguém escreve direto (só pelas RPCs acima).
-- ---------------------------------------------------------------------------

revoke all on function app.agent_policy_version() from public;
revoke all on function app.agent_proposal_minutes() from public;
revoke all on function app.agent_approval_minutes() from public;
revoke all on function app.agent_hash(jsonb, integer) from public;
revoke all on function app.agent_owner(uuid) from public;
revoke all on function app.agent_proposal_json(public.agent_proposals) from public;
revoke all on function app.agent_approval_json(public.agent_approvals) from public;
revoke all on function app.agent_receipt_json(public.agent_receipts) from public;
revoke all on function app.agent_payload_ok(text, jsonb) from public;
revoke all on function app.agent_execute(public.agent_proposals, uuid, uuid) from public;

revoke all on function public.agent_run_start(uuid, text) from public, anon;
revoke all on function public.agent_agenda_read(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.agent_directory(uuid) from public, anon;
revoke all on function public.agent_finance_read(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.agent_proposal_create(uuid, uuid, text, jsonb, text, text, text, uuid) from public, anon;
revoke all on function public.action_approve(uuid, uuid, text, integer, text, text, uuid) from public, anon;
revoke all on function public.action_execute(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.agent_run_start(uuid, text) to authenticated;
grant execute on function public.agent_agenda_read(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.agent_directory(uuid) to authenticated;
grant execute on function public.agent_finance_read(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.agent_proposal_create(uuid, uuid, text, jsonb, text, text, text, uuid) to authenticated;
grant execute on function public.action_approve(uuid, uuid, text, integer, text, text, uuid) to authenticated;
grant execute on function public.action_execute(uuid, uuid, text, text, uuid) to authenticated;

alter table public.agent_quotas enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_proposals enable row level security;
alter table public.agent_approvals enable row level security;
alter table public.agent_receipts enable row level security;
revoke all on public.agent_quotas, public.agent_runs, public.agent_proposals, public.agent_approvals,
  public.agent_receipts from anon, authenticated;
grant select on public.agent_quotas, public.agent_proposals, public.agent_approvals, public.agent_receipts
  to authenticated;
grant select, insert, update on public.agent_quotas, public.agent_proposals to service_role;
grant select, insert on public.agent_runs, public.agent_approvals, public.agent_receipts to service_role;

create policy agent_quotas_select_owner on public.agent_quotas
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy agent_proposals_select_owner on public.agent_proposals
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy agent_approvals_select_owner on public.agent_approvals
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy agent_receipts_select_owner on public.agent_receipts
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
