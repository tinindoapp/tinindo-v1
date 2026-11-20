-- Recado #142: trava de módulo no servidor nos módulos que podem estar desligados (6 por ativação e 11 guardados).
-- Cada módulo autoriza as RPCs do dono por um auxiliar app.<x>_owner(tenant) (só papel `owner`). Aqui cada auxiliar
-- passa a chamar app.authorize(tenant, array['owner'], '<módulo>'): primeiro o papel (quem não é membro não descobre
-- nada), depois a chave do módulo (403 FORBIDDEN, hint module_disabled). As RPCs públicas (anônimas) desses módulos
-- NÃO mudam: se o link de cliente de um módulo desligado continua valendo é decisão pendente (recado #142).
-- Última definição de cada auxiliar: a migration do pacote dono (P11, P12, P14–P24, P28–P31), corpo idêntico ao abaixo
-- sem a linha do módulo.

create or replace function app.rc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'recurrence');
end $$;

create or replace function app.sales_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'sales');
end $$;

create or replace function app.ga_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'growth-advice');
end $$;

create or replace function app.an_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'analytics');
end $$;

create or replace function app.ref_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'referrals');
end $$;

create or replace function app.svc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'service-ops');
end $$;

create or replace function app.ch_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'messaging');
end $$;

create or replace function app.pay_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'payments');
end $$;

create or replace function app.fsc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'fiscal');
end $$;

create or replace function app.prs_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'presence');
end $$;

create or replace function app.cp_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'campaigns');
end $$;

create or replace function app.rep_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'reputation');
end $$;

create or replace function app.fs_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'field-service');
end $$;

create or replace function app.dsc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'discovery');
end $$;

create or replace function app.tm_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'resources');
end $$;

create or replace function app.mt_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'materials');
end $$;

create or replace function app.fa_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.authorize(p_tenant_id, array['owner'], 'finance-advanced');
end $$;
