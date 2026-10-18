-- P01 · Vínculo cliente ↔ login por comprovação (docs/02 "Identidade", ADR-0003).
-- PROPOSTA (ADR-0005). DEPENDE de public.customers do P02 (tenant_id, id, name, archived_at,
-- UNIQUE (tenant_id, id)). O integrador inclui esta migration DEPOIS da do P02.
--
-- Comprovação no piloto: o dono gera um código de uso único para UM cadastro e o entrega pelo
-- contato que ele já tem da pessoa (compartilhamento manual; "share_opened" não é "delivered").
-- Quem resgata o código autenticado prova que recebeu a mensagem naquele contato.
-- * Telefone/e-mail nunca vinculam sozinhos, nem entre negócios (docs/02).
-- * O código tem 256 bits, só o sha256 fica no banco, vale 72 h, um uso, um cadastro.
-- * O texto do código só sai na primeira resposta; a resposta guardada para repetição não o contém.
-- * Cliente vinculado não vira membro: não lê tenants, CRM nem outros clientes. Lê os próprios
--   vínculos por public.my_customer_links() e os módulos usam app.linked_customer_id(tenant).

create table public.customer_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  verification_method text not null check (verification_method in ('owner_invite_code')),
  verified_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict
);
comment on table public.customer_links is
  'Login de cliente ↔ cadastro privado do negócio, após comprovação. Não é membership.';
-- Um login por cadastro e um cadastro por login, dentro do mesmo negócio.
create unique index customer_links_active_customer on public.customer_links (tenant_id, customer_id)
  where revoked_at is null;
create unique index customer_links_active_user on public.customer_links (tenant_id, user_id)
  where revoked_at is null;
create index customer_links_user on public.customer_links (user_id) where revoked_at is null;
create trigger customer_links_touch before update on public.customer_links
  for each row execute function app.touch_row();

create table public.customer_link_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  -- Gerar outro código para o mesmo cadastro aposenta este.
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  check (expires_at > created_at)
);
comment on table public.customer_link_invites is 'Backend-only. Só o hash do código fica gravado.';
create index customer_link_invites_customer on public.customer_link_invites (tenant_id, customer_id)
  where used_at is null and superseded_at is null;

create function app.customer_link_ttl() returns interval
language sql immutable set search_path = '' as $$ select interval '72 hours' $$;
revoke all on function app.customer_link_ttl() from public;

