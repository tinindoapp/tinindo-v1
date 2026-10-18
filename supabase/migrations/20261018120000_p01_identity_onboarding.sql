-- P01 · Identidade e onboarding: criação atômica do negócio, onboarding mínimo e aceite de políticas.
-- PROPOSTA (ADR-0005): o integrador numera, revisa e inclui em supabase/migrations/.
-- Depende só da fundação (20261017120000_foundation.sql). Padrão de escrita: ADR-0003.
--
-- Decisões:
-- * business.create não tem tenant antes de rodar, mas idempotency_records exige tenant_id.
--   O id do novo tenant é DERIVADO de (actor, Idempotency-Key): a repetição cai no mesmo tenant
--   e reaproveita app.idempotency_claim/complete da fundação, sem mudar a tabela de idempotência.
--   Um lock transacional por ator serializa as criações dele (repetição concorrente e cota).
-- * Onboarding guarda só dados operacionais estruturados (objetivo e política de cancelamento).
--   Sem texto livre, sem dado de saúde, sem score de maturidade (tasks/P01.md).
-- * Dados públicos do negócio ficam no perfil (P09); nada aqui é público.

-- ---------------------------------------------------------------------------
-- Onboarding do negócio (1:1 com tenants)
-- ---------------------------------------------------------------------------

