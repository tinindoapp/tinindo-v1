-- P23 · Diretório e busca local: o negócio entra no diretório por opt-in, com o perfil público (P09) publicado; a busca
-- filtra por profissão, cidade, bairro e dia de atendimento; páginas por cidade e profissão são indexáveis. Ver ADR-0027.
-- Invariantes (tasks/P23, docs/17):
-- * Só dados autorizados: o que o perfil público já mostra (nome só se o campo foi escolhido), cidade/UF declaradas
--   para o diretório, link do site (P17) se publicado, e o expediente só se o dono escolheu mostrar. Nunca contatos,
--   clientes, preços negociados ou agenda de clientes.
-- * Critérios documentados e determinísticos (app.dsc_criteria): filtros exatos; ordem alfabética do nome exibido; sem
--   destaque pago, nota ou posição comprada. Ranking explicável é o P27.
-- * Perfil retirado do ar tira o negócio do diretório na leitura. Suspensão (moderação) só pelo backend.
-- Depende de: fundação, P03 (availability_rules), P09 (public_profiles), P17 (presence_sites).

create table public.discovery_listings (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  uf char(2) not null check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  city_name text not null check (char_length(btrim(city_name)) between 2 and 80),
  city_slug text not null check (city_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  show_hours boolean not null default false,
  status text not null default 'listed' check (status in ('listed', 'unlisted', 'suspended')),
  suspended_reason text check (char_length(suspended_reason) <= 200),
  listed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint discovery_listings_suspended check ((status = 'suspended') = (suspended_reason is not null))
);
comment on table public.discovery_listings is 'Opt-in do negócio no diretório local. A leitura pública só sai por discovery_search/discovery_cities.';
create index discovery_listings_city on public.discovery_listings (uf, city_slug) where status = 'listed';
create trigger discovery_listings_touch before update on public.discovery_listings for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------------

/** Critérios da busca, num só lugar: a tela pública mostra este texto e os testes conferem a ordem. */
create function app.dsc_criteria() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'filters', jsonb_build_array('profissão (exata)', 'cidade e UF (exatas)', 'bairro (contém o texto, na área do perfil)', 'dia da semana (só quem mostra o expediente)'),
    'order', 'ordem alfabética do nome exibido',
    'never', jsonb_build_array('destaque pago', 'nota ou avaliação', 'posição comprada', 'contatos ou dados de clientes'),
    'page_size', 20)
$$;

