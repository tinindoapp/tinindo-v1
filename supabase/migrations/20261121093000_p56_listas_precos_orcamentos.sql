-- Recado #169, item 3 (P56, D31 a: manter o teto e avisar).
-- 1. pricing_list_rules ganha `truncated` (regras até 100, propostas até 20), com a mesma conta de `offset <teto>`.
-- 2. sales_quote_list cortava em 200 antes do filtro por estado: com 200 orçamentos recentes de outro estado, o filtro
--    devolvia vazio. Agora filtra, ordena e corta, e o `truncated` usa o mesmo filtro.

-- substitui 20261018150000_p05_pricing.sql; muda: acrescenta `truncated` (rules, proposals).
create or replace function public.pricing_list_rules(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'rules', coalesce((select jsonb_agg(app.price_rule_json(r) order by r.active desc, r.published_at desc)
      from (select * from public.pricing_rules r where r.tenant_id = p_tenant_id
            order by r.active desc, r.published_at desc limit 100) r), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(app.price_proposal_json(p) order by p.created_at desc)
      from (select * from public.pricing_rule_proposals p where p.tenant_id = p_tenant_id and p.status = 'proposed'
              and p.expires_at > clock_timestamp() order by p.created_at desc limit 20) p), '[]'::jsonb)
  )
    || jsonb_build_object('truncated', jsonb_build_object(
    'rules', exists (select 1 from public.pricing_rules r where r.tenant_id = p_tenant_id offset 100),
    'proposals', exists (select 1 from public.pricing_rule_proposals p where p.tenant_id = p_tenant_id and p.status = 'proposed'
        and p.expires_at > clock_timestamp() offset 20)));
end $$;

-- substitui 20261120031000_p56_listas_truncated.sql; muda: filtro por estado antes do teto (e no `truncated`).
create or replace function public.sales_quote_list(p_tenant_id uuid, p_status text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sales_owner(p_tenant_id);
  if p_status is not null and p_status not in ('draft', 'sent', 'accepted', 'declined', 'expired', 'cancelled') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'status';
  end if;
  return jsonb_build_object('quotes', coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
    select q.j, q.created_at from (
      select app.sales_quote_json(s) as j, s.created_at from public.sales_quotes s where s.tenant_id = p_tenant_id
    ) q
    where p_status is null or q.j->>'status' = p_status
    order by q.created_at desc limit 200) x), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'quotes', exists (select 1 from (
      select app.sales_quote_json(s) as j from public.sales_quotes s where s.tenant_id = p_tenant_id
    ) q where p_status is null or q.j->>'status' = p_status offset 200)));
end $$;
