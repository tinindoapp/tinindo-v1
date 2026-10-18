-- P09 · Rede: perfil público opt-in e indicações/convites com token opaco.
-- PROPOSTA (ADR-0005): o integrador numera, revisa e inclui em supabase/migrations/.
-- Depende apenas da fundação (20261017120000_foundation.sql).
--
-- Invariantes (docs/02, docs/04):
-- * Perfil público é projeção separada do CRM: só campos da whitelist, publicação opt-in,
--   leitura pública por função que nunca devolve tenant_id, contatos ou dados de clientes.
-- * Convite/indicação usa token aleatório de 256 bits; o banco guarda só o sha256.
--   O token não volta em nenhuma leitura posterior; não há coluna de telefone do indicado.
-- * Inspecionar um convite não o aceita. Aceite (claim) é comando separado, exige login
--   com contato confirmado e é de uso único.
-- * Convite de colega é atribuição de aquisição: não gera avaliação, nota nem ranking.

-- ---------------------------------------------------------------------------
-- Perfil público (um por negócio no piloto)
-- ---------------------------------------------------------------------------

create table public.public_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  category text not null check (category in ('barber', 'hairdresser', 'personal_trainer', 'other')),
  area text not null check (char_length(btrim(area)) between 1 and 80),
  public_fields text[] not null check (
    cardinality(public_fields) between 1 and 6
    and public_fields <@ array['display_name', 'category', 'area', 'bio', 'services_summary', 'booking_link']
  ),
  -- NULL = não publicado (rascunho ou removido pelo profissional).
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id),
  unique (tenant_id, id)
);
comment on table public.public_profiles is
  'Projeção pública opt-in do negócio. Nunca copia dados do CRM. Leitura pública só por network_public_profile.';
create unique index public_profiles_slug on public.public_profiles (slug);
create trigger public_profiles_touch before update on public.public_profiles
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Indicações e convites
-- ---------------------------------------------------------------------------

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('customer_recommends_professional', 'professional_invites_peer')),
  inviter_user_id uuid not null references auth.users (id) on delete cascade,
  -- Negócio de quem convida: obrigatório no convite de colega, ausente na indicação do cliente
  -- (cliente não é membro de tenant; ADR-0003).
  inviter_tenant_id uuid references public.tenants (id) on delete restrict,
  -- Dados mínimos, privados de quem convidou. Sem telefone: nada é enviado ao indicado.
  invitee_name text not null check (char_length(btrim(invitee_name)) between 1 and 120),
  invitee_category text check (invitee_category in ('barber', 'hairdresser', 'personal_trainer', 'other')),
  origin text not null check (origin in ('web', 'profile_page', 'invite_link')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'revoked')),
  expires_at timestamptz not null,
  claimed_by_user_id uuid references auth.users (id) on delete set null,
  claimed_tenant_id uuid references public.tenants (id) on delete set null,
  claimed_at timestamptz,
  -- Idempotência própria: a indicação do cliente não tem tenant, e a resposta original
  -- (com o token) não pode ser guardada em idempotency_records.
  idem_key text not null check (char_length(idem_key) between 16 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (inviter_user_id, idem_key),
  constraint referrals_kind_tenant check (
    (kind = 'professional_invites_peer') = (inviter_tenant_id is not null)
  ),
  constraint referrals_claim_consistent check (
    (status = 'claimed') = (claimed_by_user_id is not null and claimed_at is not null)
  ),
  constraint referrals_no_self_claim check (claimed_by_user_id is distinct from inviter_user_id)
);
comment on table public.referrals is
  'Indicação de cliente (pending, privada) e convite de colega (atribuição). Não é avaliação. Token só em hash.';
comment on column public.referrals.token_hash is 'sha256 hex do token opaco. O token em claro nunca é armazenado.';
create index referrals_inviter on public.referrals (inviter_user_id, created_at desc);
create trigger referrals_touch before update on public.referrals
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- RLS e grants. Escrita só por RPC. Leitura pública só por função com projeção fixa.
-- ---------------------------------------------------------------------------

alter table public.public_profiles enable row level security;
alter table public.referrals enable row level security;
revoke all on public.public_profiles, public.referrals from anon, authenticated;

grant select on public.public_profiles to authenticated;
create policy public_profiles_select_owner on public.public_profiles
  for select to authenticated
  using (app.is_member(tenant_id, array['owner']));

