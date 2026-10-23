-- P21 · Indicação de colegas: o convite rastreado do P09 (professional_invites_peer) vira adesão ELEGÍVEL quando o
-- negócio do colega mostra uso real (clientes e atendimentos concluídos), dentro de uma janela; o benefício é um
-- crédito de franquia do assistente (perguntas no mês) para o negócio que convidou. Nunca avaliação, nota ou posição.
-- Invariantes (docs/00 "Ciclos de indicação", docs/14, tasks/P21):
-- * Benefício só após ativação real, medida pelo backend (não declarada). Um benefício por negócio indicado.
-- * Autoindicação bloqueada: mesmo usuário (já no P09) e mesmo negócio (inviter_tenant = claimed_tenant).
-- * Duplicidade: o negócio indicado por vários convites só rende o benefício ao PRIMEIRO convite aceito.
-- * Teto mensal de benefícios por negócio convidante; além dele, a elegibilidade espera o mês seguinte (não some).
-- * O crédito vale no mês em que é concedido (bônus da franquia do P08), não se acumula.
-- Depende de: fundação, P02 (customers), P03 (bookings), P08 (agent_quotas), P09 (referrals), P06 (outbox, jobs_run).

-- ---------------------------------------------------------------------------
-- P08 (aditivo): bônus mensal na franquia do assistente
-- ---------------------------------------------------------------------------

alter table public.agent_quotas add column bonus integer not null default 0 check (bonus between 0 and 100000);
alter table public.agent_quotas add column bonus_period_start date;
comment on column public.agent_quotas.bonus is 'P21: crédito de franquia do mês bonus_period_start (indicações). Não acumula.';

