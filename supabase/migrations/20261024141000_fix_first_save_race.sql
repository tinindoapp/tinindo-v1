-- Correção (P16/P17): primeiro salvamento em paralelo do rascunho do site (presence_site_save) e do perfil fiscal
-- (fiscal_profile_save) vazava "duplicate key" (500) para quem chegava depois. Agora o segundo perde pela versão
-- (409 STALE_VERSION), como nas demais edições. Achado pelo teste de concorrência do P23 (mesmo padrão).
-- Substituição por `create or replace` documentada; assinaturas, grants e o resto do comportamento não mudam.

create or replace function public.presence_site_save(
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
    values (p_tenant_id, nullif(btrim(p_headline), ''), coalesce(p_sections, '{}'), p_theme) on conflict (tenant_id) do nothing returning * into s;
    if s.tenant_id is null then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
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

create or replace function public.fiscal_profile_save(
  p_tenant_id uuid,
  p_expected_version integer,
  p_legal_name text,
  p_cnpj text,
  p_regime text,
  p_municipality_ibge text,
  p_service_code text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  f public.fiscal_profiles;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_body jsonb;
begin
  perform app.fsc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'fiscal.profile_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if not app.fsc_cnpj_ok(v_cnpj) then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cnpj'; end if;
  if p_municipality_ibge is null or p_municipality_ibge !~ '^[1-5][0-9]{6}$' then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'municipality_ibge'; end if;
  if p_regime not in ('mei', 'simples_nacional', 'other') then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'regime'; end if;
  if p_service_code not in ('06.01', '06.04') then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'service_code'; end if;
  if p_legal_name is null or char_length(btrim(p_legal_name)) not between 2 and 150 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'legal_name'; end if;
  select * into f from public.fiscal_profiles x where x.tenant_id = p_tenant_id for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    insert into public.fiscal_profiles (tenant_id, legal_name, cnpj, regime, municipality_ibge, service_code)
    values (p_tenant_id, btrim(p_legal_name), v_cnpj, p_regime, p_municipality_ibge, p_service_code) on conflict (tenant_id) do nothing returning * into f;
    if f.tenant_id is null then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  else
    if f.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    -- Trocar o CNPJ depois de homologar desliga a produção (o novo CNPJ precisa homologar de novo).
    update public.fiscal_profiles x set legal_name = btrim(p_legal_name), cnpj = v_cnpj, regime = p_regime, municipality_ibge = p_municipality_ibge,
      service_code = p_service_code, production_enabled = case when x.cnpj = v_cnpj then x.production_enabled else false end, version = x.version + 1
    where x.tenant_id = p_tenant_id returning * into f;
  end if;
  perform app.audit(p_tenant_id, 'fiscal.profile.save', 'fiscal_profile', p_tenant_id, p_request_id, null,
    jsonb_build_object('regime', f.regime, 'service_code', f.service_code, 'version', f.version));
  v_body := app.fsc_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'fiscal.profile_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;