-- Quem convidou lê os próprios convites, sem hash de token nem dados de idempotência.
grant select (id, kind, inviter_user_id, inviter_tenant_id, invitee_name, invitee_category, origin,
              status, expires_at, claimed_at, created_at, updated_at, version)
  on public.referrals to authenticated;
create policy referrals_select_inviter on public.referrals
  for select to authenticated
  using (inviter_user_id = (select auth.uid()));

grant select, insert, update, delete on public.public_profiles, public.referrals to service_role;

-- ---------------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------------

/** Projeção do perfil: somente whitelist. Usada pelas leituras do dono e do público. */
create function app.network_profile_json(p public.public_profiles, p_display_name text)
returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', p.slug,
    'category', p.category,
    'area', p.area,
    'public_fields', to_jsonb(p.public_fields),
    -- Valores vêm de dados que o próprio negócio já declarou públicos; bio e resumo de
    -- serviços dependem de proposta de contrato (ver NOTAS.md) e ainda não têm fonte.
    'values', jsonb_strip_nulls(jsonb_build_object(
      'display_name', case when 'display_name' = any (p.public_fields) then p_display_name end
    )),
    'published_at', p.published_at,
    -- Reputação começa vazia e só muda por mecanismos verificáveis futuros, nunca por convite.
    'reputation', jsonb_build_object('identity_verified', false, 'reviews_count', 0),
    'version', p.version
  )
$$;
revoke all on function app.network_profile_json(public.public_profiles, text) from public;

/** Token opaco base64url (256 bits) e seu hash. */
create function app.network_new_token(out token text, out token_hash text)
language plpgsql volatile set search_path = '' as $$
begin
  token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  token_hash := encode(extensions.digest(token, 'sha256'), 'hex');
end $$;
revoke all on function app.network_new_token() from public;

create function app.network_token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select case when p_token ~ '^[A-Za-z0-9_-]{43}$'
    then encode(extensions.digest(p_token, 'sha256'), 'hex') end
$$;
revoke all on function app.network_token_hash(text) from public;

-- ---------------------------------------------------------------------------
-- profile.publish / profile.unpublish / leitura do dono
-- ---------------------------------------------------------------------------

