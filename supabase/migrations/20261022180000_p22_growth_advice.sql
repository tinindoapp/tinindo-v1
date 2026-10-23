-- P22 · Metas e conteúdo (ADR-0023). Append-only sobre P18 (indicadores), P13/P19 (ações sugeridas), P09 (perfil público).
-- Metas por indicador do P18 com progresso e denominador; sugestões só por regras sobre dado existente (sem LLM), com
-- decisão do dono registrada e acompanhamento observacional (variação observada, nunca efeito); conteúdo pré-aprovado
-- por profissão, publicado só pelo escopo autorizado do P09 (perfil publicado com o campo `bio` escolhido pelo dono).
-- Substituições por `create or replace` documentadas: `app.network_profile_json` (passa a ter fonte para `bio`) e
-- `public.jobs_run` (acompanhamento das sugestões).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  metric_key text not null check (metric_key in ('occupancy', 'no_show', 'cancellation', 'waitlist_acceptance', 'quote_acceptance', 'received', 'expenses', 'charge_coverage', 'reminders')),
  -- ratio: 0–1 (4 casas); cents: inteiro.
  target numeric not null check (target >= 0),
  -- up = quanto maior melhor; down = quanto menor melhor (faltas, cancelamentos, despesas). Derivado do indicador.
  direction text not null check (direction in ('up', 'down')),
  -- Primeiro dia do mês (fuso do negócio) a que a meta se refere.
  period_start date not null,
  note text check (char_length(note) <= 200),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id)
);
comment on table public.goals is 'Meta mensal por indicador do P18. O progresso é o próprio indicador (com denominador), nunca um número declarado.';
create unique index goals_one_active on public.goals (tenant_id, metric_key, period_start) where status = 'active';
create index goals_tenant on public.goals (tenant_id, period_start desc);
create trigger goals_touch before update on public.goals for each row execute function app.touch_row();

create table public.advice_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  rule_code text not null check (rule_code ~ '^[a-z0-9_]{3,40}$'),
  metric_key text,
  decision text not null check (decision in ('accepted', 'dismissed')),
  -- Evidência que gerou a sugestão (contagens e taxas, nunca nomes).
  evidence jsonb not null default '{}',
  -- Indicador no momento da decisão e 30 dias depois (preenchido pelo worker). Variação observada, não efeito.
  metric_before jsonb,
  follow_up_at timestamptz not null,
  metric_after jsonb,
  outcome text check (outcome in ('improved', 'worsened', 'unchanged', 'insufficient')),
  decided_by uuid,
  decided_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.advice_decisions is 'Decisão do dono sobre uma sugestão por regra e o acompanhamento observacional do indicador. Sem LLM, sem causalidade.';
create unique index advice_decisions_month on public.advice_decisions (tenant_id, rule_code, (date_trunc('month', decided_at at time zone 'UTC')::date));
create index advice_decisions_follow on public.advice_decisions (follow_up_at) where metric_after is null;

