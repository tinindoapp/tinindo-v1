-- P18 · Resultado e custo: indicadores com período, numerador, denominador e dados ausentes; baseline congelada;
-- comparação antes/depois sem atribuir causa; minutos medidos e custo de atendimento por cliente (operação Tinindo).
-- Definições (doc15 "Métricas e critérios"):
-- * Ocupação = minutos atendidos ou reservados (confirmado, concluído, falta) dentro do expediente vendável
--   (expediente − bloqueios) / minutos vendáveis. Holds, cancelados e intervalos entre atendimentos não contam.
-- * Faltas = faltas / (concluídos + faltas) com início no passado. Futuros e cancelados ficam fora do denominador.
-- * Fila = ofertas aceitas / ofertas enviadas. Aceitar não é comparecer nem pagar.
-- * Receita e despesas registradas são observações do que foi lançado; não são lucro nem efeito da Tinindo.
-- * Minutos humanos vêm de work_logs (P15), nunca de estimativa.
-- * Lembretes (P13) ainda não existem: o indicador aparece como indisponível, não como zero.
-- Depende de: fundação, P03, P06, P07, P11, P15.

create table public.analytics_baselines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  period tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  -- Indicadores congelados no momento da criação: mudanças posteriores nos registros não mexem na baseline.
  metrics jsonb not null check (jsonb_typeof(metrics) = 'array'),
  coverage jsonb not null check (jsonb_typeof(coverage) = 'array'),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.analytics_baselines is 'Ponto de partida congelado para comparar períodos. Append-only.';
create index analytics_baselines_tenant on public.analytics_baselines (tenant_id, created_at desc);
create trigger analytics_baselines_append_only before update or delete on public.analytics_baselines
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Cálculo
-- ---------------------------------------------------------------------------

create function app.an_period(p_from timestamptz, p_to timestamptz) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
end $$;

create function app.an_metric(p_key text, p_label text, p_unit text, p_num numeric, p_den numeric, p_note text,
  p_status text default null) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'unit', p_unit,
    'numerator', p_num, 'denominator', p_den,
    'value', case when p_status = 'unavailable' then null
                  when p_unit = 'ratio' then case when coalesce(p_den, 0) = 0 then null else round(p_num / p_den, 4) end
                  else p_num end,
    'status', coalesce(p_status, case when p_unit = 'ratio' and coalesce(p_den, 0) = 0 then 'insufficient' else 'ok' end),
    'note', p_note)
$$;

