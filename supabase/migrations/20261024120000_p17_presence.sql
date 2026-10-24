-- P17 · Presença digital: site padronizado do negócio, domínio do cliente e operação do Perfil da Empresa no Google por
-- acesso delegado, com registro de entregas. Ver ADR-0025.
-- Invariantes (tasks/P17, docs/17):
-- * O site é projeção de dados que o negócio já declarou públicos (perfil P09 publicado + serviços que o dono marcar).
--   Nunca lê CRM, agenda de clientes, custos ou pisos de preço.
-- * Publicar é aprovação do dono vinculada ao hash do conteúdo visto (prévia). Mudou desde a prévia → 409, nada sai.
--   Cada publicação é uma versão append-only; tirar do ar e voltar a uma versão anterior são reversíveis e registrados.
-- * Domínio é do cliente: a Tinindo não compra nem registra domínio. Só vale depois de verificado por DNS (TXT com
--   token aleatório), observado pelo backend; um nome verificado pertence a um negócio só.
-- * Google: acesso de gerente concedido pelo dono, revogável a qualquer momento; sem acesso ativo nenhuma entrega no
--   Google é registrada. A Tinindo nunca é proprietária do perfil do cliente.
-- * Entrega tem evidência (hash da versão, registro DNS observado, link público). Nenhuma garantia de posição ou ranking.
-- Depende de: fundação, P02 (provider_services), P03 (availability_rules), P09 (public_profiles), P15 (operadores, pedidos).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.presence_sites (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  headline text check (char_length(btrim(headline)) between 1 and 90),
  sections text[] not null default array['services', 'booking'] check (
    cardinality(sections) <= 4 and sections <@ array['services', 'prices', 'hours', 'booking']
  ),
  theme text not null default 'papel' check (theme in ('papel', 'tinta')),
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  published_version_no integer,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint presence_sites_published check ((status = 'published') = (published_version_no is not null))
);
comment on table public.presence_sites is 'Rascunho e estado do site do negócio. O conteúdo publicado é a versão apontada (presence_site_versions).';
create trigger presence_sites_touch before update on public.presence_sites for each row execute function app.touch_row();

create table public.presence_site_services (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  position smallint not null default 0 check (position between 0 and 50),
  primary key (tenant_id, service_id),
  constraint presence_site_services_service foreign key (tenant_id, service_id) references public.provider_services (tenant_id, id) on delete restrict
);
comment on table public.presence_site_services is 'Serviços que o dono escolheu mostrar no site (nome e duração; preço só se a seção "prices" estiver ligada).';

create table public.presence_site_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid not null,
  approved_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, version_no),
  unique (tenant_id, id)
);
comment on table public.presence_site_versions is 'Conteúdo aprovado pelo dono, congelado com hash. Append-only.';
create trigger presence_site_versions_append_only before update or delete on public.presence_site_versions for each row execute function app.forbid_mutation();

create table public.presence_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  hostname text not null check (
    char_length(hostname) between 4 and 253
    and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  -- Valor público do registro TXT (não é segredo: prova controle do DNS, não dá acesso a nada).
  verify_token text not null check (verify_token ~ '^[0-9a-f]{32}$'),
  status text not null default 'pending' check (status in ('pending', 'verified', 'removed')),
  last_check_at timestamptz,
  last_check_result text check (last_check_result in ('found', 'not_found', 'taken', 'lookup_failed')),
  verified_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id),
  constraint presence_domains_verified check ((status = 'verified') = (verified_at is not null))
);
comment on table public.presence_domains is 'Domínio do cliente ligado ao site. Só vale verificado por DNS. A Tinindo não compra nem registra domínios.';
create unique index presence_domains_one_active on public.presence_domains (tenant_id) where status <> 'removed';
create unique index presence_domains_verified_host on public.presence_domains (hostname) where status = 'verified';
create trigger presence_domains_touch before update on public.presence_domains for each row execute function app.touch_row();

create table public.presence_domain_checks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  domain_id uuid not null,
  result text not null check (result in ('found', 'not_found', 'taken', 'lookup_failed')),
  -- Valores TXT observados no nome de verificação (públicos; no máximo 10, truncados).
  observed text[] not null default '{}' check (cardinality(observed) <= 10),
  checked_at timestamptz not null default clock_timestamp(),
  constraint presence_domain_checks_domain foreign key (tenant_id, domain_id) references public.presence_domains (tenant_id, id) on delete restrict
);
comment on table public.presence_domain_checks is 'Cada consulta DNS feita pelo backend e o que foi observado. Append-only.';
create index presence_domain_checks_domain on public.presence_domain_checks (domain_id, checked_at desc);
create trigger presence_domain_checks_append_only before update or delete on public.presence_domain_checks for each row execute function app.forbid_mutation();