create table public.content_templates (
  code text primary key check (code ~ '^[a-z0-9_]{3,40}$'),
  -- Profissão alvo (ou 'all'). Mesmo vocabulário do P09/contexto.
  profession text not null check (profession in ('barber', 'hairdresser', 'personal_trainer', 'other', 'all')),
  kind text not null check (kind in ('bio', 'post')),
  title text not null check (char_length(title) between 1 and 80),
  -- Corpo com {{business}} e {{area}}. Sem dados de clientes. Aprovado pela Tinindo antes de entrar aqui.
  body text not null check (char_length(body) between 1 and 600),
  approved_by text not null default 'tinindo',
  created_at timestamptz not null default now()
);
comment on table public.content_templates is 'Conteúdo pré-aprovado por profissão. Entra por migration (revisão humana), nunca por tela.';
insert into public.content_templates (code, profession, kind, title, body) values
  ('bio_barber_classico', 'barber', 'bio', 'Apresentação clássica', '{{business}} em {{area}}: cortes, barba e cuidado com horário marcado. Agende pelo link e chegue na hora combinada.'),
  ('bio_barber_familia', 'barber', 'bio', 'Apresentação família', 'Barbearia de bairro em {{area}}. Atendimento com hora marcada para você e para a família, sem fila.'),
  ('bio_hair_cuidado', 'hairdresser', 'bio', 'Cuidado e técnica', '{{business}} em {{area}}: corte, cor e tratamento com avaliação antes de começar. Agende pelo link.'),
  ('bio_hair_rapido', 'hairdresser', 'bio', 'Rotina prática', 'Cabelo bem cuidado sem perder a manhã: horário marcado em {{area}}, com orçamento combinado antes.'),
  ('bio_pt_resultado', 'personal_trainer', 'bio', 'Treino com acompanhamento', '{{business}}: treinos individuais em {{area}}, com plano combinado e acompanhamento de presença. Agende uma avaliação.'),
  ('bio_pt_inicio', 'personal_trainer', 'bio', 'Começar com segurança', 'Personal em {{area}} para quem está começando ou voltando a treinar. Avaliação inicial e horários fixos pelo link.'),
  ('bio_other_simples', 'all', 'bio', 'Apresentação simples', '{{business}} em {{area}}. Atendimento com hora marcada: agende pelo link e receba a confirmação.'),
  ('post_horarios_semana', 'all', 'post', 'Horários da semana', 'Abrimos a agenda da semana no {{business}} ({{area}}). Garanta seu horário pelo link; confirmamos na hora.'),
  ('post_retorno', 'all', 'post', 'Convite de retorno', 'Faz tempo que não nos vemos? O {{business}} está com horários abertos em {{area}}. Agende pelo link.');

create table public.profile_contents (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  template_code text not null references public.content_templates (code) on delete restrict,
  -- Texto final (modelo com {{business}}/{{area}} preenchidos pelos dados que o negócio já declarou públicos).
  body text not null check (char_length(body) between 1 and 600),
  published_by uuid,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);
comment on table public.profile_contents is 'Conteúdo aprovado publicado como `bio` do perfil público (P09). Só aparece se o dono escolheu `bio` nos campos públicos.';
create trigger profile_contents_touch before update on public.profile_contents for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------
create function app.ga_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.ga_direction(p_key text) returns text
language sql immutable set search_path = '' as $$
  select case when p_key in ('no_show', 'cancellation', 'expenses') then 'down' else 'up' end
$$;

/** Mês corrente no fuso do negócio: [início, fim). */
create function app.ga_month(p_tenant_id uuid, p_start date default null) returns tstzrange
language sql stable set search_path = '' as $$
  select tstzrange(
    (coalesce(p_start, date_trunc('month', clock_timestamp() at time zone app.lc_tz(p_tenant_id))::date)) ::timestamp at time zone app.lc_tz(p_tenant_id),
    (coalesce(p_start, date_trunc('month', clock_timestamp() at time zone app.lc_tz(p_tenant_id))::date) + interval '1 month')::timestamp at time zone app.lc_tz(p_tenant_id), '[)')
$$;

/** Um indicador do P18 num período (mesma definição, mesmo denominador). */
create function app.ga_metric(p_tenant_id uuid, p_key text, p_range tstzrange) returns jsonb
language sql stable security definer set search_path = '' as $$
  select m from jsonb_array_elements(app.an_metrics(p_tenant_id, lower(p_range), upper(p_range))->'metrics') m where m->>'key' = p_key
$$;

create function app.ga_goal_json(g public.goals) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m jsonb := app.ga_metric(g.tenant_id, g.metric_key, app.ga_month(g.tenant_id, g.period_start));
  v numeric := nullif(m->>'value', '')::numeric;
  v_att numeric;
  v_done boolean;
begin
  if v is not null and m->>'status' = 'ok' then
    if g.direction = 'up' then
      v_att := case when g.target = 0 then 1 else least(1, round(v / g.target, 4)) end;
      v_done := v >= g.target;
    else
      v_att := case when v = 0 then 1 else least(1, round(g.target / v, 4)) end;
      v_done := v <= g.target;
    end if;
  end if;
  return jsonb_build_object('id', g.id, 'metric_key', g.metric_key, 'label', m->>'label', 'unit', m->>'unit', 'target', g.target, 'direction', g.direction,
    'period_start', g.period_start::text, 'note', g.note, 'status', g.status, 'created_at', app.fin_ts(g.created_at), 'version', g.version,
    'progress', jsonb_build_object('value', v, 'numerator', nullif(m->>'numerator', '')::numeric, 'denominator', nullif(m->>'denominator', '')::numeric,
      'status', coalesce(m->>'status', 'unavailable'), 'note', m->>'note', 'attainment', v_att, 'achieved', v_done));
