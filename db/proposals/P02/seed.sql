-- Proposta de acréscimo ao supabase/seed.sql (SINTÉTICO; só local/CI). IDs de fixtures.ts.
-- Serviços espelham `services` das fixtures; clientes espelham FX.customers.
insert into public.provider_services (id, tenant_id, name, duration_min, buffer_before_min, buffer_after_min,
  base_price_cents, min_price_cents, estimated_cost_cents, fee_bps, active) values
  ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Corte', 30, 0, 10, 6000, 4500, 1500, 500, true),
  ('40000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'Barba', 20, 0, 5, 4000, 3000, null, null, true),
  ('40000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'Sessão de treino', 60, 15, 15, 12000, 10000, 2000, 500, true);

insert into public.customers (id, tenant_id, name, phone, email, declared_source) values
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Cliente AB (exemplo)', null, 'cliente.ab@exemplo.test', 'referral'),
  ('30000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'Visitante sem login (exemplo)', null, null, 'walk_in'),
  ('30000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'Cliente AB (exemplo)', null, 'cliente.ab@exemplo.test', 'referral');