create table public.presence_google_access (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  status text not null default 'not_connected' check (status in ('not_connected', 'granted', 'revoked')),
  -- Nome público do perfil e link público no Maps, declarados pelo dono. Nenhuma credencial é guardada aqui.
  profile_name text check (char_length(btrim(profile_name)) between 1 and 120),
  profile_url text check (char_length(profile_url) <= 300),
  access_level text not null default 'manager' check (access_level = 'manager'),
  granted_by uuid,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint presence_google_granted check (status <> 'granted' or (granted_at is not null and profile_name is not null))
);
comment on table public.presence_google_access is 'Acesso de gerente ao Perfil da Empresa no Google concedido pelo dono. Revogável. A Tinindo nunca é proprietária.';
create trigger presence_google_access_touch before update on public.presence_google_access for each row execute function app.touch_row();

create table public.presence_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  kind text not null check (kind in (
    'site_published', 'site_unpublished', 'site_restored', 'domain_verified', 'domain_removed',
    'google_access_granted', 'google_access_revoked', 'google_profile_update', 'google_post', 'google_review_reply'
  )),
  summary text not null check (char_length(btrim(summary)) between 1 and 280),
  -- Evidência verificável: hash da versão, registro observado, link público. Nunca dado de cliente.
  evidence jsonb not null default '{}' check (jsonb_typeof(evidence) = 'object'),
  service_order_id uuid,
  actor text not null check (actor in ('owner', 'operator', 'system')),
  actor_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  constraint presence_deliveries_order foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete restrict
);
comment on table public.presence_deliveries is 'Registro das entregas de presença digital com evidência. Append-only. Sem garantia de posição.';
create index presence_deliveries_tenant on public.presence_deliveries (tenant_id, created_at desc);
create trigger presence_deliveries_append_only before update or delete on public.presence_deliveries for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras e funções internas
-- ---------------------------------------------------------------------------

/** Regras num só lugar (a tela mostra; mudar é migration). */
create function app.prs_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('txt_name_prefix', '_tinindo-verify', 'txt_value_prefix', 'tinindo-verify=', 'check_cooldown_seconds', 20,
    'max_services', 30, 'headline_max', 90)
$$;

create function app.prs_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/**
 * Conteúdo do site montado só de fontes públicas: perfil P09 publicado (campos escolhidos), título do dono, serviços
 * marcados (preço só com a seção "prices"), expediente (seção "hours") e link de agendamento (seção "booking", só se o
 * perfil publica o campo booking_link). Determinístico: o hash identifica exatamente o que o dono viu.
 * Sem perfil publicado devolve null (o site depende do escopo do P09).
 */
create function app.prs_snapshot(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.presence_sites;
  p public.public_profiles;
  v_t public.tenants;
begin
  select * into p from public.public_profiles x where x.tenant_id = p_tenant_id;
  if not found or p.published_at is null then return null; end if;
  select * into s from public.presence_sites x where x.tenant_id = p_tenant_id;
  if not found then
    s.sections := array['services', 'booking'];
    s.theme := 'papel';
  end if;
  select * into v_t from public.tenants x where x.id = p_tenant_id;
  return jsonb_build_object(
    'slug', p.slug,
    'display_name', case when 'display_name' = any (p.public_fields) then v_t.name end,
    'category', p.category,
    'area', p.area,
    'bio', case when 'bio' = any (p.public_fields) then (select c.body from public.profile_contents c where c.tenant_id = p_tenant_id) end,
    'headline', s.headline,
    'theme', s.theme,
    'sections', to_jsonb(s.sections),
    'services', case when 'services' = any (s.sections) then coalesce((
      select jsonb_agg(jsonb_build_object('name', ps.name, 'duration_min', ps.duration_min,
          'price_cents', case when 'prices' = any (s.sections) then ps.base_price_cents end) order by ss.position, ps.name)
      from public.presence_site_services ss join public.provider_services ps on ps.tenant_id = ss.tenant_id and ps.id = ss.service_id
      where ss.tenant_id = p_tenant_id and ps.active), '[]'::jsonb) else '[]'::jsonb end,
    'hours', case when 'hours' = any (s.sections) then coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'start', to_char(h.local_start, 'HH24:MI'), 'end', to_char(h.local_end, 'HH24:MI'))
        order by h.weekday, h.local_start, h.local_end)
      from (select distinct r.weekday, r.local_start, r.local_end from public.availability_rules r where r.tenant_id = p_tenant_id) h), '[]'::jsonb) else '[]'::jsonb end,
    'booking_path', case when 'booking' = any (s.sections) and 'booking_link' = any (p.public_fields) then '/p/' || p.slug end,
    'timezone', v_t.timezone
  );
