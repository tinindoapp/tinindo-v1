-- P34 · avisos no celular: assinatura por aparelho só da própria pessoa; fila pela rotina dos jobs com o primeiro nome
-- e nada mais; uma vez só (dedupe e prazo de envio); preferências por tipo; quem cancelou não recebe o próprio aviso.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || '/' || sqlerrm;
end $$;

-- Endereços e chaves com o formato que o navegador gera.
create temp table k as select
  'https://fcm.googleapis.com/fcm/send/aparelho-a1' as ep_a,
  'https://fcm.googleapis.com/fcm/send/aparelho-b1' as ep_b,
  'B' || repeat('A', 86) as p256dh,
  repeat('C', 22) as auth;
grant select on k to authenticated;

-- 1 · assinar
select pg_temp.login_as('a0000000-0000-4000-8000-00000000000a');
set local role authenticated;
select is(public.push_subscribe('10000000-0000-4000-8000-00000000000a', (select ep_a from k), (select p256dh from k), (select auth from k), 'Celular')
  -> 'prefs', '{"booking_new": true, "reminder_30": true, "daily_summary": false, "booking_cancelled": true}'::jsonb,
  'dono assina o aparelho; padrão: reserva nova, cancelamento e lembrete ligados, resumo do dia desligado');
select is(split_part(pg_temp.err($$select public.push_subscribe('10000000-0000-4000-8000-00000000000b', 'https://x.test/1', 'B' || repeat('A', 86), repeat('C', 22))$$), '/', 1),
  'PT403', 'não assina em negócio de que não é membro');
select is(split_part(pg_temp.err($$select public.push_subscribe('10000000-0000-4000-8000-00000000000a', 'http://inseguro.test/1', 'B' || repeat('A', 86), repeat('C', 22))$$), '/', 1),
  '23514', 'endereço sem https é recusado');
select is(public.push_device('10000000-0000-4000-8000-00000000000a', (select ep_a from k)) ->> 'device_label', 'Celular', 'vê a própria assinatura');
select is(split_part(pg_temp.err($$select public.push_claim(10)$$), '/', 1), '42501', 'pessoa logada não pega a fila de envio');
select is(split_part(pg_temp.err($$select count(*) from public.push_deliveries$$), '/', 1), '42501', 'pessoa logada não lê a fila');
reset role;

select pg_temp.login_as('b0000000-0000-4000-8000-00000000000b');
set local role authenticated;
select is((select count(*) from public.push_subscriptions)::int, 0, 'B não vê a assinatura de A');
select is(public.push_device('10000000-0000-4000-8000-00000000000b', (select ep_a from k)), null, 'B não acha o aparelho de A no negócio dele');
select is(split_part(pg_temp.err($$select public.push_prefs_save('10000000-0000-4000-8000-00000000000a', 'https://fcm.googleapis.com/fcm/send/aparelho-a1', '{"booking_new": false}')$$), '/', 1),
  'PT403', 'B não muda as preferências do aparelho de A');
select is((public.push_unsubscribe('10000000-0000-4000-8000-00000000000b', (select ep_a from k)) ->> 'removed')::boolean, false,
  'B não cancela o aparelho de A');
reset role;

-- 2 · rotina da fila: reserva nova pelo link vira um aviso com o primeiro nome só.
insert into public.customers (id, tenant_id, name, phone, email, declared_source)
values ('30000000-0000-4000-8000-0000000000c9', '10000000-0000-4000-8000-00000000000a', 'Ana Maria Souza', '+5511987654321', 'ana@exemplo.test', 'walk_in');
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source)
values ('50000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a',
  '30000000-0000-4000-8000-0000000000c9', '40000000-0000-4000-8000-0000000000a1',
  '2031-03-06 17:00:00+00', '2031-03-06 17:30:00+00', tstzrange('2031-03-06 17:00:00+00', '2031-03-06 17:40:00+00', '[)'), true, 'confirmed', 'public_link');
select app.emit_event('10000000-0000-4000-8000-00000000000a', 'booking.confirmed.v1', '50000000-0000-4000-8000-0000000000c1', 1, gen_random_uuid(),
  jsonb_build_object('source', 'public_link', 'starts_at', '2031-03-06T17:00:00Z'));
-- Reserva feita pelo próprio dono não vira "reserva nova pelo link".
select app.emit_event('10000000-0000-4000-8000-00000000000a', 'booking.confirmed.v1', '50000000-0000-4000-8000-0000000000c1', 1, gen_random_uuid(),
  jsonb_build_object('source', 'owner', 'starts_at', '2031-03-06T17:00:00Z'));
select app.push_tick(200);
select is((select count(*) from public.push_deliveries where kind = 'booking_new')::int, 1, 'reserva pelo link: um aviso; a do dono, nenhum');
select is((select body from public.push_deliveries where kind = 'booking_new'), 'Corte · Ana · qui 06/03, 14:00',
  'texto: serviço, primeiro nome e dia/hora no fuso do negócio');
