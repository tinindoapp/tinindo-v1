-- Onda 0, linha K (revisão de 10/11, achado be-banco-01): o livro do caixa cortava os recebíveis em 200
-- ordenando pelo vencimento mais antigo. Com mais de 200 linhas, os recebíveis em aberto mais novos sumiam
-- da tela (e do "a receber" que o front monta a partir dela), enquanto os quitados antigos ocupavam o corte.
-- Correção: dentro do corte de 200, os em aberto (open/partially_paid) entram primeiro, pelo vencimento
-- mais próximo; depois os demais do período, do mais novo para o mais antigo.
-- Contrato intacto: mesma assinatura, mesmo filtro, mesmo limite e a mesma ordem de saída
-- (due_at nulls last, created_at). Pagamentos e despesas não mudam.
-- Substituição por `create or replace` de public.finance_ledger (grants preservados).

create or replace function public.finance_ledger(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  return jsonb_build_object(
    'receivables', coalesce((select jsonb_agg(app.fin_receivable_json(r) order by r.due_at nulls last, r.created_at)
      from (select * from public.receivables r where r.tenant_id = p_tenant_id
              and (r.status in ('open', 'partially_paid') or (r.created_at >= p_from and r.created_at < p_to))
            order by (r.status in ('open', 'partially_paid')) desc,
                     case when r.status in ('open', 'partially_paid') then r.due_at end nulls last,
                     r.created_at desc
            limit 200) r), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(app.fin_payment_json(p) order by p.received_at desc)
      from (select * from public.payment_entries p where p.tenant_id = p_tenant_id
              and p.received_at >= p_from and p.received_at < p_to order by p.received_at desc limit 200) p), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(app.fin_expense_json(e) order by e.paid_at desc)
      from (select * from public.expense_entries e where e.tenant_id = p_tenant_id
              and e.paid_at >= p_from and e.paid_at < p_to order by e.paid_at desc limit 200) e), '[]'::jsonb)
  );
end $$;