end $$;

/**
 * Sugestões por regras (sem LLM) sobre o mês corrente. Cada uma só aparece com dado existente e suficiente, e traz a
 * evidência (taxa, numerador, denominador) e para onde ir. Nunca promete resultado.
 */
create function app.ga_rules(p_tenant_id uuid) returns jsonb
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
  -- Faltas altas com lembretes abaixo do esperado → ligar/ajustar lembretes (P13).
  m := (select x from jsonb_array_elements(ms) x where x->>'key' = 'no_show');
  if m->>'status' = 'ok' and (m->>'denominator')::numeric >= 5 and (m->>'value')::numeric >= 0.15 then
    function_result := (select x from jsonb_array_elements(ms) x where x->>'key' = 'reminders');
    if function_result->>'status' <> 'ok' or (function_result->>'value')::numeric < 0.8 then
      out := out || jsonb_build_object('rule_code', 'no_show_reminders', 'metric_key', 'no_show', 'title', 'Faltas acima de 15% e lembretes abaixo de 80%',
        'text', 'Ligue ou amplie os lembretes (24 h e 2 h antes). A régua sai sozinha pelo canal ou fica pronta para compartilhar.', 'route', '/app/relacionamento',
        'evidence', jsonb_build_object('no_show', m->'value', 'no_show_n', m->'denominator', 'reminders', function_result->'value'));
    end if;
  end if;
  -- Ocupação baixa com público autorizado → campanha com controle (P19).
  m := (select x from jsonb_array_elements(ms) x where x->>'key' = 'occupancy');
  if m->>'status' = 'ok' and (m->>'denominator')::numeric > 0 and (m->>'value')::numeric < 0.5 then
    v_aud := (app.cp_segment(p_tenant_id, '{"kind":"inactive_days","days":30}')->>'audience_count')::integer;
    if v_aud > 0 then
      out := out || jsonb_build_object('rule_code', 'occupancy_campaign', 'metric_key', 'occupancy', 'title', 'Ocupação abaixo de 50% com clientes autorizadas sem atendimento há 30 dias',
        'text', 'Monte uma campanha com grupo de controle para quem não vem há 30 dias; o resultado sai por braço, com intervalo.', 'route', '/app/campanhas',
        'evidence', jsonb_build_object('occupancy', m->'value', 'sellable_minutes', m->'denominator', 'audience', v_aud));
    end if;
  end if;
  -- Atendimentos sem cobrança registrada → Caixa (P07).
  m := (select x from jsonb_array_elements(ms) x where x->>'key' = 'charge_coverage');
  if m->>'status' = 'ok' and (m->>'denominator')::numeric >= 5 and (m->>'value')::numeric < 0.9 then
    out := out || jsonb_build_object('rule_code', 'charge_coverage', 'metric_key', 'charge_coverage', 'title', 'Menos de 90% dos atendimentos com cobrança registrada',
      'text', 'Registre a cobrança ao concluir o atendimento (ou use o link de pagamento). Sem isso, o Recebido fica incompleto.', 'route', '/app/caixa',
      'evidence', jsonb_build_object('charge_coverage', m->'value', 'completed', m->'denominator'));
  end if;
  -- Orçamentos bem aceitos → oferecer plano recorrente (P20).
  m := (select x from jsonb_array_elements(ms) x where x->>'key' = 'quote_acceptance');
  if m->>'status' = 'ok' and (m->>'denominator')::numeric >= 5 and (m->>'value')::numeric >= 0.6 then
    out := out || jsonb_build_object('rule_code', 'quote_recurrence', 'metric_key', 'quote_acceptance', 'title', 'Mais de 60% dos orçamentos aceitos',
      'text', 'Quem aceita bem tende a aceitar um plano: ofereça assinatura do serviço mais pedido (termos congelados na adesão).', 'route', '/app/assinaturas',
      'evidence', jsonb_build_object('quote_acceptance', m->'value', 'quotes', m->'denominator'));
  end if;
  -- Perfil publicado com `bio` escolhida e sem conteúdo → publicar conteúdo aprovado (P22/P09).
  select * into v_profile from public.public_profiles p where p.tenant_id = p_tenant_id and p.published_at is not null;
  if found and 'bio' = any (v_profile.public_fields) and not exists (select 1 from public.profile_contents c where c.tenant_id = p_tenant_id) then
    out := out || jsonb_build_object('rule_code', 'profile_bio', 'metric_key', null, 'title', 'Perfil público sem apresentação',
      'text', 'Você escolheu mostrar a apresentação no perfil, mas ela está vazia. Publique um texto aprovado para a sua profissão.', 'route', '/app/metas',
      'evidence', jsonb_build_object('profile_published', true, 'bio_field', true));
  end if;
  return out;
