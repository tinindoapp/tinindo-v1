-- P13 · Relacionamento: réguas determinísticas sobre o outbox (confirmação e lembretes do agendamento, follow-up de
-- orçamento sem decisão, lembrete de cobrança vencida) e reativação como CAMPANHA aprovada pelo dono, com público
-- visto e teto de envios. Cada passo é um registro: agendado, enviado ao canal, manual (o dono compartilha),
-- compartilhado, pulado (com motivo), cancelado ou adiado (orçamento diário). Nada é enviado duas vezes.
-- Invariantes (docs/02, docs/05, docs/15, tasks/P13):
-- * A régua PARA por evento: aceite/recusa do orçamento, cancelamento/conclusão/remarcação do atendimento,
--   pagamento do recebível, oposição da cliente (SAIR no canal ou consentimento revogado).
-- * Consentimento por finalidade: transacional (confirmação, lembrete, follow-up, cobrança) vale com opt-in no
--   canal (P12) ou registro do dono; marketing (reativação) só com consentimento registrado E campanha aprovada.
-- * Dedupe: um passo por (régua, agregado, chave); evento do outbox processado uma vez; a mesma remarcação cancela
--   os passos antigos antes de criar os novos.
-- * Teto diário de envios por negócio: além dele, o passo é ADIADO para o dia seguinte, nunca descartado em silêncio.
-- * Sem canal conectado, o passo vira "manual": texto pronto para o dono compartilhar (como as ofertas do P06).
--   Enviado ao canal ≠ entregue: a entrega é a do P12.
-- * O indicador de lembretes do P18 passa a ser medido: atendimentos com lembrete enviado ou compartilhado.
-- Depende de: fundação, P03 (bookings), P06 (outbox, jobs_run), P07 (receivables, payment.recorded), P11 (quotes), P12 (canal).

-- ---------------------------------------------------------------------------
-- Modelos novos (aprovados só no simulado; o real exige aprovação da Meta por migration)
-- ---------------------------------------------------------------------------

insert into public.channel_templates (code, category, body, params) values
  ('lembrete_orcamento', 'utility', 'Olá, {{1}}! Seu orçamento de {{2}} continua disponível até {{3}}. Se tiver dúvida, responda esta mensagem.', 3),
  ('lembrete_cobranca', 'utility', 'Olá, {{1}}! Há um valor de {{2}} ({{3}}) em aberto. Se já pagou, desconsidere; se preferir, responda aqui.', 3),
  ('reativacao', 'marketing', 'Olá, {{1}}! Faz tempo que não nos vemos no {{2}}. Quer agendar um horário? Responda SAIR para não receber mais convites.', 2);

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.lifecycle_settings (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  enabled boolean not null default true,
  confirmation boolean not null default true,
  reminder_hours integer[] not null default '{24,2}' check (cardinality(reminder_hours) between 0 and 4 and reminder_hours <@ array[1,2,3,6,12,24,48]),
  quote_followup_days integer not null default 2 check (quote_followup_days between 1 and 14),
  receivable_reminder boolean not null default true,
  reactivation_days integer not null default 60 check (reactivation_days between 14 and 365),
  daily_budget integer not null default 30 check (daily_budget between 0 and 500),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);
comment on table public.lifecycle_settings is 'Réguas do negócio. Ausente = padrão (ligado, 24 h e 2 h, 2 dias, 60 dias, 30 envios/dia).';
create trigger lifecycle_settings_touch before update on public.lifecycle_settings for each row execute function app.touch_row();

