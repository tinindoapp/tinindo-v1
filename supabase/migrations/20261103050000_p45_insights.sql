-- P45 · Insights proativos (ADR-0035). Estende o P22 (ADR-0023): motor de regras diário por negócio, rodando no worker
-- `jobs`, com nove regras fixas (sem LLM) sobre dado existente. Cada regra devolve status `fire`, `quiet` ou
-- `insufficient` (insuficiente ≠ zero), evidência com período, número e denominador, e uma ação ligada a um fluxo que
-- já existe (P05, P06, P07, P13, P31, P44). Nenhuma ação executa sozinha: "Preparar" cria uma PROPOSTA no fluxo do
-- módulo dono (regra de preço inativa no P05; rascunhos manuais no P13), que continua exigindo a aprovação de lá.
-- Acompanhamento em 30 dias reaproveita `advice_decisions` (P22). Resumo semanal por modelo fixo.
--
-- Invariantes:
-- * Uma rodada por negócio e dia local (`insight_runs`, PK): duas rodadas simultâneas não duplicam nada.
-- * Um insight por (negócio, regra, assunto) (`insights`, UNIQUE + upsert): rodar de novo atualiza, nunca duplica.
-- * "Agora não" silencia a REGRA por 30 dias; "Preparar"/"Ver" também a deixa quieta por 30 dias (acompanhamento).
-- * Evidência só com contagens, taxas e nome de serviço; nunca nome, telefone ou e-mail de cliente.
-- * Ao preparar, a regra é avaliada de novo: se os dados mudaram, recusa (`stale`) em vez de propor com dado velho.
--
-- Substituições por `create or replace`, documentadas:
-- * `app.ga_rules` (P22): a regra `charge_coverage` passa para o motor do P45 (`uncharged_bookings`, plano §3).
-- * `app.ga_tick` (P22): decisões de regras do P45 são medidas pela própria regra 30 dias depois.
-- * `public.jobs_run` (P06…P22): a rodada passa a chamar `app.gi_tick` (uma vez por dia por negócio).
-- Alterações aditivas no P13: régua `package_expiry` (agregado `package`) e o modelo `pacote_vencendo`.

-- ---------------------------------------------------------------------------
-- P13 (aditivo): aviso de pacote perto de vencer, sempre como rascunho manual criado a pedido do dono.
-- ---------------------------------------------------------------------------
insert into public.channel_templates (code, category, body, params) values
  ('pacote_vencendo', 'utility', 'Olá, {{1}}! Seu pacote de {{2}} ainda tem {{3}} sessão(ões) e vale até {{4}}. Quer marcar? Responda esta mensagem.', 4);
alter table public.lifecycle_steps drop constraint lifecycle_steps_rule_check;
alter table public.lifecycle_steps add constraint lifecycle_steps_rule_check
  check (rule in ('confirmation', 'reminder', 'quote_followup', 'receivable_reminder', 'reactivation', 'package_expiry'));
alter table public.lifecycle_steps drop constraint lifecycle_steps_aggregate_type_check;
alter table public.lifecycle_steps add constraint lifecycle_steps_aggregate_type_check
  check (aggregate_type in ('booking', 'quote', 'receivable', 'customer', 'package'));

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.insight_rules (
  code text primary key check (code ~ '^[a-z0-9_]{3,40}$'),
  title text not null check (char_length(title) between 1 and 80),
  -- Pacote dono do fluxo onde a ação acontece.
  flow text not null check (flow in ('P05', 'P06', 'P07', 'P13', 'P31', 'P44')),
  -- proposal: cria proposta no fluxo (aprovação lá); open: abre a tela do fluxo; none: só informa.
  action_kind text not null check (action_kind in ('proposal', 'open', 'none')),
  priority integer not null check (priority between 1 and 100),
  -- Sentido do número acompanhado em 30 dias (variação observada, nunca efeito).
  direction text not null check (direction in ('up', 'down')),
  rule_version integer not null default 1 check (rule_version >= 1),
  description text not null check (char_length(description) between 1 and 400)
);
comment on table public.insight_rules is 'Catálogo das regras do motor de insights (P45). Só muda por migration; o cálculo está em app.gi_*.';
insert into public.insight_rules (code, title, flow, action_kind, priority, direction, description) values
  ('uncharged_bookings', 'Atendimentos sem cobrança', 'P07', 'open', 90, 'up', 'Menos de 90% dos atendimentos concluídos nos últimos 30 dias com cobrança registrada (mínimo de 5 concluídos).'),
  ('waitlist_opening', 'Vaga aberta com gente esperando', 'P06', 'open', 85, 'up', 'Vaga liberada no futuro, ainda sem oferta, e pessoas ativas na lista de espera.'),
  ('no_show_concentration', 'Faltas concentradas', 'P13', 'open', 80, 'down', 'Nos últimos 60 dias (mínimo de 20 atendimentos com desfecho), um dia da semana com faltas 1,5× acima da média ou clientes que faltam em metade das vezes.'),
  ('package_expiring', 'Pacote perto de vencer', 'P13', 'proposal', 75, 'down', 'Pacotes com sessões sobrando que vencem nos próximos 15 dias.'),
  ('lapsed_customers', 'Clientes sem retorno', 'P13', 'proposal', 70, 'down', 'Clientes com 2 ou mais atendimentos que passaram do intervalo de costume do serviço (ou do prazo de reativação, 60 dias por padrão). Mínimo de 5 clientes de retorno.'),
  ('idle_slot', 'Horário ocioso recorrente', 'P05', 'proposal', 60, 'down', 'Faixa de 2 horas ou mais do expediente vazia em 4 das últimas 5 semanas (mínimo de 10 atendimentos no período).'),
  ('low_margin_service', 'Serviço abaixo da margem', 'P05', 'open', 55, 'down', 'Custo de materiais pela ficha (P30) acima de 30% do preço do serviço.'),
  ('profile_incomplete', 'Perfil incompleto', 'P44', 'open', 50, 'up', 'Perfil sem publicar, sem foto, sem serviço com preço ou sem canal verificado.'),
  ('month_closing', 'Mês fechando', 'P31', 'none', 40, 'up', 'Nos últimos 5 dias do mês: recebido, a receber e despesas do mês com a cobertura dos atendimentos.');

create table public.insight_runs (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  -- Dia no fuso do negócio.
  run_date date not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  -- Status de cada regra na rodada ({code, status, reason}); sem nomes de clientes.
  result jsonb,
  primary key (tenant_id, run_date)
);
comment on table public.insight_runs is 'Backend-only. Uma rodada do motor por negócio e dia local: a chave primária impede rodada dupla.';

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  rule_code text not null references public.insight_rules (code) on delete restrict,
  -- Assunto dentro da regra (ex.: 'wd2-14-16' para a faixa de terça das 14 às 16). Dedupe por (negócio, regra, assunto).
  subject_key text not null check (subject_key ~ '^[a-z0-9_-]{1,40}$'),
  -- open → snoozed ("Agora não") | acted (proposta preparada ou tela aberta) | resolved (a regra deixou de disparar).
  state text not null default 'open' check (state in ('open', 'snoozed', 'acted', 'resolved')),
  priority integer not null check (priority between 1 and 100),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 600),
  -- Período, número e denominador sempre presentes; contagens e taxas, nunca nomes de clientes.
  evidence jsonb not null check (evidence ?& array['period_start', 'period_end', 'numerator', 'denominator']),
  -- {kind, flow, label, route, operation?, payload?}. O payload é revalidado ao preparar.
  action jsonb not null check (action ?& array['kind', 'flow', 'label', 'route']),
  -- Número acompanhado em 30 dias ({value, numerator, denominator, status, direction}).
  measure jsonb,
  first_seen_on date not null,
  last_seen_on date not null,
  valid_until timestamptz not null,
  quiet_until timestamptz,
  decision_id uuid,
  -- O que "Preparar" criou no fluxo dono (tipo, quantidade, rota). Sem nomes.
  result jsonb,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint insights_decision foreign key (tenant_id, decision_id) references public.advice_decisions (tenant_id, id) on delete restrict,
  unique (tenant_id, rule_code, subject_key),
  unique (tenant_id, id)
);
comment on table public.insights is 'Insight do motor diário (P45). Um por negócio, regra e assunto; só o motor e as RPCs do dono escrevem.';
create index insights_open on public.insights (tenant_id, priority desc) where state = 'open';
create trigger insights_touch before update on public.insights for each row execute function app.touch_row();

