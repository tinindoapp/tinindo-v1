-- P51 · Escopo visível do piloto: chave de módulo por negócio (decisões D1 a, D3 b e D4 de 10/11 e 20/11;
-- docs/qa/revisao-2026-11-10/01-escopo-produto.md, seção 3).
-- Três níveis, um por módulo (o mesmo mapa está em _shared/contracts/scope.ts e em cada `module.tsx`; o teste de
-- contrato compara os três):
--   pilot      → 10 módulos que todo negócio vê desde o primeiro dia. Não têm chave: estão sempre ligados.
--   activation → 6 módulos que o dono liga e desliga em Conta › Mais recursos.
--   stored     → 11 módulos guardados: código e testes ficam, nada aparece. Só o backend liga (operação Tinindo).
-- Invariantes:
-- * Sem linha na tabela = desligado. A chave não apaga dado nenhum: desligar só esconde.
-- * Ligar e desligar são comandos idempotentes do dono, auditados (antes e depois). Repetir o estado atual não audita.
-- * O dono não liga módulo guardado (PT403). A chave do guardado é backend-only: `app.module_admin_set`.
-- * D4: a rotina periódica de módulo guardado só roda para o negócio que tem o módulo ligado (`app.cp_tick`).
-- * D3 (b): o piloto não distingue plano. A sessão recebe o plano só para mostrar o nome; nada é liberado por ele.
-- Depende de: fundação, P15 (plano), P19 (campanhas), P44 (dono da configuração).

-- ---------------------------------------------------------------------------
-- Catálogo (constante)
-- ---------------------------------------------------------------------------

create function app.module_catalog() returns table (module text, level text, ord integer)
language sql immutable set search_path = '' as $$
  select * from (values
    ('scheduling', 'pilot', 1), ('crm', 'pilot', 2), ('finance', 'pilot', 3), ('identity', 'pilot', 4), ('setup', 'pilot', 5),
    ('network', 'pilot', 6), ('lifecycle', 'pilot', 7), ('pricing', 'pilot', 8), ('waitlist', 'pilot', 9), ('agent', 'pilot', 10),
    ('recurrence', 'activation', 11), ('sales', 'activation', 12), ('growth-advice', 'activation', 13),
    ('analytics', 'activation', 14), ('referrals', 'activation', 15), ('service-ops', 'activation', 16),
    ('messaging', 'stored', 17), ('payments', 'stored', 18), ('fiscal', 'stored', 19), ('presence', 'stored', 20),
    ('campaigns', 'stored', 21), ('reputation', 'stored', 22), ('field-service', 'stored', 23), ('discovery', 'stored', 24),
    ('resources', 'stored', 25), ('materials', 'stored', 26), ('finance-advanced', 'stored', 27)
  ) as v(module, level, ord)
$$;

/** 'pilot' | 'activation' | 'stored' | null (módulo inexistente). Para as checks de tabela, que não aceitam subconsulta. */
create function app.module_level(p_module text) returns text
language sql immutable set search_path = '' as $$
  select c.level from app.module_catalog() c where c.module = p_module
$$;

-- ---------------------------------------------------------------------------
-- Chave por negócio
-- ---------------------------------------------------------------------------

create table public.tenant_modules (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  module text not null,
  enabled boolean not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  primary key (tenant_id, module),
  -- Módulo do piloto não tem chave: está sempre ligado.
  constraint tenant_modules_switchable check (coalesce(app.module_level(module) in ('activation', 'stored'), false))
);
comment on table public.tenant_modules is 'Chave de módulo por negócio (P51). Sem linha = desligado. Escrita só por RPC; módulo guardado só pelo backend.';
create trigger tenant_modules_touch before update on public.tenant_modules
  for each row execute function app.touch_row();

