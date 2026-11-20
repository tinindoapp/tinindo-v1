-- P56 · FKs compostas nos estornos e índices do núcleo (revisão de 10/11, be-banco-10 e be-banco-11).

-- Seis FKs entre tabelas com `tenant_id` usavam só o `id`: o banco aceitaria um estorno apontando para o lançamento
-- de outro negócio (hoje só as funções gravam e elas conferem). A FK simples antiga continua; a composta soma.
alter table public.payment_entries add constraint payment_entries_reversal_same_tenant
  foreign key (tenant_id, reversal_of) references public.payment_entries (tenant_id, id) on delete restrict not valid;
alter table public.payment_entries validate constraint payment_entries_reversal_same_tenant;
alter table public.expense_entries add constraint expense_entries_reversal_same_tenant
  foreign key (tenant_id, reversal_of) references public.expense_entries (tenant_id, id) on delete restrict not valid;
alter table public.expense_entries validate constraint expense_entries_reversal_same_tenant;
alter table public.session_entries add constraint session_entries_reversal_same_tenant
  foreign key (tenant_id, reversal_of) references public.session_entries (tenant_id, id) on delete restrict not valid;
alter table public.session_entries validate constraint session_entries_reversal_same_tenant;
alter table public.material_movements add constraint material_movements_reversal_same_tenant
  foreign key (tenant_id, reversal_of) references public.material_movements (tenant_id, id) on delete restrict not valid;
alter table public.material_movements validate constraint material_movements_reversal_same_tenant;
alter table public.team_commission_entries add constraint team_commission_entries_reversal_same_tenant
  foreign key (tenant_id, reversal_of) references public.team_commission_entries (tenant_id, id) on delete restrict not valid;
alter table public.team_commission_entries validate constraint team_commission_entries_reversal_same_tenant;
alter table public.public_booking_requests add constraint public_booking_requests_tenant_id_id_key unique (tenant_id, id);
alter table public.public_booking_requests add constraint public_booking_requests_replaced_same_tenant
  foreign key (tenant_id, replaced_request_id) references public.public_booking_requests (tenant_id, id) not valid;
alter table public.public_booking_requests validate constraint public_booking_requests_replaced_same_tenant;

-- Índices: os dois que faltavam no núcleo (pagamentos de um recebível; recebíveis de um cliente).
create index payment_entries_tenant_receivable on public.payment_entries (tenant_id, receivable_id) where receivable_id is not null;
create index receivables_tenant_customer on public.receivables (tenant_id, customer_id, created_at desc);
-- `bookings_customer` é coberto por `bookings_customer_starts` (mesmo prefixo e mesmo predicado).
drop index public.bookings_customer;
