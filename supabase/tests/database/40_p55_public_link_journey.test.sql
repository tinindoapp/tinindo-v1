-- P55 · Jornada do link: corrigir o número libera o pedido anterior, pedir de novo zera as tentativas, a 5ª errada
-- libera o horário, estado do envio e reenvio, preço/local/política antes de confirmar, bairro em domicílio, campos do
-- perfil (D21), link da reserva com token e avaliação sem conta (D20), nome do negócio nas mensagens.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7) + time '10:00') at time zone 'America/Sao_Paulo' as monday_10,
  (select base_price_cents from public.provider_services where id = '40000000-0000-4000-8000-0000000000a1') as corte_price,
  (select name from public.tenants where id = '10000000-0000-4000-8000-00000000000a') as tenant_name;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
grant execute on function pg_temp.got(text) to anon, authenticated;
create function pg_temp.at(p_hours int) returns timestamptz language sql as $$ select (select monday_10 from ids) + make_interval(hours => p_hours) $$;
grant execute on function pg_temp.at(int) to anon, authenticated;
create function pg_temp.book(p_k text, p_hours int, p_phone text, p_supersedes uuid default null, p_hood text default null) returns jsonb
language sql as $$
  insert into r select p_k, public.public_booking_request('barbearia-p55', (select corte_a from ids), pg_temp.at(p_hours),
    'Visitante', p_phone, 'p55-' || p_k || '-0000000000', repeat('a', 64), null, false, p_supersedes, p_hood)
  returning v
$$;
grant execute on function pg_temp.book(text, int, text, uuid, text) to anon, authenticated;
create function pg_temp.req(p_k text) returns uuid language sql as $$ select (v->'body'->>'request_id')::uuid from r where k = p_k $$;
grant execute on function pg_temp.req(text) to anon, authenticated;

-- Expediente de segunda; perfil publicado com o link e canal ativo.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  '[{"weekday":1,"local_start":"09:00","local_end":"19:00"}]', 'chave-expediente-p55-001', repeat('e', 64));
reset role;
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
select tenant_a, 'barbearia-p55', 'barber', 'Centro', array['display_name', 'booking_link'], now() from ids;
insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
select tenant_a, 'simulated', '+5511900000055', '+5511900000055', 'active', now() from ids;

-- ------------------------------------------------------------------ campos do perfil (D21)
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'det', public.network_profile_details_set((select tenant_a from ids), ' Rua das Flores, 10 ', false,
  'Seg a sex, 9h às 18h', 'Cancele com 2 horas de antecedência.', 'p55-detalhes-000001', repeat('f', 64));
select is(pg_temp.got('det')->'body'->'details'->>'address', 'Rua das Flores, 10', 'dono grava o endereço (sem espaços sobrando)');
select is((public.network_profile_details_set((select tenant_a from ids), ' Rua das Flores, 10 ', false,
  'Seg a sex, 9h às 18h', 'Cancele com 2 horas de antecedência.', 'p55-detalhes-000001', repeat('f', 64))->'body'->>'version')::int,
  (pg_temp.got('det')->'body'->>'version')::int, 'repetir com a mesma chave devolve o mesmo resultado');
