-- P06 · Lista de espera e jobs: cancelamento → candidato → oferta (hold + cotação) → aceite real; aceite
-- repetido confirma uma vez; expiração libera; worker com lease, retry e dead-letter; compartilhamento manual
-- nunca vira "entregue"; consentimento revogado tira da fila; isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '30000000-0000-4000-8000-0000000000a2'::uuid as bruno;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.at(p_days integer, p_hhmm text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + p_days) + p_hhmm::time)
         at time zone 'America/Sao_Paulo'
$$;
/** Prepara oferta para a entrada no horário (terça), cotando antes. */
create function pg_temp.offer(p_key text, p_entry uuid, p_hhmm text) returns jsonb language sql as $$
  select public.waitlist_prepare_offer((select tenant_a from ids), p_entry, pg_temp.at(1, p_hhmm),
    pg_temp.at(1, p_hhmm) + interval '30 minutes',
    (public.pricing_quote((select tenant_a from ids), (select corte_a from ids), (select res_a from ids),
      pg_temp.at(1, p_hhmm), pg_temp.at(1, p_hhmm) + interval '30 minutes')->>'quote_id')::uuid,
    p_key, pg_temp.h(p_key))
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.at(integer, text), pg_temp.offer(text, uuid, text)
  to anon, authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('waitlist_entries', 'waitlist_offers', 'waitlist_candidates', 'contact_consents')),
  'RLS ligada na lista de espera');
select ok(not has_column_privilege('authenticated', 'public.waitlist_offers', 'token_hash', 'select'), 'hash do token não é legível');
select ok(not has_function_privilege('authenticated', 'public.jobs_run(integer)', 'execute'), 'worker é só do backend');
select ok(has_function_privilege('anon', 'public.waitlist_accept_offer(text)', 'execute'), 'aceite pelo link é anônimo');

-- ------------------------------------------------------------------ dono: expediente, consentimento e entradas
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rules', public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  (select jsonb_agg(jsonb_build_object('weekday', d, 'local_start', '09:00', 'local_end', '19:00')) from generate_series(1, 5) d),
  'idem-wl-rules-0001', pg_temp.h('rules'));

select throws_ok(format($$ select public.waitlist_join(%L, %L, %L, '[{"weekday":2,"local_start":"09:00","local_end":"19:00"}]',
  gen_random_uuid(), now() + interval '30 days', 'idem-wl-noconsent1', %L) $$,
  (select tenant_a from ids), (select ana from ids), (select corte_a from ids), pg_temp.h('nc')),
  'PT422', 'POLICY_REJECTED', 'sem consentimento não entra na lista');
insert into r select 'c_ana', public.consent_record((select tenant_a from ids), (select ana from ids), 'waitlist_offer', 'manual_share',
  'idem-wl-consent-ana', pg_temp.h('c_ana'));
insert into r select 'c_bruno', public.consent_record((select tenant_a from ids), (select bruno from ids), 'waitlist_offer', 'manual_share',
  'idem-wl-consent-bru', pg_temp.h('c_bruno'));
insert into r select 'e_ana', public.waitlist_join((select tenant_a from ids), (select ana from ids), (select corte_a from ids),
  '[{"weekday":2,"local_start":"09:00","local_end":"19:00"}]', (pg_temp.got('c_ana')->'body'->>'consent_id')::uuid,
  now() + interval '30 days', 'idem-wl-join-ana-01', pg_temp.h('e_ana'));
select is(pg_temp.got('e_ana')->'body'->>'status', 'active', 'Ana entra na lista');
select throws_ok(format($$ select public.waitlist_join(%L, %L, %L, '[{"weekday":2,"local_start":"09:00","local_end":"19:00"}]',
  %L, now() + interval '30 days', 'idem-wl-join-ana-02', %L) $$, (select tenant_a from ids), (select ana from ids),
  (select corte_a from ids), pg_temp.got('c_ana')->'body'->>'consent_id', pg_temp.h('dup')),
  'PT422', 'POLICY_REJECTED', 'uma entrada aberta por cliente e serviço');
