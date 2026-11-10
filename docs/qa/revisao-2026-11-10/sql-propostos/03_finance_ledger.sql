-- Migration nova (ex.: 2026111x_finance_ledger_abertos_primeiro.sql): em aberto entram primeiro no corte de 200; fechados do período, do mais novo para o mais antigo.
CREATE OR REPLACE FUNCTION public.finance_ledger(p_tenant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  return jsonb_build_object(
    'receivables', coalesce((select jsonb_agg(app.fin_receivable_json(r) order by r.due_at nulls last, r.created_at)
      from (select * from public.receivables r where r.tenant_id = p_tenant_id
              and (r.status in ('open', 'partially_paid') or (r.created_at >= p_from and r.created_at < p_to))
            order by (r.status in ('open', 'partially_paid')) desc, case when r.status in ('open', 'partially_paid') then r.due_at end nulls last, r.created_at desc limit 200) r), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(app.fin_payment_json(p) order by p.received_at desc)
      from (select * from public.payment_entries p where p.tenant_id = p_tenant_id
              and p.received_at >= p_from and p.received_at < p_to order by p.received_at desc limit 200) p), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(app.fin_expense_json(e) order by e.paid_at desc)
      from (select * from public.expense_entries e where e.tenant_id = p_tenant_id
              and e.paid_at >= p_from and e.paid_at < p_to order by e.paid_at desc limit 200) e), '[]'::jsonb)
  );
end $function$

;