end $$;

/** Acompanhamento: 30 dias depois da decisão, mede o mesmo indicador de novo. Variação observada; nunca efeito. */
create function app.ga_tick(p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.advice_decisions;
  m jsonb;
  v_before numeric;
  v_after numeric;
  v_out text;
  n integer := 0;
begin
  for d in
    select * from public.advice_decisions x where x.metric_after is null and x.follow_up_at <= clock_timestamp()
    order by x.follow_up_at limit p_batch for update skip locked
  loop
    if d.metric_key is null then
      m := jsonb_build_object('status', 'unavailable');
    else
      m := coalesce(app.ga_metric(d.tenant_id, d.metric_key, tstzrange(d.follow_up_at - interval '30 days', d.follow_up_at, '[)')), '{"status":"unavailable"}'::jsonb);
    end if;
    v_before := nullif(d.metric_before->>'value', '')::numeric;
    v_after := nullif(m->>'value', '')::numeric;
    if v_before is null or v_after is null or m->>'status' <> 'ok' then
      v_out := 'insufficient';
    elsif abs(v_after - v_before) < 0.02 then
      v_out := 'unchanged';
    elsif (app.ga_direction(d.metric_key) = 'up') = (v_after > v_before) then
      v_out := 'improved';
    else
      v_out := 'worsened';
    end if;
    update public.advice_decisions x set metric_after = m, outcome = v_out where x.id = d.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('followed_up', n);
end $$;

create function app.ga_render(p_tenant_id uuid, p_body text) returns text
language sql stable security definer set search_path = '' as $$
  select replace(replace(p_body, '{{business}}', (select t.name from public.tenants t where t.id = p_tenant_id)),
    '{{area}}', coalesce((select p.area from public.public_profiles p where p.tenant_id = p_tenant_id), 'sua região'))
$$;

-- ---------------------------------------------------------------------------
-- P09 (aditivo): a projeção pública ganha fonte para `bio` (conteúdo aprovado), só se o dono escolheu o campo.
-- ---------------------------------------------------------------------------
create or replace function app.network_profile_json(p public.public_profiles, p_display_name text)
returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', p.slug,
    'category', p.category,
    'area', p.area,
    'public_fields', to_jsonb(p.public_fields),
    -- Valores vêm de dados que o próprio negócio já declarou públicos; `bio` vem do conteúdo aprovado publicado
    -- pelo dono (P22) e só aparece se o campo foi escolhido. Resumo de serviços ainda não tem fonte.
    'values', jsonb_strip_nulls(jsonb_build_object(
      'display_name', case when 'display_name' = any (p.public_fields) then p_display_name end,
      'bio', case when 'bio' = any (p.public_fields) then (select c.body from public.profile_contents c where c.tenant_id = p.tenant_id) end
    )),
    'published_at', p.published_at,
    -- Reputação começa vazia e só muda por mecanismos verificáveis futuros, nunca por convite.
    'reputation', jsonb_build_object('identity_verified', false, 'reviews_count', 0),
    'version', p.version
  )
$$;
revoke all on function app.network_profile_json(public.public_profiles, text) from public;

