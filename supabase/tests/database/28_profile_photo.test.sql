-- P09 · Foto do perfil e chaves do perfil público (recado #64, item 4): bucket com limite e tipos, gravação no Storage
-- só por membro do negócio na própria pasta (isolamento A/B), foto que precisa estar no bucket, chaves auditadas e o
-- público recebendo só o que o dono ligou (foto, WhatsApp do canal verificado, preço "a partir de").
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '10000000-0000-4000-8000-00000000000a/5f0c3b6e-1d2a-4c3b-9e8f-0a1b2c3d4e5f.webp'::text as photo_a,
  '10000000-0000-4000-8000-00000000000a/6a1d4c7f-2e3b-4d4c-8f90-1b2c3d4e5f60.webp'::text as missing_a,
  '10000000-0000-4000-8000-00000000000b/7b2e5d80-3f4c-4e5d-9a01-2c3d4e5f6071.webp'::text as photo_b,
  (select t.name from public.tenants t where t.id = '10000000-0000-4000-8000-00000000000a') as name_a;
grant select on ids to anon, authenticated;
create temp table got (k text primary key, v jsonb);
grant select, insert, update on got to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
-- O Supabase recusa DELETE direto em storage.objects sem esta variável; aqui só a política decide.
select set_config('storage.allow_delete_query', 'true', true);

-- Número do negócio A conectado e verificado no canal: é ele que o botão do WhatsApp usa.
insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
values ((select tenant_a from ids), 'simulated', '+5511933334444', '+5511933334444', 'active', now());

-- ------------------------------------------------------------------ bucket e políticas
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'profile-photos' $$,
  $$ values (true, 2097152::bigint, array['image/webp', 'image/jpeg']) $$,
  'bucket profile-photos: público, até 2 MB, só WebP e JPEG'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'profile_photos_%'),
  4, 'quatro políticas de profile-photos (gravar, trocar, apagar, listar)'
);
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'profile_photos_%' and 'anon' = any (roles)), 0, 'nenhuma política para anon');