/** Cadastro do negócio ligado ao login atual, ou NULL. Base para RLS de cliente (P03/P09). */
create function app.linked_customer_id(p_tenant_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select l.customer_id
  from public.customer_links l
  join public.tenants t on t.id = l.tenant_id
  where l.tenant_id = p_tenant_id
    and l.user_id = (select auth.uid())
    and l.revoked_at is null
    and t.status <> 'closed'
$$;
revoke all on function app.linked_customer_id(uuid) from public;
grant execute on function app.linked_customer_id(uuid) to authenticated, service_role;

create function app.token_sha256(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;
revoke all on function app.token_sha256(text) from public;

-- ---------------------------------------------------------------------------
-- customer_link.issue: dono gera código para um cadastro do próprio negócio.
-- ---------------------------------------------------------------------------

create function public.customer_link_issue(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_idem_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_replay jsonb;
  v_token text;
  v_invite public.customer_link_invites;
  v_body jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'customer_link.issue', p_idem_key, p_request_hash);
  if v_replay is not null then
    return v_replay;   -- sem o código: ele não é guardado em texto
  end if;

  perform 1 from public.customers c
  where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null
  for share;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  if exists (select 1 from public.customer_links l
             where l.tenant_id = p_tenant_id and l.customer_id = p_customer_id and l.revoked_at is null) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'customer_id';
  end if;

  -- Um código vivo por cadastro: gerar outro invalida os anteriores.
  update public.customer_link_invites i
  set superseded_at = now()
  where i.tenant_id = p_tenant_id and i.customer_id = p_customer_id
    and i.used_at is null and i.superseded_at is null;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.customer_link_invites (tenant_id, customer_id, token_hash, created_by, expires_at)
  values (p_tenant_id, p_customer_id, app.token_sha256(v_token), v_uid, now() + app.customer_link_ttl())
  returning * into v_invite;

  perform app.audit(p_tenant_id, 'customer_link.issued', 'customer', p_customer_id, null, null,
    jsonb_build_object('invite_id', v_invite.id));

  v_body := jsonb_build_object(
    'invite_id', v_invite.id,
    'customer_id', v_invite.customer_id,
    'expires_at', to_char(v_invite.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'code', null
  );
  perform app.idempotency_complete(p_tenant_id, v_uid, 'customer_link.issue', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body || jsonb_build_object('code', v_token));
end $$;

-- ---------------------------------------------------------------------------
-- customer_link.redeem: cliente autenticado resgata o código (POST; nunca por GET).
-- ---------------------------------------------------------------------------

create function public.customer_link_redeem(
  p_code text,
  p_idem_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.customer_link_invites;
  v_replay jsonb;
  v_link public.customer_links;
  v_tenant public.tenants;
  v_body jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  select * into v_invite from public.customer_link_invites i
  where i.token_hash = app.token_sha256(p_code)
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select * into v_tenant from public.tenants t where t.id = v_invite.tenant_id;
  if v_tenant.status = 'closed' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  v_replay := app.idempotency_claim(v_invite.tenant_id, v_uid, 'customer_link.redeem', p_idem_key, p_request_hash);
  if v_replay is not null then
    -- Repetição só devolve o resultado enquanto o vínculo continuar ativo para este login.
    if app.linked_customer_id(v_invite.tenant_id) is distinct from v_invite.customer_id then
      raise exception using errcode = 'PT403', message = 'FORBIDDEN';
    end if;
    return v_replay;
  end if;

  -- Usado, substituído, vencido ou inexistente respondem igual.
  if v_invite.used_at is not null or v_invite.superseded_at is not null or v_invite.expires_at <= now() then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if app.is_member(v_invite.tenant_id) then
    -- Dono/equipe não se vincula como cliente do próprio negócio por código.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED';
  end if;
  if exists (select 1 from public.customer_links l
             where l.tenant_id = v_invite.tenant_id and l.revoked_at is null
               and (l.user_id = v_uid or l.customer_id = v_invite.customer_id)) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED';
  end if;
  perform 1 from public.customers c
  where c.tenant_id = v_invite.tenant_id and c.id = v_invite.customer_id and c.archived_at is null;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at)
  values (v_invite.tenant_id, v_invite.customer_id, v_uid, 'owner_invite_code', now())
  returning * into v_link;
  update public.customer_link_invites i set used_at = now(), used_by = v_uid where i.id = v_invite.id;

  perform app.audit(v_invite.tenant_id, 'customer_link.verified', 'customer_link', v_link.id, null, null,
    jsonb_build_object('invite_id', v_invite.id, 'method', v_link.verification_method));

  -- Resposta mínima: nada do CRM (nome, telefone, e-mail) do cadastro.
  v_body := jsonb_build_object(
    'link_id', v_link.id,
    'tenant_id', v_link.tenant_id,
    'tenant_name', v_tenant.name,
    'verified_at', to_char(v_link.verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  perform app.idempotency_complete(v_invite.tenant_id, v_uid, 'customer_link.redeem', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- customer_link.revoke: dono desfaz o vínculo, ou o próprio cliente se desvincula.
-- ---------------------------------------------------------------------------

create function public.customer_link_revoke(
  p_tenant_id uuid,
  p_link_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_replay jsonb;
  v_link public.customer_links;
  v_is_owner boolean;
  v_body jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  v_is_owner := app.is_member(p_tenant_id, array['owner']);
  select * into v_link from public.customer_links l
  where l.tenant_id = p_tenant_id and l.id = p_link_id
  for update;
  -- Não-dono só enxerga o próprio vínculo; o resto é indistinguível de inexistente.
  if not found or not (v_is_owner or v_link.user_id = v_uid) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'customer_link.revoke', p_idem_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_link.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_link.revoked_at is null then
    update public.customer_links l set revoked_at = now() where l.id = v_link.id returning * into v_link;
    perform app.audit(p_tenant_id, 'customer_link.revoked', 'customer_link', v_link.id, null, null,
      jsonb_build_object('by', case when v_is_owner then 'owner' else 'customer' end));
  end if;

  v_body := jsonb_build_object(
    'link_id', v_link.id,
    'revoked_at', to_char(v_link.revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'version', v_link.version
  );
  perform app.idempotency_complete(p_tenant_id, v_uid, 'customer_link.revoke', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Leitura do cliente: só os próprios vínculos ativos, com o nome do negócio.
-- ---------------------------------------------------------------------------

create function public.my_customer_links()
returns table (link_id uuid, tenant_id uuid, tenant_name text, verified_at timestamptz, version integer)
language sql stable security definer set search_path = '' as $$
  select l.id, l.tenant_id, t.name, l.verified_at, l.version
  from public.customer_links l
  join public.tenants t on t.id = l.tenant_id
  where l.user_id = (select auth.uid())
    and l.revoked_at is null
    and t.status <> 'closed'
  order by t.name, l.id
  limit 100
$$;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------

alter table public.customer_links enable row level security;
alter table public.customer_link_invites enable row level security;

revoke all on public.customer_links, public.customer_link_invites from anon, authenticated;
grant select on public.customer_links to authenticated;
grant select, insert, update, delete on public.customer_links, public.customer_link_invites to service_role;

create policy customer_links_select on public.customer_links
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_member(tenant_id, array['owner']));
-- customer_link_invites: RLS ligada e nenhuma política para usuários (backend-only).

revoke all on function public.customer_link_issue(uuid, uuid, text, text) from public, anon;
revoke all on function public.customer_link_redeem(text, text, text) from public, anon;
revoke all on function public.customer_link_revoke(uuid, uuid, integer, text, text) from public, anon;
revoke all on function public.my_customer_links() from public, anon;
grant execute on function public.customer_link_issue(uuid, uuid, text, text) to authenticated;
grant execute on function public.customer_link_redeem(text, text, text) to authenticated;
grant execute on function public.customer_link_revoke(uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.my_customer_links() to authenticated;