/** Indicadores e cobertura de um negócio num período. Sem autorização: quem chama já autorizou. */
create function app.an_metrics(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_past_to timestamptz := least(p_to, clock_timestamp());
  v_res uuid;
  v_sell tstzmultirange := '{}';
  v_sell_min numeric := 0;
  v_booked_min numeric := 0;
  v_done integer;
  v_noshow integer;
  v_cancel integer;
  v_pending integer;
  v_offers integer;
  v_offers_ok integer;
  v_quotes integer;
  v_quotes_ok integer;
  v_received bigint;
  v_spent bigint;
  v_completed integer;
  v_charged integer;
  v_human integer;
  v_auto integer;
  v_reprocess integer;
  v_has_rules boolean;
  v_metrics jsonb := '[]';
  v_coverage jsonb := '[]';
begin
  select r.id into v_res from public.resources r where r.tenant_id = p_tenant_id and r.active;
  v_has_rules := exists (select 1 from public.availability_rules a where a.tenant_id = p_tenant_id and a.resource_id = v_res);
  if v_res is not null then
    v_sell := app.sched_open_hours(p_tenant_id, v_res, p_from, p_to)
      - coalesce((select range_agg(k.period) from public.availability_blocks k
          where k.tenant_id = p_tenant_id and k.resource_id = v_res and k.removed_at is null
            and k.period && tstzrange(p_from, p_to, '[)')), '{}'::tstzmultirange);
    select coalesce(sum(extract(epoch from upper(x) - lower(x)) / 60), 0) into v_sell_min from unnest(v_sell) x;
    select coalesce(sum(extract(epoch from upper(x) - lower(x)) / 60), 0) into v_booked_min
    from public.bookings b, unnest(tstzmultirange(tstzrange(b.starts_at, b.ends_at, '[)')) * v_sell) x
    where b.tenant_id = p_tenant_id and b.resource_id = v_res and b.status in ('confirmed', 'completed', 'no_show')
      and b.starts_at < p_to and b.ends_at > p_from;
  end if;
  v_metrics := v_metrics || app.an_metric('occupancy', 'Ocupação', 'ratio', round(v_booked_min), round(v_sell_min),
    'Minutos reservados (confirmados, concluídos e faltas) dentro do expediente vendável (expediente menos bloqueios). Holds, cancelados e intervalos não contam.',
    case when not v_has_rules then 'insufficient' end);

  select count(*) filter (where b.status = 'completed'), count(*) filter (where b.status = 'no_show'),
    count(*) filter (where b.status = 'cancelled'),
    count(*) filter (where b.status = 'confirmed' and b.ends_at <= v_now)
  into v_done, v_noshow, v_cancel, v_pending
  from public.bookings b where b.tenant_id = p_tenant_id and b.starts_at >= p_from and b.starts_at < v_past_to;
  v_metrics := v_metrics || app.an_metric('no_show', 'Faltas', 'ratio', v_noshow, v_done + v_noshow,
    'Faltas sobre atendimentos com desfecho (concluídos + faltas) já ocorridos. Futuros, cancelados e sem desfecho ficam fora.');
  v_metrics := v_metrics || app.an_metric('cancellation', 'Cancelamentos', 'ratio', v_cancel, v_done + v_noshow + v_cancel,
    'Cancelados sobre concluídos, faltas e cancelados com início no período, até agora.');

  select count(*), count(*) filter (where o.status = 'accepted') into v_offers, v_offers_ok
  from public.waitlist_offers o where o.tenant_id = p_tenant_id and o.created_at >= p_from and o.created_at < p_to
    and o.status <> 'pending_approval';
  v_metrics := v_metrics || app.an_metric('waitlist_acceptance', 'Ofertas de vaga aceitas', 'ratio', v_offers_ok, v_offers,
    'Ofertas aceitas sobre ofertas preparadas. Aceitar não é comparecer nem pagar.');

  select count(*), count(*) filter (where q.status = 'accepted') into v_quotes, v_quotes_ok
  from public.sales_quotes q where q.tenant_id = p_tenant_id and q.sent_at >= p_from and q.sent_at < p_to;
  v_metrics := v_metrics || app.an_metric('quote_acceptance', 'Orçamentos aceitos', 'ratio', v_quotes_ok, v_quotes,
    'Aceitos sobre orçamentos com link gerado no período (inclui ainda abertos e vencidos). Aceito não é pago.');

  select coalesce(sum(p.amount_cents), 0) into v_received from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= p_from and p.received_at < p_to
    and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id);
  select coalesce(sum(e.amount_cents), 0) into v_spent from public.expense_entries e
  where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= p_from and e.paid_at < p_to
    and not exists (select 1 from public.expense_entries x where x.reversal_of = e.id);
  v_metrics := v_metrics || app.an_metric('received', 'Recebimentos registrados', 'cents', v_received, null,
    'Soma do que foi lançado como recebido, já descontados estornos. Não é lucro, saldo bancário nem receita causada pela Tinindo.');
  v_metrics := v_metrics || app.an_metric('expenses', 'Despesas registradas', 'cents', v_spent, null,
    'Soma das despesas lançadas, já descontados estornos.');

  select count(*), count(*) filter (where exists (select 1 from public.receivables r where r.tenant_id = b.tenant_id
      and r.booking_id = b.id and r.status <> 'cancelled')
    or exists (select 1 from public.session_entries e where e.tenant_id = b.tenant_id and e.booking_id = b.id and e.reason = 'consume'
      and not exists (select 1 from public.session_entries x where x.reversal_of = e.id)))
  into v_completed, v_charged
  from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed' and b.starts_at >= p_from and b.starts_at < p_to;
  v_metrics := v_metrics || app.an_metric('charge_coverage', 'Atendimentos com cobrança registrada', 'ratio', v_charged, v_completed,
    'Concluídos com cobrança ou crédito de pacote lançado. Mede a qualidade do registro, não o recebimento.');

  select coalesce(sum(w.minutes) filter (where w.kind = 'human'), 0), coalesce(sum(w.minutes) filter (where w.kind = 'automation'), 0),
    coalesce(sum(w.minutes) filter (where w.reprocess), 0)
  into v_human, v_auto, v_reprocess
  from public.work_logs w where w.tenant_id = p_tenant_id and w.logged_at >= p_from and w.logged_at < p_to;
  v_metrics := v_metrics || app.an_metric('human_minutes', 'Minutos da equipe Tinindo', 'minutes', v_human, null,
    format('Minutos humanos medidos em serviços assistidos. Automação: %s min; retrabalho: %s min.', v_auto, v_reprocess));

  v_metrics := v_metrics || app.an_metric('reminders', 'Lembretes enviados', 'ratio', null, null,
    'Lembretes e acompanhamento (P13) ainda não existem. Sem dado: não é zero.', 'unavailable');

  -- Cobertura: o que falta para ler os números com segurança.
  if p_to > v_now then
    v_coverage := v_coverage || jsonb_build_object('key', 'future', 'count', null,
      'note', 'O período inclui dias futuros: faltas e cancelamentos contam só até agora; ocupação inclui reservas futuras.');
  end if;
  if not v_has_rules then
    v_coverage := v_coverage || jsonb_build_object('key', 'no_hours', 'count', null,
      'note', 'Expediente não configurado: sem denominador para a ocupação.');
  end if;
  if v_pending > 0 then
    v_coverage := v_coverage || jsonb_build_object('key', 'pending_outcome', 'count', v_pending,
      'note', 'Atendimentos já passados ainda como confirmados (sem concluir nem marcar falta): fora das taxas.');
  end if;
  if v_completed - v_charged > 0 then
    v_coverage := v_coverage || jsonb_build_object('key', 'uncharged', 'count', v_completed - v_charged,
      'note', 'Atendimentos concluídos sem cobrança registrada: os recebimentos podem estar incompletos.');
  end if;

  return jsonb_build_object('metrics', v_metrics, 'coverage', v_coverage);
