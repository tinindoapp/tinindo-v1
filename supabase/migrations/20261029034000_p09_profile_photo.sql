-- Recado #64, item 4 (P09 · perfil público): foto do negócio e três chaves do perfil (mostrar foto, botão do WhatsApp
-- e preços). Append-only; substituições por `create or replace` documentadas:
--   app.network_profile_json (passa a trazer `media`, a visão do dono das chaves),
--   public.network_public_profile (o público recebe só `photo` e `whatsapp_e164`, já filtrados pelas chaves),
--   public.public_booking_services (traz `price_from_cents` só quando o dono liga "Mostrar preços"; desligado, sem a chave).
-- Foto:
--   * bucket `profile-photos` público (só leitura pela URL pública), até 2 MB, image/webp e image/jpeg;
--   * caminho `{tenant_id}/{uuid}.webp` (ou .jpg, quando o navegador não gera WebP);
--   * gravar, trocar, apagar e listar só membro do próprio negócio (app.is_member) na pasta do negócio;
--   * o perfil guarda um caminho só; ao trocar, o app apaga o arquivo anterior pela API do Storage.
-- WhatsApp: o número conectado e verificado pelo dono no canal (channel_connections ativa). Sem ele, sem botão.
-- Preço: "a partir de" = preço base do serviço, sem regras de preço (P05).

-- ---------------------------------------------------------------------------
-- Bucket e políticas
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

/** Negócio dono do caminho `{tenant_id}/{uuid}.webp|jpg`; NULL se o caminho foge do formato. */
create function app.profile_photo_tenant(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    then split_part(p_name, '/', 1)::uuid end
$$;
revoke all on function app.profile_photo_tenant(text) from public;
grant execute on function app.profile_photo_tenant(text) to authenticated;

/** Membro (dono ou equipe) do negócio da pasta. Caminho fora do formato: ninguém. */
create function app.profile_photo_writer(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_member(app.profile_photo_tenant(p_name)), false)
$$;
revoke all on function app.profile_photo_writer(text) from public;
grant execute on function app.profile_photo_writer(text) to authenticated;

create policy profile_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and app.profile_photo_writer(name));
create policy profile_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and app.profile_photo_writer(name))
  with check (bucket_id = 'profile-photos' and app.profile_photo_writer(name));
create policy profile_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and app.profile_photo_writer(name));
-- A API do Storage lê a linha antes de apagar; o público baixa pela URL pública, sem esta política.
create policy profile_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and app.profile_photo_writer(name));

-- ---------------------------------------------------------------------------
-- Perfil: foto e chaves
-- ---------------------------------------------------------------------------

alter table public.public_profiles
  add column photo_path text check (app.profile_photo_tenant(photo_path) = tenant_id),
  add column photo_alt text check (char_length(btrim(photo_alt)) between 1 and 200),
  add column show_photo boolean not null default false,
  add column show_whatsapp boolean not null default false,
  add column show_prices boolean not null default false;
comment on column public.public_profiles.photo_path is 'Caminho no bucket profile-photos. Um por negócio; o app apaga o anterior ao trocar.';
comment on column public.public_profiles.photo_alt is 'Texto alternativo da foto. NULL = "Foto de <nome do negócio>".';

/** Número do WhatsApp do negócio: o conectado e verificado pelo dono no canal. NULL sem conexão ativa. */
create function app.network_whatsapp(p_tenant_id uuid) returns text
language sql stable set search_path = '' as $$
  select c.phone_e164 from public.channel_connections c where c.tenant_id = p_tenant_id and c.status = 'active'
$$;
revoke all on function app.network_whatsapp(uuid) from public;

create or replace function app.network_profile_json(p public.public_profiles, p_display_name text)
returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', p.slug,
    'category', p.category,
    'area', p.area,
    'public_fields', to_jsonb(p.public_fields),
    'values', jsonb_strip_nulls(jsonb_build_object(
      'display_name', case when 'display_name' = any (p.public_fields) then p_display_name end,
      'bio', case when 'bio' = any (p.public_fields) then (select c.body from public.profile_contents c where c.tenant_id = p.tenant_id) end
    )),
    'published_at', p.published_at,
    -- P24: identidade verificada pela equipe e avaliações de atendimentos verificados; nunca por convite ou benefício.
    'reputation', (select jsonb_build_object('identity_verified', (s->>'identity_verified')::boolean, 'reviews_count', (s->>'reviews_count')::int)
      from app.rep_summary(p.tenant_id) s),
    'version', p.version,
    -- Visão do dono: as chaves e o que existe por trás delas. O público recebe só o filtrado (network_public_profile).
    'media', jsonb_build_object(
      'photo_path', p.photo_path,
      'photo_alt', coalesce(p.photo_alt, 'Foto de ' || coalesce(p_display_name, (select t.name from public.tenants t where t.id = p.tenant_id))),
      'show_photo', p.show_photo,
      'show_whatsapp', p.show_whatsapp,
      'show_prices', p.show_prices,
      'whatsapp_e164', app.network_whatsapp(p.tenant_id)
    )
  )
