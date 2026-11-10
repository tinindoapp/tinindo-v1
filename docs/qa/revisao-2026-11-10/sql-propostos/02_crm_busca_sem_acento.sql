-- Migration nova (ex.: 2026111x_crm_busca_sem_acento.sql)
create function app.crm_search_key(p_text text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g')),
                   'áàâãäåçéèêëíìîïñóòôõöúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')
$$;
revoke all on function app.crm_search_key(text) from public;
grant execute on function app.crm_search_key(text) to authenticated, service_role;
alter table public.customers add column search_key text generated always as (app.crm_search_key(name)) stored;
create index customers_tenant_search on public.customers (tenant_id, search_key, id);
-- crm_customer_list: mesmo corpo, filtrando e ordenando por search_key (cursor continua opaco: {key,id}).
create or replace function public.crm_customer_list(p_tenant_id uuid, p_query text DEFAULT NULL::text, p_include_archived boolean DEFAULT false, p_after_key text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_digits text := nullif(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '');
  v_rows public.customers[];
  v_last public.customers;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if (p_after_key is null) <> (p_after_id is null) or char_length(v_q) > 120 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cursor';
  end if;

  select coalesce(array_agg(x order by x.search_key, x.id), '{}') into v_rows from (
    select c.* from public.customers c
    where c.tenant_id = p_tenant_id
      and (p_include_archived or c.archived_at is null)
      and (v_q is null
        or strpos(c.search_key, app.crm_search_key(v_q)) > 0
        or strpos(lower(coalesce(c.email, '')), v_q) > 0
        or (v_digits is not null and char_length(v_digits) >= 4 and strpos(coalesce(c.phone, ''), v_digits) > 0))
      and (p_after_key is null or (c.search_key, c.id) > (p_after_key, p_after_id))
    order by c.search_key, c.id
    limit v_limit + 1
  ) x;

  if cardinality(v_rows) > v_limit then
    v_rows := v_rows[1:v_limit];
    v_last := v_rows[v_limit];
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(app.crm_customer_json(r) order by r.search_key, r.id) from unnest(v_rows) r), '[]'::jsonb),
    'next', case when v_last.id is null then null
                 else jsonb_build_object('key', v_last.search_key, 'id', v_last.id) end);
end $function$

;
