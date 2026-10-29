-- P09 · Rede: perfil público sem vazamento do CRM, convites com token opaco (só hash no banco),
-- inspeção que não aceita, claim com contato verificado e uso único, convite que não vira nota.
-- Roda depois da fundação + seed sintético (NET-01, SEC-01).
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  'e0000000-0000-4000-8000-0000000000ee'::uuid as unconfirmed,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;

-- Resultado de chamadas intermediárias (tokens só existem na resposta do create).
create temp table got (k text primary key, v jsonb);
grant select, insert, update on got to anon, authenticated;

-- Usuário com e-mail NÃO confirmado: não comprova controle do contato.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-4000-8000-0000000000ee', 'authenticated',
  'authenticated', 'nao.confirmado@exemplo.test', '', null, '{}', '{}', now(), now(), '', '', '', '');

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.logout() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- ------------------------------------------------------------------ estrutura e privilégios
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('public_profiles', 'referrals')),
  'RLS habilitada em public_profiles e referrals'
);
select ok(not has_table_privilege('anon', 'public.public_profiles', 'select'), 'anon não lê a tabela de perfis');
select ok(not has_table_privilege('anon', 'public.referrals', 'select'), 'anon não lê convites');
select ok(not has_column_privilege('authenticated', 'public.referrals', 'token_hash', 'select'),
  'authenticated não lê token_hash');
select ok(not has_table_privilege('authenticated', 'public.referrals', 'insert')
  and not has_table_privilege('authenticated', 'public.public_profiles', 'update'),
  'escrita direta negada: só por RPC');
select ok(not has_function_privilege('anon', 'public.network_profile_publish(uuid, text, text, text, text[], text, text)', 'execute')
  and not has_function_privilege('anon', 'public.network_referral_claim(text)', 'execute')
  and not has_function_privilege('anon', 'public.network_referral_create(text, uuid, text, text, text, text, text)', 'execute'),
  'anon não publica, não cria convite e não faz claim');
select ok(has_function_privilege('anon', 'public.network_public_profile(text)', 'execute')
  and has_function_privilege('anon', 'public.network_referral_inspect(text)', 'execute'),
  'anon lê perfil publicado e inspeciona convite');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name in ('referrals', 'public_profiles')
     and column_name ~ '(phone|telefone|rating|score|stars|review|token)$'),
  0,
  'sem coluna de telefone, nota/avaliação ou token em claro'
);

-- ------------------------------------------------------------------ profile.publish
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;