end $$;

create function app.an_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.an_baseline_json(b public.analytics_baselines) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'label', b.label,
    'period', jsonb_build_object('starts_at', app.sched_ts(lower(b.period)), 'ends_at', app.sched_ts(upper(b.period))),
    'metrics', b.metrics, 'coverage', b.coverage, 'created_at', app.sched_ts(b.created_at))
$$;

-- ---------------------------------------------------------------------------
-- Dono
-- ---------------------------------------------------------------------------

create function public.analytics_metrics(p_tenant_id uuid, p_from timestamptz, p_to timestamptz, p_baseline_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cur jsonb;
  v_b public.analytics_baselines;
begin
  perform app.an_owner(p_tenant_id);
  perform app.an_period(p_from, p_to);
  v_cur := app.an_metrics(p_tenant_id, p_from, p_to);
  if p_baseline_id is not null then
    select * into v_b from public.analytics_baselines b where b.tenant_id = p_tenant_id and b.id = p_baseline_id;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'baseline_id';
    end if;
  end if;
  return jsonb_build_object(
    'period', jsonb_build_object('starts_at', app.sched_ts(p_from), 'ends_at', app.sched_ts(p_to)),
    'timezone', (select t.timezone from public.tenants t where t.id = p_tenant_id),
    'as_of', app.sched_ts(clock_timestamp()),
    'metrics', v_cur->'metrics',
    'coverage', v_cur->'coverage',
    'baseline', case when v_b.id is null then null else app.an_baseline_json(v_b) end,
    'comparison', case when v_b.id is null then null else (
      select coalesce(jsonb_agg(jsonb_build_object('key', c->>'key',
        'baseline_value', b->'value', 'current_value', c->'value',
        'delta', case when jsonb_typeof(c->'value') = 'number' and jsonb_typeof(b->'value') = 'number'
                      then to_jsonb(round((c->>'value')::numeric - (b->>'value')::numeric, 4)) else 'null'::jsonb end)), '[]'::jsonb)
      from jsonb_array_elements(v_cur->'metrics') c
      left join jsonb_array_elements(v_b.metrics) b on b->>'key' = c->>'key') end,
    -- Fixo: o sistema não estima efeito causal sem desenho comparável (grupo de controle, teste).
    'causality', 'not_established',
    'comparison_note', 'Comparação antes/depois no mesmo negócio. A diferença não prova que a Tinindo causou a mudança: época do ano, preços, clientes e registro incompleto também mudam os números.'
  );
end $$;

/** Baseline: período encerrado, indicadores congelados. Repetir com a mesma chave devolve a mesma. */
create function public.analytics_baseline_create(
  p_tenant_id uuid,
  p_label text,
  p_from timestamptz,
  p_to timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_m jsonb;
  v_b public.analytics_baselines;
  v_body jsonb;
begin
  perform app.an_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'analytics.baseline_create', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform app.an_period(p_from, p_to);
  if p_to > clock_timestamp() then
    -- Baseline com dias futuros mudaria depois de criada.
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 80 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'label';
  end if;
  v_m := app.an_metrics(p_tenant_id, p_from, p_to);
  insert into public.analytics_baselines (tenant_id, label, period, metrics, coverage, created_by)
  values (p_tenant_id, btrim(p_label), tstzrange(p_from, p_to, '[)'), v_m->'metrics', v_m->'coverage', v_uid)
  returning * into v_b;
  v_body := jsonb_build_object('baseline', app.an_baseline_json(v_b));
  perform app.audit(p_tenant_id, 'analytics.baseline_create', 'analytics_baseline', v_b.id, p_request_id, null,
    jsonb_build_object('starts_at', app.sched_ts(p_from), 'ends_at', app.sched_ts(p_to)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'analytics.baseline_create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.analytics_baseline_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.an_owner(p_tenant_id);
  return jsonb_build_object('baselines', coalesce((select jsonb_agg(app.an_baseline_json(b) order by b.created_at desc)
    from (select * from public.analytics_baselines b where b.tenant_id = p_tenant_id order by b.created_at desc limit 20) b), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Operação Tinindo: custo de atendimento por cliente
-- ---------------------------------------------------------------------------

/**
 * Minutos medidos e custo estimado por negócio. O custo-hora é informado por quem consulta (premissa, não custo
 * contábil). Receita contratada vem de assinatura/pedido com cobrança manual: não é pagamento confirmado.
 */
create function public.analytics_cost_to_serve(p_from timestamptz, p_to timestamptz, p_hourly_cost_cents bigint)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
begin
  v_op := app.svc_operator();
  perform app.an_period(p_from, p_to);
  if p_hourly_cost_cents is null or p_hourly_cost_cents < 0 or p_hourly_cost_cents > 10000000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'hourly_cost_cents';
  end if;
  return (
    with per as (
      select t.id as tenant_id, t.name as tenant_name,
        coalesce(sum(w.minutes) filter (where w.kind = 'human'), 0)::int as human_minutes,
        coalesce(sum(w.minutes) filter (where w.kind = 'automation'), 0)::int as automation_minutes,
        coalesce(sum(w.minutes) filter (where w.reprocess), 0)::int as reprocess_minutes
      from public.tenants t
      left join public.work_logs w on w.tenant_id = t.id and w.logged_at >= p_from and w.logged_at < p_to
      where exists (select 1 from public.service_orders s where s.tenant_id = t.id)
         or exists (select 1 from public.subscriptions s where s.tenant_id = t.id)
      group by t.id, t.name
    ), rows as (
      select p.*,
        round(p.human_minutes::numeric * p_hourly_cost_cents / 60)::bigint as estimated_cost_cents,
        coalesce((select s.price_cents from public.subscriptions s where s.tenant_id = p.tenant_id and s.status = 'active'), 0) as plan_monthly_cents,
        coalesce((select sum(o.price_cents) from public.service_orders o where o.tenant_id = p.tenant_id and o.status <> 'cancelled'
          and o.created_at >= p_from and o.created_at < p_to), 0)::bigint as services_contracted_cents
      from per p
    )
    select jsonb_build_object(
      'period', jsonb_build_object('starts_at', app.sched_ts(p_from), 'ends_at', app.sched_ts(p_to)),
      'hourly_cost_cents', p_hourly_cost_cents,
      'as_of', app.sched_ts(clock_timestamp()),
      'tenants', coalesce(jsonb_agg(to_jsonb(r) order by r.human_minutes desc, r.tenant_name), '[]'::jsonb),
      'totals', jsonb_build_object('human_minutes', coalesce(sum(r.human_minutes), 0), 'automation_minutes', coalesce(sum(r.automation_minutes), 0),
        'reprocess_minutes', coalesce(sum(r.reprocess_minutes), 0), 'estimated_cost_cents', coalesce(sum(r.estimated_cost_cents), 0)),
      'note', 'Custo estimado = minutos humanos medidos × custo-hora informado; não inclui infraestrutura, canal, impostos nem aquisição. Valores contratados têm cobrança manual: não são pagamentos confirmados.')
    from rows r
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.an_period(timestamptz, timestamptz) from public;
revoke all on function app.an_metric(text, text, text, numeric, numeric, text, text) from public;
revoke all on function app.an_metrics(uuid, timestamptz, timestamptz) from public;
revoke all on function app.an_owner(uuid) from public;
revoke all on function app.an_baseline_json(public.analytics_baselines) from public;

revoke all on function public.analytics_metrics(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.analytics_baseline_create(uuid, text, timestamptz, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.analytics_baseline_list(uuid) from public, anon;
revoke all on function public.analytics_cost_to_serve(timestamptz, timestamptz, bigint) from public, anon;
grant execute on function public.analytics_metrics(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.analytics_baseline_create(uuid, text, timestamptz, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.analytics_baseline_list(uuid) to authenticated;
grant execute on function public.analytics_cost_to_serve(timestamptz, timestamptz, bigint) to authenticated;

alter table public.analytics_baselines enable row level security;
revoke all on public.analytics_baselines from anon, authenticated;
grant select on public.analytics_baselines to authenticated;
grant select, insert on public.analytics_baselines to service_role;
create policy analytics_baselines_select_owner on public.analytics_baselines
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
