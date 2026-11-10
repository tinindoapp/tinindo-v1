-- Migration nova (ex.: 2026111x_indices_nucleo.sql)
create index payment_entries_receivable on public.payment_entries (tenant_id, receivable_id) where receivable_id is not null;
create index receivables_customer on public.receivables (tenant_id, customer_id, created_at desc);
drop index public.bookings_customer; -- coberto por bookings_customer_starts (mesmo prefixo e mesmo predicado)