create table public.insight_digests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  -- Segunda-feira (fuso do negócio) da semana resumida.
  week_start date not null check (extract(isodow from week_start) = 1),
  -- Texto por modelo fixo (sem LLM) e os números usados.
  body text not null check (char_length(body) between 1 and 1200),
  facts jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, week_start),
  unique (tenant_id, id)
);
comment on table public.insight_digests is 'Resumo semanal do dono por modelo fixo. Um por negócio e semana.';

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create function app.gi_weekday(p_dow integer) returns text
language sql immutable set search_path = '' as $$
  select (array['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'])[p_dow + 1]
$$;

create function app.gi_ddmm(p_date date) returns text
language sql immutable set search_path = '' as $$ select to_char(p_date, 'DD/MM') $$;

/** Resultado padrão de uma regra que não dispara (quieta ou sem dado suficiente). */
create function app.gi_out(p_status text, p_reason text, p_measure jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('status', p_status, 'reason', p_reason,
    'measure', coalesce(p_measure, jsonb_build_object('value', null, 'numerator', null, 'denominator', null, 'status', 'insufficient')))
$$;

create function app.gi_measure(p_num numeric, p_den numeric, p_direction text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('value', case when p_den > 0 then round(p_num / p_den, 4) end, 'numerator', p_num, 'denominator', p_den,
    'status', case when p_den > 0 then 'ok' else 'insufficient' end, 'direction', p_direction)
$$;

-- ---------------------------------------------------------------------------
-- As nove regras. Todas recebem o instante (p_now) para serem testáveis e determinísticas.
-- ---------------------------------------------------------------------------

/** Horário ocioso recorrente → regra de preço para a faixa (P05), como proposta inativa. */
create function app.gi_idle_slot(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_today date := (p_now at time zone tz)::date;
  v_w0 date := date_trunc('week', v_today)::date;
  v_from date := date_trunc('week', v_today)::date - 35;
  v_from_ts timestamptz := (date_trunc('week', v_today)::date - 35)::timestamp at time zone tz;
  v_to_ts timestamptz := date_trunc('week', v_today)::date::timestamp at time zone tz;
  v_n integer;
  v_grid jsonb;
  v_hours integer;
  v_idle integer;
  v_measure jsonb;
  b record;
  v_svc uuid;
  v_svc_name text;
begin
  if not exists (select 1 from public.availability_rules a where a.tenant_id = p_tenant_id) then
    return app.gi_out('insufficient', 'no_hours', null);
  end if;
  if (select t.created_at from public.tenants t where t.id = p_tenant_id) > v_from_ts then
    return app.gi_out('insufficient', 'history_short', null);
  end if;
  select count(*) into v_n from public.bookings x
  where x.tenant_id = p_tenant_id and x.status in ('confirmed', 'completed', 'no_show') and x.starts_at >= v_from_ts and x.starts_at < v_to_ts;
  if v_n < 10 then
    return app.gi_out('insufficient', 'few_bookings', null);
  end if;
  -- Grade: cada hora inteira do expediente (qualquer profissional) × 5 semanas; ocupada se algum atendimento a cruza.
  with hours as (
    select distinct a.weekday::integer as wd, h
    from public.availability_rules a cross join generate_series(0, 23) h
    where a.tenant_id = p_tenant_id and a.local_start <= make_time(h, 0, 0) and (a.local_end - time '00:00') >= make_interval(hours => h + 1)
  ), cells as (
    select hr.wd, hr.h, ((v_from + w.k * 7 + ((hr.wd + 6) % 7))::timestamp + make_interval(hours => hr.h)) at time zone tz as s
    from hours hr cross join generate_series(0, 4) w(k)
  ), per_hour as (
    select c.wd, c.h, count(*) filter (where not exists (
      select 1 from public.bookings x where x.tenant_id = p_tenant_id and x.status in ('confirmed', 'completed', 'no_show')
        and x.starts_at < c.s + interval '1 hour' and x.ends_at > c.s))::integer as idle_weeks
    from cells c group by c.wd, c.h
  )
  select jsonb_agg(jsonb_build_object('wd', p.wd, 'h', p.h, 'idle', p.idle_weeks)) into v_grid from per_hour p;
  select count(*), count(*) filter (where g.idle >= 4) into v_hours, v_idle
  from jsonb_to_recordset(v_grid) as g(wd integer, h integer, idle integer);
  v_measure := app.gi_measure(v_idle, v_hours, 'down');
  -- Faixas contínuas de 2 h ou mais vazias em ≥ 4 de 5 semanas; a mais longa.
  select x.wd, min(x.h) as h0, max(x.h) + 1 as h1, min(x.idle) as idle_weeks into b
  from (select g.wd, g.h, g.idle, g.h - row_number() over (partition by g.wd order by g.h) as grp
        from jsonb_to_recordset(v_grid) as g(wd integer, h integer, idle integer) where g.idle >= 4) x
  group by x.wd, x.grp
  having count(*) >= 2
  order by count(*) desc, min(x.idle) desc, (x.wd + 6) % 7, min(x.h)
  limit 1;
  if not found then
    return app.gi_out('quiet', 'no_idle_band', v_measure);
  end if;
  select s.id, s.name into v_svc, v_svc_name from public.bookings x join public.provider_services s on s.tenant_id = x.tenant_id and s.id = x.service_id and s.active
  where x.tenant_id = p_tenant_id and x.status in ('confirmed', 'completed', 'no_show') and x.starts_at >= v_from_ts and x.starts_at < v_to_ts
  group by s.id, s.name order by count(*) desc, s.id limit 1;
  if v_svc is null then
    return app.gi_out('insufficient', 'no_active_service', v_measure);
  end if;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure,
    'subject_key', format('wd%s-%s-%s', b.wd, b.h0, b.h1),
    'title', format('Horário vazio toda semana: %s das %sh às %sh', app.gi_weekday(b.wd), b.h0, b.h1),
    'body', format('A faixa ficou vazia em %s das últimas 5 semanas. Uma regra de preço só para ela (10%% no %s, por 4 semanas) pode atrair quem tem horário flexível. Ela nasce como proposta e só vale depois que você aprovar em Preços.', b.idle_weeks, v_svc_name),
    'evidence', jsonb_build_object('period_start', v_from, 'period_end', v_w0 - 1, 'numerator', b.idle_weeks, 'denominator', 5,
      'weekday', b.wd, 'band_start', b.h0, 'band_end', b.h1, 'bookings_in_period', v_n, 'idle_hours', v_idle, 'open_hours', v_hours),
    'action', jsonb_build_object('kind', 'proposal', 'flow', 'P05', 'operation', 'pricing.propose_rule', 'label', 'Preparar regra de preço', 'route', '/app/precos',
      'payload', jsonb_build_object('service_id', v_svc, 'service_name', v_svc_name, 'discount_bps', 1000, 'days', 28,
        'windows', jsonb_build_array(jsonb_build_object('weekday', b.wd, 'local_start', format('%s:00', lpad(b.h0::text, 2, '0')), 'local_end', format('%s:00', lpad(b.h1::text, 2, '0')))))),
    'valid_until', p_now + interval '2 days');
end $$;

/** Clientes sem retorno → convites de retorno como rascunhos manuais (P13), só para quem autorizou mensagens. */
create function app.gi_lapsed_customers(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_default integer := (app.lc_settings(p_tenant_id)).reactivation_days;
  v_returning integer;
  v_lapsed integer;
  v_ids jsonb;
  v_measure jsonb;
begin
  with done as (
    select x.customer_id, x.service_id, x.starts_at
    from public.bookings x join public.customers c on c.tenant_id = x.tenant_id and c.id = x.customer_id and c.archived_at is null
    where x.tenant_id = p_tenant_id and x.status = 'completed' and x.customer_id is not null and x.starts_at >= p_now - interval '365 days' and x.starts_at < p_now
  ), gaps as (
    select d.service_id, extract(epoch from d.starts_at - lag(d.starts_at) over (partition by d.customer_id, d.service_id order by d.starts_at)) / 86400.0 as gap from done d
  ), svc_days as (
    -- Intervalo de costume por serviço: 1,5 × a mediana dos intervalos (mínimo 14 dias), com 3 intervalos ou mais.
    select g.service_id, greatest(14, ceil(1.5 * percentile_cont(0.5) within group (order by g.gap)))::integer as n_days
    from gaps g where g.gap is not null group by g.service_id having count(*) >= 3
  ), per_customer as (
    select d.customer_id, max(d.starts_at) as last_at, (array_agg(d.service_id order by d.starts_at desc))[1] as last_service
    from done d group by d.customer_id having count(*) >= 2
  ), flagged as (
    select pc.customer_id, pc.last_at,
      (p_now - pc.last_at) > make_interval(days => coalesce(sd.n_days, v_default))
      and not exists (select 1 from public.bookings f where f.tenant_id = p_tenant_id and f.customer_id = pc.customer_id
        and f.status in ('held', 'confirmed') and f.starts_at >= p_now) as lapsed
    from per_customer pc left join svc_days sd on sd.service_id = pc.last_service
  )
  select count(*), count(*) filter (where f.lapsed),
    coalesce((select jsonb_agg(y.customer_id order by y.last_at) from (select * from flagged z where z.lapsed order by z.last_at limit 20) y), '[]'::jsonb)
  into v_returning, v_lapsed, v_ids from flagged f;
  if v_returning < 5 then
    return app.gi_out('insufficient', 'few_returning_customers', null);
  end if;
  v_measure := app.gi_measure(v_lapsed, v_returning, 'down');
  if v_lapsed = 0 then
    return app.gi_out('quiet', 'all_returning', v_measure);
  end if;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure, 'subject_key', 'lapsed',
    'title', case when v_lapsed = 1 then '1 cliente de retorno passou do prazo de costume' else format('%s clientes de retorno passaram do prazo de costume', v_lapsed) end,
    'body', format('Vieram 2 vezes ou mais e já passaram do intervalo de costume do serviço (ou %s dias quando ainda não há costume). Prepare convites de retorno: ficam como rascunho em Relacionamento para você revisar e enviar, só para quem autorizou mensagens.', v_default),
    'evidence', jsonb_build_object('period_start', ((p_now - interval '365 days') at time zone tz)::date, 'period_end', (p_now at time zone tz)::date,
      'numerator', v_lapsed, 'denominator', v_returning, 'default_days', v_default),
    'action', jsonb_build_object('kind', 'proposal', 'flow', 'P13', 'operation', 'lifecycle.draft_return', 'label', 'Preparar convites', 'route', '/app/relacionamento',
      'payload', jsonb_build_object('customer_ids', v_ids)),
    'valid_until', p_now + interval '2 days');
end $$;

/** Atendimentos sem cobrança (regra do P22 que passa para cá) → abrir o Caixa nos atendimentos (P07). */
create function app.gi_uncharged_bookings(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  m jsonb := app.ga_metric(p_tenant_id, 'charge_coverage', tstzrange(p_now - interval '30 days', p_now, '[)'));
  v_num numeric := nullif(m->>'numerator', '')::numeric;
  v_den numeric := nullif(m->>'denominator', '')::numeric;
  v_measure jsonb;
begin
  if m is null or m->>'status' <> 'ok' or coalesce(v_den, 0) < 5 then
    return app.gi_out('insufficient', 'few_completed', null);
  end if;
  v_measure := app.gi_measure(v_num, v_den, 'up');
  if v_num / v_den >= 0.9 then
    return app.gi_out('quiet', 'covered', v_measure);
  end if;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure, 'subject_key', 'last30',
    'title', case when v_den - v_num = 1 then '1 atendimento concluído sem cobrança registrada' else format('%s atendimentos concluídos sem cobrança registrada', (v_den - v_num)::integer) end,
    'body', 'Sem a cobrança registrada, o Recebido e o fechamento do mês ficam incompletos. No Caixa, os concluídos sem cobrança aparecem juntos para marcar como recebido, cobrar depois ou usar crédito de pacote.',
    'evidence', jsonb_build_object('period_start', ((p_now - interval '30 days') at time zone tz)::date, 'period_end', (p_now at time zone tz)::date,
      'numerator', v_num::integer, 'denominator', v_den::integer, 'uncharged', (v_den - v_num)::integer),
    'action', jsonb_build_object('kind', 'open', 'flow', 'P07', 'label', 'Abrir o Caixa', 'route', '/app/caixa'),
    'valid_until', p_now + interval '2 days');
end $$;

/** Faltas concentradas num dia da semana ou em poucas clientes → lembretes (P13). */
create function app.gi_no_show_concentration(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_total integer;
  v_ns integer;
  v_rate numeric;
  d record;
  v_rep_customers integer;
  v_rep_ns integer;
  v_measure jsonb;
  v_ev jsonb;
begin
  select count(*), count(*) filter (where x.status = 'no_show') into v_total, v_ns from public.bookings x
  where x.tenant_id = p_tenant_id and x.status in ('completed', 'no_show') and x.starts_at >= p_now - interval '60 days' and x.starts_at < p_now;
  if v_total < 20 then
    return app.gi_out('insufficient', 'few_outcomes', null);
  end if;
  v_measure := app.gi_measure(v_ns, v_total, 'down');
  if v_ns = 0 then
    return app.gi_out('quiet', 'no_no_shows', v_measure);
  end if;
  v_rate := v_ns::numeric / v_total;
  select y.wd, y.n, y.k into d from (
    select extract(dow from x.starts_at at time zone tz)::integer as wd, count(*)::integer as n, (count(*) filter (where x.status = 'no_show'))::integer as k
    from public.bookings x
    where x.tenant_id = p_tenant_id and x.status in ('completed', 'no_show') and x.starts_at >= p_now - interval '60 days' and x.starts_at < p_now
    group by 1) y
  where y.n >= 5 and y.k >= 3 and y.k::numeric / y.n >= 1.5 * v_rate
  order by y.k::numeric / y.n desc, y.k desc, (y.wd + 6) % 7 limit 1;
  select count(*), coalesce(sum(z.k), 0) into v_rep_customers, v_rep_ns from (
    select x.customer_id, count(*) as n, count(*) filter (where x.status = 'no_show') as k from public.bookings x
    where x.tenant_id = p_tenant_id and x.customer_id is not null and x.status in ('completed', 'no_show') and x.starts_at >= p_now - interval '60 days' and x.starts_at < p_now
    group by x.customer_id) z
  where z.k >= 2 and z.k::numeric / z.n >= 0.5;
  v_ev := jsonb_build_object('period_start', ((p_now - interval '60 days') at time zone tz)::date, 'period_end', (p_now at time zone tz)::date,
    'overall_no_show', v_ns, 'overall_total', v_total, 'repeat_customers', v_rep_customers, 'repeat_no_shows', v_rep_ns);
  if d.wd is not null then
    return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure, 'subject_key', format('wd%s', d.wd),
      'title', format('Faltas concentradas na %s', app.gi_weekday(d.wd)),
      'body', format('Na %s faltaram %s de %s atendimentos; na média dos dias, %s de %s. Lembrete mais perto do horário (2 h antes) ou uma antecedência maior na política de cancelamento costumam ajudar.', app.gi_weekday(d.wd), d.k, d.n, v_ns, v_total),
      'evidence', v_ev || jsonb_build_object('numerator', d.k, 'denominator', d.n, 'weekday', d.wd),
      'action', jsonb_build_object('kind', 'open', 'flow', 'P13', 'label', 'Ajustar lembretes', 'route', '/app/relacionamento'),
      'valid_until', p_now + interval '2 days');
  end if;
  if v_rep_customers >= 1 then
    return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure, 'subject_key', 'customers',
      'title', case when v_rep_customers = 1 then 'Faltas concentradas em 1 cliente' else format('Faltas concentradas em %s clientes', v_rep_customers) end,
      'body', format('%s das %s faltas do período são de quem faltou em metade das vezes ou mais. Confirmação e lembrete para essas clientes, ou sinal na reserva, costumam ajudar.', v_rep_ns, v_ns),
      'evidence', v_ev || jsonb_build_object('numerator', v_rep_ns, 'denominator', v_ns),
      'action', jsonb_build_object('kind', 'open', 'flow', 'P13', 'label', 'Ajustar lembretes', 'route', '/app/relacionamento'),
      'valid_until', p_now + interval '2 days');
  end if;
  return app.gi_out('quiet', 'spread', v_measure);
end $$;

/** Lista de espera com gente e vaga aberta por cancelamento → oferecer a vaga (P06). */
create function app.gi_waitlist_opening(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_waiting integer;
  v_slots integer;
  v_first timestamptz;
  v_cancel integer;
  m jsonb := app.ga_metric(p_tenant_id, 'waitlist_acceptance', tstzrange(p_now - interval '30 days', p_now, '[)'));
  v_measure jsonb;
begin
  if not exists (select 1 from public.waitlist_entries e where e.tenant_id = p_tenant_id) then
    return app.gi_out('insufficient', 'no_waitlist', null);
  end if;
  v_measure := case when m->>'status' = 'ok' then app.gi_measure((m->>'numerator')::numeric, (m->>'denominator')::numeric, 'up') end;
  select count(*) into v_waiting from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.status = 'active' and e.valid_until > p_now;
  select count(distinct c.slot), min(lower(c.slot)) into v_slots, v_first
  from public.waitlist_candidates c join public.waitlist_entries e on e.tenant_id = c.tenant_id and e.id = c.entry_id
  where c.tenant_id = p_tenant_id and c.status = 'open' and lower(c.slot) > p_now and e.status = 'active' and e.valid_until > p_now;
  select count(*) into v_cancel from public.bookings x
  where x.tenant_id = p_tenant_id and x.status = 'cancelled' and x.updated_at >= p_now - interval '7 days' and x.starts_at > p_now;
  if v_slots = 0 or v_waiting = 0 then
    return app.gi_out('quiet', 'no_open_slot', v_measure);
  end if;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure, 'subject_key', 'slots',
    'title', case when v_slots = 1 then 'Vaga aberta com gente na lista de espera' else format('%s vagas abertas com gente na lista de espera', v_slots) end,
    'body', 'Um horário liberado ainda não foi oferecido a quem espera. Na Lista de espera, a vaga aparece na ordem da fila; a oferta segura o horário e a pessoa aceita pelo link.',
    'evidence', jsonb_build_object('period_start', ((p_now - interval '7 days') at time zone tz)::date, 'period_end', (p_now at time zone tz)::date,
      'numerator', v_slots, 'denominator', v_waiting, 'recent_cancellations', v_cancel),
    'action', jsonb_build_object('kind', 'open', 'flow', 'P06', 'label', 'Oferecer a vaga', 'route', '/app/lista-de-espera'),
    'valid_until', least(v_first, p_now + interval '2 days'));
end $$;

/** Serviço com custo de materiais (ficha do P30) acima de 30% do preço → revisar preço (P05). */
create function app.gi_low_margin_service(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_covered integer;
  v_above integer;
  w record;
  v_measure jsonb;
begin
  with svc as (
    select s.id, s.name, s.base_price_cents as price,
      (select count(*) from public.material_service_usage u where u.tenant_id = s.tenant_id and u.service_id = s.id) as usage_items,
      (select count(*) from public.material_service_usage u join public.material_items i on i.tenant_id = u.tenant_id and i.id = u.item_id
        where u.tenant_id = s.tenant_id and u.service_id = s.id and i.on_hand = 0) as unknown_items,
      (select coalesce(sum(round(u.quantity * i.stock_value_cents / nullif(i.on_hand, 0))), 0)::bigint
        from public.material_service_usage u join public.material_items i on i.tenant_id = u.tenant_id and i.id = u.item_id
        where u.tenant_id = s.tenant_id and u.service_id = s.id) as cost
    from public.provider_services s where s.tenant_id = p_tenant_id and s.active and s.base_price_cents > 0
  ), covered as (select * from svc where usage_items > 0 and unknown_items = 0)
  select (select count(*) from covered), (select count(*) from covered c where c.cost > 0.30 * c.price) into v_covered, v_above;
  if v_covered = 0 then
    return app.gi_out('insufficient', 'no_cost_sheet', null);
  end if;
  v_measure := app.gi_measure(v_above, v_covered, 'down');
  if v_above = 0 then
    return app.gi_out('quiet', 'margins_ok', v_measure);
  end if;
  select z.* into w from (
    select s.id, s.name, s.base_price_cents as price,
      (select coalesce(sum(round(u.quantity * i.stock_value_cents / nullif(i.on_hand, 0))), 0)::bigint
        from public.material_service_usage u join public.material_items i on i.tenant_id = u.tenant_id and i.id = u.item_id
        where u.tenant_id = s.tenant_id and u.service_id = s.id) as cost
    from public.provider_services s
    where s.tenant_id = p_tenant_id and s.active and s.base_price_cents > 0
      and exists (select 1 from public.material_service_usage u where u.tenant_id = s.tenant_id and u.service_id = s.id)
      and not exists (select 1 from public.material_service_usage u join public.material_items i on i.tenant_id = u.tenant_id and i.id = u.item_id
        where u.tenant_id = s.tenant_id and u.service_id = s.id and i.on_hand = 0)) z
  order by z.cost::numeric / z.price desc, z.id limit 1;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure, 'subject_key', 'margin',
    'title', format('Materiais levam %s%% do preço do %s', round(100.0 * w.cost / w.price), w.name),
    'body', format('Pela ficha de materiais e o custo médio do estoque, o %s gasta %s de materiais para um preço de %s (limite de referência: 30%%). Vale revisar o preço ou a ficha.', w.name, app.lc_brl(w.cost), app.lc_brl(w.price)),
    'evidence', jsonb_build_object('period_start', (p_now at time zone tz)::date, 'period_end', (p_now at time zone tz)::date,
      'numerator', v_above, 'denominator', v_covered, 'service_name', w.name, 'cost_cents', w.cost, 'price_cents', w.price, 'threshold', 0.30),
    'action', jsonb_build_object('kind', 'open', 'flow', 'P05', 'label', 'Revisar preço', 'route', '/app/precos', 'payload', jsonb_build_object('service_id', w.id)),
    'valid_until', p_now + interval '2 days');
end $$;

/** Pacotes com sessões sobrando que vencem em 15 dias → avisos às clientes como rascunhos manuais (P13). */
create function app.gi_package_expiring(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_active integer;
  v_expiring integer;
  v_left integer;
  v_first timestamptz;
  v_ids jsonb;
  v_measure jsonb;
begin
  if not exists (select 1 from public.session_packages p where p.tenant_id = p_tenant_id) then
    return app.gi_out('insufficient', 'no_packages', null);
  end if;
  with pk as (
    select p.id, p.expires_at, p.purchased_credits + coalesce((select sum(e.delta) from public.session_entries e where e.tenant_id = p.tenant_id and e.package_id = p.id), 0)::integer as credits_left
    from public.session_packages p where p.tenant_id = p_tenant_id
  )
  select count(*) filter (where pk.credits_left > 0 and (pk.expires_at is null or pk.expires_at > p_now)),
    count(*) filter (where pk.credits_left > 0 and pk.expires_at > p_now and pk.expires_at <= p_now + interval '15 days'),
    coalesce(sum(pk.credits_left) filter (where pk.credits_left > 0 and pk.expires_at > p_now and pk.expires_at <= p_now + interval '15 days'), 0),
    min(pk.expires_at) filter (where pk.credits_left > 0 and pk.expires_at > p_now and pk.expires_at <= p_now + interval '15 days'),
    coalesce(jsonb_agg(pk.id order by pk.expires_at) filter (where pk.credits_left > 0 and pk.expires_at > p_now and pk.expires_at <= p_now + interval '15 days'), '[]'::jsonb)
  into v_active, v_expiring, v_left, v_first, v_ids from pk;
  v_measure := app.gi_measure(v_expiring, v_active, 'down');
  if v_expiring = 0 then
    return app.gi_out('quiet', 'none_expiring', v_measure);
  end if;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', v_measure, 'subject_key', 'next15',
    'title', case when v_expiring = 1 then '1 pacote vence em até 15 dias com sessões sobrando' else format('%s pacotes vencem em até 15 dias com sessões sobrando', v_expiring) end,
    'body', format('Somam %s sessão(ões) que a cliente já pagou. Prepare um aviso para cada uma: fica como rascunho em Relacionamento para você revisar e enviar.', v_left),
    'evidence', jsonb_build_object('period_start', (p_now at time zone tz)::date, 'period_end', ((p_now + interval '15 days') at time zone tz)::date,
      'numerator', v_expiring, 'denominator', v_active, 'sessions_left', v_left),
    'action', jsonb_build_object('kind', 'proposal', 'flow', 'P13', 'operation', 'lifecycle.draft_package', 'label', 'Preparar avisos', 'route', '/app/relacionamento',
      'payload', jsonb_build_object('package_ids', v_ids)),
    'valid_until', least(v_first, p_now + interval '2 days'));
end $$;

/** Perfil incompleto (publicação, foto, preço, canal) → o passo que falta (P44, na tela que resolve). */
create function app.gi_profile_incomplete(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_p public.public_profiles;
  v_published boolean;
  v_photo boolean;
  v_price boolean;
  v_channel boolean;
  v_missing text[] := '{}';
  v_done integer;
  v_route text;
begin
  select * into v_p from public.public_profiles x where x.tenant_id = p_tenant_id;
  if v_p.id is null and not exists (select 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.active) then
    -- Antes do primeiro serviço quem fala é a configuração guiada (P44): o insight espera.
    return app.gi_out('insufficient', 'setup_first', null);
  end if;
  v_published := v_p.published_at is not null;
  v_photo := v_p.photo_path is not null;
  v_price := exists (select 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.active and s.base_price_cents > 0);
  v_channel := exists (select 1 from public.channel_connections c where c.tenant_id = p_tenant_id and c.status = 'active');
  if not v_published then v_missing := v_missing || 'published'::text; end if;
  if not v_photo then v_missing := v_missing || 'photo'::text; end if;
  if not v_price then v_missing := v_missing || 'price'::text; end if;
  if not v_channel then v_missing := v_missing || 'channel'::text; end if;
  v_done := 4 - cardinality(v_missing);
  if v_done = 4 then
    return app.gi_out('quiet', 'complete', app.gi_measure(4, 4, 'up'));
  end if;
  v_route := case v_missing[1] when 'price' then '/app/clientes/servicos' when 'channel' then '/app/mensagens' else '/app/perfil' end;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', app.gi_measure(v_done, 4, 'up'), 'subject_key', 'profile',
    'title', format('Perfil: %s de 4 itens prontos', v_done),
    'body', 'Quem chega pelo link decide mais rápido com perfil publicado, foto, preço dos serviços e o WhatsApp verificado. O próximo passo abre a tela que resolve.',
    'evidence', jsonb_build_object('period_start', (p_now at time zone tz)::date, 'period_end', (p_now at time zone tz)::date,
      'numerator', v_done, 'denominator', 4, 'missing', to_jsonb(v_missing)),
    'action', jsonb_build_object('kind', 'open', 'flow', 'P44', 'label', case v_missing[1] when 'published' then 'Publicar o perfil' when 'photo' then 'Pôr uma foto'
      when 'price' then 'Pôr preço nos serviços' else 'Verificar o WhatsApp' end, 'route', v_route),
    'valid_until', p_now + interval '2 days');
end $$;

/** Mês fechando: recebido, a receber e despesas do mês com cobertura (P07/P31). Só informa. */
create function app.gi_month_closing(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_today date := (p_now at time zone tz)::date;
  v_ms date := date_trunc('month', (p_now at time zone tz))::date;
  v_me date := (date_trunc('month', (p_now at time zone tz)) + interval '1 month')::date - 1;
  v_from timestamptz := date_trunc('month', (p_now at time zone tz))::timestamp at time zone tz;
  v_to timestamptz := (date_trunc('month', (p_now at time zone tz)) + interval '1 month') at time zone tz;
  v_received bigint;
  v_n_pay integer;
  v_expenses bigint;
  v_n_exp integer;
  v_open bigint;
  m jsonb;
  v_den integer;
  v_num integer;
begin
  -- Estornado sai do mês inteiro (mesma regra do resumo do Caixa, P07/P31).
  select coalesce(sum(p.amount_cents), 0), count(*) into v_received, v_n_pay from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= v_from and p.received_at < v_to
    and not exists (select 1 from public.payment_entries r where r.tenant_id = p.tenant_id and r.reversal_of = p.id);
  select coalesce(sum(e.amount_cents), 0), count(*) into v_expenses, v_n_exp from public.expense_entries e
  where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= v_from and e.paid_at < v_to
    and not exists (select 1 from public.expense_entries r where r.tenant_id = e.tenant_id and r.reversal_of = e.id);
  select coalesce(sum(r.amount_cents - r.paid_cents), 0) into v_open from public.receivables r
  where r.tenant_id = p_tenant_id and r.status in ('open', 'partially_paid');
  m := app.ga_metric(p_tenant_id, 'charge_coverage', tstzrange(v_from, least(v_to, p_now), '[)'));
  v_den := coalesce(nullif(m->>'denominator', '')::integer, 0);
  v_num := coalesce(nullif(m->>'numerator', '')::integer, 0);
  if v_n_pay + v_n_exp + v_den = 0 then
    return app.gi_out('insufficient', 'no_records', null);
  end if;
  if v_me - v_today > 4 then
    return app.gi_out('quiet', 'not_closing', null);
  end if;
  return jsonb_build_object('status', 'fire', 'reason', null, 'measure', null, 'subject_key', 'm-' || to_char(v_ms, 'YYYY-MM'),
    'title', format('Mês fechando: %s registrados', app.lc_brl(v_received)),
    'body', format('Até agora: recebido %s, despesas %s e %s a receber em aberto. %s de %s atendimentos concluídos com cobrança registrada. É o caixa registrado, não DRE.',
      app.lc_brl(v_received), app.lc_brl(v_expenses), app.lc_brl(v_open), v_num, v_den),
    'evidence', jsonb_build_object('period_start', v_ms, 'period_end', v_me, 'numerator', v_num, 'denominator', v_den,
      'received_cents', v_received, 'expenses_cents', v_expenses, 'open_receivables_cents', v_open),
    'action', jsonb_build_object('kind', 'none', 'flow', 'P31', 'label', 'Ver o mês em Contas', 'route', '/app/contas'),
    'valid_until', v_to);
end $$;

/** Avalia uma regra do catálogo. */
create function app.gi_evaluate(p_tenant_id uuid, p_code text, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
begin
  r := case p_code
    when 'idle_slot' then app.gi_idle_slot(p_tenant_id, p_now)
    when 'lapsed_customers' then app.gi_lapsed_customers(p_tenant_id, p_now)
    when 'uncharged_bookings' then app.gi_uncharged_bookings(p_tenant_id, p_now)
    when 'no_show_concentration' then app.gi_no_show_concentration(p_tenant_id, p_now)
    when 'waitlist_opening' then app.gi_waitlist_opening(p_tenant_id, p_now)
    when 'low_margin_service' then app.gi_low_margin_service(p_tenant_id, p_now)
    when 'package_expiring' then app.gi_package_expiring(p_tenant_id, p_now)
    when 'profile_incomplete' then app.gi_profile_incomplete(p_tenant_id, p_now)
    when 'month_closing' then app.gi_month_closing(p_tenant_id, p_now)
  end;
  if r is null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'rule_code';
  end if;
  return r || jsonb_build_object('code', p_code);
end $$;

-- ---------------------------------------------------------------------------
-- Resumo semanal por modelo fixo
-- ---------------------------------------------------------------------------
create function app.gi_digest(p_tenant_id uuid, p_now timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_w0 date := date_trunc('week', (p_now at time zone tz))::date;
  v_ws date := date_trunc('week', (p_now at time zone tz))::date - 7;
  v_from timestamptz := (date_trunc('week', (p_now at time zone tz))::date - 7)::timestamp at time zone tz;
  v_to timestamptz := date_trunc('week', (p_now at time zone tz))::date::timestamp at time zone tz;
  v_history boolean;
  v_done integer;
  v_ns integer;
  v_cancel integer;
  v_received bigint;
  v_expenses bigint;
  v_new integer;
  v_open integer;
  v_body text;
  v_id uuid;
begin
  -- Sem uma semana inteira de conta, não há o que resumir.
  if (select t.created_at from public.tenants t where t.id = p_tenant_id) >= v_to then
    return null;
  end if;
  if exists (select 1 from public.insight_digests d where d.tenant_id = p_tenant_id and d.week_start = v_ws) then
    return null;
  end if;
  v_history := exists (select 1 from public.bookings x where x.tenant_id = p_tenant_id and x.starts_at < v_to);
  select count(*) filter (where x.status = 'completed'), count(*) filter (where x.status = 'no_show'), count(*) filter (where x.status = 'cancelled')
  into v_done, v_ns, v_cancel from public.bookings x where x.tenant_id = p_tenant_id and x.starts_at >= v_from and x.starts_at < v_to;
  select coalesce(sum(p.amount_cents), 0) into v_received from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= v_from and p.received_at < v_to
    and not exists (select 1 from public.payment_entries r where r.tenant_id = p.tenant_id and r.reversal_of = p.id);
  select coalesce(sum(e.amount_cents), 0) into v_expenses from public.expense_entries e
  where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= v_from and e.paid_at < v_to
    and not exists (select 1 from public.expense_entries r where r.tenant_id = e.tenant_id and r.reversal_of = e.id);
  select count(*) into v_new from public.customers c where c.tenant_id = p_tenant_id and c.created_at >= v_from and c.created_at < v_to;
  select count(*) into v_open from public.insights i where i.tenant_id = p_tenant_id and i.state = 'open';
  v_body := format('Resumo da semana de %s a %s.', app.gi_ddmm(v_ws), app.gi_ddmm(v_w0 - 1)) || E'\n'
    || case when not v_history then 'Atendimentos: ainda sem agenda registrada para resumir.'
            else format('Atendimentos: %s concluído(s), %s falta(s) e %s cancelamento(s).', v_done, v_ns, v_cancel) end || E'\n'
    || format('Recebido registrado: %s · Despesas registradas: %s.', app.lc_brl(v_received), app.lc_brl(v_expenses)) || E'\n'
    || format('Clientes novos no cadastro: %s.', v_new) || E'\n'
    || case when v_open = 0 then 'Nenhuma sugestão aberta: as regras só falam quando há dado suficiente.'
            else format('Para esta semana: %s sugestão(ões) em Metas e sugestões.', v_open) end || E'\n'
    || 'Texto automático por modelo fixo, com os números registrados no app.';
  insert into public.insight_digests (tenant_id, week_start, body, facts)
  values (p_tenant_id, v_ws, v_body, jsonb_build_object('period_start', v_ws, 'period_end', v_w0 - 1, 'has_history', v_history,
    'completed', v_done, 'no_show', v_ns, 'cancelled', v_cancel, 'received_cents', v_received, 'expenses_cents', v_expenses,
    'new_customers', v_new, 'open_insights', v_open))
  on conflict (tenant_id, week_start) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Rodada diária
-- ---------------------------------------------------------------------------

/** Avalia as nove regras de um negócio e atualiza os insights (upsert por regra e assunto). */
create function app.gi_run(p_tenant_id uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  tz text := app.lc_tz(p_tenant_id);
  v_today date := (p_now at time zone tz)::date;
  rl public.insight_rules;
  e jsonb;
  v_statuses jsonb := '[]';
  v_fired integer := 0;
begin
  for rl in select * from public.insight_rules order by priority desc, code loop
    e := app.gi_evaluate(p_tenant_id, rl.code, p_now);
    v_statuses := v_statuses || jsonb_build_object('code', rl.code, 'status', e->>'status', 'reason', e->>'reason');
    if e->>'status' = 'fire' then
      v_fired := v_fired + 1;
      -- Outro assunto da mesma regra que estava aberto deixou de valer.
      update public.insights i set state = 'resolved', version = i.version + 1
      where i.tenant_id = p_tenant_id and i.rule_code = rl.code and i.state = 'open' and i.subject_key <> e->>'subject_key';
      -- Regra silenciada ("Agora não") ou acompanhada há menos de 30 dias: não reaparece.
      continue when exists (select 1 from public.insights i where i.tenant_id = p_tenant_id and i.rule_code = rl.code
        and i.quiet_until > p_now and i.subject_key <> e->>'subject_key');
      insert into public.insights as i (tenant_id, rule_code, subject_key, priority, title, body, evidence, action, measure, first_seen_on, last_seen_on, valid_until)
      values (p_tenant_id, rl.code, e->>'subject_key', rl.priority, e->>'title', e->>'body', e->'evidence', e->'action', nullif(e->'measure', 'null'::jsonb), v_today, v_today,
        (e->>'valid_until')::timestamptz)
      on conflict (tenant_id, rule_code, subject_key) do update set
        title = excluded.title, body = excluded.body, evidence = excluded.evidence, action = excluded.action, measure = excluded.measure,
        priority = excluded.priority, last_seen_on = excluded.last_seen_on, valid_until = excluded.valid_until,
        state = case when i.state = 'open' then 'open'
                     when i.quiet_until is not null and i.quiet_until > p_now then i.state
                     else 'open' end,
        first_seen_on = case when i.state = 'resolved' then excluded.first_seen_on else i.first_seen_on end,
        version = i.version + 1;
    else
      update public.insights i set state = 'resolved', version = i.version + 1
      where i.tenant_id = p_tenant_id and i.rule_code = rl.code and i.state = 'open';
    end if;
  end loop;
  perform app.gi_digest(p_tenant_id, p_now);
  return jsonb_build_object('fired', v_fired, 'rules', v_statuses);
end $$;

/**
 * Worker: uma rodada por negócio e dia local. A linha em insight_runs é a reserva; duas rodadas simultâneas
 * esperam a mesma chave e só uma avalia. Falha de um negócio fica registrada e não para os outros.
 */
create function app.gi_tick(p_batch integer default 20, p_now timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  t record;
  v_claimed boolean;
  v_res jsonb;
  n integer := 0;
  v_failed integer := 0;
begin
  for t in
    select x.id, (v_now at time zone x.timezone)::date as d from public.tenants x
    where x.status = 'active'
      and not exists (select 1 from public.insight_runs r where r.tenant_id = x.id and r.run_date = (v_now at time zone x.timezone)::date)
    order by x.id limit least(greatest(coalesce(p_batch, 20), 1), 200)
  loop
    insert into public.insight_runs (tenant_id, run_date) values (t.id, t.d) on conflict do nothing returning true into v_claimed;
    continue when v_claimed is null;
    v_claimed := null;
    begin
      v_res := app.gi_run(t.id, v_now);
      update public.insight_runs r set finished_at = clock_timestamp(), result = v_res where r.tenant_id = t.id and r.run_date = t.d;
      n := n + 1;
    exception when others then
      update public.insight_runs r set finished_at = clock_timestamp(), result = jsonb_build_object('error', left(sqlerrm, 200))
      where r.tenant_id = t.id and r.run_date = t.d;
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('tenants', n, 'failed', v_failed);
end $$;

-- ---------------------------------------------------------------------------
-- P22 (substituições documentadas)
-- ---------------------------------------------------------------------------

/** Mesmas regras do P22, menos `charge_coverage`, que passou para o motor do P45 (`uncharged_bookings`). */
create or replace function app.ga_rules(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r tstzrange := app.ga_month(p_tenant_id);
  ms jsonb := app.an_metrics(p_tenant_id, lower(r), upper(r))->'metrics';
  out jsonb := '[]';
  m jsonb;
  function_result jsonb;
  v_profile public.public_profiles;
  v_aud integer;
begin
  m := (select x from jsonb_array_elements(ms) x where x->>'key' = 'no_show');
  if m->>'status' = 'ok' and (m->>'denominator')::numeric >= 5 and (m->>'value')::numeric >= 0.15 then
    function_result := (select x from jsonb_array_elements(ms) x where x->>'key' = 'reminders');
    if function_result->>'status' <> 'ok' or (function_result->>'value')::numeric < 0.8 then
      out := out || jsonb_build_object('rule_code', 'no_show_reminders', 'metric_key', 'no_show', 'title', 'Faltas acima de 15% e lembretes abaixo de 80%',
        'text', 'Ligue ou amplie os lembretes (24 h e 2 h antes). A régua sai sozinha pelo canal ou fica pronta para compartilhar.', 'route', '/app/relacionamento',
        'evidence', jsonb_build_object('no_show', m->'value', 'no_show_n', m->'denominator', 'reminders', function_result->'value'));
    end if;
  end if;
  m := (select x from jsonb_array_elements(ms) x where x->>'key' = 'occupancy');
  if m->>'status' = 'ok' and (m->>'denominator')::numeric > 0 and (m->>'value')::numeric < 0.5 then
    v_aud := (app.cp_segment(p_tenant_id, '{"kind":"inactive_days","days":30}')->>'audience_count')::integer;
    if v_aud > 0 then
      out := out || jsonb_build_object('rule_code', 'occupancy_campaign', 'metric_key', 'occupancy', 'title', 'Ocupação abaixo de 50% com clientes autorizadas sem atendimento há 30 dias',
        'text', 'Monte uma campanha com grupo de controle para quem não vem há 30 dias; o resultado sai por braço, com intervalo.', 'route', '/app/campanhas',
        'evidence', jsonb_build_object('occupancy', m->'value', 'sellable_minutes', m->'denominator', 'audience', v_aud));
    end if;
  end if;
  m := (select x from jsonb_array_elements(ms) x where x->>'key' = 'quote_acceptance');
  if m->>'status' = 'ok' and (m->>'denominator')::numeric >= 5 and (m->>'value')::numeric >= 0.6 then
    out := out || jsonb_build_object('rule_code', 'quote_recurrence', 'metric_key', 'quote_acceptance', 'title', 'Mais de 60% dos orçamentos aceitos',
      'text', 'Quem aceita bem tende a aceitar um plano: ofereça assinatura do serviço mais pedido (termos congelados na adesão).', 'route', '/app/assinaturas',
      'evidence', jsonb_build_object('quote_acceptance', m->'value', 'quotes', m->'denominator'));
  end if;
  select * into v_profile from public.public_profiles p where p.tenant_id = p_tenant_id and p.published_at is not null;
  if found and 'bio' = any (v_profile.public_fields) and not exists (select 1 from public.profile_contents c where c.tenant_id = p_tenant_id) then
    out := out || jsonb_build_object('rule_code', 'profile_bio', 'metric_key', null, 'title', 'Perfil público sem apresentação',
      'text', 'Você escolheu mostrar a apresentação no perfil, mas ela está vazia. Publique um texto aprovado para a sua profissão.', 'route', '/app/metas',
      'evidence', jsonb_build_object('profile_published', true, 'bio_field', true));
  end if;
  return out;
end $$;

/** Acompanhamento em 30 dias. Decisões de regras do P45 são medidas pela própria regra (mesmo número, mesmo sentido). */
create or replace function app.ga_tick(p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.advice_decisions;
  m jsonb;
  v_before numeric;
  v_after numeric;
  v_out text;
  v_dir text;
  n integer := 0;
begin
  for d in
    select * from public.advice_decisions x where x.metric_after is null and x.follow_up_at <= clock_timestamp()
    order by x.follow_up_at limit p_batch for update skip locked
  loop
    v_dir := (select r.direction from public.insight_rules r where r.code = d.rule_code);
    if v_dir is not null then
      m := coalesce(app.gi_evaluate(d.tenant_id, d.rule_code, clock_timestamp())->'measure', '{"status":"insufficient"}'::jsonb);
    elsif d.metric_key is null then
      m := jsonb_build_object('status', 'unavailable');
      v_dir := 'up';
    else
      m := coalesce(app.ga_metric(d.tenant_id, d.metric_key, tstzrange(d.follow_up_at - interval '30 days', d.follow_up_at, '[)')), '{"status":"unavailable"}'::jsonb);
      v_dir := app.ga_direction(d.metric_key);
    end if;
    v_before := nullif(d.metric_before->>'value', '')::numeric;
    v_after := nullif(m->>'value', '')::numeric;
    if v_before is null or v_after is null or m->>'status' <> 'ok' then
      v_out := 'insufficient';
    elsif abs(v_after - v_before) < 0.02 then
      v_out := 'unchanged';
    elsif (v_dir = 'up') = (v_after > v_before) then
      v_out := 'improved';
    else
      v_out := 'worsened';
    end if;
    update public.advice_decisions x set metric_after = m, outcome = v_out where x.id = d.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('followed_up', n);
end $$;

-- ---------------------------------------------------------------------------
-- Leitura e ações do dono
-- ---------------------------------------------------------------------------
create function app.gi_insight_json(i public.insights) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'rule_code', i.rule_code, 'subject_key', i.subject_key, 'state', i.state, 'priority', i.priority,
    'title', i.title, 'body', i.body, 'evidence', i.evidence,
    -- A ação vai sem o payload (ids internos); "Preparar" recalcula tudo no servidor.
    'action', i.action - 'payload', 'rule_title', r.title,
    'first_seen_on', i.first_seen_on::text, 'last_seen_on', i.last_seen_on::text, 'valid_until', app.fin_ts(i.valid_until),
    'quiet_until', app.fin_ts(i.quiet_until), 'acted_at', app.fin_ts(i.acted_at), 'result', i.result,
    'decision', (select jsonb_build_object('id', d.id, 'decision', d.decision, 'outcome', d.outcome, 'follow_up_at', app.fin_ts(d.follow_up_at),
      'metric_before', d.metric_before, 'metric_after', d.metric_after) from public.advice_decisions d where d.tenant_id = i.tenant_id and d.id = i.decision_id),
    'version', i.version)
  from public.insight_rules r where r.code = i.rule_code
$$;

/** Insights do negócio. `home`: até 3 abertos, por prioridade. `all`: abertos, recentes e o status de cada regra. */
create function public.insight_list(p_tenant_id uuid, p_scope text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_run public.insight_runs;
begin
  perform app.ga_owner(p_tenant_id);
  if p_scope not in ('home', 'all') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'scope';
  end if;
  select * into v_run from public.insight_runs r where r.tenant_id = p_tenant_id order by r.run_date desc limit 1;
  return jsonb_build_object(
    'run', case when v_run.tenant_id is null then null else jsonb_build_object('run_date', v_run.run_date::text, 'finished_at', app.fin_ts(v_run.finished_at)) end,
    'insights', coalesce((select jsonb_agg(app.gi_insight_json(i) order by (i.state = 'open') desc, i.priority desc, i.updated_at desc)
      from (select * from public.insights i where i.tenant_id = p_tenant_id
              and (i.state = 'open' and i.valid_until > clock_timestamp() or (p_scope = 'all' and i.state <> 'open' and i.updated_at > clock_timestamp() - interval '45 days'))
            order by (i.state = 'open') desc, i.priority desc, i.updated_at desc
            limit case when p_scope = 'home' then 3 else 50 end) i), '[]'::jsonb),
    'rules', case when p_scope = 'home' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'title', r.title, 'flow', r.flow,
        'status', (select x->>'status' from jsonb_array_elements(v_run.result->'rules') x where x->>'code' = r.code),
        'reason', (select x->>'reason' from jsonb_array_elements(v_run.result->'rules') x where x->>'code' = r.code)) order by r.priority desc)
      from public.insight_rules r), '[]'::jsonb) end);
end $$;

/** "Agora não": silencia a regra por 30 dias e registra a dispensa (P22) para o acompanhamento. */
create function public.insight_snooze(
  p_tenant_id uuid,
  p_insight_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  i public.insights;
  v_dec uuid;
  v_body jsonb;
begin
  perform app.ga_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'insight.snooze', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into i from public.insights x where x.tenant_id = p_tenant_id and x.id = p_insight_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if p_expected_version is null or i.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  if i.state <> 'open' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'state'; end if;
  if jsonb_typeof(i.measure) = 'object' then
    insert into public.advice_decisions (tenant_id, rule_code, metric_key, decision, evidence, metric_before, follow_up_at, decided_by)
    values (p_tenant_id, i.rule_code, null, 'dismissed', i.evidence, i.measure, clock_timestamp() + interval '30 days', v_uid)
    on conflict do nothing returning id into v_dec;
  end if;
  update public.insights x set state = 'snoozed', quiet_until = clock_timestamp() + interval '30 days', decision_id = coalesce(v_dec, x.decision_id), version = x.version + 1
  where x.id = i.id returning * into i;
  perform app.audit(p_tenant_id, 'insight.snooze', 'insight', i.id, p_request_id, null, jsonb_build_object('rule_code', i.rule_code));
  v_body := jsonb_build_object('insight', app.gi_insight_json(i), 'result', null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'insight.snooze', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/**
 * "Preparar" / "Ver": reavalia a regra agora e, se ela ainda dispara com o mesmo assunto, cria a PROPOSTA no fluxo
 * dono (P05: regra de preço inativa, aprovada em Preços; P13: rascunhos manuais em Relacionamento) ou devolve a tela
 * do fluxo. Nada é publicado, enviado ou cobrado aqui. Registra a decisão (P22) para o acompanhamento em 30 dias.
 */
create function public.insight_act(
  p_tenant_id uuid,
  p_insight_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  i public.insights;
  e jsonb;
  a jsonb;
  v_res jsonb;
  v_result jsonb;
  v_dec uuid;
  v_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_tname text;
  c record;
  v_step_key text;
  v_denied text;
  v_body jsonb;
begin
  perform app.ga_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'insight.act', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into i from public.insights x where x.tenant_id = p_tenant_id and x.id = p_insight_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if p_expected_version is null or i.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  if i.state <> 'open' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'state'; end if;
  -- Dado de agora, não o da madrugada.
  e := app.gi_evaluate(p_tenant_id, i.rule_code, clock_timestamp());
  if e->>'status' <> 'fire' or e->>'subject_key' <> i.subject_key then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'stale';
  end if;
  a := e->'action';
  v_step_key := 'ins-' || replace(i.id::text, '-', '');
  select t.name into v_tname from public.tenants t where t.id = p_tenant_id;
  if a->>'operation' = 'pricing.propose_rule' then
    -- Proposta inativa no P05: publicar continua sendo "Aprovar e publicar" em Preços (hash do que foi visto).
    v_res := public.pricing_propose_rule(p_tenant_id, (a->'payload'->>'service_id')::uuid, a->'payload'->'windows',
      (a->'payload'->>'discount_bps')::integer, (a->'payload'->>'discount_bps')::integer, 0, clock_timestamp(),
      clock_timestamp() + make_interval(days => (a->'payload'->>'days')::integer),
      'insight-act-' || replace(i.id::text, '-', ''), p_request_hash, p_request_id);
    v_result := jsonb_build_object('kind', 'pricing_proposal', 'created', 1, 'skipped', 0, 'route', '/app/precos',
      'ref', v_res->'body'->>'proposal_id');
  elsif a->>'operation' = 'lifecycle.draft_return' then
    -- Rascunhos manuais: nada sai pelo canal; o dono revisa, compartilha ou cancela em Relacionamento.
    for c in select cu.id, split_part(btrim(cu.name), ' ', 1) as first_name from public.customers cu
             where cu.tenant_id = p_tenant_id and cu.id in (select (x #>> '{}')::uuid from jsonb_array_elements(a->'payload'->'customer_ids') x) loop
      v_denied := app.lc_denied(p_tenant_id, c.id, 'marketing');
      if v_denied is not null then v_skipped := v_skipped + 1; continue; end if;
      insert into public.lifecycle_steps (tenant_id, rule, step_key, aggregate_type, aggregate_id, customer_id, due_at, status, template_code, params, body)
      values (p_tenant_id, 'reactivation', v_step_key, 'customer', c.id, c.id, clock_timestamp(), 'manual', 'reativacao',
        jsonb_build_array(c.first_name, v_tname), app.ch_render('reativacao', jsonb_build_array(c.first_name, v_tname)))
      on conflict (tenant_id, rule, aggregate_id, step_key) do nothing returning id into v_id;
      if v_id is not null then v_created := v_created + 1; end if;
      v_id := null;
    end loop;
    v_result := jsonb_build_object('kind', 'lifecycle_drafts', 'created', v_created, 'skipped', v_skipped, 'skip_reason', case when v_skipped > 0 then 'no_marketing_consent' end,
      'route', '/app/relacionamento');
  elsif a->>'operation' = 'lifecycle.draft_package' then
    for c in select p.id, p.customer_id, p.expires_at, split_part(btrim(cu.name), ' ', 1) as first_name, s.name as service_name,
               p.purchased_credits + coalesce((select sum(e2.delta) from public.session_entries e2 where e2.tenant_id = p.tenant_id and e2.package_id = p.id), 0)::integer as credits_left
             from public.session_packages p join public.customers cu on cu.tenant_id = p.tenant_id and cu.id = p.customer_id
               join public.provider_services s on s.tenant_id = p.tenant_id and s.id = p.service_id
             where p.tenant_id = p_tenant_id and p.id in (select (x #>> '{}')::uuid from jsonb_array_elements(a->'payload'->'package_ids') x) loop
      v_denied := app.lc_denied(p_tenant_id, c.customer_id, 'transactional');
      if v_denied is not null then v_skipped := v_skipped + 1; continue; end if;
      insert into public.lifecycle_steps (tenant_id, rule, step_key, aggregate_type, aggregate_id, customer_id, due_at, status, template_code, params, body)
      values (p_tenant_id, 'package_expiry', v_step_key, 'package', c.id, c.customer_id, clock_timestamp(), 'manual', 'pacote_vencendo',
        jsonb_build_array(c.first_name, c.service_name, c.credits_left::text, to_char(c.expires_at at time zone app.lc_tz(p_tenant_id), 'DD/MM')),
        app.ch_render('pacote_vencendo', jsonb_build_array(c.first_name, c.service_name, c.credits_left::text, to_char(c.expires_at at time zone app.lc_tz(p_tenant_id), 'DD/MM'))))
      on conflict (tenant_id, rule, aggregate_id, step_key) do nothing returning id into v_id;
      if v_id is not null then v_created := v_created + 1; end if;
      v_id := null;
    end loop;
    v_result := jsonb_build_object('kind', 'lifecycle_drafts', 'created', v_created, 'skipped', v_skipped, 'skip_reason', case when v_skipped > 0 then 'consent' end,
      'route', '/app/relacionamento');
  else
    v_result := jsonb_build_object('kind', a->>'kind', 'created', 0, 'skipped', 0, 'route', a->>'route');
  end if;
  if e->'measure' is not null and jsonb_typeof(e->'measure') = 'object' and e->'measure'->>'status' = 'ok' then
    insert into public.advice_decisions (tenant_id, rule_code, metric_key, decision, evidence, metric_before, follow_up_at, decided_by)
    values (p_tenant_id, i.rule_code, null, 'accepted', e->'evidence', e->'measure', clock_timestamp() + interval '30 days', v_uid)
    on conflict do nothing returning id into v_dec;
  end if;
  update public.insights x set state = 'acted', acted_at = clock_timestamp(), result = v_result, evidence = e->'evidence', measure = nullif(e->'measure', 'null'::jsonb),
    quiet_until = greatest(clock_timestamp() + interval '30 days', x.valid_until), decision_id = coalesce(v_dec, x.decision_id), version = x.version + 1
  where x.id = i.id returning * into i;
  perform app.audit(p_tenant_id, 'insight.act', 'insight', i.id, p_request_id, null,
    jsonb_build_object('rule_code', i.rule_code, 'result_kind', v_result->>'kind', 'created', v_result->'created'));
  v_body := jsonb_build_object('insight', app.gi_insight_json(i), 'result', v_result);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'insight.act', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Resumos semanais do dono (os 8 mais recentes). */
create function public.digest_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.ga_owner(p_tenant_id);
  return jsonb_build_object('digests', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'week_start', d.week_start::text, 'body', d.body, 'facts', d.facts,
      'created_at', app.fin_ts(d.created_at)) order by d.week_start desc)
    from (select * from public.insight_digests d where d.tenant_id = p_tenant_id order by d.week_start desc limit 8) d), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Worker: o motor entra na rodada (uma vez por dia por negócio; as outras rodadas do dia não fazem nada)
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
  v_referrals jsonb;
  v_campaigns jsonb;
  v_advice jsonb;
  v_insights jsonb;
  e public.outbox_events;
begin
  v_expired_offers := app.wl_expire_offers();
  v_expired_holds := public.scheduling_expire_holds();
  v_recurrence := app.rc_tick(100);
  v_referrals := app.ref_tick(100);
  v_campaigns := app.cp_tick(100);
  v_advice := app.ga_tick(100);
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
  -- Depois do outbox e da régua: o motor lê o estado já atualizado.
  v_insights := app.gi_tick(20);
  return jsonb_build_object('done', v_done, 'retried', v_failed, 'dead', v_dead, 'expired_holds', v_expired_holds, 'expired_offers', v_expired_offers,
    'lifecycle', v_lifecycle, 'recurrence', v_recurrence, 'referrals', v_referrals, 'campaigns', v_campaigns, 'advice', v_advice, 'insights', v_insights);
end $$;

-- ---------------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------------
revoke all on function app.gi_weekday(integer), app.gi_ddmm(date), app.gi_out(text, text, jsonb), app.gi_measure(numeric, numeric, text),
  app.gi_idle_slot(uuid, timestamptz), app.gi_lapsed_customers(uuid, timestamptz), app.gi_uncharged_bookings(uuid, timestamptz),
  app.gi_no_show_concentration(uuid, timestamptz), app.gi_waitlist_opening(uuid, timestamptz), app.gi_low_margin_service(uuid, timestamptz),
  app.gi_package_expiring(uuid, timestamptz), app.gi_profile_incomplete(uuid, timestamptz), app.gi_month_closing(uuid, timestamptz),
  app.gi_evaluate(uuid, text, timestamptz), app.gi_digest(uuid, timestamptz), app.gi_run(uuid, timestamptz), app.gi_tick(integer, timestamptz),
  app.gi_insight_json(public.insights) from public, anon, authenticated;
revoke all on function public.insight_list(uuid, text) from public, anon;
revoke all on function public.insight_snooze(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.insight_act(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.digest_list(uuid) from public, anon;
grant execute on function public.insight_list(uuid, text) to authenticated;
grant execute on function public.insight_snooze(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.insight_act(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.digest_list(uuid) to authenticated;

alter table public.insight_rules enable row level security;
alter table public.insight_runs enable row level security;
alter table public.insights enable row level security;
alter table public.insight_digests enable row level security;
grant select on public.insight_rules, public.insights, public.insight_digests to authenticated;
create policy insight_rules_read on public.insight_rules for select to authenticated using (true);
create policy insights_owner_select on public.insights for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy insight_digests_owner_select on public.insight_digests for select to authenticated using (app.is_member(tenant_id, array['owner']));
-- insight_runs: sem grant nem política (backend-only).
