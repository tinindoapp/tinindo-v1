-- STUB SÓ PARA TESTE LOCAL do P01, aplicado como migration antes de 002_customer_links.sql.
-- Representa o mínimo que 002 usa de public.customers (contrato Customer, docs/02).
-- NÃO é proposta: a tabela real é do P02 e substitui este arquivo. Os registros de teste
-- (FX.customers) são inseridos dentro de tests/002_customer_links.test.sql.
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null,
  phone text,
  email text,
  archived_at timestamptz,
  version integer not null default 1,
  unique (tenant_id, id)
);
alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;
create policy customers_select_member on public.customers
  for select to authenticated using (app.is_member(tenant_id));
grant select on public.customers to authenticated;