create or replace function public.agent_run_start(p_tenant_id uuid, p_idem_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text := app.member_role(p_tenant_id);
  v_run public.agent_runs;
  v_q public.agent_quotas;
  v_month date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
  v_t public.tenants;
  v_replay boolean := false;
  v_limit integer;
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
    -- P21: o bônus de indicação vale só no mês em que foi concedido.
    v_limit := v_q.monthly_limit + case when v_q.bonus_period_start = v_month then v_q.bonus else 0 end;
    if v_q.used >= v_limit then
      raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED';
    end if;
    update public.agent_quotas q set used = q.used + 1, updated_at = now()
    where q.tenant_id = p_tenant_id returning * into v_q;
    insert into public.agent_runs (tenant_id, user_id, idem_key) values (p_tenant_id, v_uid, p_idem_key)
    returning * into v_run;
  end if;
  v_limit := v_q.monthly_limit + case when v_q.bonus_period_start = v_month then v_q.bonus else 0 end;

  select * into v_t from public.tenants t where t.id = p_tenant_id;
  return jsonb_build_object('run_id', v_run.id, 'replay', v_replay, 'role', v_role, 'tenant_name', v_t.name,
    'timezone', v_t.timezone, 'quota', jsonb_build_object('limit', v_limit, 'used', v_q.used,
      'bonus', case when v_q.bonus_period_start = v_month then v_q.bonus else 0 end,
      'renews_at', app.sched_ts(((v_q.period_start + interval '1 month')::timestamp) at time zone 'UTC')));
end $$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.referral_activations (
  referral_id uuid primary key references public.referrals (id) on delete restrict,
  inviter_tenant_id uuid not null references public.tenants (id) on delete restrict,
  invitee_tenant_id uuid not null references public.tenants (id) on delete restrict,
  -- awaiting_activity → eligible → rewarded ; blocked (motivo) ; eligible pode esperar o teto mensal.
  status text not null default 'awaiting_activity' check (status in ('awaiting_activity', 'eligible', 'rewarded', 'blocked')),
  block_reason text check (block_reason in ('same_tenant', 'duplicate', 'window_expired')),
  -- O que o backend mediu na última avaliação (contagens, não dados pessoais).
  checks jsonb not null default '{}' check (jsonb_typeof(checks) = 'object'),
  claimed_at timestamptz not null,
  eligible_at timestamptz,
  rewarded_at timestamptz,
  reward_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);
comment on table public.referral_activations is 'Adesão elegível de um convite de colega: medida pelo backend, nunca declarada. Um benefício por negócio indicado.';
create unique index referral_activations_one_per_invitee on public.referral_activations (invitee_tenant_id) where status in ('eligible', 'rewarded');
create index referral_activations_pending on public.referral_activations (status) where status in ('awaiting_activity', 'eligible');
create trigger referral_activations_touch before update on public.referral_activations for each row execute function app.touch_row();

create table public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  referral_id uuid not null unique references public.referrals (id) on delete restrict,
  kind text not null default 'agent_questions' check (kind in ('agent_questions')),
  amount integer not null check (amount between 1 and 100000),
  period_start date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.referral_rewards is 'Benefício concedido: crédito de franquia do assistente no mês. Append-only. Não é avaliação.';
create index referral_rewards_month on public.referral_rewards (tenant_id, period_start);
create trigger referral_rewards_append_only before update or delete on public.referral_rewards for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------------

/** Regras do programa, num só lugar (a tela as mostra; mudar é migration, nunca constante no app). */
create function app.ref_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('min_customers', 3, 'min_completed_bookings', 2, 'window_days', 60, 'reward_questions', 50, 'monthly_cap', 10)
$$;

create function app.ref_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/** Uso real do negócio indicado: contagens, sem dados pessoais. */
create function app.ref_activity(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'customers', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.archived_at is null),
    'completed_bookings', (select count(*) from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed'))
$$;

/** Concede o benefício ao negócio convidante: bônus na franquia do mês corrente. Idempotente por convite. */
create function app.ref_reward(p_act public.referral_activations) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
  v_amount integer := (app.ref_rules()->>'reward_questions')::integer;
  v_r public.referral_rewards;
begin
  select * into v_r from public.referral_rewards x where x.referral_id = p_act.referral_id;
  if found then return v_r.id; end if;
  insert into public.referral_rewards (tenant_id, referral_id, amount, period_start)
  values (p_act.inviter_tenant_id, p_act.referral_id, v_amount, v_month) returning * into v_r;
  insert into public.agent_quotas (tenant_id, period_start, bonus, bonus_period_start)
  values (p_act.inviter_tenant_id, v_month, v_amount, v_month)
  on conflict (tenant_id) do update
    set bonus = case when public.agent_quotas.bonus_period_start = v_month then public.agent_quotas.bonus + v_amount else v_amount end,
        bonus_period_start = v_month, updated_at = now();
  update public.referral_activations a set status = 'rewarded', rewarded_at = clock_timestamp(), reward_id = v_r.id where a.referral_id = p_act.referral_id;
  perform app.emit_event(p_act.inviter_tenant_id, 'referral.rewarded.v1', p_act.referral_id, 1, gen_random_uuid(),
    jsonb_build_object('referral_id', p_act.referral_id, 'reward_id', v_r.id, 'kind', v_r.kind, 'amount', v_amount, 'period_start', v_month::text));
  perform app.audit(p_act.inviter_tenant_id, 'referral.reward', 'referral', p_act.referral_id, null, null,
    jsonb_build_object('kind', v_r.kind, 'amount', v_amount, 'period_start', v_month::text));
  return v_r.id;
end $$;

/**
 * Uma rodada: registra convites de colega aceitos, avalia os que aguardam uso real e concede o benefício aos
 * elegíveis dentro do teto mensal. Determinística e idempotente: rodar de novo não concede duas vezes.
 */
create function app.ref_tick(p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals;
  a public.referral_activations;
  v_rules jsonb := app.ref_rules();
  v_checks jsonb;
  v_month date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
  v_registered integer := 0;
  v_eligible integer := 0;
  v_rewarded integer := 0;
  v_blocked integer := 0;
  v_capped integer := 0;
begin
  -- 1 · Convites de colega aceitos por um negócio ainda não registrados.
  for r in
    select x.* from public.referrals x
    where x.kind = 'professional_invites_peer' and x.status = 'claimed' and x.claimed_tenant_id is not null
      and not exists (select 1 from public.referral_activations y where y.referral_id = x.id)
    order by x.claimed_at limit p_batch
  loop
    insert into public.referral_activations (referral_id, inviter_tenant_id, invitee_tenant_id, claimed_at,
      status, block_reason)
    values (r.id, r.inviter_tenant_id, r.claimed_tenant_id, r.claimed_at,
      case when r.inviter_tenant_id = r.claimed_tenant_id then 'blocked' else 'awaiting_activity' end,
      case when r.inviter_tenant_id = r.claimed_tenant_id then 'same_tenant' end)
    on conflict do nothing;
    v_registered := v_registered + 1;
  end loop;
  -- 2 · Avaliação do uso real, do convite mais antigo para o mais novo (o primeiro aceito tem prioridade na duplicidade).
  for a in
    select * from public.referral_activations x where x.status in ('awaiting_activity', 'eligible')
    order by x.claimed_at limit p_batch for update skip locked
  loop
    if a.status = 'awaiting_activity' then
      if exists (select 1 from public.referral_activations y where y.invitee_tenant_id = a.invitee_tenant_id and y.referral_id <> a.referral_id
          and y.status in ('eligible', 'rewarded')) then
        update public.referral_activations x set status = 'blocked', block_reason = 'duplicate' where x.referral_id = a.referral_id;
        v_blocked := v_blocked + 1;
        continue;
      end if;
      v_checks := app.ref_activity(a.invitee_tenant_id);
      if (v_checks->>'customers')::integer >= (v_rules->>'min_customers')::integer
         and (v_checks->>'completed_bookings')::integer >= (v_rules->>'min_completed_bookings')::integer then
        begin
          update public.referral_activations x set status = 'eligible', eligible_at = clock_timestamp(), checks = v_checks where x.referral_id = a.referral_id returning * into a;
          v_eligible := v_eligible + 1;
        exception when unique_violation then
          update public.referral_activations x set status = 'blocked', block_reason = 'duplicate', checks = v_checks where x.referral_id = a.referral_id;
          v_blocked := v_blocked + 1;
          continue;
        end;
      elsif a.claimed_at + make_interval(days => (v_rules->>'window_days')::integer) < clock_timestamp() then
        update public.referral_activations x set status = 'blocked', block_reason = 'window_expired', checks = v_checks where x.referral_id = a.referral_id;
        v_blocked := v_blocked + 1;
        continue;
      else
        update public.referral_activations x set checks = v_checks where x.referral_id = a.referral_id;
        continue;
      end if;
    end if;
    -- Elegível: concede dentro do teto mensal do convidante; além dele, espera (não some).
    if (select count(*) from public.referral_rewards w where w.tenant_id = a.inviter_tenant_id and w.period_start = v_month) < (v_rules->>'monthly_cap')::integer then
      perform app.ref_reward(a);
      v_rewarded := v_rewarded + 1;
    else
      v_capped := v_capped + 1;
    end if;
  end loop;
  return jsonb_build_object('registered', v_registered, 'eligible', v_eligible, 'rewarded', v_rewarded, 'blocked', v_blocked, 'capped', v_capped);
end $$;

-- ---------------------------------------------------------------------------
-- Worker (P06): avaliação das indicações a cada rodada
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
  e public.outbox_events;
begin
  v_expired_offers := app.wl_expire_offers();
  v_expired_holds := public.scheduling_expire_holds();
  v_recurrence := app.rc_tick(100);
  v_referrals := app.ref_tick(100);
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
    'expired_offers', v_expired_offers, 'expired_holds', v_expired_holds, 'lifecycle', v_lifecycle, 'recurrence', v_recurrence, 'referrals', v_referrals);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: painel de indicações
-- ---------------------------------------------------------------------------

create function public.referral_dashboard(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
begin
  perform app.ref_owner(p_tenant_id);
  return jsonb_build_object(
    'rules', app.ref_rules(),
    'invites', coalesce((select jsonb_agg(jsonb_build_object(
        'referral_id', r.id, 'invitee_name', r.invitee_name, 'invitee_category', r.invitee_category, 'created_at', app.fin_ts(r.created_at),
        'expires_at', app.fin_ts(r.expires_at),
        'state', case when r.status = 'claimed' then 'claimed' when r.status = 'revoked' then 'revoked' when r.expires_at <= now() then 'expired' else 'pending' end,
        'claimed_at', app.fin_ts(r.claimed_at),
        'activation', (select jsonb_build_object('status', a.status, 'block_reason', a.block_reason, 'checks', a.checks,
            'eligible_at', app.fin_ts(a.eligible_at), 'rewarded_at', app.fin_ts(a.rewarded_at)) from public.referral_activations a where a.referral_id = r.id),
        'reward', (select jsonb_build_object('id', w.id, 'kind', w.kind, 'amount', w.amount, 'period_start', w.period_start::text, 'created_at', app.fin_ts(w.created_at))
          from public.referral_rewards w where w.referral_id = r.id)) order by r.created_at desc)
      from (select * from public.referrals r where r.inviter_tenant_id = p_tenant_id and r.kind = 'professional_invites_peer' order by r.created_at desc limit 100) r), '[]'::jsonb),
    'summary', jsonb_build_object(
      'invites', (select count(*) from public.referrals r where r.inviter_tenant_id = p_tenant_id and r.kind = 'professional_invites_peer'),
      'claimed', (select count(*) from public.referrals r where r.inviter_tenant_id = p_tenant_id and r.kind = 'professional_invites_peer' and r.status = 'claimed'),
      'rewarded', (select count(*) from public.referral_rewards w where w.tenant_id = p_tenant_id),
      'rewarded_this_month', (select count(*) from public.referral_rewards w where w.tenant_id = p_tenant_id and w.period_start = v_month),
      'bonus_this_month', (select case when q.bonus_period_start = v_month then q.bonus else 0 end from public.agent_quotas q where q.tenant_id = p_tenant_id),
      'agent_limit', (select q.monthly_limit from public.agent_quotas q where q.tenant_id = p_tenant_id),
      'agent_used', (select case when q.period_start = v_month then q.used else 0 end from public.agent_quotas q where q.tenant_id = p_tenant_id)));
end $$;

create function public.referral_rewards_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.ref_owner(p_tenant_id);
  return jsonb_build_object('rewards', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'referral_id', w.referral_id, 'kind', w.kind, 'amount', w.amount,
      'period_start', w.period_start::text, 'created_at', app.fin_ts(w.created_at),
      'invitee_name', (select r.invitee_name from public.referrals r where r.id = w.referral_id)) order by w.created_at desc)
    from (select * from public.referral_rewards w where w.tenant_id = p_tenant_id order by w.created_at desc limit 100) w), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.ref_activity(uuid), app.ref_reward(public.referral_activations), app.ref_tick(integer) from public, anon, authenticated;
revoke all on function public.referral_dashboard(uuid) from public, anon;
revoke all on function public.referral_rewards_list(uuid) from public, anon;
grant execute on function public.referral_dashboard(uuid) to authenticated;
grant execute on function public.referral_rewards_list(uuid) to authenticated;

alter table public.referral_activations enable row level security;
alter table public.referral_rewards enable row level security;
grant select on public.referral_rewards to authenticated;
create policy referral_rewards_select_owner on public.referral_rewards for select to authenticated using (app.is_member(tenant_id, array['owner']));
-- referral_activations: RLS ligada e nenhuma política para usuários (o painel expõe só o necessário).