select ok((select bool_and(body !~ '(Souza|Maria|98765|@|R\$)') from public.push_deliveries), 'nada de sobrenome, telefone, e-mail ou valor');
select is((select url from public.push_deliveries where kind = 'booking_new'), '/app/agenda?dia=2031-03-06', 'abre a agenda do dia');
select app.push_tick(200);
select is((select count(*) from public.push_deliveries)::int, 1, 'rodar de novo não duplica (cursor e deduplicação)');

-- 3 · preferência desligada: nada na fila.
select pg_temp.login_as('a0000000-0000-4000-8000-00000000000a');
set local role authenticated;
select is(public.push_prefs_save('10000000-0000-4000-8000-00000000000a', (select ep_a from k), '{"booking_new": false}') #>> '{prefs,booking_new}',
  'false', 'desliga "reserva nova" neste aparelho');
reset role;
select app.emit_event('10000000-0000-4000-8000-00000000000a', 'booking.confirmed.v1', '50000000-0000-4000-8000-0000000000c1', 2, gen_random_uuid(),
  jsonb_build_object('source', 'public_link', 'starts_at', '2031-03-06T17:00:00Z'));
select app.push_tick(200);
select is((select count(*) from public.push_deliveries where kind = 'booking_new')::int, 1, 'com o tipo desligado, a reserva nova não entra');

-- 4 · cancelamento: quem cancelou não recebe; outra pessoa sim.
insert into public.audit_events (tenant_id, actor_user_id, action, object_type, object_id, request_id)
values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'booking.cancel', 'booking', '50000000-0000-4000-8000-0000000000c1',
  'e1000000-0000-4000-8000-000000000001');
select app.emit_event('10000000-0000-4000-8000-00000000000a', 'booking.cancelled.v1', '50000000-0000-4000-8000-0000000000c1', 3, 'e1000000-0000-4000-8000-000000000001',
  jsonb_build_object('source', 'public_link', 'starts_at', '2031-03-06T17:00:00Z'));
select app.push_tick(200);
select is((select count(*) from public.push_deliveries where kind = 'booking_cancelled')::int, 0, 'o aparelho de quem cancelou não recebe o aviso');
insert into public.audit_events (tenant_id, actor_user_id, action, object_type, object_id, request_id)
values ('10000000-0000-4000-8000-00000000000a', null, 'agent.booking.cancel', 'booking', '50000000-0000-4000-8000-0000000000c1',
  'e1000000-0000-4000-8000-000000000002');
select app.emit_event('10000000-0000-4000-8000-00000000000a', 'booking.cancelled.v1', '50000000-0000-4000-8000-0000000000c1', 4, 'e1000000-0000-4000-8000-000000000002',
  jsonb_build_object('source', 'public_link', 'starts_at', '2031-03-06T17:00:00Z'));
select app.push_tick(200);
select is((select string_agg(title, ',') from public.push_deliveries where kind = 'booking_cancelled'), 'Atendimento cancelado',
  'cancelamento de outra origem chega, uma vez; o de quem cancelou continua de fora (relendo a janela)');

-- 5 · lembrete 30 min antes, uma vez só.
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source)
select '50000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a',
  '30000000-0000-4000-8000-0000000000c9', '40000000-0000-4000-8000-0000000000a2', now() + interval '30 minutes', now() + interval '50 minutes',
  tstzrange(now() + interval '30 minutes', now() + interval '55 minutes', '[)'), true, 'confirmed', 'owner';
select app.push_tick(200);
select app.push_tick(200);
select is((select count(*) from public.push_deliveries where kind = 'reminder_30')::int, 1, 'lembrete de 30 min entra uma vez');

-- 6 · entrega: um lote com prazo; a segunda rodada não pega o mesmo; resultado anotado.
create temp table ids as select id, kind from public.push_deliveries;
grant select on ids to service_role;
set local role service_role;
select is(jsonb_array_length(public.push_claim(50)), 3, 'a rodada de envio pega os 3 prontos');
select is(jsonb_array_length(public.push_claim(50)), 0, 'outra rodada em paralelo não pega os mesmos (prazo de 2 min)');
select public.push_report(d.id, 'sent', 201) from ids d where d.kind = 'booking_new';
select public.push_report(d.id, 'sent', 201) from ids d where d.kind = 'booking_new';
reset role;
select is((select status || '/' || attempts from public.push_deliveries where kind = 'booking_new'), 'sent/1', 'enviado uma vez; anotar de novo não muda');
set local role service_role;
select public.push_report(d.id, 'failed', 500) from ids d where d.kind = 'reminder_30';
reset role;
select is((select status from public.push_deliveries where kind = 'reminder_30'), 'pending', 'falha volta para a fila com espera');
select ok((select next_attempt_at > now() from public.push_deliveries where kind = 'reminder_30'), 'e só tenta de novo mais tarde');
set local role service_role;
select public.push_report(d.id, 'gone', 410) from ids d where d.kind = 'booking_cancelled';
reset role;
select is((select count(*) from public.push_subscriptions where endpoint = (select ep_a from k))::int, 0,
  'serviço de push disse que o aparelho saiu (410): a assinatura sai');
select is((select count(*) from public.push_deliveries)::int, 0, 'e a fila dela vai junto');

select is((select count(*) from public.job_ticks where name = 'push' and fn = 'app.push_tick')::int, 1, 'rotina registrada na fila dos jobs');

select * from finish();
rollback;
