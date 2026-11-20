-- Recado #142 · trava de módulo no servidor: em cada um dos 17 módulos que podem estar desligados (6 por ativação e
-- 11 guardados), com a chave desligada uma leitura e um comando do dono recusam com 403 FORBIDDEN, hint module_disabled;
-- com a chave ligada, a mesma chamada passa pela trava (pode falhar adiante por argumento, nunca por módulo).
-- Indicações não tem comando do dono no negócio: as duas chamadas são leituras.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a;
grant select on ids to authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
/** sqlstate/mensagem/hint de uma chamada; 'ok' se não deu erro. */
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return v_state || '/' || v_msg || '/' || coalesce(nullif(v_hint, ''), '-');
end $$;
grant execute on function pg_temp.err(text) to authenticated;
/** Liga ou desliga a chave como o backend faz (só o superusuário do teste; o dono não escreve a chave). */
create function pg_temp.key(p_module text, p_on boolean) returns void language sql as $$
  select app.module_admin_set((select tenant_a from ids), p_module, p_on)
$$;

-- ------------------------------------------------------------------ chave desligada: recusado pela trava
select pg_temp.key(m, false) from unnest(array['recurrence', 'sales', 'growth-advice', 'analytics', 'referrals', 'service-ops', 'messaging', 'payments', 'fiscal', 'presence', 'campaigns', 'reputation', 'field-service', 'discovery', 'resources', 'materials', 'finance-advanced']) m;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.recurrence_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'recurrence desligado: recurrence_list recusa');
select is(pg_temp.err(format($$ select public.recurrence_plan_save(%L, null::uuid, null::integer, null::uuid, null::text, null::integer, null::integer, null::bigint, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'recurrence desligado: recurrence_plan_save recusa');
select is(pg_temp.err(format($$ select public.sales_quote_list(%L, null::text) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'sales desligado: sales_quote_list recusa');
select is(pg_temp.err(format($$ select public.sales_quote_create(%L, null::uuid, null::text, null::jsonb, null::timestamp with time zone, null::uuid, null::timestamp with time zone, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'sales desligado: sales_quote_create recusa');
select is(pg_temp.err(format($$ select public.goal_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'growth-advice desligado: goal_list recusa');
select is(pg_temp.err(format($$ select public.goal_save(%L, null::uuid, null::integer, null::text, null::numeric, null::date, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'growth-advice desligado: goal_save recusa');
select is(pg_temp.err(format($$ select public.analytics_baseline_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'analytics desligado: analytics_baseline_list recusa');
select is(pg_temp.err(format($$ select public.analytics_baseline_create(%L, null::text, null::timestamp with time zone, null::timestamp with time zone, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'analytics desligado: analytics_baseline_create recusa');
select is(pg_temp.err(format($$ select public.referral_rewards_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'referrals desligado: referral_rewards_list recusa');
select is(pg_temp.err(format($$ select public.referral_dashboard(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'referrals desligado: referral_dashboard recusa');
select is(pg_temp.err(format($$ select public.service_order_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'service-ops desligado: service_order_list recusa');
select is(pg_temp.err(format($$ select public.service_order_request(%L, null::uuid, null::text, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'service-ops desligado: service_order_request recusa');
select is(pg_temp.err(format($$ select public.channel_inbox(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'messaging desligado: channel_inbox recusa');
select is(pg_temp.err(format($$ select public.channel_connect(%L, null::text, null::text, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'messaging desligado: channel_connect recusa');
select is(pg_temp.err(format($$ select public.payment_charges_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'payments desligado: payment_charges_list recusa');
select is(pg_temp.err(format($$ select public.payment_charge_create(%L, null::uuid, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'payments desligado: payment_charge_create recusa');
select is(pg_temp.err(format($$ select public.fiscal_folder(%L, null::text) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'fiscal desligado: fiscal_folder recusa');
select is(pg_temp.err(format($$ select public.fiscal_profile_save(%L, null::integer, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'fiscal desligado: fiscal_profile_save recusa');
select is(pg_temp.err(format($$ select public.presence_get(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'presence desligado: presence_get recusa');
select is(pg_temp.err(format($$ select public.presence_site_save(%L, null::integer, null::text, null::text[], null::text, null::uuid[], null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'presence desligado: presence_site_save recusa');
select is(pg_temp.err(format($$ select public.campaign_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'campaigns desligado: campaign_list recusa');
select is(pg_temp.err(format($$ select public.campaign_approve(%L, null::text, null::jsonb, null::text, null::integer, null::integer, null::bigint, null::integer, null::jsonb, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'campaigns desligado: campaign_approve recusa');
select is(pg_temp.err(format($$ select public.review_owner_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'reputation desligado: review_owner_list recusa');
select is(pg_temp.err(format($$ select public.review_reply(%L, null::uuid, null::integer, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'reputation desligado: review_reply recusa');
select is(pg_temp.err(format($$ select public.field_settings_get(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'field-service desligado: field_settings_get recusa');
select is(pg_temp.err(format($$ select public.field_settings_save(%L, null::integer, null::boolean, null::integer, null::integer, null::integer, null::numeric, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'field-service desligado: field_settings_save recusa');
select is(pg_temp.err(format($$ select public.discovery_get(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'discovery desligado: discovery_get recusa');
select is(pg_temp.err(format($$ select public.discovery_save(%L, null::integer, null::text, null::text, null::boolean, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'discovery desligado: discovery_save recusa');
select is(pg_temp.err(format($$ select public.resources_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'resources desligado: resources_list recusa');
select is(pg_temp.err(format($$ select public.resources_save(%L, null::uuid, null::integer, null::text, null::text, null::boolean, null::integer, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'resources desligado: resources_save recusa');
select is(pg_temp.err(format($$ select public.materials_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'materials desligado: materials_list recusa');
select is(pg_temp.err(format($$ select public.materials_item_save(%L, null::uuid, null::integer, null::text, null::text, null::text, null::boolean, null::numeric, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'materials desligado: materials_item_save recusa');
select is(pg_temp.err(format($$ select public.accounts_categories(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'finance-advanced desligado: accounts_categories recusa');
select is(pg_temp.err(format($$ select public.accounts_category_save(%L, null::uuid, null::integer, null::text, null::text, null::text, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'finance-advanced desligado: accounts_category_save recusa');

-- ------------------------------------------------------------------ chave ligada: a trava deixa passar
reset role;
select pg_temp.key(m, true) from unnest(array['recurrence', 'sales', 'growth-advice', 'analytics', 'referrals', 'service-ops', 'messaging', 'payments', 'fiscal', 'presence', 'campaigns', 'reputation', 'field-service', 'discovery', 'resources', 'materials', 'finance-advanced']) m;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select isnt(pg_temp.err(format($$ select public.recurrence_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'recurrence ligado: recurrence_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.recurrence_plan_save(%L, null::uuid, null::integer, null::uuid, null::text, null::integer, null::integer, null::bigint, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'recurrence ligado: recurrence_plan_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.sales_quote_list(%L, null::text) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'sales ligado: sales_quote_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.sales_quote_create(%L, null::uuid, null::text, null::jsonb, null::timestamp with time zone, null::uuid, null::timestamp with time zone, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'sales ligado: sales_quote_create passa pela trava');
select isnt(pg_temp.err(format($$ select public.goal_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'growth-advice ligado: goal_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.goal_save(%L, null::uuid, null::integer, null::text, null::numeric, null::date, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'growth-advice ligado: goal_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.analytics_baseline_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'analytics ligado: analytics_baseline_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.analytics_baseline_create(%L, null::text, null::timestamp with time zone, null::timestamp with time zone, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'analytics ligado: analytics_baseline_create passa pela trava');
select isnt(pg_temp.err(format($$ select public.referral_rewards_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'referrals ligado: referral_rewards_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.referral_dashboard(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'referrals ligado: referral_dashboard passa pela trava');
select isnt(pg_temp.err(format($$ select public.service_order_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'service-ops ligado: service_order_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.service_order_request(%L, null::uuid, null::text, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'service-ops ligado: service_order_request passa pela trava');
select isnt(pg_temp.err(format($$ select public.channel_inbox(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'messaging ligado: channel_inbox passa pela trava');
select isnt(pg_temp.err(format($$ select public.channel_connect(%L, null::text, null::text, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'messaging ligado: channel_connect passa pela trava');
select isnt(pg_temp.err(format($$ select public.payment_charges_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'payments ligado: payment_charges_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.payment_charge_create(%L, null::uuid, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'payments ligado: payment_charge_create passa pela trava');
select isnt(pg_temp.err(format($$ select public.fiscal_folder(%L, null::text) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'fiscal ligado: fiscal_folder passa pela trava');
select isnt(pg_temp.err(format($$ select public.fiscal_profile_save(%L, null::integer, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'fiscal ligado: fiscal_profile_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.presence_get(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'presence ligado: presence_get passa pela trava');
select isnt(pg_temp.err(format($$ select public.presence_site_save(%L, null::integer, null::text, null::text[], null::text, null::uuid[], null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'presence ligado: presence_site_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.campaign_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'campaigns ligado: campaign_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.campaign_approve(%L, null::text, null::jsonb, null::text, null::integer, null::integer, null::bigint, null::integer, null::jsonb, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'campaigns ligado: campaign_approve passa pela trava');
select isnt(pg_temp.err(format($$ select public.review_owner_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'reputation ligado: review_owner_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.review_reply(%L, null::uuid, null::integer, null::text, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'reputation ligado: review_reply passa pela trava');
select isnt(pg_temp.err(format($$ select public.field_settings_get(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'field-service ligado: field_settings_get passa pela trava');
select isnt(pg_temp.err(format($$ select public.field_settings_save(%L, null::integer, null::boolean, null::integer, null::integer, null::integer, null::numeric, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'field-service ligado: field_settings_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.discovery_get(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'discovery ligado: discovery_get passa pela trava');
select isnt(pg_temp.err(format($$ select public.discovery_save(%L, null::integer, null::text, null::text, null::boolean, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'discovery ligado: discovery_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.resources_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'resources ligado: resources_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.resources_save(%L, null::uuid, null::integer, null::text, null::text, null::boolean, null::integer, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'resources ligado: resources_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.materials_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'materials ligado: materials_list passa pela trava');
select isnt(pg_temp.err(format($$ select public.materials_item_save(%L, null::uuid, null::integer, null::text, null::text, null::text, null::boolean, null::numeric, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'materials ligado: materials_item_save passa pela trava');
select isnt(pg_temp.err(format($$ select public.accounts_categories(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'finance-advanced ligado: accounts_categories passa pela trava');
select isnt(pg_temp.err(format($$ select public.accounts_category_save(%L, null::uuid, null::integer, null::text, null::text, null::text, null::boolean, null::text, null::text, null::uuid) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/module_disabled', 'finance-advanced ligado: accounts_category_save passa pela trava');

-- ------------------------------------------------------------------ ordem: papel antes do módulo
reset role;
select pg_temp.key('payments', false);
select pg_temp.login_as('b0000000-0000-4000-8000-00000000000b');
set local role authenticated;
select is(pg_temp.err(format($$ select public.payment_charges_list(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/-',
  'quem não é dono recebe só FORBIDDEN, sem saber se o módulo está ligado');
reset role;
select ok(not has_function_privilege('authenticated', 'app.authorize(uuid, text[], text)', 'execute'), 'trava só por dentro das RPCs');

select * from finish();
rollback;
