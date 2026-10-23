-- P19 · Campanhas e experimentos (ADR-0022). Append-only sobre P13 (réguas), P12 (canal), P07 (pacotes), P05 (regras de
-- preço) e P18 (indicadores). Segmentos só por dados existentes; público só com consentimento de marketing (P13);
-- limite de envios e de gasto aplicados no servidor; oferta vinculada (desconto ou regra de preço do P05); grupo de
-- controle sorteado no servidor; resultado por braço com intervalo; sem causalidade afirmada fora do desenho.
-- Alteração aditiva documentada: `lifecycle_steps.rule` ganha o valor 'campaign' (check recriado); `app.lc_dispatch`
-- e `public.jobs_run` substituídos por `create or replace`. O vínculo passo ↔ campanha fica em `campaign_members.step_id`
-- (a coluna `lifecycle_steps.campaign_id` continua exclusiva das campanhas de reativação do P13).

-- ---------------------------------------------------------------------------
-- Modelo de mensagem (aprovado só no simulado; o real exige aprovação da Meta por migration)
-- ---------------------------------------------------------------------------
insert into public.channel_templates (code, category, body, params) values
  ('oferta_campanha', 'marketing', 'Olá, {{1}}! {{2}} tem uma oferta para você: {{3}}. Vale até {{4}}. Responda SAIR para não receber mais convites.', 4);

-- ---------------------------------------------------------------------------
-- P13 (aditivo): passos de campanha são uma régua própria, com finalidade de marketing.
-- ---------------------------------------------------------------------------
alter table public.lifecycle_steps drop constraint lifecycle_steps_rule_check;
alter table public.lifecycle_steps add constraint lifecycle_steps_rule_check
  check (rule in ('confirmation', 'reminder', 'quote_followup', 'receivable_reminder', 'reactivation', 'campaign'));

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  -- {"kind":"inactive_days","days":N} | {"kind":"credit_remaining"} | {"kind":"marketing_all"}
  segment jsonb not null check (segment->>'kind' in ('inactive_days', 'credit_remaining', 'marketing_all')),
  -- Hash do público visto pelo dono na hora de aprovar: aprovar outro público é outra campanha.
  audience_hash text not null check (audience_hash ~ '^[0-9a-f]{64}$'),
  audience_count integer not null check (audience_count >= 0),
  -- Desenho: percentual sorteado para o grupo de controle (0 = observação, sem efeito afirmável).
  control_pct integer not null check (control_pct between 0 and 50),
  control_count integer not null check (control_count >= 0),
  treatment_count integer not null check (treatment_count >= 0),
  -- Limites aplicados no servidor: envios e gasto estimado com a oferta.
  max_sends integer not null check (max_sends between 1 and 500),
  spend_cap_cents bigint check (spend_cap_cents is null or spend_cap_cents between 0 and 9007199254740991),
  estimated_cost_cents bigint not null default 0 check (estimated_cost_cents >= 0),
  -- {"kind":"none"} | {"kind":"discount_pct","pct":N,"service_id":uuid|null} | {"kind":"pricing_rule","pricing_rule_id":uuid}
  offer jsonb not null default '{"kind":"none"}' check (offer->>'kind' in ('none', 'discount_pct', 'pricing_rule')),
  offer_text text not null check (char_length(offer_text) between 1 and 160),
  window_days integer not null check (window_days between 7 and 60),
  status text not null default 'running' check (status in ('running', 'closed', 'cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  closed_at timestamptz,
  -- Resultado congelado ao fechar (por braço, com intervalo). Enquanto roda, é calculado na leitura.
  result jsonb,
  approved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id)
);
comment on table public.campaigns is 'Campanha com público aprovado (hash), limites no servidor, controle sorteado e janela de medição.';
create index campaigns_tenant on public.campaigns (tenant_id, status, created_at desc);
create index campaigns_running on public.campaigns (ends_at) where status = 'running';
create trigger campaigns_touch before update on public.campaigns for each row execute function app.touch_row();