/** O módulo vale para o negócio? Piloto sempre; os demais pela chave. Sem autorização: quem chama já autorizou. */
create function app.module_enabled(p_tenant_id uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.module_level(p_module)
    when 'pilot' then true
    else coalesce((select m.enabled from public.tenant_modules m where m.tenant_id = p_tenant_id and m.module = p_module), false)
  end
$$;

/** Plano do negócio para a sessão: código e nome. Sem assinatura registrada, o Grátis (como em service_plan_current). */
create function app.scope_plan(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', x.code, 'name', x.name) from (
    select o.code, v.name, 1 as pri from public.subscriptions s
      join public.offering_versions v on v.id = s.offering_version_id
      join public.platform_offerings o on o.id = v.offering_id
      where s.tenant_id = p_tenant_id and s.status = 'active'
    union all
    (select o.code, v.name, 2 from public.offering_versions v join public.platform_offerings o on o.id = v.offering_id
      where o.code = 'free' order by v.version_no desc limit 1)
    order by pri limit 1) x
$$;

/** Escopo como a sessão do app lê: profissão, plano e os 27 módulos com nível e estado. */
create function app.scope_json(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profession', (select t.profession from public.tenants t where t.id = p_tenant_id),
    'plan', app.scope_plan(p_tenant_id),
    'modules', (select jsonb_agg(jsonb_build_object('module', c.module, 'level', c.level,
        'enabled', app.module_enabled(p_tenant_id, c.module)) order by c.ord) from app.module_catalog() c))
$$;

/** Grava a chave e audita. Devolve true se o estado mudou. Sem autorização: quem chama já autorizou. */
create function app.module_write(p_tenant_id uuid, p_module text, p_enabled boolean, p_request_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean;
begin
  -- Serializa por (negócio, módulo): dois toques ao mesmo tempo gravam uma mudança e uma linha de auditoria.
  perform pg_advisory_xact_lock(hashtext('module:' || p_tenant_id::text || ':' || p_module));
  v_before := app.module_enabled(p_tenant_id, p_module);
  if v_before = p_enabled then
    return false;
  end if;
  insert into public.tenant_modules (tenant_id, module, enabled, updated_by) values (p_tenant_id, p_module, p_enabled, auth.uid())
  on conflict (tenant_id, module) do update set enabled = excluded.enabled, updated_by = excluded.updated_by;
  perform app.audit(p_tenant_id, case when p_enabled then 'module.enable' else 'module.disable' end, 'tenant_module', null, p_request_id,
    jsonb_build_object('module', p_module, 'enabled', v_before), jsonb_build_object('module', p_module, 'enabled', p_enabled));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs (função `setup`: setup.scope e setup.module_set)
-- ---------------------------------------------------------------------------

/** Leitura da sessão: membros do negócio. */
create function public.setup_scope(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return app.scope_json(p_tenant_id);
end $$;

/** O dono liga ou desliga um módulo "por ativação". Módulo do piloto ou inexistente → 400; guardado → 403. */
create function public.setup_module_set(
  p_tenant_id uuid,
  p_module text,
  p_enabled boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_body jsonb;
  v_level text := app.module_level(p_module);
begin
  perform app.setup_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'setup.module_set', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if v_level is null or v_level = 'pilot' or p_enabled is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = case when p_enabled is null then 'enabled' else 'module' end;
  end if;
  if v_level = 'stored' then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  perform app.module_write(p_tenant_id, p_module, p_enabled, p_request_id);
  v_body := jsonb_build_object('module', p_module, 'enabled', p_enabled, 'scope', app.scope_json(p_tenant_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'setup.module_set', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/**
 * Backend-only (operação Tinindo, com a chave de serviço): liga ou desliga qualquer módulo com chave, inclusive os
 * guardados, quando o portão do módulo for cumprido para aquele negócio. Auditado como as demais mudanças.
 */
create function app.module_admin_set(p_tenant_id uuid, p_module text, p_enabled boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if app.module_level(p_module) is null or app.module_level(p_module) = 'pilot' or p_enabled is null
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'module';
  end if;
  return app.module_write(p_tenant_id, p_module, p_enabled, null);
end $$;

-- ---------------------------------------------------------------------------
-- D4 · Periferia congelada: rotina periódica de módulo guardado só roda para o negócio com o módulo ligado.
-- Das rotinas de `public.jobs_run`, a única de módulo guardado é o fechamento de campanhas (P19). As demais são de
-- módulos do piloto (reservas provisórias, ofertas de vaga, réguas) ou "por ativação" (assinaturas, indicações,
-- sugestões), que seguem como estão.
-- ---------------------------------------------------------------------------

create or replace function app.cp_tick(p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.campaigns;
  v_closed integer := 0;
begin
  for c in
    select * from public.campaigns x
    where x.status = 'running' and x.ends_at <= clock_timestamp() and app.module_enabled(x.tenant_id, 'campaigns')
    order by x.ends_at limit p_batch for update skip locked
  loop
    c.status := 'closed';
    update public.campaigns x set status = 'closed', closed_at = clock_timestamp(), result = app.cp_result(c), version = x.version + 1 where x.id = c.id;
    perform app.emit_event(c.tenant_id, 'campaign.closed.v1', c.id, c.version + 1, gen_random_uuid(), jsonb_build_object('name', c.name));
    v_closed := v_closed + 1;
  end loop;
  return jsonb_build_object('closed', v_closed);
end $$;

-- ---------------------------------------------------------------------------
-- D3 (b) · Texto dos planos sem prometer diferença que não existe.
-- No piloto os dois planos dão as mesmas funções e a mesma franquia do assistente (200 perguntas por mês); a versão
-- anterior dizia que o Completo incluía "ofertas de vaga e recuperação de agenda", que todo negócio já tem.
-- Versões publicadas são imutáveis: entra uma versão nova de cada plano (a assinatura existente guarda a que aceitou
-- e a tela avisa que há versão mais nova). Preço e franquia não mudam; nada é cobrado nem aplicado por plano.
-- ---------------------------------------------------------------------------
select app.svc_publish_offering('free', 'plan', 'Grátis', 'No piloto, todos os negócios usam as mesmas funções da Tinindo, sem cobrança.', 0, 'monthly',
  '["Agenda, clientes e caixa registrado", "Perfil público com link de reserva", "Assistente: até 200 perguntas por mês"]',
  '["Atendimento humano", "Serviços assistidos", "Emissão fiscal"]', 200, null, null);
select app.svc_publish_offering('founder', 'plan', 'Completo (fundador)',
  'Reserva o preço de fundador por 12 meses, para adesões elegíveis, quando a cobrança começar. No piloto as funções são as mesmas do Grátis e nada é cobrado.',
  7900, 'monthly',
  '["As mesmas funções do Grátis durante o piloto", "Assistente: até 200 perguntas por mês, igual ao Grátis"]',
  '["Funções a mais que o Grátis durante o piloto", "Atendimento humano ilimitado", "Serviços assistidos (contratados à parte)", "Emissão fiscal", "Marketing pago"]',
  200, null, null);

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.module_catalog(), app.module_level(text), app.module_enabled(uuid, text), app.scope_plan(uuid), app.scope_json(uuid),
  app.module_write(uuid, text, boolean, uuid), app.module_admin_set(uuid, text, boolean) from public;
grant execute on function app.module_enabled(uuid, text), app.module_admin_set(uuid, text, boolean) to service_role;
revoke all on function public.setup_scope(uuid) from public, anon;
revoke all on function public.setup_module_set(uuid, text, boolean, text, text, uuid) from public, anon;
grant execute on function public.setup_scope(uuid) to authenticated;
grant execute on function public.setup_module_set(uuid, text, boolean, text, text, uuid) to authenticated;

alter table public.tenant_modules enable row level security;
revoke all on public.tenant_modules from anon, authenticated;
grant select on public.tenant_modules to authenticated;
grant select on public.tenant_modules to service_role;
create policy tenant_modules_select_member on public.tenant_modules for select to authenticated using (app.is_member(tenant_id));
