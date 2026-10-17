-- P00 · Fundação: identidade de negócio, isolamento por tenant e infraestrutura de comando.
-- Dono: integrador (ADR-0005). Append-only depois de aplicada em qualquer ambiente compartilhado.
--
-- Convenções (ADR-0003/0004):
-- * Toda tabela privada tem tenant_id NOT NULL, UNIQUE (tenant_id, id) e RLS habilitada.
-- * Leitura simples por RLS; escrita crítica só por função transacional (RPC) dos módulos.
-- * Erros de domínio: RAISE ... USING ERRCODE = 'PTxxx', MESSAGE = '<ErrorCode do contrato>'.
--   PostgREST devolve o HTTP xxx; Edge Functions mapeiam a mensagem para o envelope v1.
-- * Nenhuma tabela/função fica exposta sem GRANT explícito (auto_expose_new_tables = false).

create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
comment on schema app is 'Funções internas da Tinindo. Não exposto pela Data API.';
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Utilitários de linha
-- ---------------------------------------------------------------------------

create function app.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create function app.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'PT403', message = 'FORBIDDEN',
    detail = format('%s é append-only', tg_table_name);
end $$;

create function app.validate_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when invalid_parameter_value then
  raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
    detail = 'timezone IANA inválido', hint = 'timezone';
end $$;

-- ---------------------------------------------------------------------------
-- Negócio (tenant), membros e recurso
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  profession text not null check (profession in ('barber', 'hairdresser', 'personal_trainer', 'other')),
  timezone text not null default 'America/Sao_Paulo',
  currency char(3) not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  settings_version integer not null default 1 check (settings_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);
comment on table public.tenants is 'Negócio assinante. Moeda BRL e timezone IANA no piloto.';

create trigger tenants_touch before update on public.tenants
  for each row execute function app.touch_row();
create trigger tenants_timezone before insert or update of timezone on public.tenants
  for each row execute function app.validate_timezone();

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, user_id),
  unique (tenant_id, id)
);
comment on table public.tenant_memberships is 'Papel de um login dentro de um negócio. Papel decidido no servidor.';
create index tenant_memberships_user on public.tenant_memberships (user_id) where active;
create trigger tenant_memberships_touch before update on public.tenant_memberships
  for each row execute function app.touch_row();

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id)
);
comment on table public.resources is 'Profissional/recurso que ocupa capacidade. Piloto: um ativo por negócio.';
create unique index resources_one_active_per_tenant on public.resources (tenant_id) where active;
create trigger resources_touch before update on public.resources
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Autorização: o tenant do request é seleção; estas funções decidem.
-- SECURITY DEFINER para não recursar na RLS de tenant_memberships.
-- ---------------------------------------------------------------------------

create function app.member_role(p_tenant_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant_id
    and m.user_id = (select auth.uid())
    and m.active
    and t.status <> 'closed'
$$;

create function app.is_member(p_tenant_id uuid, p_roles text[] default array['owner', 'staff'])
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.member_role(p_tenant_id) = any (p_roles), false)
$$;

revoke all on function app.member_role(uuid) from public;
revoke all on function app.is_member(uuid, text[]) from public;
grant execute on function app.member_role(uuid) to authenticated, service_role;
grant execute on function app.is_member(uuid, text[]) to authenticated, service_role;

/**
 * Caminho request → autorização → banco. Usado pela Edge Function `context`
 * e por qualquer módulo que precise do contexto validado.
 * Não revela se o tenant existe: não-membro e inexistente dão o mesmo erro.
 */