/** Endereço de cidade: minúsculas, sem acento, hífens. */
create function app.dsc_slug(p text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    translate(lower(btrim(p)), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', '-', 'g'))
$$;

create function app.dsc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/** Cartão público do negócio: só campos autorizados (perfil P09, cidade do diretório, site P17, expediente se escolhido). */
create function app.dsc_card(l public.discovery_listings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'slug', p.slug,
    'display_name', case when 'display_name' = any (p.public_fields) then t.name end,
    'category', p.category,
    'area', p.area,
    'city_name', l.city_name, 'city_slug', l.city_slug, 'uf', l.uf,
    'profile_path', '/p/' || p.slug,
    'site_path', case when s.status = 'published' then '/s/' || p.slug end,
    'booking', 'booking_link' = any (p.public_fields),
    'weekdays', case when l.show_hours then coalesce((select jsonb_agg(distinct r.weekday order by r.weekday) from public.availability_rules r where r.tenant_id = l.tenant_id), '[]'::jsonb) end)
  from public.public_profiles p
  join public.tenants t on t.id = p.tenant_id
  left join public.presence_sites s on s.tenant_id = p.tenant_id
  where p.tenant_id = l.tenant_id
$$;

/** Nome usado na ordem: o nome público quando autorizado; senão a área (nunca o nome privado). */
create function app.dsc_sort_name(l public.discovery_listings) returns text
language sql stable security definer set search_path = '' as $$
  select lower(app.dsc_slug(coalesce(case when 'display_name' = any (p.public_fields) then t.name end, p.area)))
  from public.public_profiles p join public.tenants t on t.id = p.tenant_id where p.tenant_id = l.tenant_id
$$;

create function app.dsc_overview(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.discovery_listings;
  p public.public_profiles;
begin
  select * into l from public.discovery_listings x where x.tenant_id = p_tenant_id;
  select * into p from public.public_profiles x where x.tenant_id = p_tenant_id;
  return jsonb_build_object(
    'criteria', app.dsc_criteria(),
    'profile', jsonb_build_object('exists', p.id is not null, 'published', p.published_at is not null, 'slug', p.slug,
      'public_fields', coalesce(to_jsonb(p.public_fields), '[]'::jsonb)),
    'listing', case when l.tenant_id is null then null else jsonb_build_object('uf', l.uf, 'city_name', l.city_name, 'city_slug', l.city_slug,
      'show_hours', l.show_hours, 'status', l.status, 'suspended_reason', l.suspended_reason, 'listed_at', app.fin_ts(l.listed_at), 'version', l.version) end,
    -- Como o público vê (só se aparece de fato: listado e com perfil publicado).
    'card', case when l.tenant_id is not null and l.status = 'listed' and p.published_at is not null then app.dsc_card(l) end,
    'visible', l.tenant_id is not null and l.status = 'listed' and p.published_at is not null);
end $$;

-- ---------------------------------------------------------------------------
-- Dono
-- ---------------------------------------------------------------------------

create function public.discovery_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.dsc_owner(p_tenant_id);
  return app.dsc_overview(p_tenant_id);
end $$;

create function public.discovery_save(
  p_tenant_id uuid,
  p_expected_version integer,
  p_uf text,
  p_city_name text,
  p_show_hours boolean,
  p_listed boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  l public.discovery_listings;
  v_slug text := app.dsc_slug(p_city_name);
  v_uf text := upper(btrim(coalesce(p_uf, '')));
  v_status text;
  v_body jsonb;
begin
  perform app.dsc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'discovery.save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if v_uf !~ '^[A-Z]{2}$' or v_uf not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'uf';
  end if;
  if p_city_name is null or char_length(btrim(p_city_name)) not between 2 and 80 or v_slug = '' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'city_name';
  end if;
  -- Entrar no diretório exige o perfil público publicado (o diretório só repete o que o perfil já mostra).
  if p_listed and not exists (select 1 from public.public_profiles p where p.tenant_id = p_tenant_id and p.published_at is not null) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'profile';
  end if;
  select * into l from public.discovery_listings x where x.tenant_id = p_tenant_id for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    -- Primeiro salvamento em paralelo: quem chega depois perde pela versão (nunca erro de chave duplicada).
    insert into public.discovery_listings (tenant_id, uf, city_name, city_slug, show_hours, status, listed_at)
    values (p_tenant_id, v_uf, btrim(p_city_name), v_slug, coalesce(p_show_hours, false), case when p_listed then 'listed' else 'unlisted' end,
      case when p_listed then clock_timestamp() end) on conflict (tenant_id) do nothing returning * into l;
    if l.tenant_id is null then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  else
    if l.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    -- Suspenso pela moderação não volta sozinho: o dono só pode sair (unlisted continua suspenso até o backend liberar).
    v_status := case when l.status = 'suspended' then 'suspended' when p_listed then 'listed' else 'unlisted' end;
    update public.discovery_listings x set uf = v_uf, city_name = btrim(p_city_name), city_slug = v_slug, show_hours = coalesce(p_show_hours, false),
      status = v_status, listed_at = case when v_status = 'listed' and x.status <> 'listed' then clock_timestamp() else x.listed_at end, version = x.version + 1
    where x.tenant_id = p_tenant_id returning * into l;
  end if;
  perform app.audit(p_tenant_id, 'discovery.save', 'discovery_listing', p_tenant_id, p_request_id, null,
    jsonb_build_object('uf', l.uf, 'city_slug', l.city_slug, 'status', l.status, 'show_hours', l.show_hours));
  v_body := app.dsc_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'discovery.save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Moderação (backend): suspender e liberar. Sem RPC para o app.
-- ---------------------------------------------------------------------------

create function public.discovery_moderate(p_tenant_id uuid, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.discovery_listings;
begin
  select * into l from public.discovery_listings x where x.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if p_action = 'suspend' then
    if p_reason is null or char_length(btrim(p_reason)) not between 5 and 200 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason'; end if;
    update public.discovery_listings x set status = 'suspended', suspended_reason = btrim(p_reason), version = x.version + 1 where x.tenant_id = p_tenant_id;
  elsif p_action = 'release' then
    update public.discovery_listings x set status = 'unlisted', suspended_reason = null, version = x.version + 1 where x.tenant_id = p_tenant_id and x.status = 'suspended';
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'action';
  end if;
  perform app.audit(p_tenant_id, 'discovery.moderate.' || p_action, 'discovery_listing', p_tenant_id, null, null, jsonb_build_object('reason', p_reason));
  return app.dsc_overview(p_tenant_id);
end $$;

-- ---------------------------------------------------------------------------
-- Público
-- ---------------------------------------------------------------------------

/**
 * Busca: filtros exatos de profissão e cidade/UF, bairro contido na área, dia da semana só entre quem mostra o
 * expediente. Ordem alfabética do nome exibido (desempate pelo endereço do perfil). Página de 20.
 */
create function public.discovery_search(p_uf text, p_city_slug text, p_category text, p_area text, p_weekday integer, p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uf text := upper(btrim(coalesce(p_uf, '')));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_area text := nullif(app.dsc_slug(coalesce(p_area, '')), '');
  v_total integer;
  v_items jsonb;
begin
  if v_uf !~ '^[A-Z]{2}$' then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'uf'; end if;
  if p_city_slug is null or p_city_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'city_slug'; end if;
  if p_category is not null and p_category not in ('barber', 'hairdresser', 'personal_trainer', 'other') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'category';
  end if;
  if p_weekday is not null and p_weekday not between 0 and 6 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'weekday'; end if;
  with hits as (
    select l as listing, app.dsc_sort_name(l) as sort_name, p.slug
    from public.discovery_listings l
    join public.public_profiles p on p.tenant_id = l.tenant_id and p.published_at is not null
    where l.status = 'listed' and l.uf = v_uf and l.city_slug = p_city_slug
      and (p_category is null or p.category = p_category)
      and (v_area is null or app.dsc_slug(p.area) like '%' || v_area || '%')
      and (p_weekday is null or (l.show_hours and exists (select 1 from public.availability_rules r where r.tenant_id = l.tenant_id and r.weekday = p_weekday)))
  )
  select (select count(*)::int from hits),
    coalesce((select jsonb_agg(app.dsc_card(h.listing) order by h.sort_name, h.slug)
      from (select * from hits order by sort_name, slug limit 20 offset (v_page - 1) * 20) h), '[]'::jsonb)
  into v_total, v_items;
  return jsonb_build_object('criteria', app.dsc_criteria(), 'total', v_total, 'page', v_page, 'items', v_items,
    'city_name', (select l.city_name from public.discovery_listings l where l.uf = v_uf and l.city_slug = p_city_slug and l.status = 'listed' order by l.listed_at limit 1));
end $$;

/** Cidades com negócios listados (para as páginas de índice), opcionalmente por profissão. */
create function public.discovery_cities(p_category text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('cities', coalesce((select jsonb_agg(jsonb_build_object('uf', c.uf, 'city_slug', c.city_slug, 'city_name', c.city_name, 'count', c.n)
      order by c.uf, c.city_slug)
    from (select l.uf, l.city_slug, min(l.city_name) as city_name, count(*)::int as n
          from public.discovery_listings l join public.public_profiles p on p.tenant_id = l.tenant_id and p.published_at is not null
          where l.status = 'listed' and (p_category is null or p.category = p_category)
          group by l.uf, l.city_slug) c), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.dsc_card(public.discovery_listings), app.dsc_sort_name(public.discovery_listings), app.dsc_overview(uuid) from public, anon, authenticated;
revoke all on function public.discovery_get(uuid) from public, anon;
revoke all on function public.discovery_save(uuid, integer, text, text, boolean, boolean, text, text, uuid) from public, anon;
revoke all on function public.discovery_moderate(uuid, text, text) from public, anon, authenticated;
revoke all on function public.discovery_search(text, text, text, text, integer, integer) from public;
revoke all on function public.discovery_cities(text) from public;
grant execute on function public.discovery_get(uuid) to authenticated;
grant execute on function public.discovery_save(uuid, integer, text, text, boolean, boolean, text, text, uuid) to authenticated;
grant execute on function public.discovery_moderate(uuid, text, text) to service_role;
grant execute on function public.discovery_search(text, text, text, text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.discovery_cities(text) to anon, authenticated, service_role;

alter table public.discovery_listings enable row level security;
revoke all on public.discovery_listings from anon, authenticated;
grant select, insert, update on public.discovery_listings to service_role;
-- discovery_listings: RLS ligada e nenhuma política para usuários (dono lê pela discovery_get; público pela busca).