create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  campaign_id uuid not null,
  customer_id uuid not null,
  arm text not null check (arm in ('treatment', 'control')),
  step_id uuid,
  assigned_at timestamptz not null default now(),
  constraint campaign_members_campaign foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id) on delete restrict,
  constraint campaign_members_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint campaign_members_step foreign key (tenant_id, step_id) references public.lifecycle_steps (tenant_id, id) on delete restrict,
  unique (campaign_id, customer_id),
  unique (tenant_id, id)
);
comment on table public.campaign_members is 'Quem entrou na campanha e em que braço (sorteio no servidor). Conversão é medida nos agendamentos, não declarada.';
create index campaign_members_campaign on public.campaign_members (campaign_id, arm);
create index campaign_members_customer on public.campaign_members (tenant_id, customer_id);
create trigger campaign_members_append_only before update or delete on public.campaign_members for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------
create function app.cp_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/** Valida o segmento e devolve a forma canônica. */
create function app.cp_segment_norm(p_segment jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_kind text := p_segment->>'kind';
  v_days integer;
begin
  if v_kind = 'inactive_days' then
    v_days := (p_segment->>'days')::integer;
    if v_days is null or v_days not between 14 and 365 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'segment.days';
    end if;
    return jsonb_build_object('kind', 'inactive_days', 'days', v_days);
  elsif v_kind in ('credit_remaining', 'marketing_all') then
    return jsonb_build_object('kind', v_kind);
  end if;
  raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'segment.kind';
exception when invalid_text_representation then
  raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'segment.days';
end $$;

/**
 * Público autorizado de um segmento: clientes ativas com consentimento de marketing (P13) e sem oposição, sem
 * atendimento futuro e fora de outra campanha em curso. Só dados existentes; hash do conjunto para a aprovação.
 */
create function app.cp_segment(p_tenant_id uuid, p_segment jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s jsonb := app.cp_segment_norm(p_segment);
  v_items jsonb;
  v_hash text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', x.id, 'name', x.name, 'last_visit_at', app.fin_ts(x.last_visit),
      'has_channel', x.has_channel, 'credits_remaining', x.credits) order by x.last_visit nulls first, x.name), '[]'::jsonb)
  into v_items
  from (
    select cu.id, cu.name,
      (select max(b.starts_at) from public.bookings b where b.tenant_id = p_tenant_id and b.customer_id = cu.id and b.status in ('completed', 'confirmed', 'no_show')) as last_visit,
      (app.lc_contact(p_tenant_id, cu.id)).id is not null as has_channel,
      coalesce((select sum((app.fin_package_balance(p_tenant_id, p.id)->>'remaining_credits')::integer) from public.session_packages p
        where p.tenant_id = p_tenant_id and p.customer_id = cu.id and (p.expires_at is null or p.expires_at > clock_timestamp())), 0)::integer as credits
    from public.customers cu
    where cu.tenant_id = p_tenant_id and cu.archived_at is null
      and app.lc_denied(p_tenant_id, cu.id, 'marketing') is null
      and not exists (select 1 from public.bookings b where b.tenant_id = p_tenant_id and b.customer_id = cu.id and b.status in ('confirmed', 'held') and b.starts_at > clock_timestamp())
      and not exists (select 1 from public.campaign_members m join public.campaigns c on c.id = m.campaign_id
        where m.tenant_id = p_tenant_id and m.customer_id = cu.id and c.status = 'running')
  ) x
  where case s->>'kind'
    when 'inactive_days' then x.last_visit is null or x.last_visit < clock_timestamp() - make_interval(days => (s->>'days')::integer)
    when 'credit_remaining' then x.credits > 0
    else true end;
  select encode(sha256(convert_to(coalesce(string_agg(i->>'customer_id', ',' order by i->>'customer_id'), ''), 'UTF8')), 'hex') into v_hash
  from jsonb_array_elements(v_items) i;
  return jsonb_build_object('segment', s, 'customers', v_items, 'audience_hash', v_hash, 'audience_count', jsonb_array_length(v_items));
