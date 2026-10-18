-- Seed SINTÉTICO apenas para banco local e CI (`supabase db reset`).
-- Nunca aplicar em homologação compartilhada nem produção (não usar --include-seed).
-- IDs espelham supabase/functions/_shared/contracts/fixtures.ts (verificado em tests/contracts).
-- Senha local de todos os usuários: tinindo-local-123 (somente ambiente local).

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
   'dono.a@exemplo.test', extensions.crypt('tinindo-local-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Dono A (exemplo)"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
   'dono.b@exemplo.test', extensions.crypt('tinindo-local-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Dona B (exemplo)"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-0000000000ab', 'authenticated', 'authenticated',
   'cliente.ab@exemplo.test', extensions.crypt('tinindo-local-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Cliente AB (exemplo)"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-0000000000dd', 'authenticated', 'authenticated',
   'sem.vinculo@exemplo.test', extensions.crypt('tinindo-local-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Sem vínculo (exemplo)"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@exemplo.test';

insert into public.tenants (id, name, profession, timezone) values
  ('10000000-0000-4000-8000-00000000000a', 'Barbearia Exemplo A', 'barber', 'America/Sao_Paulo'),
  ('10000000-0000-4000-8000-00000000000b', 'Personal Exemplo B', 'personal_trainer', 'America/Sao_Paulo');

insert into public.tenant_memberships (tenant_id, user_id, role) values
  ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'owner'),
  ('10000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'owner');

insert into public.resources (id, tenant_id, name) values
  ('20000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Profissional A'),
  ('20000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', 'Profissional B');

-- P02 · catálogo e clientes (espelham services e FX.customers de fixtures.ts).
insert into public.provider_services (id, tenant_id, name, duration_min, buffer_before_min, buffer_after_min,
  base_price_cents, min_price_cents, estimated_cost_cents, fee_bps, active) values
  ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Corte', 30, 0, 10, 6000, 4500, 1500, 500, true),
  ('40000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'Barba', 20, 0, 5, 4000, 3000, null, null, true),
  ('40000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'Sessão de treino', 60, 15, 15, 12000, 10000, 2000, 500, true);

insert into public.customers (id, tenant_id, name, phone, email, declared_source) values
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Cliente AB (exemplo)', null, 'cliente.ab@exemplo.test', 'referral'),
  ('30000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'Visitante sem login (exemplo)', null, null, 'walk_in'),
  ('30000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'Cliente AB (exemplo)', null, 'cliente.ab@exemplo.test', 'referral');

-- P15 · Serviço assistido SINTÉTICO só para local/CI (preço e franquia fictícios; o catálogo real é decisão do dono).
select app.svc_publish_offering('implantacao_exemplo', 'service', 'Implantação assistida (exemplo)',
  'Cadastro inicial de serviços, horários e clientes pela equipe Tinindo.', 50000, 'one_time',
  '["Cadastro de até 20 serviços", "Horários de atendimento", "Importação de uma planilha de clientes"]',
  '["Site personalizado", "Google Meu Negócio", "Emissão fiscal"]', null, 120, 7);