$$;
revoke all on function app.network_profile_json(public.public_profiles, text) from public;

/**
 * Leitura pública por slug. Só perfis publicados de negócios ativos. Nunca devolve tenant_id, contatos, clientes,
 * custos ou agenda. Inexistente e não publicado: mesmo 404. Foto e WhatsApp só com a chave ligada (o servidor decide).
 */
create or replace function public.network_public_profile(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.public_profiles;
  v_name text;
  v_media jsonb;
begin
  select p.* into v_row
  from public.public_profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.slug = p_slug and p.published_at is not null and t.status = 'active';
  if v_row.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select t.name into v_name from public.tenants t where t.id = v_row.tenant_id;
  v_media := app.network_profile_json(v_row, v_name) -> 'media';
  return (app.network_profile_json(v_row, v_name) - 'version' - 'media') || jsonb_build_object(
    'photo', case when v_row.show_photo and v_row.photo_path is not null
      then jsonb_build_object('path', v_row.photo_path, 'alt', v_media ->> 'photo_alt') end,
    'whatsapp_e164', case when v_row.show_whatsapp then v_media ->> 'whatsapp_e164' end
  );
end $$;

/** profile.media: foto (caminho já enviado ao Storage), texto alternativo e as três chaves. Só o dono. */
create function public.network_profile_media_set(
  p_tenant_id uuid,
  p_photo_path text,
  p_photo_alt text,
  p_show_photo boolean,
  p_show_whatsapp boolean,
  p_show_prices boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
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
  v_replay := app.idempotency_claim(p_tenant_id, auth.uid(), 'profile.media', p_idem_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_before from public.public_profiles p where p.tenant_id = p_tenant_id for update;
  if v_before.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  -- A foto precisa estar na pasta deste negócio e já enviada ao bucket.
  if p_photo_path is not null and (app.profile_photo_tenant(p_photo_path) is distinct from p_tenant_id
      or not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p_photo_path)) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'photo_path';
  end if;
  if p_show_photo and p_photo_path is null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'show_photo';
  end if;

  update public.public_profiles p
  set photo_path = p_photo_path, photo_alt = nullif(btrim(p_photo_alt), ''),
      show_photo = p_show_photo, show_whatsapp = p_show_whatsapp, show_prices = p_show_prices
  where p.id = v_before.id
  returning * into v_row;

  select t.name into v_name from public.tenants t where t.id = p_tenant_id;
  v_body := app.network_profile_json(v_row, v_name);
  perform app.audit(p_tenant_id, 'profile.media', 'public_profile', v_row.id, p_request_id,
    jsonb_build_object('photo', v_before.photo_path is not null,
      'show_photo', v_before.show_photo, 'show_whatsapp', v_before.show_whatsapp, 'show_prices', v_before.show_prices),
    jsonb_build_object('photo', v_row.photo_path is not null, 'photo_changed', v_row.photo_path is distinct from v_before.photo_path,
      'show_photo', v_row.show_photo, 'show_whatsapp', v_row.show_whatsapp, 'show_prices', v_row.show_prices));
  perform app.idempotency_complete(p_tenant_id, auth.uid(), 'profile.media', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;
revoke all on function public.network_profile_media_set(uuid, text, text, boolean, boolean, boolean, text, text, uuid) from public, anon;
grant execute on function public.network_profile_media_set(uuid, text, text, boolean, boolean, boolean, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Serviços do link público: preço "a partir de" só com a chave ligada
-- ---------------------------------------------------------------------------

create or replace function public.public_booking_services(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := app.pbk_tenant(p_slug);
  v_prices boolean;
begin
  if v_tenant is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select p.show_prices into v_prices from public.public_profiles p where p.tenant_id = v_tenant;
  return jsonb_build_object('services', coalesce((
    -- Desligado, a chave nem aparece: a resposta continua sem nenhum preço, como antes.
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration_min', s.duration_min)
        || case when v_prices then jsonb_build_object('price_from_cents', s.base_price_cents) else '{}'::jsonb end
        order by s.name_key, s.id)
    from (select * from public.provider_services s where s.tenant_id = v_tenant and s.active
          order by s.name_key, s.id limit 50) s), '[]'::jsonb));
end $$;