-- ---------------------------------------------------------------------------
-- RPCs do dono
-- ---------------------------------------------------------------------------
create function public.goal_save(
  p_tenant_id uuid,
  p_goal_id uuid,
  p_expected_version integer,
  p_metric_key text,
  p_target numeric,
  p_period_start date,
  p_note text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  g public.goals;
  v_start date := coalesce(p_period_start, date_trunc('month', clock_timestamp() at time zone app.lc_tz(p_tenant_id))::date);
  v_unit text;
  v_body jsonb;
  v_code integer := 200;
begin
  perform app.ga_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'goal.save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_metric_key is null or p_metric_key not in ('occupancy', 'no_show', 'cancellation', 'waitlist_acceptance', 'quote_acceptance', 'received', 'expenses', 'charge_coverage', 'reminders') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'metric_key';
  end if;
  v_unit := case when p_metric_key in ('received', 'expenses') then 'cents' else 'ratio' end;
  if p_target is null or p_target < 0 or (v_unit = 'ratio' and p_target > 1) or (v_unit = 'cents' and (p_target <> trunc(p_target) or p_target > 9007199254740991)) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'target';
  end if;
  if v_start <> date_trunc('month', v_start)::date then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period_start';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'note';
  end if;
  if p_goal_id is null then
    if exists (select 1 from public.goals x where x.tenant_id = p_tenant_id and x.metric_key = p_metric_key and x.period_start = v_start and x.status = 'active') then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'goal';
    end if;
    begin
      insert into public.goals (tenant_id, metric_key, target, direction, period_start, note, created_by)
      values (p_tenant_id, p_metric_key, round(p_target, 4), app.ga_direction(p_metric_key), v_start, nullif(btrim(p_note), ''), v_uid) returning * into g;
    exception when unique_violation then
      -- Duas criações simultâneas da mesma meta: a segunda é recusada como regra, não como erro interno.
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'goal';
    end;
    v_code := 201;
  else
    select * into g from public.goals x where x.tenant_id = p_tenant_id and x.id = p_goal_id for update;
    if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
    if p_expected_version is null or g.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    if g.status <> 'active' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status'; end if;
    if g.metric_key <> p_metric_key then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'metric_key'; end if;
    update public.goals x set target = round(p_target, 4), note = nullif(btrim(p_note), ''), version = x.version + 1 where x.id = g.id returning * into g;
  end if;
  perform app.audit(p_tenant_id, 'goal.save', 'goal', g.id, p_request_id, null,
    jsonb_build_object('metric_key', g.metric_key, 'target', g.target, 'period_start', g.period_start, 'version', g.version));
  v_body := jsonb_build_object('goal', app.ga_goal_json(g));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'goal.save', p_idem_key, v_code, v_body);
  return jsonb_build_object('status_code', v_code, 'body', v_body);
end $$;

create function public.goal_archive(
  p_tenant_id uuid,
  p_goal_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  g public.goals;
  v_body jsonb;
begin
  perform app.ga_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'goal.archive', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into g from public.goals x where x.tenant_id = p_tenant_id and x.id = p_goal_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if g.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  if g.status <> 'active' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status'; end if;
  update public.goals x set status = 'archived', version = x.version + 1 where x.id = g.id returning * into g;
  perform app.audit(p_tenant_id, 'goal.archive', 'goal', g.id, p_request_id, null, jsonb_build_object('metric_key', g.metric_key));
  v_body := jsonb_build_object('goal', app.ga_goal_json(g));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'goal.archive', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.goal_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r tstzrange := app.ga_month(p_tenant_id);
begin
  perform app.ga_owner(p_tenant_id);
  return jsonb_build_object(
    'month_start', app.fin_ts(lower(r)), 'month_end', app.fin_ts(upper(r)),
    'goals', coalesce((select jsonb_agg(app.ga_goal_json(g) order by g.status, g.period_start desc, g.metric_key)
      from (select * from public.goals g where g.tenant_id = p_tenant_id order by g.created_at desc limit 50) g), '[]'::jsonb),
    'metrics', app.an_metrics(p_tenant_id, lower(r), upper(r))->'metrics');
end $$;

create function public.advice_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.ga_owner(p_tenant_id);
  return jsonb_build_object(
    'suggestions', app.ga_rules(p_tenant_id),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'rule_code', d.rule_code, 'metric_key', d.metric_key, 'decision', d.decision,
        'evidence', d.evidence, 'metric_before', d.metric_before, 'metric_after', d.metric_after, 'outcome', d.outcome,
        'decided_at', app.fin_ts(d.decided_at), 'follow_up_at', app.fin_ts(d.follow_up_at)) order by d.decided_at desc)
      from (select * from public.advice_decisions d where d.tenant_id = p_tenant_id order by d.decided_at desc limit 50) d), '[]'::jsonb));