end $$;

create function app.prs_hash(p_snapshot jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_snapshot::text, 'sha256'), 'hex')
$$;

create function app.prs_delivery(p_tenant_id uuid, p_kind text, p_summary text, p_evidence jsonb, p_actor text, p_order uuid default null) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.presence_deliveries (tenant_id, kind, summary, evidence, actor, actor_user_id, service_order_id)
  values (p_tenant_id, p_kind, p_summary, coalesce(p_evidence, '{}'::jsonb), p_actor, auth.uid(), p_order)
  returning id
$$;

create function app.prs_domain_json(d public.presence_domains) returns jsonb
language sql stable set search_path = '' as $$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'hostname', d.hostname, 'status', d.status,
    'txt_name', (app.prs_rules()->>'txt_name_prefix') || '.' || d.hostname,
    'txt_value', (app.prs_rules()->>'txt_value_prefix') || d.verify_token,
    'last_check_at', app.fin_ts(d.last_check_at), 'last_check_result', d.last_check_result,
    'verified_at', app.fin_ts(d.verified_at), 'created_at', app.fin_ts(d.created_at), 'version', d.version) end
$$;

create function app.prs_google_json(g public.presence_google_access) returns jsonb
language sql stable set search_path = '' as $$
  select case when g.tenant_id is null then jsonb_build_object('status', 'not_connected', 'profile_name', null, 'profile_url', null,
      'access_level', 'manager', 'granted_at', null, 'revoked_at', null, 'version', 0)
    else jsonb_build_object('status', g.status, 'profile_name', g.profile_name, 'profile_url', g.profile_url, 'access_level', g.access_level,
      'granted_at', app.fin_ts(g.granted_at), 'revoked_at', app.fin_ts(g.revoked_at), 'version', g.version) end
$$;

/** Visão completa do dono: rascunho, prévia com hash, versão publicada, histórico, domínio, Google e entregas. */
create function app.prs_overview(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.presence_sites;
  p public.public_profiles;
  d public.presence_domains;
  g public.presence_google_access;
  v_preview jsonb := app.prs_snapshot(p_tenant_id);
  pv public.presence_site_versions;
begin
  select * into s from public.presence_sites x where x.tenant_id = p_tenant_id;
  select * into p from public.public_profiles x where x.tenant_id = p_tenant_id;
  select * into d from public.presence_domains x where x.tenant_id = p_tenant_id and x.status <> 'removed';
  select * into g from public.presence_google_access x where x.tenant_id = p_tenant_id;
  if s.status = 'published' then
    select * into pv from public.presence_site_versions x where x.tenant_id = p_tenant_id and x.version_no = s.published_version_no;
  end if;
  return jsonb_build_object(
    'rules', app.prs_rules(),
    'profile', jsonb_build_object('exists', p.id is not null, 'published', p.published_at is not null, 'slug', p.slug,
      'public_fields', coalesce(to_jsonb(p.public_fields), '[]'::jsonb)),
    'site', jsonb_build_object(
      'headline', s.headline,
      'sections', coalesce(to_jsonb(s.sections), '["services","booking"]'::jsonb),
      'theme', coalesce(s.theme, 'papel'),
      'status', coalesce(s.status, 'draft'),
      'service_ids', coalesce((select jsonb_agg(ss.service_id order by ss.position, ss.service_id) from public.presence_site_services ss where ss.tenant_id = p_tenant_id), '[]'::jsonb),
      'version', coalesce(s.version, 0)),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('id', ps.id, 'name', ps.name, 'duration_min', ps.duration_min,
        'base_price_cents', ps.base_price_cents, 'active', ps.active) order by ps.name)
      from public.provider_services ps where ps.tenant_id = p_tenant_id and ps.active), '[]'::jsonb),
    'preview', v_preview,
    'preview_hash', case when v_preview is null then null else app.prs_hash(v_preview) end,
    'published', case when pv.id is null then null else jsonb_build_object('version_no', pv.version_no, 'snapshot', pv.snapshot,
      'snapshot_hash', pv.snapshot_hash, 'approved_at', app.fin_ts(pv.approved_at), 'published_at', app.fin_ts(s.published_at)) end,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version_no', v.version_no, 'snapshot_hash', v.snapshot_hash, 'approved_at', app.fin_ts(v.approved_at))
        order by v.version_no desc)
      from (select * from public.presence_site_versions x where x.tenant_id = p_tenant_id order by x.version_no desc limit 20) v), '[]'::jsonb),
    'domain', app.prs_domain_json(d),
    'google', app.prs_google_json(g),
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'summary', e.summary, 'evidence', e.evidence,
        'actor', e.actor, 'service_order_id', e.service_order_id, 'created_at', app.fin_ts(e.created_at)) order by e.created_at desc, e.id)
      from (select * from public.presence_deliveries x where x.tenant_id = p_tenant_id order by x.created_at desc limit 50) e), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Dono: site