create table public.lifecycle_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid not null,
  purpose text not null check (purpose in ('transactional', 'marketing')),
  source text not null default 'owner_recorded' check (source in ('owner_recorded')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  recorded_by uuid,
  constraint lifecycle_consents_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.lifecycle_consents is 'Consentimento por finalidade, registrado pelo dono (declarado, auditado). Revogar para a régua.';
create unique index lifecycle_consents_live on public.lifecycle_consents (tenant_id, customer_id, purpose) where revoked_at is null;

create table public.lifecycle_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  kind text not null check (kind in ('reactivation')),
  -- Hash do público visto pelo dono na hora de aprovar: aprovar outro público é outra campanha.
  audience_hash text not null check (audience_hash ~ '^[0-9a-f]{64}$'),
  audience_count integer not null check (audience_count >= 0),
  max_sends integer not null check (max_sends between 1 and 500),
  template_code text not null references public.channel_templates (code) on delete restrict,
  status text not null default 'approved' check (status in ('approved', 'cancelled')),
  approved_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.lifecycle_campaigns is 'Reativação só como campanha: público aprovado e teto de envios pelo dono.';

create table public.lifecycle_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  rule text not null check (rule in ('confirmation', 'reminder', 'quote_followup', 'receivable_reminder', 'reactivation')),
  step_key text not null check (char_length(step_key) between 1 and 40),
  aggregate_type text not null check (aggregate_type in ('booking', 'quote', 'receivable', 'customer')),
  aggregate_id uuid not null,
  customer_id uuid,
  campaign_id uuid,
  due_at timestamptz not null,
  -- scheduled → sent (ao canal) | manual → shared | skipped | cancelled ; deferred = adiado pelo teto diário.
  status text not null default 'scheduled' check (status in ('scheduled', 'deferred', 'sent', 'manual', 'shared', 'skipped', 'cancelled')),
  skip_reason text check (char_length(skip_reason) <= 80),
  template_code text not null references public.channel_templates (code) on delete restrict,
  params jsonb not null default '[]' check (jsonb_typeof(params) = 'array'),
  -- Texto renderizado (para o compartilhamento manual e para a tela). Dado da cliente, não instrução.
  body text not null check (char_length(body) between 1 and 1024),
  channel_message_id uuid,
  source_event_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint lifecycle_steps_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint lifecycle_steps_campaign foreign key (tenant_id, campaign_id) references public.lifecycle_campaigns (tenant_id, id) on delete restrict,
  constraint lifecycle_steps_message foreign key (tenant_id, channel_message_id) references public.channel_messages (tenant_id, id) on delete restrict,
  unique (tenant_id, rule, aggregate_id, step_key),
  unique (tenant_id, id)
);
comment on table public.lifecycle_steps is 'Um passo de régua. Dedupe por (régua, agregado, chave). Enviado ao canal ≠ entregue.';
create index lifecycle_steps_due on public.lifecycle_steps (due_at) where status in ('scheduled', 'deferred');
create index lifecycle_steps_tenant on public.lifecycle_steps (tenant_id, status, due_at);
create index lifecycle_steps_aggregate on public.lifecycle_steps (tenant_id, aggregate_type, aggregate_id);
create trigger lifecycle_steps_touch before update on public.lifecycle_steps for each row execute function app.touch_row();

create table public.lifecycle_processed_events (
  event_id uuid primary key,
  processed_at timestamptz not null default now()
);
comment on table public.lifecycle_processed_events is 'Backend-only. Consumidor idempotente do outbox (entrega ao menos uma vez).';

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.lc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.lc_settings(p_tenant_id uuid) returns public.lifecycle_settings
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.lifecycle_settings;
begin
  select * into s from public.lifecycle_settings x where x.tenant_id = p_tenant_id;
  if not found then
    s.tenant_id := p_tenant_id; s.enabled := true; s.confirmation := true; s.reminder_hours := '{24,2}'; s.quote_followup_days := 2;
    s.receivable_reminder := true; s.reactivation_days := 60; s.daily_budget := 30; s.updated_at := now(); s.version := 0;
  end if;
  return s;
end $$;

