-- Recado #64, item 2 · Leitura de cliente por id no CRM (customer.get).
-- A ficha /app/clientes/:id percorria a lista inteira para achar um cliente. Esta leitura devolve o cliente do negócio,
-- arquivado ou não, na mesma projeção de crm_customer_json. Só membro do negócio lê; id de outro negócio ou inexistente
-- responde NOT_FOUND, sem distinguir os dois casos. Só leitura: sem idempotência, evento ou auditoria.

create function public.crm_customer_get(p_tenant_id uuid, p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.customers;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select * into v_row from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id;
  if v_row.id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('customer', app.crm_customer_json(v_row));
end $$;

revoke all on function public.crm_customer_get(uuid, uuid) from public, anon;
grant execute on function public.crm_customer_get(uuid, uuid) to authenticated;
