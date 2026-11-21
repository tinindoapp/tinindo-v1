-- Assistente parte 2, item 3 (revisão 06/11, T8): leituras novas do assistente do dono, para ele explicar e ajudar a
-- configurar sem adivinhar. Cada uma confere o vínculo no banco (`app.is_member` / dono), devolve só o mínimo que o
-- motor determinístico precisa para compor a resposta e NUNCA nome de cliente, telefone ou recado da lista de espera.
-- O que vai ao modelo de linguagem continua sendo só o pedido redigido (as leituras ficam no motor).

-- Configuração guiada (P44): passos e o que falta, sem gravar nada (a leitura de setup_progress registra conclusões).
create function public.agent_setup_read(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object('progress', app.setup_progress_json(p_tenant_id), 'as_of', app.fin_ts(clock_timestamp()));
end $$;

-- Sugestões abertas (P45) com a evidência já calculada pela regra, e o estado de cada regra na última rodada
-- (dispara, quieta ou dado insuficiente, com o motivo). Só o dono: é o mesmo acesso de insight.list.
create function public.agent_insights_read(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_run public.insight_runs;
begin
  perform app.ga_owner(p_tenant_id);
  select * into v_run from public.insight_runs r where r.tenant_id = p_tenant_id order by r.run_date desc limit 1;
  return jsonb_build_object(
    'insights', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'rule_code', i.rule_code, 'title', i.title, 'body', i.body,
        'evidence', i.evidence, 'version', i.version, 'route', i.action->>'route') order by i.priority desc, i.updated_at desc)
      from (select * from public.insights i where i.tenant_id = p_tenant_id and i.state = 'open' and i.valid_until > clock_timestamp()
            order by i.priority desc, i.updated_at desc limit 10) i), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'title', r.title,
        'status', (select x->>'status' from jsonb_array_elements(v_run.result->'rules') x where x->>'code' = r.code),
        'reason', (select x->>'reason' from jsonb_array_elements(v_run.result->'rules') x where x->>'code' = r.code)) order by r.priority desc)
      from public.insight_rules r), '[]'::jsonb),
    'as_of', app.fin_ts(clock_timestamp()));
end $$;

-- Lista de espera (P06): contagens por serviço e ofertas abertas (serviço, início do horário, prazo). Sem nomes, sem
-- recados, sem janelas aceitáveis de cada pessoa. Só o dono (a equipe não vê a lista de espera, regra do P08).
create function public.agent_waitlist_read(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'by_service', coalesce((select jsonb_agg(jsonb_build_object('service_id', x.service_id, 'active', x.active, 'offered', x.offered) order by x.service_id)
      from (select e.service_id, count(*) filter (where e.status = 'active') as active, count(*) filter (where e.status = 'offered') as offered
            from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.status in ('active', 'offered') and e.valid_until > clock_timestamp()
            group by e.service_id) x), '[]'::jsonb),
    'open_offers', coalesce((select jsonb_agg(jsonb_build_object('service_id', e.service_id, 'starts_at', app.sched_ts(b.starts_at),
        'expires_at', app.sched_ts(o.expires_at), 'status', o.status) order by b.starts_at)
      from public.waitlist_offers o
      join public.waitlist_entries e on e.tenant_id = o.tenant_id and e.id = o.entry_id
      join public.bookings b on b.tenant_id = o.tenant_id and b.id = o.booking_hold_id
      where o.tenant_id = p_tenant_id and o.status in ('pending_approval', 'offered') and o.expires_at > clock_timestamp()), '[]'::jsonb),
    'as_of', app.fin_ts(clock_timestamp()));
end $$;

-- Régua de lembretes (P13): como está configurada hoje. Só o dono (mesmo acesso de lifecycle.settings).
create function public.agent_lifecycle_read(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.lc_owner(p_tenant_id);
  return jsonb_build_object('settings', app.lc_settings_json(app.lc_settings(p_tenant_id)) - 'version', 'as_of', app.fin_ts(clock_timestamp()));
end $$;

revoke all on function public.agent_setup_read(uuid), public.agent_insights_read(uuid), public.agent_waitlist_read(uuid),
  public.agent_lifecycle_read(uuid) from public, anon;
grant execute on function public.agent_setup_read(uuid), public.agent_insights_read(uuid), public.agent_waitlist_read(uuid),
  public.agent_lifecycle_read(uuid) to authenticated;