create function public.resolve_context(p_tenant_id uuid)
returns table (
  actor_user_id uuid,
  tenant_id uuid,
  role text,
  tenant_name text,
  timezone text,
  currency text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  return query
    select v_uid, t.id, m.role, t.name, t.timezone, t.currency::text
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id
      and m.user_id = v_uid
      and m.active
      and t.status <> 'closed';
  if not found then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;
revoke all on function public.resolve_context(uuid) from public, anon;
grant execute on function public.resolve_context(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotência: (tenant, actor, operation, key) + hash do payload normalizado.
-- Claim, mutação, outbox e complete acontecem na MESMA transação do comando.
-- ---------------------------------------------------------------------------

create table public.idempotency_records (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_user_id uuid,
  operation text not null check (operation ~ '^[a-z_]+\.[a-z_]+$'),
  key text not null check (char_length(key) between 16 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status_code integer check (status_code between 200 and 599),
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint idempotency_records_scope unique nulls not distinct (tenant_id, actor_user_id, operation, key)
);
comment on table public.idempotency_records is 'Backend-only. Sem acesso pela Data API.';

/**
 * Retorna NULL quando a chamada é nova (seguir com a mutação) ou a resposta gravada
 * {status_code, body} quando é repetição. Payload diferente com a mesma chave → PT409.
 * Chamadas concorrentes com a mesma chave esperam a primeira transação terminar.
 * O módulo DEVE revalidar autorização antes de chamar (repetição não fura permissão).
 */
create function app.idempotency_claim(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_operation text,
  p_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.idempotency_records;
begin
  insert into public.idempotency_records (tenant_id, actor_user_id, operation, key, request_hash)
  values (p_tenant_id, p_actor_user_id, p_operation, p_key, p_request_hash)
  on conflict on constraint idempotency_records_scope do nothing;
  if found then
    return null;
  end if;

  select * into r
  from public.idempotency_records i
  where i.tenant_id = p_tenant_id
    and i.actor_user_id is not distinct from p_actor_user_id
    and i.operation = p_operation
    and i.key = p_key;

  if r.request_hash <> p_request_hash then
    raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_MISMATCH';
  end if;
  if r.response is null then
    -- Registro sem resposta só existe se o comando gravou o claim e não completou: bug do módulo.
    raise exception using errcode = 'PT500', message = 'INTERNAL_ERROR',
      detail = 'registro de idempotência sem resposta';
  end if;
  return jsonb_build_object('status_code', r.status_code, 'body', r.response);
end $$;

create function app.idempotency_complete(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_operation text,
  p_key text,
  p_status_code integer,
  p_response jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.idempotency_records i
  set status_code = p_status_code, response = p_response, completed_at = now()
  where i.tenant_id = p_tenant_id
    and i.actor_user_id is not distinct from p_actor_user_id
    and i.operation = p_operation
    and i.key = p_key
    and i.response is null;
  if not found then
    raise exception using errcode = 'PT500', message = 'INTERNAL_ERROR',
      detail = 'complete sem claim correspondente';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Outbox: gravado na mesma transação da mudança. Dispatcher/jobs: proposta do P06.
-- ---------------------------------------------------------------------------

create table public.outbox_events (
  event_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z_]+(\.[a-z_]+)+\.v[0-9]+$'),
  aggregate_id uuid not null,
  aggregate_version integer not null check (aggregate_version >= 1),
  schema_version integer not null default 1 check (schema_version >= 1),
  correlation_id uuid not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 50),
  next_run_at timestamptz not null default now(),
  leased_until timestamptz,
  last_error text check (char_length(last_error) <= 1000)
);
comment on table public.outbox_events is 'Backend-only. Entrega ao menos uma vez; consumidor deduplica event_id.';
create index outbox_events_ready on public.outbox_events (next_run_at)
  where status in ('pending', 'processing');
create index outbox_events_tenant on public.outbox_events (tenant_id, occurred_at);

create function app.emit_event(
  p_tenant_id uuid,
  p_event_type text,
  p_aggregate_id uuid,
  p_aggregate_version integer,
  p_correlation_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.outbox_events
    (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, payload)
  values
    (p_tenant_id, p_event_type, p_aggregate_id, p_aggregate_version, p_correlation_id, p_payload)
  returning event_id
$$;

-- ---------------------------------------------------------------------------
-- Auditoria append-only (antes/depois já redigidos pelo chamador: sem telefone/mensagem).
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants (id) on delete restrict,
  actor_user_id uuid,
  action text not null check (char_length(action) between 1 and 80),
  object_type text not null check (char_length(object_type) between 1 and 60),
  object_id uuid,
  request_id uuid,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_events_tenant on public.audit_events (tenant_id, occurred_at desc);
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function app.forbid_mutation();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function app.forbid_mutation();

create function app.audit(
  p_tenant_id uuid,
  p_action text,
  p_object_type text,
  p_object_id uuid,
  p_request_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_events
    (tenant_id, actor_user_id, action, object_type, object_id, request_id, before, after)
  values
    (p_tenant_id, (select auth.uid()), p_action, p_object_type, p_object_id, p_request_id, p_before, p_after)
$$;

revoke all on function app.idempotency_claim(uuid, uuid, text, text, text) from public;
revoke all on function app.idempotency_complete(uuid, uuid, text, text, integer, jsonb) from public;
revoke all on function app.emit_event(uuid, text, uuid, integer, uuid, jsonb) from public;
revoke all on function app.audit(uuid, text, text, uuid, uuid, jsonb, jsonb) from public;
grant execute on function app.idempotency_claim(uuid, uuid, text, text, text) to service_role;
grant execute on function app.idempotency_complete(uuid, uuid, text, text, integer, jsonb) to service_role;
grant execute on function app.emit_event(uuid, text, uuid, integer, uuid, jsonb) to service_role;
grant execute on function app.audit(uuid, text, text, uuid, uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- RLS e grants. Políticas explícitas; ausência de política = negado.
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.resources enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.outbox_events enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.tenants, public.tenant_memberships, public.resources,
  public.idempotency_records, public.outbox_events, public.audit_events
  from anon, authenticated;

grant select on public.tenants, public.tenant_memberships, public.resources, public.audit_events
  to authenticated;
grant select, insert, update, delete on public.tenants, public.tenant_memberships, public.resources,
  public.idempotency_records, public.outbox_events
  to service_role;
grant select, insert on public.audit_events to service_role;

create policy tenants_select_member on public.tenants
  for select to authenticated
  using (app.is_member(id));

create policy tenant_memberships_select on public.tenant_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_member(tenant_id, array['owner']));

create policy resources_select_member on public.resources
  for select to authenticated
  using (app.is_member(tenant_id));

create policy audit_events_select_owner on public.audit_events
  for select to authenticated
  using (tenant_id is not null and app.is_member(tenant_id, array['owner']));

-- idempotency_records e outbox_events: RLS ligada e nenhuma política para usuários.