insert into r select 'e_bruno', public.waitlist_join((select tenant_a from ids), (select bruno from ids), (select corte_a from ids),
  '[{"weekday":2,"local_start":"09:00","local_end":"19:00"}]', (pg_temp.got('c_bruno')->'body'->>'consent_id')::uuid,
  now() + interval '30 days', 'idem-wl-join-bru-01', pg_temp.h('e_bruno'));

-- Reserva de outra pessoa na terça 10h, depois cancelada: libera a vaga.
insert into r select 'b10', public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  null, 'Visitante', pg_temp.at(1, '10:00'), pg_temp.at(1, '10:30'), null, 'confirm', 'idem-wl-book-10-01', pg_temp.h('b10'));
insert into r select 'b10c', public.scheduling_booking_cancel((select tenant_a from ids),
  (pg_temp.got('b10')->'body'->'booking'->>'id')::uuid, 1, 'Desmarcou', 'idem-wl-cancel-10-1', pg_temp.h('b10c'));
reset role;

-- Bruno entrou depois (na mesma transação de teste o relógio não anda).
update public.waitlist_entries set joined_at = joined_at + interval '1 minute' where id = (pg_temp.got('e_bruno')->'body'->>'id')::uuid;

-- ------------------------------------------------------------------ worker: cancelamento → candidatos
insert into r select 'run1', public.jobs_run(100);
select ok((pg_temp.got('run1')->>'done')::int >= 2, 'worker processa os eventos pendentes');
select is((select count(*)::int from public.waitlist_candidates where slot = tstzrange(pg_temp.at(1, '10:00'), pg_temp.at(1, '10:30'), '[)')),
  2, 'vaga liberada gera candidatos para as entradas compatíveis');
select is((select entry_id from public.waitlist_candidates where lower(slot) = pg_temp.at(1, '10:00')
  order by (select joined_at from public.waitlist_entries e where e.id = entry_id), entry_id limit 1),
  (pg_temp.got('e_ana')->'body'->>'id')::uuid, 'ordem estável: quem entrou primeiro');
select is((select status from public.outbox_events where aggregate_id = (pg_temp.got('b10')->'body'->'booking'->>'id')::uuid
  and event_type = 'booking.cancelled.v1'), 'done', 'evento marcado como processado');
-- Reprocessamento (worker reiniciado) não duplica.
update public.outbox_events set status = 'pending', next_run_at = now() - interval '1 second'
where aggregate_id = (pg_temp.got('b10')->'body'->'booking'->>'id')::uuid;
insert into r select 'run2', public.jobs_run(100);
select is((select count(*)::int from public.waitlist_candidates), 2, 'reprocessar o mesmo evento não duplica candidatos');

-- ------------------------------------------------------------------ oferta, link e aceite
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'o1', pg_temp.offer('idem-wl-offer-ana-1', (pg_temp.got('e_ana')->'body'->>'id')::uuid, '10:00');
select is((pg_temp.got('o1')->>'status_code')::int, 201, 'oferta preparada pelo dono');
select ok(pg_temp.got('o1')->'body'->>'token' ~ '^[A-Za-z0-9_-]{43}$', 'link com token opaco de 256 bits');
select is((select status from public.bookings where id = (pg_temp.got('o1')->'body'->>'booking_hold_id')::uuid), 'held',
  'oferta segura o horário com hold exclusivo');
select is((select source from public.bookings where id = (pg_temp.got('o1')->'body'->>'booking_hold_id')::uuid), 'waitlist',
  'hold criado pela agenda com origem lista de espera');
