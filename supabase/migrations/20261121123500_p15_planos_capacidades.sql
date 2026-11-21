-- Planos e cobrança da Tinindo (1/5) · capacidades legíveis por máquina em cada versão de plano (D3 a; relatório
-- docs/qa/revisao-2026-11-10/01-escopo-produto.md, achado 09; handoff P51, pendência "plano por capacidade").
-- * offering_versions ganha `capabilities` (módulos por ativação liberados, clientes ativos, agendamentos por mês,
--   perguntas ao assistente por mês, lembretes por mês) e `terms` (dias de teste, dias de carência, meses de preço
--   travado e janela de adesão). As duas vêm juntas e validadas; versão publicada continua imutável.
-- * Valores: supabase/functions/service-ops/planos.json é a ÚNICA fonte. Os blocos `$plano$…$plano$` abaixo são cópia
--   literal dele (tests/contracts/service-ops/planos-config.test.ts compara). Os valores marcados em
--   `a_confirmar_pelo_felipe` são iniciais: nenhuma cobrança começa antes do ok do Felipe.
-- * Compromisso histórico: quem assinou uma versão anterior (sem capacidades) continua nela. Esta migration só publica
--   versões novas; nada muda nas assinaturas existentes. A aplicação dos limites vem no bloco 2.
-- Depende de: P15 (catálogo, assinaturas), P51 (versões 2 dos planos).

-- ---------------------------------------------------------------------------
-- Validação (usada nas checks da tabela: funções imutáveis, sem subconsulta)
-- ---------------------------------------------------------------------------

/** Capacidades bem formadas: exatamente as cinco chaves, módulos por ativação sem repetição e limites inteiros. */
create function app.plan_caps_valid(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and (select array_agg(k order by k) from jsonb_object_keys(p) k)
      = array['agent_questions_month', 'bookings_month', 'customers_max', 'modules', 'reminders_month']
    and jsonb_typeof(p->'modules') = 'array'
    and coalesce((select bool_and(jsonb_typeof(m) = 'string' and m #>> '{}' in
        ('recurrence', 'sales', 'growth-advice', 'analytics', 'referrals', 'service-ops'))
      from jsonb_array_elements(p->'modules') m), true)
    and (select count(distinct m) = count(*) from jsonb_array_elements(p->'modules') m)
    and coalesce((select bool_and(jsonb_typeof(p->k) = 'number' and (p->>k) ~ '^[0-9]+$' and (p->>k)::numeric <= 1000000)
      from unnest(array['customers_max', 'bookings_month', 'agent_questions_month', 'reminders_month']) k), false)
$$;

/** Condições bem formadas: dias de teste e de carência, meses de preço travado e a janela de adesão. */
create function app.plan_terms_valid(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and (select array_agg(k order by k) from jsonb_object_keys(p) k)
      = array['available_from', 'available_until', 'grace_days', 'price_lock_months', 'trial_days']
    and (p->>'trial_days') ~ '^[0-9]+$' and (p->>'trial_days')::int <= 90
    and (p->>'grace_days') ~ '^[0-9]+$' and (p->>'grace_days')::int <= 60
    and (jsonb_typeof(p->'price_lock_months') = 'null'
      or ((p->>'price_lock_months') ~ '^[0-9]+$' and (p->>'price_lock_months')::int between 1 and 60))
    and jsonb_typeof(p->'available_from') in ('null', 'string')
    and jsonb_typeof(p->'available_until') in ('null', 'string')
    and (jsonb_typeof(p->'available_from') = 'null' or jsonb_typeof(p->'available_until') = 'null'
      or (p->>'available_from') < (p->>'available_until'))
$$;

-- Só as checks e o backend usam (as checks não exigem EXECUTE de quem grava).
revoke all on function app.plan_caps_valid(jsonb), app.plan_terms_valid(jsonb) from public, anon, authenticated;

alter table public.offering_versions
  add column capabilities jsonb,
  add column terms jsonb,
  add constraint offering_versions_caps_pair check ((capabilities is null) = (terms is null)),
  add constraint offering_versions_caps_valid check (capabilities is null or app.plan_caps_valid(capabilities)),
  add constraint offering_versions_terms_valid check (terms is null or app.plan_terms_valid(terms)),
  -- Plano por capacidade é mensal, e a coluna antiga da franquia do assistente acompanha a capacidade.
  add constraint offering_versions_caps_plan check (capabilities is null
    or (billing = 'monthly' and agent_questions_month = (capabilities->>'agent_questions_month')::int));
comment on column public.offering_versions.capabilities is
  'D3 a: o que a versão do plano libera (módulos por ativação e limites). null = versão anterior às capacidades.';
comment on column public.offering_versions.terms is
  'D3 a: dias de teste, dias de carência, meses de preço travado e janela de adesão da versão.';

-- ---------------------------------------------------------------------------
-- Publicação (só backend) e leitura
-- ---------------------------------------------------------------------------

/**
 * Publica uma versão de plano a partir de uma entrada de planos.json. Repetir o mesmo conteúdo devolve a versão atual
 * (não cria outra). Campos de documentação (a_confirmar_pelo_felipe) não entram no compromisso nem no hash.
 */
create function app.svc_publish_plan(p jsonb) returns public.offering_versions
language plpgsql security definer set search_path = '' as $$
declare
  v_off public.platform_offerings;
  v_last public.offering_versions;
  v_hash text;
  v_row public.offering_versions;
  v_code text := p->>'code';
begin
  if v_code is null or not app.plan_caps_valid(p->'capabilities') or not app.plan_terms_valid(p->'terms')
    or jsonb_typeof(p->'included') <> 'array' or jsonb_typeof(p->'excluded') <> 'array' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'plan';
  end if;
  insert into public.platform_offerings (code, kind) values (v_code, 'plan') on conflict (code) do nothing;
  select * into v_off from public.platform_offerings o where o.code = v_code for update;
  if v_off.kind <> 'plan' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
  end if;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object('code', v_code, 'kind', 'plan', 'name', p->>'name',
    'description', p->>'description', 'price_cents', (p->>'price_cents')::bigint, 'billing', 'monthly',
    'included', p->'included', 'excluded', p->'excluded', 'capabilities', p->'capabilities', 'terms', p->'terms')::text,
    'UTF8')), 'hex');
  select * into v_last from public.offering_versions v where v.offering_id = v_off.id order by v.version_no desc limit 1;
  if found and v_last.scope_hash = v_hash then
    return v_last;
  end if;
  insert into public.offering_versions (offering_id, version_no, name, description, price_cents, billing, included, excluded,
    agent_questions_month, assisted_minutes, sla_days, scope_hash, capabilities, terms)
  values (v_off.id, coalesce(v_last.version_no, 0) + 1, p->>'name', p->>'description', (p->>'price_cents')::bigint, 'monthly',
    p->'included', p->'excluded', (p->'capabilities'->>'agent_questions_month')::int, null, null, v_hash,
    p->'capabilities', p->'terms')
  returning * into v_row;
  return v_row;
