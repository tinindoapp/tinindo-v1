-- Migration nova (ex.: 2026111x_fk_compostas_estorno.sql)
alter table public.payment_entries add constraint payment_entries_reversal_same_tenant foreign key (tenant_id, reversal_of) references public.payment_entries (tenant_id, id) on delete restrict not valid;
alter table public.payment_entries validate constraint payment_entries_reversal_same_tenant;
alter table public.expense_entries add constraint expense_entries_reversal_same_tenant foreign key (tenant_id, reversal_of) references public.expense_entries (tenant_id, id) on delete restrict not valid;
alter table public.expense_entries validate constraint expense_entries_reversal_same_tenant;
alter table public.session_entries add constraint session_entries_reversal_same_tenant foreign key (tenant_id, reversal_of) references public.session_entries (tenant_id, id) on delete restrict not valid;
alter table public.session_entries validate constraint session_entries_reversal_same_tenant;
alter table public.material_movements add constraint material_movements_reversal_same_tenant foreign key (tenant_id, reversal_of) references public.material_movements (tenant_id, id) on delete restrict not valid;
alter table public.material_movements validate constraint material_movements_reversal_same_tenant;
alter table public.team_commission_entries add constraint team_commission_entries_reversal_same_tenant foreign key (tenant_id, reversal_of) references public.team_commission_entries (tenant_id, id) on delete restrict not valid;
alter table public.team_commission_entries validate constraint team_commission_entries_reversal_same_tenant;
alter table public.public_booking_requests add constraint public_booking_requests_tenant_id_id_key unique (tenant_id, id);
alter table public.public_booking_requests add constraint public_booking_requests_replaced_same_tenant foreign key (tenant_id, replaced_request_id) references public.public_booking_requests (tenant_id, id) not valid;
alter table public.public_booking_requests validate constraint public_booking_requests_replaced_same_tenant;