create function public.network_profile_publish(
  p_tenant_id uuid,
  p_slug text,
  p_category text,
  p_area text,
  p_public_fields text[],
  p_idem_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_before public.public_profiles;
  v_row public.public_profiles;
  v_name text;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, auth.uid(), 'profile.publish', p_idem_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  if exists (select 1 from public.public_profiles p where p.slug = p_slug and p.tenant_id <> p_tenant_id) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'endereço já usado por outro perfil', hint = 'slug';
  end if;

  select * into v_before from public.public_profiles p where p.tenant_id = p_tenant_id for update;
  select t.name into v_name from public.tenants t where t.id = p_tenant_id;

  begin
    insert into public.public_profiles as p (tenant_id, slug, category, area, public_fields, published_at)
    values (p_tenant_id, p_slug, p_category, btrim(p_area),
            array(select distinct f from unnest(p_public_fields) f order by f), now())
    on conflict (tenant_id) do update
      set slug = excluded.slug, category = excluded.category, area = excluded.area,
          public_fields = excluded.public_fields, published_at = excluded.published_at
    returning * into v_row;
  exception when unique_violation then
    -- Corrida pelo mesmo slug entre dois negócios: mesma resposta da checagem acima.
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'endereço já usado por outro perfil', hint = 'slug';
  end;

  v_body := app.network_profile_json(v_row, v_name);
  perform app.audit(p_tenant_id, 'profile.publish', 'public_profile', v_row.id, null,
    case when v_before.id is null then null
      else jsonb_build_object('slug', v_before.slug, 'public_fields', to_jsonb(v_before.public_fields),
                              'published', v_before.published_at is not null) end,
    jsonb_build_object('slug', v_row.slug, 'public_fields', to_jsonb(v_row.public_fields), 'published', true));
  perform app.idempotency_complete(p_tenant_id, auth.uid(), 'profile.publish', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Remoção pelo profissional (docs/04: remoção deve existir desde o piloto). */
create function public.network_profile_unpublish(p_tenant_id uuid, p_idem_key text, p_request_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_row public.public_profiles;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, auth.uid(), 'profile.unpublish', p_idem_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  update public.public_profiles p set published_at = null
  where p.tenant_id = p_tenant_id
  returning * into v_row;
  if v_row.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  v_body := jsonb_build_object('slug', v_row.slug, 'published', false);
  perform app.audit(p_tenant_id, 'profile.unpublish', 'public_profile', v_row.id, null,
    null, jsonb_build_object('published', false));
  perform app.idempotency_complete(p_tenant_id, auth.uid(), 'profile.unpublish', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Perfil do próprio negócio (rascunho ou publicado). NULL se ainda não existe. */
create function public.network_profile_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.public_profiles;
  v_name text;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select * into v_row from public.public_profiles p where p.tenant_id = p_tenant_id;
  if v_row.id is null then
    return null;
  end if;
  select t.name into v_name from public.tenants t where t.id = p_tenant_id;
  return app.network_profile_json(v_row, v_name);
end $$;

/**
 * Leitura pública por slug. Só perfis publicados de negócios ativos. Nunca devolve
 * tenant_id, contatos, clientes, custos ou agenda. Inexistente e não publicado: mesmo 404.
 */
create function public.network_public_profile(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.public_profiles;
  v_name text;
  v_body jsonb;
begin
  select p.* into v_row
  from public.public_profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.slug = p_slug and p.published_at is not null and t.status = 'active';
  if v_row.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select t.name into v_name from public.tenants t where t.id = v_row.tenant_id;
  v_body := app.network_profile_json(v_row, v_name);
  return v_body - 'version';
end $$;

-- ---------------------------------------------------------------------------
-- referral.create / inspect / claim / list
-- ---------------------------------------------------------------------------

create function public.network_referral_create(
  p_kind text,
  p_tenant_id uuid,
  p_invitee_name text,
  p_invitee_category text,
  p_origin text,
  p_idem_key text,
  p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.referrals;
  v_token record;
  v_row public.referrals;
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  if p_kind = 'professional_invites_peer' then
    if p_tenant_id is null or not app.is_member(p_tenant_id, array['owner']) then
      raise exception using errcode = 'PT403', message = 'FORBIDDEN';
    end if;
  elsif p_kind = 'customer_recommends_professional' then
    if p_tenant_id is not null then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'tenant_id';
    end if;
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
  end if;

  select * into v_existing from public.referrals r
  where r.inviter_user_id = v_uid and r.idem_key = p_idem_key
  for update;
  v_token := app.network_new_token();

  if v_existing.id is not null then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_MISMATCH';
    end if;
    if v_existing.status <> 'pending' or v_existing.expires_at <= now() then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED',
        detail = 'convite já usado ou vencido';
    end if;
    -- Repetição: mesmo convite, link renovado. O token anterior deixa de valer, então
    -- uma resposta perdida nunca deixa dois links ativos para a mesma indicação.
    update public.referrals r set token_hash = v_token.token_hash
    where r.id = v_existing.id returning * into v_row;
  else
    if (select count(*) from public.referrals r
        where r.inviter_user_id = v_uid and r.created_at > now() - interval '24 hours') >= 20 then
      raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED';
    end if;
    insert into public.referrals (kind, inviter_user_id, inviter_tenant_id, invitee_name, invitee_category,
                                  origin, token_hash, expires_at, idem_key, request_hash)
    values (p_kind, v_uid, p_tenant_id, btrim(p_invitee_name), p_invitee_category,
            p_origin, v_token.token_hash, now() + interval '14 days', p_idem_key, p_request_hash)
    returning * into v_row;
    perform app.audit(p_tenant_id, 'referral.create', 'referral', v_row.id, null, null,
      jsonb_build_object('kind', v_row.kind, 'origin', v_row.origin));
  end if;

  return jsonb_build_object('referral_id', v_row.id, 'token', v_token.token, 'expires_at', v_row.expires_at);
end $$;

/**
 * Detalhes mínimos para a página do convite. Não aceita, não altera nada e não devolve
 * nome do indicado nem dados de quem convidou além do perfil público, se publicado.
 */
create function public.network_referral_inspect(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.referrals;
  v_slug text;
begin
  select * into v_row from public.referrals r where r.token_hash = app.network_token_hash(p_token);
  if v_row.id is null or v_row.status = 'revoked' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_row.inviter_tenant_id is not null then
    select p.slug into v_slug from public.public_profiles p
    join public.tenants t on t.id = p.tenant_id
    where p.tenant_id = v_row.inviter_tenant_id and p.published_at is not null and t.status = 'active';
  end if;
  return jsonb_build_object(
    'kind', v_row.kind,
    'invitee_category', v_row.invitee_category,
    'state', case
      when v_row.status = 'claimed' then 'used'
      when v_row.expires_at <= now() then 'expired'
      else 'open' end,
    'expires_at', v_row.expires_at,
    'inviter_profile_slug', v_slug
  );
end $$;

/**
 * Aceite do convite: login com contato confirmado (e-mail ou telefone verificado pelo Auth),
 * uso único, sem autoconvite. Repetir pelo mesmo usuário devolve o mesmo resultado.
 */
create function public.network_referral_claim(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.referrals;
  v_user jsonb;
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  select * into v_row from public.referrals r
  where r.token_hash = app.network_token_hash(p_token)
  for update;
  if v_row.id is null or v_row.status = 'revoked' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  if v_row.status = 'claimed' then
    if v_row.claimed_by_user_id = v_uid then
      return jsonb_build_object('referral_id', v_row.id, 'kind', v_row.kind, 'state', 'claimed');
    end if;
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', detail = 'convite já usado';
  end if;
  if v_row.expires_at <= now() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', detail = 'convite vencido';
  end if;

  -- Comprovação de controle do contato (docs/04): confirmado pelo Auth, não declarado.
  select to_jsonb(u) into v_user from auth.users u where u.id = v_uid;
  if v_user is null
     or coalesce(v_user ->> 'email_confirmed_at', v_user ->> 'phone_confirmed_at') is null then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', hint = 'contact';
  end if;

  -- Sem autoconvite: quem convidou ou membro do negócio que convidou não aceita.
  if v_row.inviter_user_id = v_uid
     or (v_row.inviter_tenant_id is not null and exists (
       select 1 from public.tenant_memberships m
       where m.tenant_id = v_row.inviter_tenant_id and m.user_id = v_uid)) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', detail = 'autoconvite';
  end if;

  -- Atribuição ao negócio do aceitante, se ele já é dono de exatamente um.
  select min(m.tenant_id::text)::uuid into v_tenant
  from public.tenant_memberships m
  where m.user_id = v_uid and m.role = 'owner' and m.active
  having count(*) = 1;

  update public.referrals r
  set status = 'claimed', claimed_by_user_id = v_uid, claimed_at = now(), claimed_tenant_id = v_tenant
  where r.id = v_row.id;

  perform app.audit(v_row.inviter_tenant_id, 'referral.claim', 'referral', v_row.id, null, null,
    jsonb_build_object('kind', v_row.kind, 'state', 'claimed'));
  return jsonb_build_object('referral_id', v_row.id, 'kind', v_row.kind, 'state', 'claimed');
end $$;

/** Convites e indicações feitos pelo próprio usuário (máx. 50, mais recentes). */
create function public.network_referral_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select r.id as referral_id, r.kind, r.invitee_name, r.invitee_category, r.created_at, r.expires_at,
             case when r.status = 'claimed' then 'claimed'
                  when r.status = 'revoked' then 'revoked'
                  when r.expires_at <= now() then 'expired'
                  else 'pending' end as state
      from public.referrals r
      where r.inviter_user_id = v_uid
      order by r.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.network_profile_publish(uuid, text, text, text, text[], text, text) from public, anon;
revoke all on function public.network_profile_unpublish(uuid, text, text) from public, anon;
revoke all on function public.network_profile_get(uuid) from public, anon;
revoke all on function public.network_public_profile(text) from public;
revoke all on function public.network_referral_create(text, uuid, text, text, text, text, text) from public, anon;
revoke all on function public.network_referral_inspect(text) from public;
revoke all on function public.network_referral_claim(text) from public, anon;
revoke all on function public.network_referral_list() from public, anon;

grant execute on function public.network_profile_publish(uuid, text, text, text, text[], text, text) to authenticated;
grant execute on function public.network_profile_unpublish(uuid, text, text) to authenticated;
grant execute on function public.network_profile_get(uuid) to authenticated;
grant execute on function public.network_public_profile(text) to anon, authenticated;
grant execute on function public.network_referral_create(text, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.network_referral_inspect(text) to anon, authenticated;
grant execute on function public.network_referral_claim(text) to authenticated;
grant execute on function public.network_referral_list() to authenticated;