end $$;
revoke all on function app.svc_publish_plan(jsonb) from public, anon, authenticated;
grant execute on function app.svc_publish_plan(jsonb) to service_role;

-- Última definição: 20261018190000_p15_service_ops.sql, mais capacidades e condições.
create or replace function app.svc_version_json(v public.offering_versions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'code', o.code, 'kind', o.kind, 'version_no', v.version_no, 'name', v.name,
    'description', v.description, 'price_cents', v.price_cents, 'billing', v.billing, 'included', v.included,
    'excluded', v.excluded, 'agent_questions_month', v.agent_questions_month, 'assisted_minutes', v.assisted_minutes,
    'sla_days', v.sla_days, 'scope_hash', v.scope_hash, 'published_at', app.sched_ts(v.published_at),
    'capabilities', v.capabilities, 'terms', v.terms)
  from public.platform_offerings o where o.id = v.offering_id
$$;

-- ---------------------------------------------------------------------------
-- Versões com capacidades (cópia literal de supabase/functions/service-ops/planos.json)
-- ---------------------------------------------------------------------------

select app.svc_publish_plan($plano${
  "code": "free",
  "name": "Grátis",
  "description": "Agenda, clientes e caixa para quem está começando, com limites mensais.",
  "price_cents": 0,
  "included": [
    "Agenda, clientes e caixa registrado",
    "Perfil público com link de reserva",
    "Exportação dos seus dados"
  ],
  "excluded": [
    "Atendimento humano",
    "Serviços assistidos (contratados à parte)",
    "Emissão fiscal"
  ],
  "capabilities": {
    "modules": [
      "recurrence",
      "sales",
      "referrals",
      "service-ops"
    ],
    "customers_max": 150,
    "bookings_month": 120,
    "agent_questions_month": 30,
    "reminders_month": 120
  },
  "terms": {
    "trial_days": 0,
    "grace_days": 0,
    "price_lock_months": null,
    "available_from": null,
    "available_until": null
  },
  "a_confirmar_pelo_felipe": [
    "description",
    "capabilities.modules",
    "capabilities.customers_max",
    "capabilities.bookings_month",
    "capabilities.agent_questions_month",
    "capabilities.reminders_month"
  ]
}$plano$::jsonb);
select app.svc_publish_plan($plano${
  "code": "founder",
  "name": "Completo (fundador)",
  "description": "Todos os recursos opcionais e limites maiores, com o preço de fundador fixo por 12 meses.",
  "price_cents": 7900,
  "included": [
    "Tudo do Grátis, com limites maiores",
    "Todos os recursos opcionais de Conta › Mais recursos",
    "Preço de fundador fixo por 12 meses a partir da adesão"
  ],
  "excluded": [
    "Atendimento humano ilimitado",
    "Serviços assistidos (contratados à parte)",
    "Emissão fiscal",
    "Marketing pago"
  ],
  "capabilities": {
    "modules": [
      "recurrence",
      "sales",
      "growth-advice",
      "analytics",
      "referrals",
      "service-ops"
    ],
    "customers_max": 2000,
    "bookings_month": 1500,
    "agent_questions_month": 200,
    "reminders_month": 1500
  },
  "terms": {
    "trial_days": 14,
    "grace_days": 7,
    "price_lock_months": 12,
    "available_from": null,
    "available_until": "2027-06-30T23:59:59Z"
  },
  "a_confirmar_pelo_felipe": [
    "description",
    "price_cents",
    "capabilities.modules",
    "capabilities.customers_max",
    "capabilities.bookings_month",
    "capabilities.agent_questions_month",
    "capabilities.reminders_month",
    "terms.trial_days",
    "terms.grace_days",
    "terms.price_lock_months",
    "terms.available_from",
    "terms.available_until"
  ]
}$plano$::jsonb);
