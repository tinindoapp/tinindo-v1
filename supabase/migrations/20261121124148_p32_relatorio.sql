-- P32 (parte), bloco 4 · Relatório ao profissional: "Sua semana" e "Seu mês".
-- Para o dono do negócio, num período fechado no fuso do negócio (semana de segunda a domingo; mês do calendário):
--   atendimentos feitos, recebido, a receber, faltas, quem voltou e quem não voltou, horário mais cheio e mais vazio.
-- Cada número traz o período, o denominador e "insufficient" quando não há base para dizer (nunca vira zero).
-- Período em andamento termina em "agora" (dito no retorno). Mesmas definições do P18 (recebido sem os estornados).

create function app.report_bounds(p_tz text, p_kind text, p_ref date) returns table (local_start date, local_end date)
language sql immutable set search_path = '' as $$
  select case when p_kind = 'week' then p_ref - ((extract(isodow from p_ref)::int) - 1) else date_trunc('month', p_ref)::date end,
         case when p_kind = 'week' then p_ref - ((extract(isodow from p_ref)::int) - 1) + 7 else (date_trunc('month', p_ref) + interval '1 month')::date end
$$;

create function app.report_metric(p_value numeric, p_den integer, p_min integer, p_note text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('value', case when coalesce(p_den, 0) >= p_min then p_value end, 'denominator', coalesce(p_den, 0),
    'status', case when coalesce(p_den, 0) >= p_min then 'ok' else 'insufficient' end, 'note', p_note)
$$;

create function public.report_period(p_tenant_id uuid, p_kind text, p_ref date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v_ls date;
  v_le date;
  v_from timestamptz;
  v_to timestamptz;
  v_now timestamptz := clock_timestamp();
  v_end timestamptz;
  v_prev_from timestamptz;
  v_done integer;
  v_noshow integer;
  v_past integer;
  v_received bigint;
  v_open bigint;
  v_open_n integer;
  v_seen integer;
  v_returned integer;
  v_prev_seen integer;
  v_not_returned integer;
  v_slots integer;
  v_busy jsonb;
  v_quiet jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_kind is null or p_kind not in ('week', 'month') or p_ref is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  select b.local_start, b.local_end into v_ls, v_le from app.report_bounds(v_tz, p_kind, p_ref) b;
  v_from := v_ls::timestamp at time zone v_tz;
  v_to := v_le::timestamp at time zone v_tz;
  if v_from > v_now then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  v_end := least(v_to, v_now);
  v_prev_from := (case when p_kind = 'week' then v_ls - 7 else (v_ls - interval '1 month')::date end)::timestamp at time zone v_tz;

  -- Atendimentos do período que já começaram: feitos, faltas e os que ficaram sem desfecho (confirmados no passado).
  select count(*) filter (where b.status = 'completed'), count(*) filter (where b.status = 'no_show'),
         count(*) filter (where b.status in ('completed', 'no_show', 'confirmed'))
    into v_done, v_noshow, v_past
  from public.bookings b where b.tenant_id = p_tenant_id and b.starts_at >= v_from and b.starts_at < v_end;

  select coalesce(sum(p.amount_cents), 0) into v_received from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= v_from and p.received_at < v_end
    and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id);

  -- A receber: o que está em aberto hoje (cobrado e não pago), em qualquer data.
  select coalesce(sum(r.amount_cents - r.paid_cents), 0), count(*) into v_open, v_open_n from public.receivables r
  where r.tenant_id = p_tenant_id and r.status in ('open', 'partially_paid');

  -- Voltaram: clientes atendidos no período que já tinham sido atendidos antes. Base: clientes atendidos no período.
  select count(distinct b.customer_id),
         count(distinct b.customer_id) filter (where exists (select 1 from public.bookings o where o.tenant_id = p_tenant_id
           and o.customer_id = b.customer_id and o.status = 'completed' and o.starts_at < v_from))
    into v_seen, v_returned
  from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed' and b.customer_id is not null
    and b.starts_at >= v_from and b.starts_at < v_end;

  -- Não voltaram: clientes atendidos no período anterior sem atendimento feito nem marcado neste período.
  select count(distinct b.customer_id),
         count(distinct b.customer_id) filter (where not exists (select 1 from public.bookings o where o.tenant_id = p_tenant_id
           and o.customer_id = b.customer_id and o.starts_at >= v_from and o.starts_at < v_to and o.status in ('completed', 'confirmed', 'held')))
    into v_prev_seen, v_not_returned
  from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed' and b.customer_id is not null
    and b.starts_at >= v_prev_from and b.starts_at < v_from;

  -- Horário mais cheio e mais vazio: por dia da semana e hora cheia dentro do expediente, contando os atendimentos que
  -- ocuparam a agenda (feitos, faltas e confirmados) no período. Só com pelo menos 5 atendimentos.
  with open_hours as (
    select distinct r.weekday::int as wd, h::int as hour from public.availability_rules r,
      generate_series(extract(hour from r.local_start)::int, (extract(hour from r.local_end - interval '1 minute'))::int) h
    where r.tenant_id = p_tenant_id
  ), used as (
    select extract(dow from b.starts_at at time zone v_tz)::int as wd, extract(hour from b.starts_at at time zone v_tz)::int as hour, count(*)::int as n
    from public.bookings b where b.tenant_id = p_tenant_id and b.status in ('completed', 'no_show', 'confirmed')
      and b.starts_at >= v_from and b.starts_at < v_end
    group by 1, 2
  ), slots as (
    select o.wd, o.hour, coalesce(u.n, 0) as n from open_hours o left join used u on u.wd = o.wd and u.hour = o.hour
  )
  select (select count(*) from slots),
         (select jsonb_build_object('weekday', s.wd, 'hour', s.hour, 'count', s.n) from slots s order by s.n desc, s.wd, s.hour limit 1),
         (select jsonb_build_object('weekday', s.wd, 'hour', s.hour, 'count', s.n) from slots s order by s.n, s.wd, s.hour limit 1)
    into v_slots, v_busy, v_quiet;

  return jsonb_build_object(
    'kind', p_kind,
    'period', jsonb_build_object('starts_at', app.sched_ts(v_from), 'ends_at', app.sched_ts(v_to)),
    'until', app.sched_ts(v_end), 'in_progress', v_to > v_now, 'timezone', v_tz, 'as_of', app.sched_ts(v_now),
    'services_done', app.report_metric(v_done, v_past, 1, 'Feitos entre os atendimentos que já começaram no período (feitos, faltas e os confirmados sem desfecho).'),
    'no_shows', app.report_metric(v_noshow, v_done + v_noshow, 1, 'Faltas entre os atendimentos com desfecho (feitos e faltas).'),
    'received_cents', jsonb_build_object('value', v_received, 'status', 'ok', 'note', 'Recebimentos registrados no período, sem os estornados.'),
    'to_receive_cents', jsonb_build_object('value', v_open, 'denominator', v_open_n, 'status', 'ok', 'note', 'Em aberto agora (cobrado e não pago), de qualquer data.'),
    'returned', app.report_metric(v_returned, v_seen, 1, 'Clientes atendidos no período que já tinham vindo antes, entre os clientes atendidos no período.'),
    'not_returned', app.report_metric(v_not_returned, v_prev_seen, 1, 'Clientes do período anterior sem atendimento feito nem marcado neste período, entre os clientes do período anterior.'),
    'busiest', case when v_past >= 5 and v_slots > 0 then v_busy end,
    'quietest', case when v_past >= 5 and v_slots > 0 then v_quiet end,
    'hours_status', case when v_slots = 0 then 'no_hours' when v_past < 5 then 'insufficient' else 'ok' end,
    'hours_denominator', v_past,
    'hours_note', 'Por dia da semana e hora cheia do expediente, contando feitos, faltas e confirmados. Precisa de pelo menos 5 atendimentos.');
end $$;

revoke all on function app.report_bounds(text, text, date) from public;
revoke all on function app.report_metric(numeric, integer, integer, text) from public;
revoke all on function public.report_period(uuid, text, date) from public, anon;
grant execute on function public.report_period(uuid, text, date) to authenticated;