end $$;

/** Registra a decisão do dono sobre uma sugestão em vigor; congela o indicador de agora para o acompanhamento. */
create function public.advice_decide(
  p_tenant_id uuid,
  p_rule_code text,
  p_decision text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  s jsonb;
  d public.advice_decisions;
  m jsonb;
  v_body jsonb;
begin
  perform app.ga_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'advice.decide', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_decision not in ('accepted', 'dismissed') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'decision';
  end if;
  s := (select x from jsonb_array_elements(app.ga_rules(p_tenant_id)) x where x->>'rule_code' = p_rule_code);
  if s is null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'rule_code';
  end if;
  if exists (select 1 from public.advice_decisions x where x.tenant_id = p_tenant_id and x.rule_code = p_rule_code
      and date_trunc('month', x.decided_at at time zone 'UTC') = date_trunc('month', clock_timestamp() at time zone 'UTC')) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'decided';
  end if;
  m := case when s->>'metric_key' is null then null else app.ga_metric(p_tenant_id, s->>'metric_key', app.ga_month(p_tenant_id)) end;
  insert into public.advice_decisions (tenant_id, rule_code, metric_key, decision, evidence, metric_before, follow_up_at, decided_by)
  values (p_tenant_id, p_rule_code, s->>'metric_key', p_decision, coalesce(s->'evidence', '{}'::jsonb),
    case when m is null then null else jsonb_build_object('value', m->'value', 'numerator', m->'numerator', 'denominator', m->'denominator', 'status', m->'status') end,
    clock_timestamp() + interval '30 days', v_uid) returning * into d;
  perform app.audit(p_tenant_id, 'advice.decide', 'advice_decision', d.id, p_request_id, null, jsonb_build_object('rule_code', p_rule_code, 'decision', p_decision));
  v_body := jsonb_build_object('decision', jsonb_build_object('id', d.id, 'rule_code', d.rule_code, 'metric_key', d.metric_key, 'decision', d.decision,
    'evidence', d.evidence, 'metric_before', d.metric_before, 'metric_after', d.metric_after, 'outcome', d.outcome,
    'decided_at', app.fin_ts(d.decided_at), 'follow_up_at', app.fin_ts(d.follow_up_at)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'advice.decide', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.content_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_prof text;
  v_profile public.public_profiles;
begin
  perform app.ga_owner(p_tenant_id);
  select t.profession into v_prof from public.tenants t where t.id = p_tenant_id;
  select * into v_profile from public.public_profiles p where p.tenant_id = p_tenant_id;
  return jsonb_build_object(
    'profession', v_prof,
    'scope', jsonb_build_object('profile_published', v_profile.published_at is not null, 'bio_field', coalesce('bio' = any (v_profile.public_fields), false)),
    'published', (select jsonb_build_object('template_code', c.template_code, 'body', c.body, 'published_at', app.fin_ts(c.published_at), 'version', c.version)
      from public.profile_contents c where c.tenant_id = p_tenant_id),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'profession', t.profession, 'kind', t.kind, 'title', t.title,
        'body', t.body, 'preview', app.ga_render(p_tenant_id, t.body), 'approved_by', t.approved_by) order by t.kind, t.profession desc, t.code)
      from public.content_templates t where t.profession in (v_prof, 'all')), '[]'::jsonb));
end $$;