-- ---------------------------------------------------------------------------

create function public.presence_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.prs_owner(p_tenant_id);
  return app.prs_overview(p_tenant_id);
end $$;

create function public.presence_site_save(
  p_tenant_id uuid,
  p_expected_version integer,
  p_headline text,
  p_sections text[],
  p_theme text,
  p_service_ids uuid[],
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  s public.presence_sites;
  v_ids uuid[] := coalesce(p_service_ids, '{}');
  v_body jsonb;
  i integer;
begin
  perform app.prs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'site.save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if cardinality(v_ids) > (app.prs_rules()->>'max_services')::integer then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'service_ids';
  end if;
  if exists (select 1 from unnest(v_ids) u(id) where not exists (
      select 1 from public.provider_services ps where ps.tenant_id = p_tenant_id and ps.id = u.id and ps.active)) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'service_ids';
  end if;
  if p_theme not in ('papel', 'tinta') then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'theme'; end if;
  -- Versão 0 = ainda sem rascunho salvo.
  select * into s from public.presence_sites x where x.tenant_id = p_tenant_id for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    insert into public.presence_sites (tenant_id, headline, sections, theme)
    values (p_tenant_id, nullif(btrim(p_headline), ''), coalesce(p_sections, '{}'), p_theme) returning * into s;
  else
    if s.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    update public.presence_sites x set headline = nullif(btrim(p_headline), ''), sections = coalesce(p_sections, '{}'), theme = p_theme, version = x.version + 1
    where x.tenant_id = p_tenant_id returning * into s;
  end if;
  delete from public.presence_site_services x where x.tenant_id = p_tenant_id;
  for i in 1 .. cardinality(v_ids) loop
    insert into public.presence_site_services (tenant_id, service_id, position) values (p_tenant_id, v_ids[i], i - 1) on conflict do nothing;
  end loop;
  perform app.audit(p_tenant_id, 'presence.site.save', 'presence_site', p_tenant_id, p_request_id, null,
    jsonb_build_object('sections', to_jsonb(s.sections), 'theme', s.theme, 'services', cardinality(v_ids), 'version', s.version));
  v_body := app.prs_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'site.save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.presence_site_publish(
  p_tenant_id uuid,
  p_expected_hash text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_snap jsonb;
  v_hash text;
  v_no integer;
  s public.presence_sites;
  v_body jsonb;
begin
  perform app.prs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'site.publish', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  insert into public.presence_sites (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  select * into s from public.presence_sites x where x.tenant_id = p_tenant_id for update;
  v_snap := app.prs_snapshot(p_tenant_id);
  if v_snap is null then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'profile'; end if;
  v_hash := app.prs_hash(v_snap);
  -- Aprovação vinculada ao que o dono viu: qualquer mudança desde a prévia invalida a aprovação.
  if v_hash <> p_expected_hash then raise exception using errcode = 'PT409', message = 'STALE_VERSION', hint = 'preview'; end if;
  -- Mesmo conteúdo já no ar (ex.: dois cliques em paralelo com chaves diferentes): nada de versão duplicada.
  if s.status = 'published' and exists (select 1 from public.presence_site_versions v where v.tenant_id = p_tenant_id
      and v.version_no = s.published_version_no and v.snapshot_hash = v_hash) then
    v_body := app.prs_overview(p_tenant_id);
    perform app.idempotency_complete(p_tenant_id, v_uid, 'site.publish', p_idem_key, 200, v_body);
    return jsonb_build_object('status_code', 200, 'body', v_body);
  end if;
  select coalesce(max(v.version_no), 0) + 1 into v_no from public.presence_site_versions v where v.tenant_id = p_tenant_id;
  insert into public.presence_site_versions (tenant_id, version_no, snapshot, snapshot_hash, approved_by)
  values (p_tenant_id, v_no, v_snap, v_hash, v_uid);
  update public.presence_sites x set status = 'published', published_version_no = v_no, published_at = clock_timestamp(), version = x.version + 1
  where x.tenant_id = p_tenant_id returning * into s;
  perform app.prs_delivery(p_tenant_id, 'site_published', 'Site publicado (versão ' || v_no || ').',
    jsonb_build_object('version_no', v_no, 'snapshot_hash', v_hash, 'path', '/s/' || (v_snap->>'slug')), 'owner');
  perform app.audit(p_tenant_id, 'presence.site.publish', 'presence_site', p_tenant_id, p_request_id, null, jsonb_build_object('version_no', v_no, 'snapshot_hash', v_hash));
  perform app.emit_event(p_tenant_id, 'presence.site.published.v1', p_tenant_id, s.version, coalesce(p_request_id, gen_random_uuid()),
    jsonb_build_object('version_no', v_no, 'snapshot_hash', v_hash));
  v_body := app.prs_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'site.publish', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.presence_site_unpublish(
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
  s public.presence_sites;
  v_no integer;
  v_body jsonb;
begin
  perform app.prs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'site.unpublish', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into s from public.presence_sites x where x.tenant_id = p_tenant_id for update;
  if not found or s.status <> 'published' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status'; end if;
  if s.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  v_no := s.published_version_no;
  update public.presence_sites x set status = 'unpublished', published_version_no = null, version = x.version + 1 where x.tenant_id = p_tenant_id;
  perform app.prs_delivery(p_tenant_id, 'site_unpublished', 'Site tirado do ar (estava na versão ' || v_no || ').', jsonb_build_object('version_no', v_no), 'owner');
  perform app.audit(p_tenant_id, 'presence.site.unpublish', 'presence_site', p_tenant_id, p_request_id, null, jsonb_build_object('version_no', v_no));
  v_body := app.prs_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'site.unpublish', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.presence_site_restore(
  p_tenant_id uuid,
  p_version_no integer,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  s public.presence_sites;
  pv public.presence_site_versions;
  v_body jsonb;
begin
  perform app.prs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'site.restore', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into s from public.presence_sites x where x.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if s.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  select * into pv from public.presence_site_versions x where x.tenant_id = p_tenant_id and x.version_no = p_version_no;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'version_no'; end if;
  -- Voltar exige o perfil ainda publicado: o site nunca fica no ar com o escopo do P09 retirado.
  if not exists (select 1 from public.public_profiles p where p.tenant_id = p_tenant_id and p.published_at is not null) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'profile';
  end if;
  update public.presence_sites x set status = 'published', published_version_no = pv.version_no, published_at = clock_timestamp(), version = x.version + 1
  where x.tenant_id = p_tenant_id;
  perform app.prs_delivery(p_tenant_id, 'site_restored', 'Site no ar de novo com a versão ' || pv.version_no || '.',
    jsonb_build_object('version_no', pv.version_no, 'snapshot_hash', pv.snapshot_hash), 'owner');
  perform app.audit(p_tenant_id, 'presence.site.restore', 'presence_site', p_tenant_id, p_request_id, null, jsonb_build_object('version_no', pv.version_no));
  v_body := app.prs_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'site.restore', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: domínio
-- ---------------------------------------------------------------------------

create function public.presence_domain_add(
  p_tenant_id uuid,
  p_hostname text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_host text := lower(btrim(p_hostname));
  d public.presence_domains;
  v_body jsonb;
begin
  perform app.prs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'domain.add', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if v_host is null or char_length(v_host) not between 4 and 253 or v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'hostname';
  end if;
  -- Domínio é do cliente: nomes da própria Tinindo ou de teste não entram.
  if v_host ~ '(^|\.)tinindo\.' or v_host ~ '\.(test|example|invalid|localhost|local)$' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'hostname';
  end if;
  if exists (select 1 from public.presence_domains x where x.tenant_id = p_tenant_id and x.status <> 'removed') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'domain';
  end if;
  if exists (select 1 from public.presence_domains x where x.hostname = v_host and x.status = 'verified') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'hostname_taken';
  end if;
  insert into public.presence_domains (tenant_id, hostname, verify_token)
  values (p_tenant_id, v_host, encode(extensions.gen_random_bytes(16), 'hex')) returning * into d;
  perform app.audit(p_tenant_id, 'presence.domain.add', 'presence_domain', d.id, p_request_id, null, jsonb_build_object('hostname', d.hostname));
  v_body := app.prs_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'domain.add', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.presence_domain_remove(
  p_tenant_id uuid,
  p_domain_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  d public.presence_domains;
  v_body jsonb;
begin
  perform app.prs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'domain.remove', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into d from public.presence_domains x where x.tenant_id = p_tenant_id and x.id = p_domain_id for update;
  if not found or d.status = 'removed' then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if d.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  update public.presence_domains x set status = 'removed', removed_at = clock_timestamp(), verified_at = null where x.id = d.id;
  if d.status = 'verified' then
    perform app.prs_delivery(p_tenant_id, 'domain_removed', 'Domínio ' || d.hostname || ' desligado do site.', jsonb_build_object('hostname', d.hostname), 'owner');
  end if;
  perform app.audit(p_tenant_id, 'presence.domain.remove', 'presence_domain', d.id, p_request_id, null, jsonb_build_object('hostname', d.hostname, 'was', d.status));
  v_body := app.prs_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'domain.remove', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Dono pede a verificação: autoriza e devolve o que a função consulta no DNS (nome e valor esperados). */
create function public.presence_domain_check_target(p_tenant_id uuid, p_domain_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d public.presence_domains;
begin
  perform app.prs_owner(p_tenant_id);
  select * into d from public.presence_domains x where x.tenant_id = p_tenant_id and x.id = p_domain_id and x.status <> 'removed';
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if d.last_check_at is not null and d.last_check_at > clock_timestamp() - make_interval(secs => (app.prs_rules()->>'check_cooldown_seconds')::integer) then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'cooldown';
  end if;
  return jsonb_build_object('domain_id', d.id, 'txt_name', (app.prs_rules()->>'txt_name_prefix') || '.' || d.hostname);
end $$;

/**
 * Backend (service_role): grava o que a função observou no DNS e decide aqui, comparando com o token guardado.
 * Achou o valor → verificado (se outro negócio já verificou o mesmo nome, fica "taken"). Idempotente por estado.
 */
create function public.presence_domain_record_check(p_domain_id uuid, p_observed text[], p_lookup_failed boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.presence_domains;
  v_expected text;
  v_result text;
  v_obs text[] := (select coalesce(array_agg(left(o, 200)), '{}') from (select o from unnest(coalesce(p_observed, '{}')) o limit 10) x);
begin
  select * into d from public.presence_domains x where x.id = p_domain_id for update;
  if not found or d.status = 'removed' then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  v_expected := (app.prs_rules()->>'txt_value_prefix') || d.verify_token;
  if d.status = 'verified' then
    v_result := case when v_expected = any (v_obs) then 'found' when p_lookup_failed then 'lookup_failed' else 'not_found' end;
  elsif p_lookup_failed then
    v_result := 'lookup_failed';
  elsif v_expected = any (v_obs) then
    if exists (select 1 from public.presence_domains x where x.hostname = d.hostname and x.status = 'verified' and x.id <> d.id) then
      v_result := 'taken';
    else
      begin
        update public.presence_domains x set status = 'verified', verified_at = clock_timestamp() where x.id = d.id;
        v_result := 'found';
      exception when unique_violation then
        -- Outro negócio verificou o mesmo nome no mesmo instante: o índice único decide, este fica "taken".
        v_result := 'taken';
      end;
    end if;
    if v_result = 'found' then
      perform app.prs_delivery(d.tenant_id, 'domain_verified', 'Domínio ' || d.hostname || ' verificado por DNS.',
        jsonb_build_object('hostname', d.hostname, 'txt_name', (app.prs_rules()->>'txt_name_prefix') || '.' || d.hostname, 'txt_value', v_expected), 'system');
      perform app.audit(d.tenant_id, 'presence.domain.verify', 'presence_domain', d.id, null, null, jsonb_build_object('hostname', d.hostname));
      perform app.emit_event(d.tenant_id, 'presence.domain.verified.v1', d.id, d.version + 1, gen_random_uuid(), jsonb_build_object('hostname', d.hostname));
    end if;
  else
    v_result := 'not_found';
  end if;
  insert into public.presence_domain_checks (tenant_id, domain_id, result, observed) values (d.tenant_id, d.id, v_result, v_obs);
  update public.presence_domains x set last_check_at = clock_timestamp(), last_check_result = v_result where x.id = d.id returning * into d;
  return jsonb_build_object('result', v_result, 'domain', app.prs_domain_json(d));
end $$;

-- ---------------------------------------------------------------------------
-- Dono: acesso ao Google
-- ---------------------------------------------------------------------------

create function public.presence_google_set(
  p_tenant_id uuid,
  p_action text,
  p_profile_name text,
  p_profile_url text,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  g public.presence_google_access;
  v_url text := nullif(btrim(p_profile_url), '');
  v_body jsonb;
begin
  perform app.prs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'google.set', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  insert into public.presence_google_access (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  select * into g from public.presence_google_access x where x.tenant_id = p_tenant_id for update;
  if g.version <> p_expected_version and not (p_expected_version = 0 and g.status = 'not_connected') then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if p_action = 'grant' then
    if g.status = 'granted' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status'; end if;
    if p_profile_name is null or char_length(btrim(p_profile_name)) not between 1 and 120 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'profile_name';
    end if;
    if v_url is not null and v_url !~ '^https://((www\.)?google\.[a-z.]+/maps|maps\.app\.goo\.gl/|g\.page/)' then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'profile_url';
    end if;
    update public.presence_google_access x set status = 'granted', profile_name = btrim(p_profile_name), profile_url = v_url, granted_by = v_uid,
      granted_at = clock_timestamp(), revoked_at = null, version = x.version + 1 where x.tenant_id = p_tenant_id returning * into g;
    perform app.prs_delivery(p_tenant_id, 'google_access_granted', 'Acesso de gerente ao perfil “' || g.profile_name || '” concedido pelo dono.',
      jsonb_strip_nulls(jsonb_build_object('profile_url', g.profile_url, 'access_level', g.access_level)), 'owner');
  elsif p_action = 'revoke' then
    if g.status <> 'granted' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status'; end if;
    update public.presence_google_access x set status = 'revoked', revoked_at = clock_timestamp(), version = x.version + 1
    where x.tenant_id = p_tenant_id returning * into g;
    perform app.prs_delivery(p_tenant_id, 'google_access_revoked', 'Acesso ao perfil “' || g.profile_name || '” revogado pelo dono. Nada mais é feito no Google.', '{}'::jsonb, 'owner');
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'action';
  end if;
  perform app.audit(p_tenant_id, 'presence.google.' || p_action, 'presence_google', p_tenant_id, p_request_id, null, jsonb_build_object('status', g.status));
  v_body := app.prs_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'google.set', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Operação Tinindo: registrar entrega com evidência (P15)
-- ---------------------------------------------------------------------------

create function public.presence_delivery_record(
  p_tenant_id uuid,
  p_kind text,
  p_summary text,
  p_evidence_url text,
  p_service_order_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators := app.svc_operator();
  v_replay jsonb;
  v_order public.service_orders;
  v_id uuid;
  v_body jsonb;
begin
  v_replay := app.idempotency_claim(p_tenant_id, v_op.user_id, 'ops.presence_delivery', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_kind not in ('google_profile_update', 'google_post', 'google_review_reply') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
  end if;
  if p_summary is null or char_length(btrim(p_summary)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'summary';
  end if;
  if p_evidence_url is null or p_evidence_url !~ '^https://[^[:space:]]{4,250}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'evidence_url';
  end if;
  -- Sem acesso de gerente ativo concedido pelo dono, nada é feito no Google.
  if not exists (select 1 from public.presence_google_access g where g.tenant_id = p_tenant_id and g.status = 'granted') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'google_access';
  end if;
  if p_service_order_id is not null then
    select * into v_order from public.service_orders o where o.tenant_id = p_tenant_id and o.id = p_service_order_id;
    if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_order_id'; end if;
    if v_order.assignee_user_id is distinct from v_op.user_id then raise exception using errcode = 'PT403', message = 'FORBIDDEN'; end if;
  end if;
  v_id := app.prs_delivery(p_tenant_id, p_kind, btrim(p_summary), jsonb_build_object('url', p_evidence_url), 'operator', p_service_order_id);
  perform app.audit(p_tenant_id, 'presence.delivery', 'presence_delivery', v_id, p_request_id, null, jsonb_build_object('kind', p_kind));
  v_body := jsonb_build_object('delivery', (select jsonb_build_object('id', e.id, 'kind', e.kind, 'summary', e.summary, 'evidence', e.evidence,
    'actor', e.actor, 'service_order_id', e.service_order_id, 'created_at', app.fin_ts(e.created_at)) from public.presence_deliveries e where e.id = v_id));
  perform app.idempotency_complete(p_tenant_id, v_op.user_id, 'ops.presence_delivery', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Público: página publicada por endereço ou por domínio verificado
-- ---------------------------------------------------------------------------

create function app.prs_public(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.presence_sites;
  pv public.presence_site_versions;
begin
  select * into s from public.presence_sites x where x.tenant_id = p_tenant_id;
  if not found or s.status <> 'published' then return null; end if;
  -- Perfil retirado do ar derruba o site junto (o escopo é o do P09).
  if not exists (select 1 from public.public_profiles p where p.tenant_id = p_tenant_id and p.published_at is not null) then return null; end if;
  select * into pv from public.presence_site_versions x where x.tenant_id = p_tenant_id and x.version_no = s.published_version_no;
  return jsonb_build_object('site', pv.snapshot, 'version_no', pv.version_no, 'snapshot_hash', pv.snapshot_hash, 'published_at', app.fin_ts(s.published_at),
    'hostname', (select d.hostname from public.presence_domains d where d.tenant_id = p_tenant_id and d.status = 'verified'));
end $$;

create function public.presence_public_site(p_slug text, p_host text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_out jsonb;
begin
  if p_host is not null then
    select d.tenant_id into v_tenant from public.presence_domains d where d.hostname = lower(btrim(p_host)) and d.status = 'verified';
  else
    select p.tenant_id into v_tenant from public.public_profiles p where p.slug = lower(btrim(p_slug));
  end if;
  v_out := case when v_tenant is null then null else app.prs_public(v_tenant) end;
  if v_out is null then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS. Escrita só por RPC; o público só lê pela função com projeção fixa.
-- ---------------------------------------------------------------------------

revoke all on function app.prs_snapshot(uuid), app.prs_overview(uuid), app.prs_delivery(uuid, text, text, jsonb, text, uuid), app.prs_public(uuid)
  from public, anon, authenticated;
revoke all on function public.presence_get(uuid) from public, anon;
revoke all on function public.presence_site_save(uuid, integer, text, text[], text, uuid[], text, text, uuid) from public, anon;
revoke all on function public.presence_site_publish(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.presence_site_unpublish(uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.presence_site_restore(uuid, integer, integer, text, text, uuid) from public, anon;
revoke all on function public.presence_domain_add(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.presence_domain_remove(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.presence_domain_check_target(uuid, uuid) from public, anon;
revoke all on function public.presence_domain_record_check(uuid, text[], boolean) from public, anon, authenticated;
revoke all on function public.presence_google_set(uuid, text, text, text, integer, text, text, uuid) from public, anon;
revoke all on function public.presence_delivery_record(uuid, text, text, text, uuid, text, text, uuid) from public, anon;
revoke all on function public.presence_public_site(text, text) from public;
grant execute on function public.presence_get(uuid) to authenticated;
grant execute on function public.presence_site_save(uuid, integer, text, text[], text, uuid[], text, text, uuid) to authenticated;
grant execute on function public.presence_site_publish(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.presence_site_unpublish(uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.presence_site_restore(uuid, integer, integer, text, text, uuid) to authenticated;
grant execute on function public.presence_domain_add(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.presence_domain_remove(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.presence_domain_check_target(uuid, uuid) to authenticated;
grant execute on function public.presence_domain_record_check(uuid, text[], boolean) to service_role;
grant execute on function public.presence_google_set(uuid, text, text, text, integer, text, text, uuid) to authenticated;
grant execute on function public.presence_delivery_record(uuid, text, text, text, uuid, text, text, uuid) to authenticated;
grant execute on function public.presence_public_site(text, text) to anon, authenticated, service_role;

alter table public.presence_sites enable row level security;
alter table public.presence_site_services enable row level security;
alter table public.presence_site_versions enable row level security;
alter table public.presence_domains enable row level security;
alter table public.presence_domain_checks enable row level security;
alter table public.presence_google_access enable row level security;
alter table public.presence_deliveries enable row level security;
revoke all on public.presence_sites, public.presence_site_services, public.presence_site_versions, public.presence_domains,
  public.presence_domain_checks, public.presence_google_access, public.presence_deliveries from anon, authenticated;
grant select on public.presence_site_versions, public.presence_deliveries, public.presence_domain_checks to authenticated;
create policy presence_site_versions_owner on public.presence_site_versions for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy presence_deliveries_owner on public.presence_deliveries for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy presence_domain_checks_owner on public.presence_domain_checks for select to authenticated using (app.is_member(tenant_id, array['owner']));
grant select, insert, update, delete on public.presence_sites, public.presence_site_services, public.presence_domains, public.presence_google_access to service_role;
grant select, insert on public.presence_site_versions, public.presence_domain_checks, public.presence_deliveries to service_role;
-- presence_sites, presence_site_services, presence_domains, presence_google_access: RLS ligada e nenhuma política para
-- usuários (o dono lê pela presence_get; o token de verificação é público por natureza, mas só sai pela RPC).
