-- P32 (parte), bloco 3 · Painel do piloto (só a equipe Tinindo). Por negócio, num período (padrão: a semana):
--   funil do primeiro dia (bloco 2); uso na semana (telas e comandos); onde recebeu erro ou recusa (operação e código);
--   telas abertas nos últimos 30 dias (a tela compara com o menu para dizer quais nunca abriu); custo do assistente
--   (US$, da camada de linguagem) e mensagens enviadas (contagem; o preço é do provedor); atendimentos e recebimentos
--   em número. Nunca conteúdo: nada de nome de cliente, telefone, texto, valor de atendimento ou de recebimento.

create function app.pilot_business(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', t.id, 'name', t.name, 'profession', t.profession,
    'usage_enabled', app.usage_enabled(t.id),
    'funnel', app.pilot_funnel_of(t.id),
    'usage', jsonb_build_object(
      'active_days', (select count(*) from public.usage_days d where d.tenant_id = t.id
        and d.day >= (p_from at time zone t.timezone)::date and d.day < (p_to at time zone t.timezone)::date),
      'screens', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n) order by x.n desc, x.name)
        from (select e.name, count(*)::int as n from public.usage_events e
              where e.tenant_id = t.id and e.kind = 'screen' and e.occurred_at >= p_from and e.occurred_at < p_to
              group by e.name order by count(*) desc, e.name limit 50) x), '[]'::jsonb),
      'commands', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'ok', x.ok, 'refused', x.refused, 'error', x.error)
          order by x.ok + x.refused + x.error desc, x.name)
        from (select e.name, count(*) filter (where e.outcome = 'ok')::int as ok,
                count(*) filter (where e.outcome = 'refused')::int as refused, count(*) filter (where e.outcome = 'error')::int as error
              from public.usage_events e
              where e.tenant_id = t.id and e.kind = 'command' and e.occurred_at >= p_from and e.occurred_at < p_to
              group by e.name order by count(*) desc, e.name limit 50) x), '[]'::jsonb),
      'problems', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'outcome', x.outcome, 'code', x.code, 'count', x.n,
          'last_at', app.sched_ts(x.last_at)) order by x.n desc, x.name)
        from (select e.name, e.outcome, e.code, count(*)::int as n, max(e.occurred_at) as last_at from public.usage_events e
              where e.tenant_id = t.id and e.kind = 'command' and e.outcome in ('refused', 'error')
                and e.occurred_at >= p_from and e.occurred_at < p_to
              group by e.name, e.outcome, e.code order by count(*) desc, e.name limit 30) x), '[]'::jsonb),
      'opened_30d', coalesce((select jsonb_agg(distinct e.name order by e.name) from public.usage_events e
        where e.tenant_id = t.id and e.kind = 'screen' and e.occurred_at >= clock_timestamp() - interval '30 days'), '[]'::jsonb)),
    'cost', jsonb_build_object(
      'assistant_usd', coalesce((select round(sum(u.cost_usd), 4) from public.agent_llm_usage u
        where u.tenant_id = t.id and u.month >= date_trunc('month', p_from at time zone t.timezone)::date
          and u.month < (p_to at time zone t.timezone)::date), 0),
      'assistant_calls', coalesce((select sum(u.calls) from public.agent_llm_usage u
        where u.tenant_id = t.id and u.month >= date_trunc('month', p_from at time zone t.timezone)::date
          and u.month < (p_to at time zone t.timezone)::date), 0),
      'assistant_months', 'Assistente por mês inteiro (o uso é guardado por mês): os meses que tocam o período.',
      'messages_template', (select count(*) from public.channel_messages m where m.tenant_id = t.id and m.direction = 'outbound'
        and m.kind = 'template' and m.created_at >= p_from and m.created_at < p_to),
      'messages_text', (select count(*) from public.channel_messages m where m.tenant_id = t.id and m.direction = 'outbound'
        and m.kind = 'text' and m.created_at >= p_from and m.created_at < p_to),
      'messages_failed', (select count(*) from public.channel_messages m where m.tenant_id = t.id and m.direction = 'outbound'
        and m.status = 'failed' and m.created_at >= p_from and m.created_at < p_to)),
    'counts', jsonb_build_object(
      'bookings_created', (select count(*) from public.bookings b where b.tenant_id = t.id and b.created_at >= p_from and b.created_at < p_to),
      'services_done', (select count(*) from public.bookings b where b.tenant_id = t.id and b.status = 'completed'
        and b.starts_at >= p_from and b.starts_at < p_to),
      'no_shows', (select count(*) from public.bookings b where b.tenant_id = t.id and b.status = 'no_show'
        and b.starts_at >= p_from and b.starts_at < p_to),
      'cancelled', (select count(*) from public.bookings b where b.tenant_id = t.id and b.status = 'cancelled'
        and b.starts_at >= p_from and b.starts_at < p_to),
      'payments', (select count(*) from public.payment_entries e where e.tenant_id = t.id and e.reversal_of is null
        and e.received_at >= p_from and e.received_at < p_to)))
  from public.tenants t where t.id = p_tenant_id
$$;
revoke all on function app.pilot_business(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create function public.pilot_panel(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.svc_operator();
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '92 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  return jsonb_build_object(
    'period', jsonb_build_object('starts_at', app.sched_ts(p_from), 'ends_at', app.sched_ts(p_to)),
    'as_of', app.sched_ts(clock_timestamp()),
    'businesses', coalesce((select jsonb_agg(app.pilot_business(t.id, p_from, p_to) order by t.created_at desc)
      from (select * from public.tenants t where t.status = 'active' order by t.created_at desc limit 200) t), '[]'::jsonb),
    'truncated', jsonb_build_object('businesses', exists (select 1 from public.tenants t where t.status = 'active' offset 200)));
end $$;
revoke all on function public.pilot_panel(timestamptz, timestamptz) from public, anon;
grant execute on function public.pilot_panel(timestamptz, timestamptz) to authenticated;