create table public.tenant_onboarding (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  goal text check (goal in (
    'fill_schedule', 'organize_clients', 'track_payments', 'reduce_no_shows', 'save_admin_time'
  )),
  -- Antecedência mínima para cancelar sem penalidade. null = ainda não definida.
  cancellation_notice_hours integer check (cancellation_notice_hours between 0 and 168),
  -- Multa por cancelamento tardio em basis points do preço combinado. null = sem multa.
  -- Cobrança é manual (P07); este campo não move dinheiro.
  late_cancellation_fee_bps integer check (late_cancellation_fee_bps between 1 and 10000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint tenant_onboarding_complete_requires_fields
    check (completed_at is null or (goal is not null and cancellation_notice_hours is not null))
);
comment on table public.tenant_onboarding is
  'Diagnóstico operacional mínimo (objetivo, política de cancelamento). Privado do negócio.';
create trigger tenant_onboarding_touch before update on public.tenant_onboarding
  for each row execute function app.touch_row();

-- Negócios criados antes desta proposta ganham onboarding vazio. O seed roda DEPOIS das migrations,
-- então onboarding_save também cria a linha que faltar.
insert into public.tenant_onboarding (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- Aceite de termos/políticas (append-only). Texto das políticas vive fora do banco.
-- ---------------------------------------------------------------------------

create table public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  policy_version text not null check (policy_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  accepted_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id, policy_version)
);
comment on table public.policy_acceptances is 'Versões de termos/privacidade aceitas por quem criou o negócio.';
create trigger policy_acceptances_append_only before update or delete on public.policy_acceptances
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------

/** UUID v4-formatado e determinístico a partir de um texto (sha256). Não é segredo. */
create function app.uuid_from_text(p_text text) returns uuid
language sql immutable set search_path = '' as $$
  select (
    substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-'
    || substr('89ab', (get_byte(decode(substr(h, 17, 2), 'hex'), 0) % 4) + 1, 1)
    || substr(h, 18, 3) || '-' || substr(h, 21, 12)
  )::uuid
  from (select encode(pg_catalog.sha256(convert_to(p_text, 'UTF8')), 'hex') as h) s
$$;
revoke all on function app.uuid_from_text(text) from public;

/** Limite de negócios ativos em que a pessoa é dona. Abuso/custo, não regra comercial. */
create function app.max_owned_tenants() returns integer
language sql immutable set search_path = '' as $$ select 3 $$;
revoke all on function app.max_owned_tenants() from public;

create function app.onboarding_json(o public.tenant_onboarding) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', o.tenant_id,
    'goal', o.goal,
    'cancellation_notice_hours', o.cancellation_notice_hours,
    'late_cancellation_fee_bps', o.late_cancellation_fee_bps,
    'completed_at', to_char(o.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'version', o.version
  )
$$;
revoke all on function app.onboarding_json(public.tenant_onboarding) from public;

-- ---------------------------------------------------------------------------
-- business.create: tenant + owner + recurso + onboarding + aceites, numa transação.
-- ---------------------------------------------------------------------------

create function public.business_create(
  p_name text,
  p_profession text,
  p_timezone text,
  p_accepted_policy_versions text[],
  p_idem_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant_id uuid;
  v_resource_id uuid;
  v_replay jsonb;
  v_owned integer;
  v_tenant public.tenants;
  v_body jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  if p_idem_key is null or char_length(p_idem_key) not between 16 and 128 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'idempotency_key';
  end if;
  if p_accepted_policy_versions is null
     or cardinality(p_accepted_policy_versions) not between 1 and 10 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'accepted_policy_versions';
  end if;

  -- Mesma chave do mesmo ator → mesmo tenant. O lock por ator serializa as criações dele:
  -- repetições concorrentes viram replay e chaves diferentes não furam a cota.
  v_tenant_id := app.uuid_from_text(v_uid::text || ':business.create:' || p_idem_key);
  perform pg_advisory_xact_lock(hashtextextended('business.create:' || v_uid::text, 0));

  if exists (select 1 from public.tenants t where t.id = v_tenant_id) then
    -- Repetição: revalida acesso (quem perdeu o acesso não relê o resultado).
    if not app.is_member(v_tenant_id, array['owner']) then
      raise exception using errcode = 'PT403', message = 'FORBIDDEN';
    end if;
    v_replay := app.idempotency_claim(v_tenant_id, v_uid, 'business.create', p_idem_key, p_request_hash);
    if v_replay is null then
      raise exception using errcode = 'PT500', message = 'INTERNAL_ERROR',
        detail = 'tenant derivado existe sem registro de idempotência';
    end if;
    return v_replay;
  end if;

  select count(*) into v_owned
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = v_uid and m.role = 'owner' and m.active and t.status <> 'closed';
  if v_owned >= app.max_owned_tenants() then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED';
  end if;

  insert into public.tenants (id, name, profession, timezone)
  values (v_tenant_id, btrim(p_name), p_profession, p_timezone)
  returning * into v_tenant;

  perform app.idempotency_claim(v_tenant_id, v_uid, 'business.create', p_idem_key, p_request_hash);

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_uid, 'owner');

  insert into public.resources (tenant_id, name)
  values (v_tenant_id, v_tenant.name)
  returning id into v_resource_id;

  insert into public.tenant_onboarding (tenant_id) values (v_tenant_id);

  insert into public.policy_acceptances (tenant_id, user_id, policy_version)
  select v_tenant_id, v_uid, v
  from (select distinct unnest(p_accepted_policy_versions) as v) s;

  perform app.audit(v_tenant_id, 'business.created', 'tenant', v_tenant_id, null, null,
    jsonb_build_object('profession', v_tenant.profession, 'timezone', v_tenant.timezone));

  v_body := jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'name', v_tenant.name,
      'profession', v_tenant.profession,
      'timezone', v_tenant.timezone,
      'currency', v_tenant.currency::text,
      'status', v_tenant.status,
      'version', v_tenant.version
    ),
    'resource_id', v_resource_id
  );
  perform app.idempotency_complete(v_tenant_id, v_uid, 'business.create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- onboarding.save: dono atualiza objetivo e política, com expected_version.
-- ---------------------------------------------------------------------------

create function public.onboarding_save(
  p_tenant_id uuid,
  p_expected_version integer,
  p_goal text,
  p_cancellation_notice_hours integer,
  p_late_cancellation_fee_bps integer,
  p_mark_complete boolean,
  p_idem_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_replay jsonb;
  v_row public.tenant_onboarding;
  v_body jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'onboarding.save', p_idem_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  -- Negócio sem linha (seed/criação anterior à proposta) começa do onboarding vazio, versão 1.
  insert into public.tenant_onboarding (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  select * into v_row from public.tenant_onboarding o where o.tenant_id = p_tenant_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_row.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if coalesce(p_mark_complete, false) and (p_goal is null or p_cancellation_notice_hours is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      hint = case when p_goal is null then 'goal' else 'cancellation_notice_hours' end;
  end if;

  update public.tenant_onboarding o
  set goal = p_goal,
      cancellation_notice_hours = p_cancellation_notice_hours,
      late_cancellation_fee_bps = p_late_cancellation_fee_bps,
      completed_at = case
        when o.completed_at is not null then o.completed_at
        when coalesce(p_mark_complete, false) then now()
      end
  where o.tenant_id = p_tenant_id
  returning * into v_row;

  perform app.audit(p_tenant_id, 'onboarding.saved', 'tenant_onboarding', p_tenant_id, null, null,
    jsonb_build_object('goal', v_row.goal, 'cancellation_notice_hours', v_row.cancellation_notice_hours,
      'late_cancellation_fee_bps', v_row.late_cancellation_fee_bps, 'completed', v_row.completed_at is not null));

  v_body := jsonb_build_object('onboarding', app.onboarding_json(v_row));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'onboarding.save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------

alter table public.tenant_onboarding enable row level security;
alter table public.policy_acceptances enable row level security;

revoke all on public.tenant_onboarding, public.policy_acceptances from anon, authenticated;
grant select on public.tenant_onboarding, public.policy_acceptances to authenticated;
grant select, insert, update, delete on public.tenant_onboarding to service_role;
grant select, insert on public.policy_acceptances to service_role;

create policy tenant_onboarding_select_member on public.tenant_onboarding
  for select to authenticated
  using (app.is_member(tenant_id));

create policy policy_acceptances_select on public.policy_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_member(tenant_id, array['owner']));

revoke all on function public.business_create(text, text, text, text[], text, text) from public, anon;
revoke all on function public.onboarding_save(uuid, integer, text, integer, integer, boolean, text, text)
  from public, anon;
grant execute on function public.business_create(text, text, text, text[], text, text) to authenticated;
grant execute on function public.onboarding_save(uuid, integer, text, integer, integer, boolean, text, text)
  to authenticated;
