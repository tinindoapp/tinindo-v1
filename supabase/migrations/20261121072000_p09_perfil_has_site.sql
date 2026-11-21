-- Recado #161: a página pública (/p/<slug>) chamava presence.public_site sempre, e o Site guardado no piloto (P51)
-- respondia 404. O perfil público passa a dizer se há Site publicado (has_site); a página só chama quando há.
-- Mesma condição de app.prs_public: Site publicado com o perfil no ar (o perfil já está no ar se esta função responde).

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
    'whatsapp_e164', case when v_row.show_whatsapp then v_media ->> 'whatsapp_e164' end,
    'has_site', exists (
      select 1 from public.presence_sites s where s.tenant_id = v_row.tenant_id and s.status = 'published'
    )
  );
end $$;