select throws_ok(
  $$ select public.network_profile_publish((select tenant_b from ids), 'invasor', 'barber', 'Centro',
       array['display_name'], 'pub-key-0000000001', repeat('a', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono A não publica perfil do tenant B'
);
select throws_ok(
  $$ select public.network_profile_publish((select tenant_a from ids), 'barbearia-a', 'barber', 'Centro',
       array['display_name', 'telefone'], 'pub-key-0000000002', repeat('b', 64)) $$,
  '23514', null, 'campo fora da whitelist é recusado'
);
insert into got values ('pub1', (select public.network_profile_publish((select tenant_a from ids), 'barbearia-a',
  'barber', 'Centro', array['display_name', 'area', 'booking_link'], 'pub-key-0000000003', repeat('c', 64))));
select is((select v -> 'body' ->> 'slug' from got where k = 'pub1'), 'barbearia-a', 'dono A publica o perfil');
select is(
  (select public.network_profile_publish((select tenant_a from ids), 'barbearia-a', 'barber', 'Centro',
     array['display_name', 'area', 'booking_link'], 'pub-key-0000000003', repeat('c', 64))),
  (select v from got where k = 'pub1'),
  'repetição com a mesma chave devolve a resposta original'
);
select throws_ok(
  $$ select public.network_profile_publish((select tenant_a from ids), 'outro-slug', 'barber', 'Centro',
       array['display_name'], 'pub-key-0000000003', repeat('d', 64)) $$,
  'PT409', 'IDEMPOTENCY_MISMATCH', 'mesma chave com outro payload → 409'
);
select is((select count(*)::int from public.public_profiles), 1, 'dono A lê só o próprio perfil');
reset role;

select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is((select count(*)::int from public.public_profiles), 0, 'dono B não lê o perfil de A pela tabela');
select throws_ok(
  $$ select public.network_profile_publish((select tenant_b from ids), 'barbearia-a', 'personal_trainer', 'Sul',
       array['display_name'], 'pub-key-0000000004', repeat('e', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'slug de outro negócio é recusado'
);
select throws_ok(
  $$ select public.network_profile_get((select tenant_a from ids)) $$,
  'PT403', 'FORBIDDEN', 'dono B não lê o rascunho de A'
);
reset role;

select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select throws_ok(
  $$ select public.network_profile_publish((select tenant_a from ids), 'cliente-tenta', 'barber', 'Centro',
       array['display_name'], 'pub-key-0000000005', repeat('f', 64)) $$,
  'PT403', 'FORBIDDEN', 'cliente não publica perfil do negócio'
);
reset role;

-- ------------------------------------------------------------------ leitura pública
select pg_temp.logout();
set local role anon;
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.network_public_profile('barbearia-a')) k),
  array['area', 'category', 'photo', 'public_fields', 'published_at', 'reputation', 'slug', 'values', 'whatsapp_e164'],
  'perfil público tem só a projeção fixa (sem tenant_id, contatos, versão nem as chaves do dono)'
);
select is(
  public.network_public_profile('barbearia-a') -> 'values',
  '{"display_name": "Barbearia Exemplo A"}'::jsonb,
  'valores públicos só dos campos escolhidos pelo profissional'
);
select is(
  public.network_public_profile('barbearia-a') -> 'reputation',
  '{"identity_verified": false, "reviews_count": 0}'::jsonb,
  'perfil novo sem avaliações nem verificação'
);
select throws_ok($$ select public.network_public_profile('nao-existe') $$, 'PT404', 'NOT_FOUND',
  'slug inexistente → 404');
select throws_ok($$ select * from public.public_profiles $$, '42501', null, 'anon não consulta a tabela');
reset role;

-- ------------------------------------------------------------------ referral.create
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into got values ('peer', (select public.network_referral_create('professional_invites_peer',
  (select tenant_a from ids), 'Colega Exemplo', 'barber', 'web', 'ref-key-0000000001', repeat('1', 64))));
select ok((select v ->> 'token' ~ '^[A-Za-z0-9_-]{43}$' from got where k = 'peer'), 'token opaco de 256 bits');
select throws_ok(
  $$ select public.network_referral_create('professional_invites_peer', (select tenant_b from ids),
       'Colega', null, 'web', 'ref-key-0000000002', repeat('2', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono A não convida em nome do tenant B'
);
insert into got values ('peer_replay', (select public.network_referral_create('professional_invites_peer',
  (select tenant_a from ids), 'Colega Exemplo', 'barber', 'web', 'ref-key-0000000001', repeat('1', 64))));
select is(
  (select (select v ->> 'referral_id' from got where k = 'peer_replay') = (select v ->> 'referral_id' from got where k = 'peer')),
  true,
  'repetição devolve o mesmo convite'
);
select throws_ok(
  $$ select public.network_referral_create('professional_invites_peer', (select tenant_a from ids),
       'Outro Nome', 'barber', 'web', 'ref-key-0000000001', repeat('3', 64)) $$,
  'PT409', 'IDEMPOTENCY_MISMATCH', 'mesma chave com outro payload → 409'
);
reset role;

select ok(
  (select r.token_hash = encode(extensions.digest((select v ->> 'token' from got where k = 'peer_replay'), 'sha256'), 'hex')
   from public.referrals r where r.id = (select (v ->> 'referral_id')::uuid from got where k = 'peer')),
  'banco guarda só o sha256 do token vigente'
);
select is(
  (select count(*)::int from public.referrals r, got g
   where g.k in ('peer', 'peer_replay') and to_jsonb(r)::text like '%' || (g.v ->> 'token') || '%'),
  0,
  'token em claro não aparece em nenhuma coluna'
);

select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
insert into got values ('rec', (select public.network_referral_create('customer_recommends_professional',
  null, 'Profissional Indicado', 'hairdresser', 'web', 'ref-key-0000000010', repeat('4', 64))));
select ok((select v ? 'token' from got where k = 'rec'), 'cliente indica profissional sem ser membro de negócio');
select throws_ok(
  $$ select public.network_referral_create('customer_recommends_professional', (select tenant_a from ids),
       'X', null, 'web', 'ref-key-0000000011', repeat('5', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'indicação do cliente não carrega tenant'
);
select is((select count(*)::int from public.referrals), 1, 'cliente lê só as próprias indicações');
reset role;

-- ------------------------------------------------------------------ inspect não aceita
select pg_temp.logout();
set local role anon;
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.network_referral_inspect(
     (select v ->> 'token' from got where k = 'peer_replay'))) k),
  array['expires_at', 'invitee_category', 'inviter_profile_slug', 'kind', 'state'],
  'inspeção mostra detalhes mínimos (sem nome do indicado)'
);
select is(
  public.network_referral_inspect((select v ->> 'token' from got where k = 'peer_replay')) ->> 'inviter_profile_slug',
  'barbearia-a',
  'inspeção aponta só para o perfil público de quem convidou'
);
select throws_ok(
  format('select public.network_referral_inspect(%L)', (select v ->> 'token' from got where k = 'peer')),
  'PT404', 'NOT_FOUND', 'link anterior deixa de valer após a repetição'
);
reset role;
select is(
  (select status from public.referrals where id = (select (v ->> 'referral_id')::uuid from got where k = 'peer')),
  'pending',
  'inspecionar não muda o estado do convite'
);

-- ------------------------------------------------------------------ claim
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(
  format('select public.network_referral_claim(%L)', (select v ->> 'token' from got where k = 'peer_replay')),
  'PT422', 'POLICY_REJECTED', 'quem convidou não aceita o próprio convite'
);
reset role;

select pg_temp.login_as((select unconfirmed from ids));
set local role authenticated;
select throws_ok(
  format('select public.network_referral_claim(%L)', (select v ->> 'token' from got where k = 'peer_replay')),
  'PT403', 'FORBIDDEN', 'claim exige contato confirmado'
);
reset role;

select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is(
  public.network_referral_claim((select v ->> 'token' from got where k = 'peer_replay')) ->> 'state',
  'claimed',
  'dono B com e-mail confirmado aceita o convite de colega'
);
select is(
  public.network_referral_claim((select v ->> 'token' from got where k = 'peer_replay')) ->> 'state',
  'claimed',
  'repetir o claim pelo mesmo usuário é idempotente'
);
select is((select count(*)::int from public.referrals), 0, 'dono B não lê os convites de A');
reset role;

select is(
  (select claimed_tenant_id from public.referrals where id = (select (v ->> 'referral_id')::uuid from got where k = 'peer')),
  (select tenant_b from ids),
  'atribuição registra o negócio de quem aceitou'
);

select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select throws_ok(
  format('select public.network_referral_claim(%L)', (select v ->> 'token' from got where k = 'peer_replay')),
  'PT422', 'POLICY_REJECTED', 'convite é de uso único'
);
reset role;

update public.referrals set expires_at = now() - interval '1 second'
where id = (select (v ->> 'referral_id')::uuid from got where k = 'rec');
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select throws_ok(
  format('select public.network_referral_claim(%L)', (select v ->> 'token' from got where k = 'rec')),
  'PT422', 'POLICY_REJECTED', 'convite vencido não é aceito'
);
reset role;

-- Convite aceito não altera reputação do perfil de quem convidou nem de quem aceitou.
select pg_temp.logout();
set local role anon;
select is(
  public.network_public_profile('barbearia-a') -> 'reputation',
  '{"identity_verified": false, "reviews_count": 0}'::jsonb,
  'convite de colega não vira avaliação nem nota'
);
reset role;

-- ------------------------------------------------------------------ cota e remoção
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select lives_ok(
  $$ select public.network_referral_create('customer_recommends_professional', null, 'Indicado ' || g, null, 'web',
       'quota-key-' || lpad(g::text, 8, '0'), repeat('6', 64)) from generate_series(1, 19) g $$,
  'até 20 indicações por dia'
);
select throws_ok(
  $$ select public.network_referral_create('customer_recommends_professional', null, 'Excesso', null, 'web',
       'quota-key-99999999', repeat('7', 64)) $$,
  'PT429', 'QUOTA_EXCEEDED', 'acima da cota diária → 429'
);
reset role;

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select public.network_profile_unpublish((select tenant_a from ids), 'unpub-key-00000001', repeat('8', 64));
reset role;
select pg_temp.logout();
set local role anon;
select throws_ok($$ select public.network_public_profile('barbearia-a') $$, 'PT404', 'NOT_FOUND',
  'perfil removido pelo profissional some da leitura pública');
reset role;

select * from finish();
rollback;