create function app.lc_settings_json(s public.lifecycle_settings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('enabled', s.enabled, 'confirmation', s.confirmation, 'reminder_hours', to_jsonb(s.reminder_hours),
    'quote_followup_days', s.quote_followup_days, 'receivable_reminder', s.receivable_reminder, 'reactivation_days', s.reactivation_days,
    'daily_budget', s.daily_budget, 'version', s.version)
$$;

create function app.lc_tz(p_tenant_id uuid) returns text
language sql stable set search_path = '' as $$ select t.timezone from public.tenants t where t.id = p_tenant_id $$;

create function app.lc_when(p_ts timestamptz, p_tz text) returns text
language sql immutable set search_path = '' as $$ select to_char(p_ts at time zone p_tz, 'DD/MM "às" HH24:MI') $$;

create function app.lc_brl(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select 'R$ ' || replace(to_char(p_cents / 100.0, 'FM999G999G990D00'), '.', ',')
$$;

/** Contato do canal (P12) da cliente, se houver conexão ativa e telefone igual ao do cadastro. */
create function app.lc_contact(p_tenant_id uuid, p_customer_id uuid) returns public.channel_contacts
language sql stable security definer set search_path = '' as $$
  select k.* from public.channel_contacts k
  where k.tenant_id = p_tenant_id
    and exists (select 1 from public.channel_connections c where c.tenant_id = k.tenant_id and c.status = 'active')
    and (k.customer_id = p_customer_id
    or k.phone_e164 = (select cu.phone from public.customers cu where cu.id = p_customer_id and cu.tenant_id = p_tenant_id))
  order by (k.customer_id = p_customer_id) desc nulls last limit 1
$$;

/** Permissão por finalidade. null = permitido; texto = motivo para pular. */
create function app.lc_denied(p_tenant_id uuid, p_customer_id uuid, p_purpose text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  k public.channel_contacts;
  v_consent boolean;
begin
  if p_customer_id is null then return 'no_customer'; end if;
  k := app.lc_contact(p_tenant_id, p_customer_id);
  if k.id is not null and k.opted_out_at is not null then return 'opted_out'; end if;
  v_consent := exists (select 1 from public.lifecycle_consents c where c.tenant_id = p_tenant_id and c.customer_id = p_customer_id
    and c.purpose = p_purpose and c.revoked_at is null);
  if p_purpose = 'marketing' then
    return case when v_consent then null else 'no_marketing_consent' end;
  end if;
  -- Transacional (sobre o atendimento, orçamento ou cobrança que a própria cliente pediu): permitido, salvo oposição
  -- registrada: SAIR no canal (acima) ou consentimento transacional revogado pelo dono em nome da cliente.
  if not v_consent and exists (select 1 from public.lifecycle_consents c where c.tenant_id = p_tenant_id and c.customer_id = p_customer_id
      and c.purpose = 'transactional' and c.revoked_at is not null) then
    return 'consent_revoked';
  end if;
  return null;
end $$;

/** Agenda um passo; repetir (mesma régua, agregado e chave) não cria outro. */
create function app.lc_schedule(p_tenant_id uuid, p_rule text, p_aggregate_type text, p_aggregate_id uuid, p_customer_id uuid, p_step_key text,
  p_due_at timestamptz, p_template text, p_params jsonb, p_source_event uuid, p_campaign uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.lifecycle_steps (tenant_id, rule, step_key, aggregate_type, aggregate_id, customer_id, campaign_id, due_at, template_code, params, body, source_event_id)
  values (p_tenant_id, p_rule, p_step_key, p_aggregate_type, p_aggregate_id, p_customer_id, p_campaign, p_due_at, p_template, p_params,
    app.ch_render(p_template, p_params), p_source_event)
  on conflict (tenant_id, rule, aggregate_id, step_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

/** Para a régua de um agregado: passos pendentes viram cancelados com o motivo. Enviados não mudam. */
create function app.lc_stop(p_tenant_id uuid, p_aggregate_type text, p_aggregate_id uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.lifecycle_steps s set status = 'cancelled', skip_reason = left(p_reason, 80), resolved_at = clock_timestamp()
  where s.tenant_id = p_tenant_id and s.aggregate_type = p_aggregate_type and s.aggregate_id = p_aggregate_id
    and s.status in ('scheduled', 'deferred', 'manual');
  get diagnostics n = row_count;
  return n;
end $$;

/** Reação a um evento do outbox (idempotente por event_id). */
create function app.lc_on_event(e public.outbox_events) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.lifecycle_settings;
  v_b public.bookings;
  v_cu public.customers;
  v_svc text;
  v_tz text;
  h integer;
  v_customer uuid;
begin
  insert into public.lifecycle_processed_events (event_id) values (e.event_id) on conflict do nothing;
  if not found then return; end if;
  s := app.lc_settings(e.tenant_id);
  v_tz := app.lc_tz(e.tenant_id);
  if e.event_type in ('booking.confirmed.v1', 'booking.rescheduled.v1') then
    select * into v_b from public.bookings b where b.tenant_id = e.tenant_id and b.id = e.aggregate_id;
    if not found or v_b.status <> 'confirmed' or v_b.customer_id is null then return; end if;
    -- Remarcação: o mesmo atendimento confirmado de novo cancela os passos antigos antes dos novos.
    perform app.lc_stop(e.tenant_id, 'booking', v_b.id, 'rescheduled');
    if not s.enabled then return; end if;
    select cu.* into v_cu from public.customers cu where cu.id = v_b.customer_id;
    select p.name into v_svc from public.provider_services p where p.id = v_b.service_id;
    if s.confirmation then
      perform app.lc_schedule(e.tenant_id, 'confirmation', 'booking', v_b.id, v_b.customer_id, 'v' || v_b.version, clock_timestamp(), 'confirmacao_agendamento',
        jsonb_build_array(v_cu.name, coalesce(v_svc, 'atendimento'), app.lc_when(v_b.starts_at, v_tz)), e.event_id);
    end if;
    foreach h in array s.reminder_hours loop
      if v_b.starts_at - make_interval(hours => h) > clock_timestamp() + interval '5 minutes' then
        perform app.lc_schedule(e.tenant_id, 'reminder', 'booking', v_b.id, v_b.customer_id, 'v' || v_b.version || '-h' || h, v_b.starts_at - make_interval(hours => h),
          'lembrete_agendamento', jsonb_build_array(coalesce(v_svc, 'atendimento'), app.lc_when(v_b.starts_at, v_tz)), e.event_id);
      end if;
    end loop;
  elsif e.event_type in ('booking.cancelled.v1', 'booking.completed.v1') then
    perform app.lc_stop(e.tenant_id, 'booking', e.aggregate_id, split_part(e.event_type, '.', 2));
  elsif e.event_type in ('sales.quote.accepted.v1', 'sales.quote.declined.v1') then
    perform app.lc_stop(e.tenant_id, 'quote', e.aggregate_id, split_part(e.event_type, '.', 3));
  elsif e.event_type = 'payment.recorded.v1' and (e.payload->>'receivable_id') is not null then
    perform app.lc_stop(e.tenant_id, 'receivable', (e.payload->>'receivable_id')::uuid, 'paid');
  elsif e.event_type = 'channel.message.received.v1' and coalesce((e.payload->>'opted_out')::boolean, false) then
    v_customer := nullif(e.payload->>'customer_id', '')::uuid;
    if v_customer is not null then
      update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'opted_out', resolved_at = clock_timestamp()
      where x.tenant_id = e.tenant_id and x.customer_id = v_customer and x.status in ('scheduled', 'deferred', 'manual');
    end if;
  end if;
end $$;

/** Envios de hoje (fuso do negócio) que contam no teto: enviados ao canal. Manual não gasta canal. */
create function app.lc_sent_today(p_tenant_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.lifecycle_steps s
  where s.tenant_id = p_tenant_id and s.status = 'sent'
    and (s.resolved_at at time zone app.lc_tz(p_tenant_id))::date = (clock_timestamp() at time zone app.lc_tz(p_tenant_id))::date
$$;

/** Próximo horário útil para um passo adiado: amanhã às 09:00 no fuso do negócio. */
create function app.lc_tomorrow_9(p_tenant_id uuid) returns timestamptz
language sql stable set search_path = '' as $$
  select (((clock_timestamp() at time zone app.lc_tz(p_tenant_id))::date + 1) + time '09:00') at time zone app.lc_tz(p_tenant_id)
$$;

/**
 * Despacha um passo vencido: pula sem permissão, adia pelo teto, envia ao canal (mensagem de modelo na fila do P12)
 * ou vira manual (sem canal). Enviado ao canal não é entregue: o P12 acompanha.
 */
create function app.lc_dispatch(p_step public.lifecycle_steps) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.lifecycle_settings := app.lc_settings(p_step.tenant_id);
  v_denied text;
  k public.channel_contacts;
  c public.channel_connections;
  v_m public.channel_messages;
  v_purpose text := case when p_step.rule = 'reactivation' then 'marketing' else 'transactional' end;
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

/** Uma rodada: gera passos por prazo (orçamento sem decisão, cobrança vencida) e despacha os vencidos. */
create function app.lc_tick(p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  st public.lifecycle_steps;
  v_out text;
  v_counts jsonb := '{"sent":0,"manual":0,"skipped":0,"deferred":0,"cancelled":0}';
  v_created integer := 0;
begin
  -- Orçamentos enviados há N dias, ainda sem decisão e dentro da validade.
  for r in
    select q.id, q.tenant_id, q.customer_id, cu.name, v.total_cents, v.valid_until, s.quote_followup_days
    from public.sales_quotes q
    join public.sales_quote_versions v on v.quote_id = q.id and v.version_no = q.current_version
    join public.customers cu on cu.id = q.customer_id
    cross join lateral app.lc_settings(q.tenant_id) s
    where q.status = 'sent' and s.enabled and q.sent_at <= clock_timestamp() - make_interval(days => s.quote_followup_days)
      and v.valid_until > clock_timestamp()
      and not exists (select 1 from public.lifecycle_steps x where x.tenant_id = q.tenant_id and x.rule = 'quote_followup' and x.aggregate_id = q.id)
    limit p_batch
  loop
    if app.lc_schedule(r.tenant_id, 'quote_followup', 'quote', r.id, r.customer_id, 'd' || r.quote_followup_days, clock_timestamp(), 'lembrete_orcamento',
      jsonb_build_array(r.name, app.lc_brl(r.total_cents), app.lc_when(r.valid_until, app.lc_tz(r.tenant_id))), null) is not null then
      v_created := v_created + 1;
    end if;
  end loop;
  -- Recebíveis em aberto vencidos há mais de 1 dia.
  for r in
    select rc.id, rc.tenant_id, rc.customer_id, cu.name, rc.amount_cents - rc.paid_cents as open_cents, rc.description
    from public.receivables rc
    join public.customers cu on cu.id = rc.customer_id
    cross join lateral app.lc_settings(rc.tenant_id) s
    where rc.status in ('open', 'partially_paid') and s.enabled and s.receivable_reminder and rc.due_at is not null
      and rc.due_at <= clock_timestamp() - interval '1 day'
      and not exists (select 1 from public.lifecycle_steps x where x.tenant_id = rc.tenant_id and x.rule = 'receivable_reminder' and x.aggregate_id = rc.id)
    limit p_batch
  loop
    if app.lc_schedule(r.tenant_id, 'receivable_reminder', 'receivable', r.id, r.customer_id, 'due', clock_timestamp(), 'lembrete_cobranca',
      jsonb_build_array(r.name, app.lc_brl(r.open_cents), r.description), null) is not null then
      v_created := v_created + 1;
    end if;
  end loop;
  -- Passos vencidos: um por vez, com lock (vários workers não despacham o mesmo passo).
  for st in
    select * from public.lifecycle_steps x where x.status in ('scheduled', 'deferred') and x.due_at <= clock_timestamp()
    order by x.due_at limit p_batch for update skip locked
  loop
    v_out := app.lc_dispatch(st);
    v_counts := jsonb_set(v_counts, array[v_out], to_jsonb(coalesce((v_counts->>v_out)::integer, 0) + 1));
  end loop;
  return v_counts || jsonb_build_object('created', v_created);
end $$;

-- ---------------------------------------------------------------------------
-- P12 (correção aditiva): ao reconectar o número, o contato existente passa a apontar para a conexão ativa.
-- ---------------------------------------------------------------------------

create or replace function app.lc_rebind_contacts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (old.status is distinct from 'active') then
    update public.channel_contacts k set connection_id = new.id where k.tenant_id = new.tenant_id and k.connection_id <> new.id;
  end if;
  return new;
end $$;
create trigger channel_connections_rebind after update on public.channel_connections
  for each row execute function app.lc_rebind_contacts();

-- ---------------------------------------------------------------------------
-- P03 (aditivo): remarcação emite evento. A RPC de remarcar atualiza a reserva no lugar e não emitia nada; a régua
-- precisa saber para trocar os lembretes. Gatilho só quando um atendimento confirmado muda de horário.
-- ---------------------------------------------------------------------------

create function app.lc_booking_rescheduled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmed' and old.status = 'confirmed' and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at) then
    perform app.emit_event(new.tenant_id, 'booking.rescheduled.v1', new.id, new.version, gen_random_uuid(),
      app.sched_event_payload(new) || jsonb_build_object('previous_starts_at', app.sched_ts(old.starts_at)));
  end if;
  return new;
end $$;
create trigger bookings_rescheduled_event after update on public.bookings
  for each row execute function app.lc_booking_rescheduled();

-- ---------------------------------------------------------------------------
-- Worker (P06): reage aos eventos e roda a régua a cada rodada
-- ---------------------------------------------------------------------------

create or replace function app.jobs_handle(e public.outbox_events) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
begin
  if e.event_type = 'booking.cancelled.v1' then
    select * into v_b from public.bookings b where b.tenant_id = e.tenant_id and b.id = e.aggregate_id;
    if found and v_b.starts_at > clock_timestamp() then
      perform app.wl_candidates_for(e.tenant_id, v_b.resource_id, v_b.starts_at, e.event_id);
    end if;
  elsif e.event_type = 'waitlist.offer.expired.v1' then
    perform 1;
  elsif e.event_type = 'test.poison.v1' then
    raise exception 'evento de teste que sempre falha';
  end if;
  -- P13: réguas reagem a todo evento (idempotente por event_id).
  perform app.lc_on_event(e);
end $$;

create or replace function public.jobs_run(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired_holds integer;
  v_expired_offers integer;
  v_done integer := 0;
  v_failed integer := 0;
  v_dead integer := 0;
  v_lifecycle jsonb;
  e public.outbox_events;
begin
  v_expired_offers := app.wl_expire_offers();
  v_expired_holds := public.scheduling_expire_holds();
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
  return jsonb_build_object('done', v_done, 'retried', v_failed, 'dead', v_dead,
    'expired_offers', v_expired_offers, 'expired_holds', v_expired_holds, 'lifecycle', v_lifecycle);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: configurações, fila, consentimentos, campanha de reativação
-- ---------------------------------------------------------------------------

create function public.lifecycle_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.lc_owner(p_tenant_id);
  return jsonb_build_object('settings', app.lc_settings_json(app.lc_settings(p_tenant_id)), 'sent_today', app.lc_sent_today(p_tenant_id));
end $$;

create function public.lifecycle_settings_save(
  p_tenant_id uuid,
  p_settings jsonb,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  cur public.lifecycle_settings;
  s public.lifecycle_settings;
  v_hours integer[];
  v_body jsonb;
begin
  perform app.lc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'lifecycle.settings_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  cur := app.lc_settings(p_tenant_id);
  if cur.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if jsonb_typeof(p_settings->'reminder_hours') = 'array' then
    select coalesce(array_agg(distinct (x.value)::integer order by (x.value)::integer desc), '{}') into v_hours from jsonb_array_elements_text(p_settings->'reminder_hours') x;
  else
    v_hours := cur.reminder_hours;
  end if;
  insert into public.lifecycle_settings as t (tenant_id, enabled, confirmation, reminder_hours, quote_followup_days, receivable_reminder, reactivation_days, daily_budget)
  values (p_tenant_id, coalesce((p_settings->>'enabled')::boolean, cur.enabled), coalesce((p_settings->>'confirmation')::boolean, cur.confirmation), v_hours,
    coalesce((p_settings->>'quote_followup_days')::integer, cur.quote_followup_days), coalesce((p_settings->>'receivable_reminder')::boolean, cur.receivable_reminder),
    coalesce((p_settings->>'reactivation_days')::integer, cur.reactivation_days), coalesce((p_settings->>'daily_budget')::integer, cur.daily_budget))
  on conflict (tenant_id) do update set enabled = excluded.enabled, confirmation = excluded.confirmation, reminder_hours = excluded.reminder_hours,
    quote_followup_days = excluded.quote_followup_days, receivable_reminder = excluded.receivable_reminder, reactivation_days = excluded.reactivation_days,
    daily_budget = excluded.daily_budget
  returning * into s;
  perform app.audit(p_tenant_id, 'lifecycle.settings_save', 'lifecycle_settings', p_tenant_id, p_request_id, app.lc_settings_json(cur), app.lc_settings_json(s));
  v_body := jsonb_build_object('settings', app.lc_settings_json(s), 'sent_today', app.lc_sent_today(p_tenant_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'lifecycle.settings_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
exception when check_violation then
  raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'settings';
end $$;

create function app.lc_step_json(s public.lifecycle_steps) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'rule', s.rule, 'step_key', s.step_key, 'aggregate_type', s.aggregate_type, 'aggregate_id', s.aggregate_id,
    'customer_id', s.customer_id, 'customer_name', (select cu.name from public.customers cu where cu.id = s.customer_id),
    'campaign_id', s.campaign_id, 'due_at', app.fin_ts(s.due_at), 'status', s.status, 'skip_reason', s.skip_reason,
    'template_code', s.template_code, 'body', s.body, 'channel_message_id', s.channel_message_id,
    'message_status', (select m.status from public.channel_messages m where m.id = s.channel_message_id),
    'resolved_at', app.fin_ts(s.resolved_at), 'created_at', app.fin_ts(s.created_at), 'version', s.version)
$$;

create function public.lifecycle_steps_list(p_tenant_id uuid, p_status text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.lc_owner(p_tenant_id);
  return jsonb_build_object('steps', coalesce((select jsonb_agg(app.lc_step_json(s) order by s.due_at desc)
    from (select * from public.lifecycle_steps s where s.tenant_id = p_tenant_id and (p_status is null or s.status = p_status)
          order by s.due_at desc limit 200) s), '[]'::jsonb),
    'counts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select s.status, count(*) as n from public.lifecycle_steps s where s.tenant_id = p_tenant_id group by s.status) x));
end $$;

/** O dono compartilhou o texto por conta própria (passo manual). Compartilhar não é entregar. */
create function public.lifecycle_step_mark_shared(
  p_tenant_id uuid,
  p_step_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  s public.lifecycle_steps;
  v_body jsonb;
begin
  perform app.lc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'lifecycle.step_mark_shared', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  update public.lifecycle_steps x set status = 'shared', resolved_at = clock_timestamp() where x.tenant_id = p_tenant_id and x.id = p_step_id and x.status = 'manual' returning * into s;
  if not found then
    if exists (select 1 from public.lifecycle_steps x where x.tenant_id = p_tenant_id and x.id = p_step_id) then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
    end if;
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  perform app.audit(p_tenant_id, 'lifecycle.step_mark_shared', 'lifecycle_step', s.id, p_request_id, null, jsonb_build_object('rule', s.rule));
  v_body := jsonb_build_object('step', app.lc_step_json(s));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'lifecycle.step_mark_shared', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.lifecycle_step_cancel(
  p_tenant_id uuid,
  p_step_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  s public.lifecycle_steps;
  v_body jsonb;
begin
  perform app.lc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'lifecycle.step_cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'owner', resolved_at = clock_timestamp()
  where x.tenant_id = p_tenant_id and x.id = p_step_id and x.status in ('scheduled', 'deferred', 'manual') returning * into s;
  if not found then
    if exists (select 1 from public.lifecycle_steps x where x.tenant_id = p_tenant_id and x.id = p_step_id) then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
    end if;
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  perform app.audit(p_tenant_id, 'lifecycle.step_cancel', 'lifecycle_step', s.id, p_request_id, null, jsonb_build_object('rule', s.rule));
  v_body := jsonb_build_object('step', app.lc_step_json(s));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'lifecycle.step_cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Consentimento por finalidade, registrado pelo dono. Revogar para a régua da cliente naquela finalidade. */
create function public.lifecycle_consent_set(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_purpose text,
  p_granted boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_body jsonb;
  v_live boolean;
begin
  perform app.lc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'lifecycle.consent_set', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_purpose not in ('transactional', 'marketing') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'purpose';
  end if;
  perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  if p_granted then
    insert into public.lifecycle_consents (tenant_id, customer_id, purpose, recorded_by) values (p_tenant_id, p_customer_id, p_purpose, v_uid)
    on conflict do nothing;
  else
    update public.lifecycle_consents c set revoked_at = clock_timestamp() where c.tenant_id = p_tenant_id and c.customer_id = p_customer_id and c.purpose = p_purpose and c.revoked_at is null;
    if p_purpose = 'marketing' then
      update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'consent_revoked', resolved_at = clock_timestamp()
      where x.tenant_id = p_tenant_id and x.customer_id = p_customer_id and x.rule = 'reactivation' and x.status in ('scheduled', 'deferred', 'manual');
    else
      update public.lifecycle_steps x set status = 'cancelled', skip_reason = 'consent_revoked', resolved_at = clock_timestamp()
      where x.tenant_id = p_tenant_id and x.customer_id = p_customer_id and x.rule <> 'reactivation' and x.status in ('scheduled', 'deferred', 'manual')
        and app.lc_denied(p_tenant_id, p_customer_id, 'transactional') is not null;
    end if;
  end if;
  v_live := exists (select 1 from public.lifecycle_consents c where c.tenant_id = p_tenant_id and c.customer_id = p_customer_id and c.purpose = p_purpose and c.revoked_at is null);
  perform app.audit(p_tenant_id, 'lifecycle.consent_set', 'customer', p_customer_id, p_request_id, null, jsonb_build_object('purpose', p_purpose, 'granted', p_granted));
  v_body := jsonb_build_object('customer_id', p_customer_id, 'purpose', p_purpose, 'granted', v_live);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'lifecycle.consent_set', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Público elegível à reativação AGORA, com o hash que a aprovação precisa citar. Só com consentimento de marketing. */
create function app.lc_audience(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.lifecycle_settings := app.lc_settings(p_tenant_id);
  v_items jsonb;
  v_hash text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', x.id, 'name', x.name, 'last_visit_at', app.fin_ts(x.last_visit),
      'has_channel', x.has_channel) order by x.last_visit nulls first, x.name), '[]'::jsonb)
  into v_items
  from (
    select cu.id, cu.name,
      (select max(b.starts_at) from public.bookings b where b.tenant_id = p_tenant_id and b.customer_id = cu.id and b.status in ('completed', 'confirmed', 'no_show')) as last_visit,
      (app.lc_contact(p_tenant_id, cu.id)).id is not null as has_channel
    from public.customers cu
    where cu.tenant_id = p_tenant_id and cu.archived_at is null
      and exists (select 1 from public.lifecycle_consents c where c.tenant_id = p_tenant_id and c.customer_id = cu.id and c.purpose = 'marketing' and c.revoked_at is null)
      and app.lc_denied(p_tenant_id, cu.id, 'marketing') is null
      and not exists (select 1 from public.lifecycle_steps x where x.tenant_id = p_tenant_id and x.customer_id = cu.id and x.rule = 'reactivation'
        and x.created_at > clock_timestamp() - interval '90 days')
      and not exists (select 1 from public.bookings b where b.tenant_id = p_tenant_id and b.customer_id = cu.id and b.status in ('confirmed', 'held') and b.starts_at > clock_timestamp())
  ) x
  where x.last_visit is null or x.last_visit < clock_timestamp() - make_interval(days => s.reactivation_days);
  select encode(sha256(convert_to(coalesce(string_agg(i->>'customer_id', ',' order by i->>'customer_id'), ''), 'UTF8')), 'hex') into v_hash
  from jsonb_array_elements(v_items) i;
  return jsonb_build_object('customers', v_items, 'audience_hash', v_hash, 'reactivation_days', s.reactivation_days, 'daily_budget', s.daily_budget,
    'sent_today', app.lc_sent_today(p_tenant_id));
end $$;

create function public.lifecycle_audience_preview(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.lc_owner(p_tenant_id);
  return app.lc_audience(p_tenant_id);
end $$;

/** Aprova a campanha citando o público visto (hash) e o teto. Cria os passos; o worker envia dentro do orçamento diário. */
create function public.lifecycle_campaign_approve(
  p_tenant_id uuid,
  p_audience_hash text,
  p_max_sends integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_aud jsonb;
  v_c public.lifecycle_campaigns;
  v_name text;
  v_n integer := 0;
  i jsonb;
  v_body jsonb;
begin
  perform app.lc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'lifecycle.campaign_approve', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_max_sends is null or p_max_sends not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'max_sends';
  end if;
  -- Uma aprovação por vez por negócio: a segunda recalcula o público já sem quem a primeira agendou.
  perform pg_advisory_xact_lock(hashtext('lifecycle_campaign:' || p_tenant_id::text));
  v_aud := app.lc_audience(p_tenant_id);
  if v_aud->>'audience_hash' <> p_audience_hash then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION', hint = 'audience_hash';
  end if;
  if jsonb_array_length(v_aud->'customers') = 0 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'audience';
  end if;
  select t.name into v_name from public.tenants t where t.id = p_tenant_id;
  insert into public.lifecycle_campaigns (tenant_id, kind, audience_hash, audience_count, max_sends, template_code, approved_by)
  values (p_tenant_id, 'reactivation', p_audience_hash, jsonb_array_length(v_aud->'customers'), p_max_sends, 'reativacao', v_uid) returning * into v_c;
  for i in select value from jsonb_array_elements(v_aud->'customers') loop
    exit when v_n >= p_max_sends;
    -- Chave por mês: a mesma cliente não recebe duas reativações no mês, venha de que campanha vier.
    if app.lc_schedule(p_tenant_id, 'reactivation', 'customer', (i->>'customer_id')::uuid, (i->>'customer_id')::uuid, 'r' || to_char(clock_timestamp() at time zone app.lc_tz(p_tenant_id), 'YYYY-MM'), clock_timestamp(),
      'reativacao', jsonb_build_array(i->>'name', v_name), null, v_c.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  perform app.audit(p_tenant_id, 'lifecycle.campaign_approve', 'lifecycle_campaign', v_c.id, p_request_id, null,
    jsonb_build_object('audience_count', v_c.audience_count, 'max_sends', p_max_sends, 'scheduled', v_n));
  v_body := jsonb_build_object('campaign', jsonb_build_object('id', v_c.id, 'kind', v_c.kind, 'audience_count', v_c.audience_count, 'max_sends', v_c.max_sends,
    'scheduled', v_n, 'status', v_c.status, 'created_at', app.fin_ts(v_c.created_at)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'lifecycle.campaign_approve', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.lifecycle_campaign_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.lc_owner(p_tenant_id);
  return jsonb_build_object('campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'audience_count', c.audience_count,
      'max_sends', c.max_sends, 'status', c.status, 'created_at', app.fin_ts(c.created_at),
      'scheduled', (select count(*) from public.lifecycle_steps s where s.campaign_id = c.id),
      'sent', (select count(*) from public.lifecycle_steps s where s.campaign_id = c.id and s.status in ('sent', 'shared')),
      'skipped', (select count(*) from public.lifecycle_steps s where s.campaign_id = c.id and s.status in ('skipped', 'cancelled'))) order by c.created_at desc)
    from (select * from public.lifecycle_campaigns c where c.tenant_id = p_tenant_id order by c.created_at desc limit 50) c), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- P18: indicador de lembretes passa a ser medido
-- ---------------------------------------------------------------------------

create or replace function app.an_metrics(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
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
  v_remind_den integer;
  v_remind_num integer;
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

  -- P13: atendimentos com cliente, no período, que tiveram pelo menos um lembrete enviado ao canal ou compartilhado.
  select count(*), count(*) filter (where exists (select 1 from public.lifecycle_steps s where s.tenant_id = b.tenant_id
      and s.aggregate_type = 'booking' and s.aggregate_id = b.id and s.rule = 'reminder' and s.status in ('sent', 'shared')))
  into v_remind_den, v_remind_num
  from public.bookings b where b.tenant_id = p_tenant_id and b.customer_id is not null and b.status in ('confirmed', 'completed', 'no_show')
    and b.starts_at >= p_from and b.starts_at < p_to;
  v_metrics := v_metrics || app.an_metric('reminders', 'Lembretes enviados', 'ratio', v_remind_num, v_remind_den,
    'Atendimentos com cliente que tiveram lembrete enviado ao canal ou compartilhado pelo profissional, sobre os atendimentos do período. Enviado não é entregue nem lido.');

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

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.lc_settings(uuid), app.lc_contact(uuid, uuid), app.lc_denied(uuid, uuid, text), app.lc_audience(uuid), app.lc_sent_today(uuid) from public, anon, authenticated;
revoke all on function app.lc_schedule(uuid, text, text, uuid, uuid, text, timestamptz, text, jsonb, uuid, uuid), app.lc_stop(uuid, text, uuid, text),
  app.lc_on_event(public.outbox_events), app.lc_dispatch(public.lifecycle_steps), app.lc_tick(integer) from public, anon, authenticated;

revoke all on function public.lifecycle_settings_get(uuid) from public, anon;
revoke all on function public.lifecycle_settings_save(uuid, jsonb, integer, text, text, uuid) from public, anon;
revoke all on function public.lifecycle_steps_list(uuid, text) from public, anon;
revoke all on function public.lifecycle_step_mark_shared(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.lifecycle_step_cancel(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.lifecycle_consent_set(uuid, uuid, text, boolean, text, text, uuid) from public, anon;
revoke all on function public.lifecycle_audience_preview(uuid) from public, anon;
revoke all on function public.lifecycle_campaign_approve(uuid, text, integer, text, text, uuid) from public, anon;
revoke all on function public.lifecycle_campaign_list(uuid) from public, anon;
grant execute on function public.lifecycle_settings_get(uuid) to authenticated;
grant execute on function public.lifecycle_settings_save(uuid, jsonb, integer, text, text, uuid) to authenticated;
grant execute on function public.lifecycle_steps_list(uuid, text) to authenticated;
grant execute on function public.lifecycle_step_mark_shared(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.lifecycle_step_cancel(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.lifecycle_consent_set(uuid, uuid, text, boolean, text, text, uuid) to authenticated;
grant execute on function public.lifecycle_audience_preview(uuid) to authenticated;
grant execute on function public.lifecycle_campaign_approve(uuid, text, integer, text, text, uuid) to authenticated;
grant execute on function public.lifecycle_campaign_list(uuid) to authenticated;

alter table public.lifecycle_settings enable row level security;
alter table public.lifecycle_consents enable row level security;
alter table public.lifecycle_campaigns enable row level security;
alter table public.lifecycle_steps enable row level security;
alter table public.lifecycle_processed_events enable row level security;
grant select on public.lifecycle_settings, public.lifecycle_consents, public.lifecycle_campaigns, public.lifecycle_steps to authenticated;
create policy lifecycle_settings_select_owner on public.lifecycle_settings for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy lifecycle_consents_select_owner on public.lifecycle_consents for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy lifecycle_campaigns_select_owner on public.lifecycle_campaigns for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy lifecycle_steps_select_owner on public.lifecycle_steps for select to authenticated using (app.is_member(tenant_id, array['owner']));
-- lifecycle_processed_events: RLS ligada e nenhuma política nem grant para usuários.