end $$;

/** Valida a oferta (vinculada a serviço/regra do negócio) e devolve {offer, text, unit_cost_cents}. */
create function app.cp_offer(p_tenant_id uuid, p_offer jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := coalesce(p_offer->>'kind', 'none');
  v_pct integer;
  v_svc public.provider_services;
  v_rule public.pricing_rules;
  v_price bigint;
begin
  if v_kind = 'none' then
    return jsonb_build_object('offer', '{"kind":"none"}'::jsonb, 'text', 'um horário reservado para você', 'unit_cost_cents', 0);
  elsif v_kind = 'discount_pct' then
    v_pct := (p_offer->>'pct')::integer;
    if v_pct is null or v_pct not between 5 and 50 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'offer.pct';
    end if;
    if nullif(p_offer->>'service_id', '') is not null then
      select * into v_svc from public.provider_services p where p.tenant_id = p_tenant_id and p.id = (p_offer->>'service_id')::uuid;
      if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'offer.service_id'; end if;
      v_price := v_svc.base_price_cents;
    else
      select max(p.base_price_cents) into v_price from public.provider_services p where p.tenant_id = p_tenant_id and p.active;
    end if;
    return jsonb_build_object('offer', jsonb_build_object('kind', 'discount_pct', 'pct', v_pct, 'service_id', v_svc.id),
      'text', v_pct || '% de desconto' || coalesce(' em ' || v_svc.name, ''),
      'unit_cost_cents', (coalesce(v_price, 0) * v_pct / 100)::bigint);
  elsif v_kind = 'pricing_rule' then
    select * into v_rule from public.pricing_rules r where r.tenant_id = p_tenant_id and r.id = (p_offer->>'pricing_rule_id')::uuid and r.active;
    if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'offer.pricing_rule_id'; end if;
    select * into v_svc from public.provider_services p where p.id = v_rule.service_id;
    return jsonb_build_object('offer', jsonb_build_object('kind', 'pricing_rule', 'pricing_rule_id', v_rule.id, 'service_id', v_svc.id),
      'text', (v_rule.discount_bps / 100) || '% de desconto em ' || v_svc.name || ' (regra de preço vigente)',
      'unit_cost_cents', (v_svc.base_price_cents * v_rule.discount_bps / 10000)::bigint);
  end if;
  raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'offer.kind';
exception when invalid_text_representation then
  raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'offer';
end $$;

/** Intervalo de Wilson (95%) para uma proporção. */
create function app.cp_wilson(p_k integer, p_n integer) returns numeric[]
language sql immutable set search_path = '' as $$
  select case when p_n = 0 then array[0, 0]::numeric[] else array[
    round(greatest(0, ((p_k + 1.92) / (p_n + 3.8416)) - (1.96 / (p_n + 3.8416)) * sqrt((p_k::numeric * (p_n - p_k)) / p_n + 0.9604))::numeric, 4),
    round(least(1, ((p_k + 1.92) / (p_n + 3.8416)) + (1.96 / (p_n + 3.8416)) * sqrt((p_k::numeric * (p_n - p_k)) / p_n + 0.9604))::numeric, 4)] end
$$;

/** Um braço: n, convertidos (agendamento criado na janela), taxa com intervalo, receita de atendimentos concluídos. */
create function app.cp_arm(p_c public.campaigns, p_arm text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (
    select mm.customer_id, mm.assigned_at,
      exists (select 1 from public.bookings b where b.tenant_id = p_c.tenant_id and b.customer_id = mm.customer_id
        and b.status in ('confirmed', 'completed', 'no_show') and b.created_at >= mm.assigned_at and b.created_at <= p_c.ends_at) as converted,
      coalesce((select sum(b.agreed_price_cents) from public.bookings b where b.tenant_id = p_c.tenant_id and b.customer_id = mm.customer_id
        and b.status = 'completed' and b.created_at >= mm.assigned_at and b.created_at <= p_c.ends_at), 0) as revenue
    from public.campaign_members mm where mm.campaign_id = p_c.id and mm.arm = p_arm
  ), agg as (select count(*)::integer as n, count(*) filter (where converted)::integer as k, coalesce(sum(revenue), 0)::bigint as revenue from m)
  select jsonb_build_object('n', agg.n, 'converted', agg.k, 'rate', case when agg.n = 0 then null else round(agg.k::numeric / agg.n, 4) end,
    'ci', to_jsonb(app.cp_wilson(agg.k, agg.n)), 'revenue_cents', agg.revenue,
    'sent', (select count(*) from public.campaign_members x join public.lifecycle_steps s on s.id = x.step_id where x.campaign_id = p_c.id and x.arm = p_arm and s.status in ('sent', 'shared')),
    'manual', (select count(*) from public.campaign_members x join public.lifecycle_steps s on s.id = x.step_id where x.campaign_id = p_c.id and x.arm = p_arm and s.status = 'manual'),
    'skipped', (select count(*) from public.campaign_members x join public.lifecycle_steps s on s.id = x.step_id where x.campaign_id = p_c.id and x.arm = p_arm and s.status in ('skipped', 'cancelled')),
    'pending', (select count(*) from public.campaign_members x join public.lifecycle_steps s on s.id = x.step_id where x.campaign_id = p_c.id and x.arm = p_arm and s.status in ('scheduled', 'deferred')))
  from agg
$$;

/**
 * Resultado da campanha. Com controle sorteado: diferença entre braços com intervalo (Newcombe); veredito só pelo
 * intervalo. Sem controle: observação, nunca efeito. Nunca afirma causa fora do desenho.
 */
create function app.cp_result(p_c public.campaigns) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t jsonb := app.cp_arm(p_c, 'treatment');
  c jsonb := app.cp_arm(p_c, 'control');
  v_design text := case when p_c.control_pct > 0 then 'randomized_control' else 'observational' end;
  v_diff jsonb := null;
  v_verdict text;
  p1 numeric; p2 numeric; l1 numeric; u1 numeric; l2 numeric; u2 numeric; d numeric; lo numeric; hi numeric;
begin
  if v_design = 'observational' then
    v_verdict := 'observation_only';
  elsif (t->>'n')::integer < 5 or (c->>'n')::integer < 5 then
    v_verdict := 'inconclusive';
  else
    p1 := (t->>'rate')::numeric; p2 := (c->>'rate')::numeric;
    l1 := (t->'ci'->>0)::numeric; u1 := (t->'ci'->>1)::numeric; l2 := (c->'ci'->>0)::numeric; u2 := (c->'ci'->>1)::numeric;
    d := p1 - p2;
    lo := round(d - sqrt(power(p1 - l1, 2) + power(u2 - p2, 2)), 4);
    hi := round(d + sqrt(power(u1 - p1, 2) + power(p2 - l2, 2)), 4);
    v_diff := jsonb_build_object('value', round(d, 4), 'ci', jsonb_build_array(lo, hi));
    v_verdict := case when lo > 0 or hi < 0 then 'difference_detected' else 'no_difference_detected' end;
  end if;
  return jsonb_build_object('design', v_design, 'final', p_c.status <> 'running',
    'window', jsonb_build_object('starts_at', app.fin_ts(p_c.starts_at), 'ends_at', app.fin_ts(p_c.ends_at)),
    'arms', jsonb_build_object('treatment', t, 'control', c), 'difference', v_diff, 'verdict', v_verdict);
end $$;

create function app.cp_json(p_c public.campaigns) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_c.id, 'name', p_c.name, 'segment', p_c.segment, 'audience_count', p_c.audience_count,
    'control_pct', p_c.control_pct, 'control_count', p_c.control_count, 'treatment_count', p_c.treatment_count,
    'max_sends', p_c.max_sends, 'spend_cap_cents', p_c.spend_cap_cents, 'estimated_cost_cents', p_c.estimated_cost_cents,
    'offer', p_c.offer, 'offer_text', p_c.offer_text, 'window_days', p_c.window_days, 'status', p_c.status,
    'starts_at', app.fin_ts(p_c.starts_at), 'ends_at', app.fin_ts(p_c.ends_at), 'closed_at', app.fin_ts(p_c.closed_at),
    'result', coalesce(p_c.result, app.cp_result(p_c)), 'created_at', app.fin_ts(p_c.created_at), 'version', p_c.version)
$$;

/** Fecha campanhas cuja janela terminou: congela o resultado e emite evento. Idempotente (lock por linha). */
create function app.cp_tick(p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.campaigns;
  v_closed integer := 0;
begin
  for c in
    select * from public.campaigns x where x.status = 'running' and x.ends_at <= clock_timestamp()
    order by x.ends_at limit p_batch for update skip locked
  loop
    c.status := 'closed';
    update public.campaigns x set status = 'closed', closed_at = clock_timestamp(), result = app.cp_result(c), version = x.version + 1 where x.id = c.id;
    perform app.emit_event(c.tenant_id, 'campaign.closed.v1', c.id, c.version + 1, gen_random_uuid(), jsonb_build_object('name', c.name));
    v_closed := v_closed + 1;
  end loop;
  return jsonb_build_object('closed', v_closed);
end $$;

-- ---------------------------------------------------------------------------
-- P13 (aditivo): o despacho trata 'campaign' como marketing (consentimento obrigatório) e para campanhas encerradas.
-- ---------------------------------------------------------------------------
create or replace function app.lc_dispatch(p_step public.lifecycle_steps) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.lifecycle_settings := app.lc_settings(p_step.tenant_id);
  v_denied text;
  k public.channel_contacts;
  c public.channel_connections;
  v_m public.channel_messages;
  v_purpose text := case when p_step.rule in ('reactivation', 'campaign') then 'marketing' else 'transactional' end;
begin
  -- Agregado ainda vale? (defesa extra: a parada por evento é o caminho normal)
  if p_step.aggregate_type = 'booking' and not exists (select 1 from public.bookings b where b.id = p_step.aggregate_id and b.status = 'confirmed') then
    update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'booking_not_confirmed', resolved_at = clock_timestamp() where x.id = p_step.id;
    return 'cancelled';
  end if;
  if p_step.aggregate_type = 'quote' and not exists (select 1 from public.sales_quotes q where q.id = p_step.aggregate_id and q.status = 'sent') then
    update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'quote_decided', resolved_at = clock_timestamp() where x.id = p_step.id;
    return 'cancelled';
  end if;
  if p_step.aggregate_type = 'receivable' and not exists (select 1 from public.receivables r where r.id = p_step.aggregate_id and r.status in ('open', 'partially_paid')) then
    update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'receivable_closed', resolved_at = clock_timestamp() where x.id = p_step.id;
    return 'cancelled';
  end if;
  if p_step.rule = 'campaign' and not exists (select 1 from public.campaign_members m join public.campaigns cp on cp.id = m.campaign_id
      where m.step_id = p_step.id and cp.status = 'running') then
    update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'campaign_not_running', resolved_at = clock_timestamp() where x.id = p_step.id;
    return 'cancelled';
  end if;
  v_denied := app.lc_denied(p_step.tenant_id, p_step.customer_id, v_purpose);
  if v_denied is not null then
    update public.lifecycle_steps x set status = 'skipped', skip_reason = v_denied, resolved_at = clock_timestamp() where x.id = p_step.id;
    return 'skipped';
  end if;
  k := app.lc_contact(p_step.tenant_id, p_step.customer_id);
  if k.id is null then
    update public.lifecycle_steps x set status = 'manual', resolved_at = clock_timestamp() where x.id = p_step.id;
    return 'manual';
  end if;
  if app.lc_sent_today(p_step.tenant_id) >= s.daily_budget then
    update public.lifecycle_steps x set status = 'deferred', due_at = app.lc_tomorrow_9(p_step.tenant_id), skip_reason = 'daily_budget' where x.id = p_step.id;
    return 'deferred';
  end if;
  select * into c from public.channel_connections cc where cc.tenant_id = p_step.tenant_id and cc.status = 'active';
  if not exists (select 1 from public.channel_templates t where t.code = p_step.template_code and c.provider = any (t.approved_providers)) then
    update public.lifecycle_steps x set status = 'manual', skip_reason = 'template_not_approved', resolved_at = clock_timestamp() where x.id = p_step.id;
    return 'manual';
  end if;
  insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, template_code, template_params, status, created_by)
  values (p_step.tenant_id, k.id, 'outbound', 'template', p_step.body, p_step.template_code, p_step.params, 'queued', null)
  returning * into v_m;
  update public.channel_contacts x set last_message_at = v_m.created_at where x.id = k.id;
  update public.lifecycle_steps x set status = 'sent', channel_message_id = v_m.id, resolved_at = clock_timestamp(), skip_reason = null where x.id = p_step.id;
  perform app.audit(p_step.tenant_id, 'lifecycle.sent', 'lifecycle_step', p_step.id, null, null,
    jsonb_build_object('rule', p_step.rule, 'template_code', p_step.template_code, 'message_id', v_m.id));
  return 'sent';
end $$;

-- ---------------------------------------------------------------------------
-- RPCs do dono
-- ---------------------------------------------------------------------------
create function public.campaign_preview(p_tenant_id uuid, p_segment jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.cp_owner(p_tenant_id);
  return app.cp_segment(p_tenant_id, p_segment);
end $$;

/**
 * Aprova a campanha citando o público visto (hash). O servidor sorteia o controle, aplica o teto de envios e o
 * teto de gasto (reduzindo o braço tratado), cria os passos (P13) e abre a janela de medição.
 */
create function public.campaign_approve(
  p_tenant_id uuid,
  p_name text,
  p_segment jsonb,
  p_audience_hash text,
  p_control_pct integer,
  p_max_sends integer,
  p_spend_cap_cents bigint,
  p_window_days integer,
  p_offer jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_aud jsonb;
  v_off jsonb;
  v_c public.campaigns;
  v_name text;
  v_n integer;
  v_control integer;
  v_treat integer;
  v_unit bigint;
  i record;
  v_pos integer := 0;
  v_step uuid;
  v_body jsonb;
begin
  perform app.cp_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'campaign.approve', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'name';
  end if;
  if p_control_pct is null or p_control_pct not between 0 and 50 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'control_pct';
  end if;
  if p_max_sends is null or p_max_sends not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'max_sends';
  end if;
  if p_window_days is null or p_window_days not between 7 and 60 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window_days';
  end if;
  if p_spend_cap_cents is not null and p_spend_cap_cents < 0 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'spend_cap_cents';
  end if;
  v_off := app.cp_offer(p_tenant_id, coalesce(p_offer, '{"kind":"none"}'::jsonb));
  -- Uma aprovação por vez por negócio: a segunda recalcula o público já sem quem a primeira incluiu.
  perform pg_advisory_xact_lock(hashtext('campaign:' || p_tenant_id::text));
  v_aud := app.cp_segment(p_tenant_id, p_segment);
  if v_aud->>'audience_hash' <> p_audience_hash then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION', hint = 'audience_hash';
  end if;
  v_n := (v_aud->>'audience_count')::integer;
  if v_n = 0 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'audience';
  end if;
  -- Sorteio: controle = os primeiros ceil(n × pct) numa ordem aleatória estável por campanha; tratado = o resto,
  -- limitado pelo teto de envios e pelo teto de gasto estimado (custo unitário da oferta × tratados).
  v_control := ceil(v_n * p_control_pct / 100.0)::integer;
  if p_control_pct > 0 and v_n >= 2 and v_control = 0 then v_control := 1; end if;
  v_treat := least(v_n - v_control, p_max_sends);
  v_unit := (v_off->>'unit_cost_cents')::bigint;
  if p_spend_cap_cents is not null and v_unit > 0 then
    v_treat := least(v_treat, (p_spend_cap_cents / v_unit)::integer);
  end if;
  if v_treat < 1 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'spend_cap';
  end if;
  select t.name into v_name from public.tenants t where t.id = p_tenant_id;
  insert into public.campaigns (tenant_id, name, segment, audience_hash, audience_count, control_pct, control_count, treatment_count, max_sends, spend_cap_cents,
    estimated_cost_cents, offer, offer_text, window_days, ends_at, approved_by)
  values (p_tenant_id, btrim(p_name), v_aud->'segment', p_audience_hash, v_n, p_control_pct, v_control, v_treat, p_max_sends, p_spend_cap_cents,
    v_unit * v_treat, v_off->'offer', v_off->>'text', p_window_days, clock_timestamp() + make_interval(days => p_window_days), v_uid)
  returning * into v_c;
  for i in
    select (x->>'customer_id')::uuid as customer_id, x->>'name' as name
    from jsonb_array_elements(v_aud->'customers') x
    order by md5(v_c.id::text || (x->>'customer_id'))
  loop
    v_pos := v_pos + 1;
    if v_pos <= v_control then
      insert into public.campaign_members (tenant_id, campaign_id, customer_id, arm) values (p_tenant_id, v_c.id, i.customer_id, 'control');
    elsif v_pos <= v_control + v_treat then
      v_step := app.lc_schedule(p_tenant_id, 'campaign', 'customer', i.customer_id, i.customer_id, 'c' || left(v_c.id::text, 8), clock_timestamp(), 'oferta_campanha',
        jsonb_build_array(i.name, v_name, v_c.offer_text, to_char(v_c.ends_at at time zone app.lc_tz(p_tenant_id), 'DD/MM')), null, null);
      insert into public.campaign_members (tenant_id, campaign_id, customer_id, arm, step_id) values (p_tenant_id, v_c.id, i.customer_id, 'treatment', v_step);
    end if;
  end loop;
  perform app.audit(p_tenant_id, 'campaign.approve', 'campaign', v_c.id, p_request_id, null,
    jsonb_build_object('audience_count', v_n, 'control_count', v_control, 'treatment_count', v_treat, 'max_sends', p_max_sends,
      'spend_cap_cents', p_spend_cap_cents, 'estimated_cost_cents', v_c.estimated_cost_cents, 'offer_kind', v_c.offer->>'kind', 'window_days', p_window_days));
  perform app.emit_event(p_tenant_id, 'campaign.approved.v1', v_c.id, 1, coalesce(p_request_id, gen_random_uuid()),
    jsonb_build_object('treatment_count', v_treat, 'control_count', v_control));
  v_body := jsonb_build_object('campaign', app.cp_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'campaign.approve', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.campaign_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.cp_owner(p_tenant_id);
  return jsonb_build_object('campaigns', coalesce((select jsonb_agg(app.cp_json(c) order by c.created_at desc)
    from (select * from public.campaigns c where c.tenant_id = p_tenant_id order by c.created_at desc limit 50) c), '[]'::jsonb));
end $$;

create function public.campaign_get(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.campaigns;
begin
  perform app.cp_owner(p_tenant_id);
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  return jsonb_build_object('campaign', app.cp_json(c),
    'members', coalesce((select jsonb_agg(jsonb_build_object('customer_id', m.customer_id, 'customer_name', cu.name, 'arm', m.arm,
        'step_status', (select s.status from public.lifecycle_steps s where s.id = m.step_id),
        'converted', exists (select 1 from public.bookings b where b.tenant_id = p_tenant_id and b.customer_id = m.customer_id
          and b.status in ('confirmed', 'completed', 'no_show') and b.created_at >= m.assigned_at and b.created_at <= c.ends_at)) order by m.arm, cu.name)
      from (select * from public.campaign_members m where m.campaign_id = c.id order by m.assigned_at limit 500) m
      join public.customers cu on cu.id = m.customer_id), '[]'::jsonb));
end $$;

/** Cancela uma campanha em curso: passos pendentes param; o que já saiu não muda; o resultado congela como observação parcial. */
create function public.campaign_cancel(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  c public.campaigns;
  n integer;
  v_body jsonb;
begin
  perform app.cp_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'campaign.cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if c.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  if c.status <> 'running' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status'; end if;
  update public.lifecycle_steps s set status = 'cancelled', skip_reason = 'campaign_cancelled', resolved_at = clock_timestamp()
  where s.tenant_id = p_tenant_id and s.status in ('scheduled', 'deferred', 'manual')
    and s.id in (select m.step_id from public.campaign_members m where m.campaign_id = c.id and m.step_id is not null);
  get diagnostics n = row_count;
  c.status := 'cancelled';
  c.ends_at := clock_timestamp();
  update public.campaigns x set status = 'cancelled', ends_at = clock_timestamp(), closed_at = clock_timestamp(), result = app.cp_result(c), version = x.version + 1
  where x.id = c.id returning * into c;
  perform app.audit(p_tenant_id, 'campaign.cancel', 'campaign', c.id, p_request_id, null, jsonb_build_object('steps_cancelled', n));
  v_body := jsonb_build_object('campaign', app.cp_json(c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'campaign.cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Worker: fecha campanhas vencidas a cada rodada
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
  e public.outbox_events;
begin
  v_expired_offers := app.wl_expire_offers();
  v_expired_holds := public.scheduling_expire_holds();
  v_recurrence := app.rc_tick(100);
  v_referrals := app.ref_tick(100);
  v_campaigns := app.cp_tick(100);
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
    'lifecycle', v_lifecycle, 'recurrence', v_recurrence, 'referrals', v_referrals, 'campaigns', v_campaigns);
end $$;

-- ---------------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------------
revoke all on function app.cp_owner(uuid), app.cp_segment_norm(jsonb), app.cp_segment(uuid, jsonb), app.cp_offer(uuid, jsonb), app.cp_wilson(integer, integer),
  app.cp_arm(public.campaigns, text), app.cp_result(public.campaigns), app.cp_json(public.campaigns), app.cp_tick(integer) from public, anon, authenticated;
revoke all on function public.campaign_preview(uuid, jsonb) from public, anon;
revoke all on function public.campaign_approve(uuid, text, jsonb, text, integer, integer, bigint, integer, jsonb, text, text, uuid) from public, anon;
revoke all on function public.campaign_list(uuid) from public, anon;
revoke all on function public.campaign_get(uuid, uuid) from public, anon;
revoke all on function public.campaign_cancel(uuid, uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.campaign_preview(uuid, jsonb) to authenticated;
grant execute on function public.campaign_approve(uuid, text, jsonb, text, integer, integer, bigint, integer, jsonb, text, text, uuid) to authenticated;
grant execute on function public.campaign_list(uuid) to authenticated;
grant execute on function public.campaign_get(uuid, uuid) to authenticated;
grant execute on function public.campaign_cancel(uuid, uuid, integer, text, text, uuid) to authenticated;

alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
grant select on public.campaigns, public.campaign_members to authenticated;
create policy campaigns_owner_select on public.campaigns for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy campaign_members_owner_select on public.campaign_members for select to authenticated using (app.is_member(tenant_id, array['owner']));
