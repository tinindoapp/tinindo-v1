-- P32 (parte), bloco 5 · Previsão simples e honesta.
-- Para o dono do negócio. Nenhuma ação automática: só leitura.
--   · Ocupação esperada da próxima semana, por dia da semana: média das 8 últimas semanas fechadas (minutos ocupados por
--     feitos, faltas e confirmados) sobre os minutos de expediente daquele dia. Mostra também o que já está marcado.
--   · Risco de falta por dia da semana e hora cheia: faltas / (feitos + faltas) nas 8 semanas; com menos de 3 atendimentos
--     no horário, vale a taxa geral do negócio (dito como "média geral").
--   · Só com pelo menos 8 semanas fechadas desde o primeiro agendamento; antes disso, "insufficient".
--   · Acerto: para cada uma das 4 últimas semanas fechadas com 8 semanas antes dela, a previsão daquela semana (mesma
--     regra) contra o que aconteceu, por dia da semana, e contra a referência ingênua "igual à semana anterior".

create function public.forecast_week(p_tenant_id uuid, p_ref date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v_now timestamptz := clock_timestamp();
  v_cw date;            -- segunda-feira da semana de p_ref (local)
  v_target date;        -- segunda-feira da semana prevista
  v_first date;
  v_weeks integer;
  v_overall_n integer;
  v_overall_ns integer;
  v_days jsonb;
  v_slots jsonb;
  v_back jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_ref is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'ref';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  v_cw := p_ref - ((extract(isodow from p_ref)::int) - 1);
  if v_cw::timestamp at time zone v_tz > v_now then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'ref';
  end if;
  v_target := v_cw + 7;

  select min((b.starts_at at time zone v_tz)::date) into v_first from public.bookings b where b.tenant_id = p_tenant_id;
  v_weeks := case when v_first is null then 0
    else greatest(0, (v_cw - (v_first - ((extract(isodow from v_first)::int) - 1))) / 7) end;

  if v_weeks < 8 then
    return jsonb_build_object('status', 'insufficient', 'weeks_of_history', v_weeks, 'weeks_needed', 8,
      'target', jsonb_build_object('starts_at', app.sched_ts(v_target::timestamp at time zone v_tz),
        'ends_at', app.sched_ts((v_target + 7)::timestamp at time zone v_tz)),
      'timezone', v_tz, 'as_of', app.sched_ts(v_now), 'days', '[]'::jsonb, 'no_show_slots', '[]'::jsonb,
      'overall_no_show', null, 'backtest', '[]'::jsonb, 'accuracy', null);
  end if;

  -- Grade: 12 semanas fechadas (j = 1 é a última) × 7 dias, com zero onde não houve nada.
  with grid as (
    select j, wd from generate_series(1, 12) j, generate_series(0, 6) wd
  ), booked as (
    select (v_cw - ((b.starts_at at time zone v_tz)::date - ((extract(isodow from (b.starts_at at time zone v_tz)::date)::int) - 1))) / 7 as j,
           extract(dow from b.starts_at at time zone v_tz)::int as wd,
           count(*)::int as n,
           sum(extract(epoch from (b.ends_at - b.starts_at)) / 60)::numeric as minutes
    from public.bookings b
    where b.tenant_id = p_tenant_id and b.status in ('completed', 'no_show', 'confirmed')
      and b.starts_at >= (v_cw - 84)::timestamp at time zone v_tz and b.starts_at < v_cw::timestamp at time zone v_tz
    group by 1, 2
  ), g as (
    select grid.j, grid.wd, coalesce(booked.n, 0) as n, coalesce(booked.minutes, 0) as minutes
    from grid left join booked using (j, wd)
  ), open_min as (
    select r.weekday::int as wd, sum(extract(epoch from (r.local_end - r.local_start)) / 60)::numeric as minutes
    from public.availability_rules r where r.tenant_id = p_tenant_id group by 1
  ), ahead as (
    select extract(dow from b.starts_at at time zone v_tz)::int as wd, count(*)::int as n
    from public.bookings b where b.tenant_id = p_tenant_id and b.status in ('confirmed', 'held')
      and b.starts_at >= v_target::timestamp at time zone v_tz and b.starts_at < (v_target + 7)::timestamp at time zone v_tz
    group by 1
  ), pred as (
    select g.wd, avg(g.n) as n, avg(g.minutes) as minutes from g where g.j between 1 and 8 group by g.wd
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', v_target + ((p.wd + 6) % 7),
      'weekday', p.wd,
      'expected_bookings', round(p.n, 1),
      'already_booked', coalesce(a.n, 0),
      'open_minutes', coalesce(o.minutes, 0)::int,
      'expected_occupancy', case when coalesce(o.minutes, 0) > 0 then round(least(p.minutes / o.minutes, 1), 2) end
    ) order by (p.wd + 6) % 7), '[]'::jsonb)
    into v_days
  from pred p left join open_min o on o.wd = p.wd left join ahead a on a.wd = p.wd;

  -- Risco de falta por horário, nas 8 semanas.
  select count(*) filter (where b.status in ('completed', 'no_show')), count(*) filter (where b.status = 'no_show')
    into v_overall_n, v_overall_ns
  from public.bookings b where b.tenant_id = p_tenant_id
    and b.starts_at >= (v_cw - 56)::timestamp at time zone v_tz and b.starts_at < v_cw::timestamp at time zone v_tz;

  with open_hours as (
    select distinct r.weekday::int as wd, h::int as hour from public.availability_rules r,
      generate_series(extract(hour from r.local_start)::int, (extract(hour from r.local_end - interval '1 minute'))::int) h
    where r.tenant_id = p_tenant_id
  ), s as (
    select extract(dow from b.starts_at at time zone v_tz)::int as wd, extract(hour from b.starts_at at time zone v_tz)::int as hour,
           count(*)::int as n, count(*) filter (where b.status = 'no_show')::int as ns
    from public.bookings b where b.tenant_id = p_tenant_id and b.status in ('completed', 'no_show')
      and b.starts_at >= (v_cw - 56)::timestamp at time zone v_tz and b.starts_at < v_cw::timestamp at time zone v_tz
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', o.wd, 'hour', o.hour, 'denominator', coalesce(s.n, 0), 'no_shows', coalesce(s.ns, 0),
      'basis', case when coalesce(s.n, 0) >= 3 then 'slot' else 'overall' end,
      'risk', case when coalesce(s.n, 0) >= 3 then round(s.ns::numeric / s.n, 2)
                   when v_overall_n > 0 then round(v_overall_ns::numeric / v_overall_n, 2) end
    ) order by (o.wd + 6) % 7, o.hour), '[]'::jsonb)
    into v_slots
  from open_hours o left join s on s.wd = o.wd and s.hour = o.hour;

  -- Acerto: previsão (média das 8 semanas anteriores) e referência (semana anterior) contra o real, por dia da semana.
  with grid as (
    select j, wd from generate_series(1, 12) j, generate_series(0, 6) wd
  ), booked as (
    select (v_cw - ((b.starts_at at time zone v_tz)::date - ((extract(isodow from (b.starts_at at time zone v_tz)::date)::int) - 1))) / 7 as j,
           extract(dow from b.starts_at at time zone v_tz)::int as wd, count(*)::int as n
    from public.bookings b
    where b.tenant_id = p_tenant_id and b.status in ('completed', 'no_show', 'confirmed')
      and b.starts_at >= (v_cw - 84)::timestamp at time zone v_tz and b.starts_at < v_cw::timestamp at time zone v_tz
    group by 1, 2
  ), g as (
    select grid.j, grid.wd, coalesce(booked.n, 0) as n from grid left join booked using (j, wd)
  ), wk as (
    select k.k as j, d.wd,
      (select g.n from g where g.j = k.k and g.wd = d.wd) as actual,
      (select avg(g.n) from g where g.j between k.k + 1 and k.k + 8 and g.wd = d.wd) as predicted,
      (select g.n from g where g.j = k.k + 1 and g.wd = d.wd) as baseline
    from generate_series(1, 4) k(k), generate_series(0, 6) d(wd)
    where v_weeks >= k.k + 8
  ), per_week as (
    select j, sum(actual)::int as actual, round(sum(predicted), 1) as predicted, sum(baseline)::int as baseline,
           round(sum(abs(predicted - actual)), 1) as model_error, sum(abs(baseline - actual))::int as baseline_error
    from wk group by j
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'starts_at', app.sched_ts((v_cw - 7 * j)::timestamp at time zone v_tz),
      'actual', actual, 'predicted', predicted, 'baseline', baseline,
      'model_error', model_error, 'baseline_error', baseline_error) order by j desc), '[]'::jsonb)
    into v_back
  from per_week;

  return jsonb_build_object('status', 'ok', 'weeks_of_history', v_weeks, 'weeks_needed', 8,
    'target', jsonb_build_object('starts_at', app.sched_ts(v_target::timestamp at time zone v_tz),
      'ends_at', app.sched_ts((v_target + 7)::timestamp at time zone v_tz)),
    'timezone', v_tz, 'as_of', app.sched_ts(v_now),
    'days', v_days,
    'no_show_slots', v_slots,
    'overall_no_show', jsonb_build_object('denominator', v_overall_n, 'no_shows', v_overall_ns,
      'risk', case when v_overall_n > 0 then round(v_overall_ns::numeric / v_overall_n, 2) end),
    'backtest', v_back,
    'accuracy', case when jsonb_array_length(v_back) = 0 then null else (
      select jsonb_build_object('weeks', count(*), 'actual', sum((e ->> 'actual')::int),
        'model_error', sum((e ->> 'model_error')::numeric), 'baseline_error', sum((e ->> 'baseline_error')::numeric),
        'model_accuracy', case when sum((e ->> 'actual')::int) > 0
          then round(greatest(0, 1 - sum((e ->> 'model_error')::numeric) / sum((e ->> 'actual')::int)), 2) end,
        'baseline_accuracy', case when sum((e ->> 'actual')::int) > 0
          then round(greatest(0, 1 - sum((e ->> 'baseline_error')::numeric) / sum((e ->> 'actual')::int)), 2) end,
        'beats_baseline', sum((e ->> 'model_error')::numeric) < sum((e ->> 'baseline_error')::numeric))
      from jsonb_array_elements(v_back) e) end);
end $$;

revoke all on function public.forecast_week(uuid, date) from public, anon;
grant execute on function public.forecast_week(uuid, date) to authenticated;