/** Publica um conteúdo aprovado como `bio` do perfil público. Só com perfil publicado e o campo `bio` escolhido (P09). */
create function public.content_publish(
  p_tenant_id uuid,
  p_template_code text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  t public.content_templates;
  v_profile public.public_profiles;
  v_prof text;
  c public.profile_contents;
  v_body jsonb;
begin
  perform app.ga_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'content.publish', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into t from public.content_templates x where x.code = p_template_code;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'template_code'; end if;
  select x.profession into v_prof from public.tenants x where x.id = p_tenant_id;
  if t.profession not in (v_prof, 'all') then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'profession'; end if;
  if t.kind <> 'bio' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'kind'; end if;
  select * into v_profile from public.public_profiles p where p.tenant_id = p_tenant_id;
  if not found or v_profile.published_at is null or not ('bio' = any (v_profile.public_fields)) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'scope';
  end if;
  insert into public.profile_contents as pc (tenant_id, template_code, body, published_by)
  values (p_tenant_id, t.code, app.ga_render(p_tenant_id, t.body), v_uid)
  on conflict (tenant_id) do update set template_code = excluded.template_code, body = excluded.body, published_by = excluded.published_by,
    published_at = clock_timestamp(), version = pc.version + 1
  returning * into c;
  perform app.audit(p_tenant_id, 'content.publish', 'profile_content', p_tenant_id, p_request_id, null, jsonb_build_object('template_code', t.code, 'version', c.version));
  perform app.emit_event(p_tenant_id, 'content.published.v1', p_tenant_id, c.version, coalesce(p_request_id, gen_random_uuid()), jsonb_build_object('template_code', t.code));
  v_body := jsonb_build_object('published', jsonb_build_object('template_code', c.template_code, 'body', c.body, 'published_at', app.fin_ts(c.published_at), 'version', c.version));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'content.publish', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.content_unpublish(
  p_tenant_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  c public.profile_contents;
  v_body jsonb;
begin
  perform app.ga_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'content.unpublish', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into c from public.profile_contents x where x.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if c.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  delete from public.profile_contents x where x.tenant_id = p_tenant_id;
  perform app.audit(p_tenant_id, 'content.unpublish', 'profile_content', p_tenant_id, p_request_id, jsonb_build_object('template_code', c.template_code), null);
  v_body := jsonb_build_object('published', null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'content.unpublish', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Worker: acompanhamento das sugestões a cada rodada
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
  return jsonb_build_object('done', v_done, 'retried', v_failed, 'dead', v_dead, 'expired_holds', v_expired_holds, 'expired_offers', v_expired_offers,
    'lifecycle', v_lifecycle, 'recurrence', v_recurrence, 'referrals', v_referrals, 'campaigns', v_campaigns, 'advice', v_advice);
end $$;

-- ---------------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------------
revoke all on function app.ga_owner(uuid), app.ga_direction(text), app.ga_month(uuid, date), app.ga_metric(uuid, text, tstzrange), app.ga_goal_json(public.goals),
  app.ga_rules(uuid), app.ga_tick(integer), app.ga_render(uuid, text) from public, anon, authenticated;
revoke all on function public.goal_save(uuid, uuid, integer, text, numeric, date, text, text, text, uuid) from public, anon;
revoke all on function public.goal_archive(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.goal_list(uuid) from public, anon;
revoke all on function public.advice_list(uuid) from public, anon;
revoke all on function public.advice_decide(uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.content_list(uuid) from public, anon;
revoke all on function public.content_publish(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.content_unpublish(uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.goal_save(uuid, uuid, integer, text, numeric, date, text, text, text, uuid) to authenticated;
grant execute on function public.goal_archive(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.goal_list(uuid) to authenticated;
grant execute on function public.advice_list(uuid) to authenticated;
grant execute on function public.advice_decide(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.content_list(uuid) to authenticated;
grant execute on function public.content_publish(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.content_unpublish(uuid, integer, text, text, uuid) to authenticated;

alter table public.goals enable row level security;
alter table public.advice_decisions enable row level security;
alter table public.content_templates enable row level security;
alter table public.profile_contents enable row level security;
grant select on public.goals, public.advice_decisions, public.content_templates, public.profile_contents to authenticated;
create policy goals_owner_select on public.goals for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy advice_decisions_owner_select on public.advice_decisions for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy content_templates_read on public.content_templates for select to authenticated using (true);
create policy profile_contents_owner_select on public.profile_contents for select to authenticated using (app.is_member(tenant_id, array['owner']));