-- ------------------------------------------------------------------ dono A: grava na própria pasta, não na de B
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into got values ('pub', (select public.network_profile_publish((select tenant_a from ids), 'barbearia-foto', 'barber',
  'Centro', array['display_name', 'area', 'booking_link'], 'foto-pub-000000001', repeat('a', 64))));
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('profile-photos', (select photo_a from ids)) $$,
  'dono A grava a foto na pasta de A'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('profile-photos', (select photo_b from ids)) $$,
  '42501', null, 'dono A não grava na pasta de B'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('profile-photos', '10000000-0000-4000-8000-00000000000a/foto.png') $$,
  '42501', null, 'caminho fora do formato {tenant}/{uuid}.webp é recusado'
);
select throws_ok(
  $$ select public.network_profile_media_set((select tenant_a from ids), (select photo_b from ids), null, true, false, false,
       'foto-media-00000001', repeat('b', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'perfil de A não aponta para foto da pasta de B'
);
select throws_ok(
  $$ select public.network_profile_media_set((select tenant_a from ids), (select missing_a from ids), null, true, false, false,
       'foto-media-00000002', repeat('c', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'foto que não está no bucket é recusada'
);
select throws_ok(
  $$ select public.network_profile_media_set((select tenant_a from ids), null, null, true, false, false,
       'foto-media-00000003', repeat('d', 64)) $$,
  'PT422', 'POLICY_REJECTED', '"Mostrar foto" sem foto é recusado'
);
insert into got values ('m1', (select public.network_profile_media_set((select tenant_a from ids), (select photo_a from ids), null,
  true, true, false, 'foto-media-00000004', repeat('e', 64))));
select is((select v -> 'body' -> 'media' ->> 'photo_alt' from got where k = 'm1'), 'Foto de ' || (select name_a from ids),
  'texto alternativo padrão: "Foto de <nome do negócio>"');
select is((select v -> 'body' -> 'media' ->> 'whatsapp_e164' from got where k = 'm1'), '+5511933334444',
  'o dono vê o número conectado no canal');
select is(
  (select public.network_profile_media_set((select tenant_a from ids), (select photo_a from ids), null,
     true, true, false, 'foto-media-00000004', repeat('e', 64))),
  (select v from got where k = 'm1'), 'repetição com a mesma chave devolve a resposta original'
);
reset role;

select is((select count(*)::int from public.audit_events a where a.tenant_id = (select tenant_a from ids) and a.action = 'profile.media'),
  1, 'troca das chaves fica na auditoria (uma vez, sem a repetição)');
select is((select a.after from public.audit_events a where a.tenant_id = (select tenant_a from ids) and a.action = 'profile.media'),
  '{"photo": true, "photo_changed": true, "show_photo": true, "show_prices": false, "show_whatsapp": true}'::jsonb,
  'auditoria sem caminho nem número, só o que mudou');

-- ------------------------------------------------------------------ público: só o que o dono ligou
set local role anon;
select is((select public.network_public_profile('barbearia-foto') -> 'photo'),
  jsonb_build_object('path', (select photo_a from ids), 'alt', 'Foto de ' || (select name_a from ids)),
  'com "Mostrar foto", o público recebe a foto e o texto alternativo');
select is((select public.network_public_profile('barbearia-foto') ->> 'whatsapp_e164'), '+5511933334444',
  'com "Mostrar botão do WhatsApp", o número do canal');
select ok(not (public.network_public_profile('barbearia-foto') ? 'media'), 'o público não recebe as chaves do dono');
select ok(public.public_booking_services('barbearia-foto')::text !~ '(price|cents)', 'sem "Mostrar preços", nenhum preço na resposta');
reset role;

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select lives_ok(
  $$ select public.network_profile_media_set((select tenant_a from ids), (select photo_a from ids), 'Fachada da barbearia',
       false, false, true, 'foto-media-00000005', repeat('f', 64)) $$,
  'dono A desliga foto e WhatsApp, liga preços e troca o texto alternativo'
);
reset role;
set local role anon;
select is((select public.network_public_profile('barbearia-foto') -> 'photo'), 'null'::jsonb, 'foto desligada: photo nulo');
select is((select public.network_public_profile('barbearia-foto') -> 'whatsapp_e164'), 'null'::jsonb, 'WhatsApp desligado: nulo');
select is((select (s ->> 'price_from_cents')::int from jsonb_array_elements(public.public_booking_services('barbearia-foto') -> 'services') s
  where s ->> 'name' = 'Corte'), 6000, 'com "Mostrar preços", "a partir de" é o preço base do serviço');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('profile-photos', (select missing_a from ids)) $$,
  '42501', null, 'visitante anônimo não grava foto');
reset role;

-- ------------------------------------------------------------------ dono B: não vê, não troca, não apaga a foto de A
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'profile-photos'), 0, 'dono B não lista a foto de A');
with d as (update storage.objects set metadata = '{}' where name = (select photo_a from ids) returning 1)
insert into got select 'upd_b', to_jsonb(count(*)) from d;
with d as (delete from storage.objects where name = (select photo_a from ids) returning 1)
insert into got select 'del_b', to_jsonb(count(*)) from d;
select is((select v from got where k = 'upd_b') || (select v from got where k = 'del_b'), '[0, 0]'::jsonb,
  'dono B não troca nem apaga a foto de A');
select throws_ok(
  $$ select public.network_profile_media_set((select tenant_a from ids), null, null, false, false, false,
       'foto-media-00000006', repeat('a', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono B não mexe nas chaves de A'
);
reset role;

-- ------------------------------------------------------------------ dono A apaga a própria foto (troca de foto)
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
with d as (delete from storage.objects where name = (select photo_a from ids) returning 1)
insert into got select 'del_a', to_jsonb(count(*)) from d;
select is((select v from got where k = 'del_a'), '1'::jsonb, 'dono A apaga a foto anterior da própria pasta');
reset role;

select * from finish();
rollback;