select throws_ok($$ select public.network_profile_details_set((select tenant_a from ids), 'R', false, null, null, 'p55-detalhes-000002', repeat('f', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'endereço curto demais é recusado');
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok($$ select public.network_profile_details_set((select tenant_a from ids), null, true, null, null, 'p55-detalhes-000003', repeat('f', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono de outro negócio não muda o perfil');
reset role;
select pg_temp.as_anon();
set local role anon;
select is(public.network_public_profile('barbearia-p55')->'details'->>'cancellation_policy', 'Cancele com 2 horas de antecedência.',
  'perfil público traz a política');

-- ------------------------------------------------------------------ preço, local e política antes de confirmar
select pg_temp.book('a1', 0, '+5511955550101');
select is((pg_temp.got('a1')->>'status_code')::int, 201, 'pedido aceito');
select is(pg_temp.got('a1')->'body'->>'price_cents', (select corte_price::text from ids),
  'antes de confirmar: o preço base que a confirmação congela');
select is(pg_temp.got('a1')->'body'->'place', '{"kind": "address", "text": "Rua das Flores, 10"}'::jsonb, 'antes de confirmar: onde');
select is(pg_temp.got('a1')->'body'->>'policy', 'Cancele com 2 horas de antecedência.', 'antes de confirmar: a política');
select is((pg_temp.got('a1')->'body'->>'attempts_left')::int || ':' || (pg_temp.got('a1')->'body'->>'resends_left'), '5:2',
  'tentativas e reenvios disponíveis');
select ok(pg_temp.got('a1')::text !~ '(5511955550101|Visitante|"code")', 'resposta sem telefone, nome nem código');

-- ------------------------------------------------------------------ corrigir o número libera o pedido anterior
select pg_temp.book('a2', 0, '+5511955550102', pg_temp.req('a1'));
select is((pg_temp.got('a2')->>'status_code')::int, 201, 'mesmo horário com o número corrigido: aceito, sem conflito consigo mesmo');
reset role;
select is((select status from public.public_booking_requests where id = pg_temp.req('a1')), 'cancelled', 'pedido do número errado encerrado');
select is((select b.status || ':' || b.status_reason from public.bookings b join public.public_booking_requests q on q.booking_id = b.id
  where q.id = pg_temp.req('a1')), 'expired:replaced', 'horário do número errado liberado na mesma transação');
select pg_temp.as_anon();
set local role anon;
select throws_ok(format($$ select public.public_booking_confirm(%L, %L) $$, pg_temp.req('a1'),
  (select 1)::text), 'PT422', 'POLICY_REJECTED', 'o pedido do número errado não confirma mais');
-- Outra pessoa não consegue cancelar o pedido de alguém só pelo id: o pedido é de outro negócio aqui não existe; e um id
-- que já não espera é ignorado sem erro.
select pg_temp.book('a3', 1, '+5511955550103', pg_temp.req('a1'));
select is((pg_temp.got('a3')->>'status_code')::int, 201, 'id que já não espera é ignorado');

-- ------------------------------------------------------------------ tentativas: a 5ª errada libera o horário
select is(public.public_booking_confirm(pg_temp.req('a2'), '000000')->'details'->>'attempts_left', '4', 'código errado diz quantas restam');
select public.public_booking_confirm(pg_temp.req('a2'), '000000') from generate_series(1, 3);
insert into r select 'last', public.public_booking_confirm(pg_temp.req('a2'), '000000');
select is(pg_temp.got('last')->>'field', 'attempts', 'na 5ª errada: tentativas esgotadas');
reset role;
select is((select q.status || ':' || b.status || ':' || b.status_reason from public.public_booking_requests q
  join public.bookings b on b.id = q.booking_id where q.id = pg_temp.req('a2')), 'exhausted:expired:attempts',
  'o horário foi liberado e o pedido encerrado (não fica preso)');
select is((select count(*)::int from public.outbox_events e join public.public_booking_requests q on q.booking_id = e.aggregate_id
  where q.id = pg_temp.req('a2') and e.event_type = 'booking.hold_released.v1'), 1, 'evento de horário liberado');
select pg_temp.as_anon();
set local role anon;
select throws_ok(format($$ select public.public_booking_confirm(%L, %L) $$, pg_temp.req('a2'),
  (select 1)::text), 'PT422', 'POLICY_REJECTED', 'depois de esgotar, nada confirma');
reset role;
select pg_temp.as_anon();
set local role anon;
select pg_temp.book('a4', 0, '+5511955550102');
select is((pg_temp.got('a4')->'body'->>'attempts_left')::int, 5, 'pedir de novo o mesmo horário: aceito e com as tentativas zeradas');
-- Limite por contato e por hora: o 4º pedido do mesmo número no negócio é recusado.
select pg_temp.book('a5', 2, '+5511955550102', pg_temp.req('a4'));
select throws_ok($$ select pg_temp.book('a6', 3, '+5511955550102', pg_temp.req('a5')) $$, 'PT429', 'QUOTA_EXCEEDED',
  'limite por contato e por hora segura a força bruta');

-- ------------------------------------------------------------------ estado do envio e reenvio
select is(public.public_booking_status(pg_temp.req('a5'))->>'delivery', 'queued', 'estado real do envio: na fila');
select throws_ok(format($$ select public.public_booking_resend(%L) $$, pg_temp.req('a5')), 'PT429', 'QUOTA_EXCEEDED',
  'reenviar logo depois: espere 30 s');
reset role;
update public.public_booking_requests set queued_at = clock_timestamp() - interval '1 minute', dispatch_status = 'failed' where id = pg_temp.req('a5');
select pg_temp.as_anon();
set local role anon;
select is(public.public_booking_status(pg_temp.req('a5'))->>'delivery', 'failed', 'falha no envio aparece como falha');
select is(public.public_booking_resend(pg_temp.req('a5'))->>'delivery', 'queued', 'reenviar volta para a fila');
reset role;
select is((select code from public.public_booking_requests where id = pg_temp.req('a5')),
  (select code from public.public_booking_requests where id = pg_temp.req('a5')), 'reenviar não troca o código');
update public.public_booking_requests set queued_at = clock_timestamp() - interval '1 minute' where id = pg_temp.req('a5');
select pg_temp.as_anon();
set local role anon;
select public.public_booking_resend(pg_temp.req('a5'));
reset role;
update public.public_booking_requests set queued_at = clock_timestamp() - interval '1 minute' where id = pg_temp.req('a5');
select pg_temp.as_anon();
set local role anon;
select throws_ok(format($$ select public.public_booking_resend(%L) $$, pg_temp.req('a5')), 'PT429', 'QUOTA_EXCEEDED',
  'no máximo 2 reenvios por pedido');
select throws_ok($$ select public.public_booking_status('6f000000-0000-4000-8000-000000000055') $$, 'PT404', 'NOT_FOUND',
  'pedido desconhecido: não encontrado');

-- ------------------------------------------------------------------ mensagem do código diz o nome do negócio
reset role;
select ok((select x->>'body' from jsonb_array_elements(public.channel_dispatch_claim(50)->'items') x
  where x->>'ref' = 'pbk:' || pg_temp.req('a5')) like 'Código de ' || (select tenant_name from ids) || ':%',
  'o código sai com o nome do negócio');

-- ------------------------------------------------------------------ confirmar devolve o link da reserva (D20)
insert into r select 'code', to_jsonb(code) from public.public_booking_requests where id = pg_temp.req('a5');
select pg_temp.as_anon();
set local role anon;
insert into r select 'ok', public.public_booking_confirm(pg_temp.req('a5'), pg_temp.got('code')#>>'{}');
select ok(pg_temp.got('ok')->'body'->>'booking_token' ~ '^[A-Za-z0-9_-]{43}$', 'confirmação traz o token do link da reserva');
select is(public.public_booking_confirm(pg_temp.req('a5'), '000000')->'body'->>'booking_token', pg_temp.got('ok')->'body'->>'booking_token',
  'repetir a confirmação devolve o mesmo link');
select is(pg_temp.got('ok')->'body'->>'business_name', (select tenant_name from ids), 'confirmação diz o negócio');
insert into r select 'view', public.booking_link_view(pg_temp.got('ok')->'body'->>'booking_token');
select is(pg_temp.got('view')->>'status', 'confirmed', 'o link mostra a reserva');
select ok(pg_temp.got('view')::text !~ '(5511955550102|Visitante|tenant_id|customer)', 'o link não mostra contato nem ids do negócio');
select is((pg_temp.got('view')->'review'->>'can_review')::boolean, false, 'antes de concluir, ainda não dá para avaliar');
select throws_ok($$ select public.booking_link_view('x') $$, 'PT404', 'NOT_FOUND', 'token inválido: não encontrado');
select throws_ok($$ select public.booking_link_view(repeat('A', 43)) $$, 'PT404', 'NOT_FOUND', 'token desconhecido: não encontrado');
select ok(not has_table_privilege('anon', 'public.booking_links', 'select') and not has_table_privilege('authenticated', 'public.booking_links', 'select'),
  'links sem acesso pela Data API');

-- ------------------------------------------------------------------ avaliar pelo link
reset role;
update public.bookings b set status = 'completed', starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes', occupied_range = tstzrange(now() - interval '2 hours', now() - interval '80 minutes', '[)')
from public.public_booking_requests q where q.id = pg_temp.req('a5') and b.id = q.booking_id;
select pg_temp.as_anon();
set local role anon;
insert into r select 'rev', public.booking_link_review_submit(pg_temp.got('ok')->'body'->>'booking_token', 5, 'Ótimo corte, pontual.');
select is(pg_temp.got('rev')->'review'->>'status', 'published', 'cliente sem conta avalia pelo link');
select is((public.booking_link_review_submit(pg_temp.got('ok')->'body'->>'booking_token', 5, 'Ótimo corte, pontual.')->'review'->>'id'),
  pg_temp.got('rev')->'review'->>'id', 'repetir o envio devolve a mesma avaliação');
select throws_ok(format($$ select public.booking_link_review_submit(%L, 3, null) $$, pg_temp.got('ok')->'body'->>'booking_token'),
  'PT422', 'POLICY_REJECTED', 'uma avaliação por atendimento');
select is(public.review_public_list('barbearia-p55')->'reviews'->0->>'body', 'Ótimo corte, pontual.', 'aparece na lista pública');
select ok(public.review_public_list('barbearia-p55')::text !~ 'author', 'sem autor na lista pública');
select is(public.booking_link_review_withdraw(pg_temp.got('ok')->'body'->>'booking_token')->'review'->>'status', 'withdrawn',
  'retirar pelo mesmo link');

-- ------------------------------------------------------------------ dono gera o link; outro dono não
reset role;
insert into r select 'bk', to_jsonb(booking_id) from public.public_booking_requests where id = pg_temp.req('a5');
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.booking_link_issue(%L, %L) $$, (select tenant_a from ids), pg_temp.got('bk')#>>'{}'),
  'PT403', 'FORBIDDEN', 'dono de outro negócio não gera link');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select ok(public.booking_link_issue((select tenant_a from ids), (pg_temp.got('bk')#>>'{}')::uuid)->>'token' ~ '^[A-Za-z0-9_-]{43}$',
  'o dono gera o link da reserva para mandar ao cliente');
reset role;
select ok(not exists (select 1 from public.audit_events a where a.action in ('public.book', 'public.release', 'public.resend', 'booking_link.issue', 'profile.details')
  and (coalesce(a.after::text, '') || coalesce(a.before::text, '')) ~ '(55119555501|Visitante|Rua das Flores)'), 'auditoria sem telefone, nome nem endereço');

select * from finish();
rollback;