select ok((pg_temp.got('o1')->'body'->>'expires_at')::timestamptz <= now() + interval '15 minutes', 'prazo = menor entre hold e cotação');
select is(public.waitlist_prepare_offer((select tenant_a from ids), (pg_temp.got('e_ana')->'body'->>'id')::uuid,
  pg_temp.at(1, '10:00'), pg_temp.at(1, '10:00') + interval '30 minutes', (pg_temp.got('o1')->'body'->>'quote_id')::uuid,
  'idem-wl-offer-ana-1', pg_temp.h('idem-wl-offer-ana-1'))->'body'->'token', 'null'::jsonb, 'repetição não reexibe o token');
select is((select count(*)::int from public.waitlist_offers), 1, 'repetir não cria segunda oferta');
select throws_ok(format($$ select public.waitlist_prepare_offer(%L, %L, %L, %L,
  (public.pricing_quote(%L, %L, %L, %L, %L)->>'quote_id')::uuid, 'idem-wl-offer-bru-1', %L) $$,
  (select tenant_a from ids), pg_temp.got('e_bruno')->'body'->>'id', pg_temp.at(1, '10:00'), pg_temp.at(1, '10:30'),
  (select tenant_a from ids), (select corte_a from ids), (select res_a from ids), pg_temp.at(1, '10:00'), pg_temp.at(1, '10:30'),
  pg_temp.h('bru1')), 'PT409', 'SLOT_CONFLICT', 'uma pessoa de cada vez: o mesmo horário não vai a duas ofertas');
insert into r select 'shared', public.waitlist_mark_shared((select tenant_a from ids), (pg_temp.got('o1')->'body'->>'id')::uuid,
  'idem-wl-shared-0001', pg_temp.h('sh'));
select is(pg_temp.got('shared')->'body'->>'delivery_state', 'share_opened', 'compartilhar marca só "abriu o compartilhamento"');
reset role;
select throws_ok(format($$ update public.waitlist_offers set delivery_state = 'delivered' where id = %L $$,
  pg_temp.got('o1')->'body'->>'id'), '23514', null, 'compartilhamento manual nunca vira "entregue"');

set local role anon;
insert into r select 'view', public.waitlist_offer_view(pg_temp.got('o1')->'body'->>'token');
select is(pg_temp.got('view')->>'status', 'offered', 'abrir o link mostra a oferta');
select ok(pg_temp.got('view')::text !~ '10000000-0000-4000-8000-00000000000a', 'link não expõe o tenant');
reset role;
select is((select status from public.waitlist_offers where id = (pg_temp.got('o1')->'body'->>'id')::uuid), 'offered',
  'abrir o link não aceita');
set local role anon;
insert into r select 'acc1', public.waitlist_accept_offer(pg_temp.got('o1')->'body'->>'token');
select is(pg_temp.got('acc1')->'booking'->>'status', 'confirmed', 'aceite confirma a reserva');
select is(public.waitlist_accept_offer(pg_temp.got('o1')->'body'->>'token'), pg_temp.got('acc1'), 'clique duplicado devolve a mesma reserva');
select throws_ok($$ select public.waitlist_accept_offer('nao-existe-token-nao-existe-token-nao-exist') $$, 'PT404', 'NOT_FOUND',
  'token desconhecido → 404');
reset role;
select is((select count(*)::int from public.bookings where starts_at = pg_temp.at(1, '10:00') and status = 'confirmed'), 1,
  'uma única reserva confirmada');
select is((select agreed_price_cents::int from public.bookings where id = (pg_temp.got('o1')->'body'->>'booking_hold_id')::uuid),
  6000, 'preço da cotação congelado');
select is((select status from public.waitlist_entries where id = (pg_temp.got('e_ana')->'body'->>'id')::uuid), 'fulfilled',
  'entrada atendida');

-- ------------------------------------------------------------------ expiração libera
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'o2', pg_temp.offer('idem-wl-offer-bru-2', (pg_temp.got('e_bruno')->'body'->>'id')::uuid, '14:00');
reset role;
update public.waitlist_offers set expires_at = clock_timestamp() - interval '1 second' where id = (pg_temp.got('o2')->'body'->>'id')::uuid;
set local role anon;
select throws_ok(format($$ select public.waitlist_accept_offer(%L) $$, pg_temp.got('o2')->'body'->>'token'),
  'PT422', 'POLICY_REJECTED', 'aceite depois do prazo negado');
reset role;
insert into r select 'run3', public.jobs_run(100);
select is((pg_temp.got('run3')->>'expired_offers')::int, 1, 'worker expira a oferta vencida');
select is((select status from public.bookings where id = (pg_temp.got('o2')->'body'->>'booking_hold_id')::uuid), 'expired',
  'hold da oferta vencida liberado');
select is((select count(*)::int from public.outbox_events where event_type = 'waitlist.offer.expired.v1'), 1,
  'expiração emite um evento');
select is((select status from public.waitlist_entries where id = (pg_temp.got('e_bruno')->'body'->>'id')::uuid), 'active',
  'entrada volta para a fila');
insert into r select 'run4', public.jobs_run(100);
select is((select count(*)::int from public.outbox_events where event_type = 'waitlist.offer.expired.v1'), 1,
  'rodar de novo não emite expiração duplicada');

-- ------------------------------------------------------------------ recusa devolve o horário
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'o3', pg_temp.offer('idem-wl-offer-bru-3', (pg_temp.got('e_bruno')->'body'->>'id')::uuid, '15:00');
set local role anon;
select is(public.waitlist_decline_offer(pg_temp.got('o3')->'body'->>'token')->>'status', 'declined', 'cliente recusa pelo link');
reset role;
select is((select status from public.bookings where id = (pg_temp.got('o3')->'body'->>'booking_hold_id')::uuid), 'cancelled',
  'recusa libera o horário');

-- ------------------------------------------------------------------ worker: lease vencido, retry e dead-letter
insert into public.outbox_events (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, status, leased_until, attempts)
values ((select tenant_a from ids), 'payment.recorded.v1', gen_random_uuid(), 1, gen_random_uuid(), 'processing',
  clock_timestamp() - interval '1 minute', 1);
insert into public.outbox_events (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, max_attempts)
values ((select tenant_a from ids), 'test.poison.v1', gen_random_uuid(), 1, gen_random_uuid(), 2);
insert into r select 'run5', public.jobs_run(100);
select is((select status from public.outbox_events where event_type = 'payment.recorded.v1'), 'done',
  'evento com lease vencido (worker caiu) é retomado');
select is((select status || ':' || attempts from public.outbox_events where event_type = 'test.poison.v1'), 'pending:1',
  'falha volta para a fila com tentativa contada');
select ok((select next_run_at > clock_timestamp() and last_error is not null from public.outbox_events where event_type = 'test.poison.v1'),
  'retry com backoff e erro registrado');
update public.outbox_events set next_run_at = clock_timestamp() - interval '1 second' where event_type = 'test.poison.v1';
insert into r select 'run6', public.jobs_run(100);
select is((select status from public.outbox_events where event_type = 'test.poison.v1'), 'dead', 'esgotou tentativas → dead-letter');

-- ------------------------------------------------------------------ consentimento revogado e isolamento
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rev', public.consent_revoke((select tenant_a from ids), (pg_temp.got('c_bruno')->'body'->>'consent_id')::uuid,
  'idem-wl-revoke-0001', pg_temp.h('rev'));
select is((select status from public.waitlist_entries where id = (pg_temp.got('e_bruno')->'body'->>'id')::uuid), 'withdrawn',
  'consentimento revogado tira da fila');
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is((select count(*)::int from public.waitlist_entries), 0, 'dono B não lê a lista de A');
select throws_ok(format($$ select public.waitlist_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'dono B não lista ofertas de A');
reset role;
set local role anon;
select throws_ok('select * from public.waitlist_entries', '42501', null, 'anon não lê a lista');
reset role;

select * from finish();
rollback;
