-- Onda 0, linha J (revisão de 10/11, achado be-banco-02): a busca de clientes não ignorava acento.
-- "joao" não achava "João" e "conceicao" não achava "Conceição": crm_customer_list comparava o texto
-- digitado com name_key, que só passa para minúsculas.
-- Correção:
--   * app.crm_search_key(text): imutável, sem extensão (unaccent não é imutável): tira acento do português
--     (maiúsculas e minúsculas), passa para minúsculas e junta espaços.
--   * customers.search_key: coluna gerada com essa chave, com índice (tenant_id, search_key, id).
--   * public.crm_customer_list (create or replace, mesma assinatura e saída): busca pelo nome via search_key,
--     com o texto digitado normalizado do mesmo jeito; e-mail e dígitos do telefone como antes.
--     A ordem e o cursor passam a usar search_key ("Álvaro" fica entre os "A"). O cursor segue opaco
--     ({key, id}); um cursor antigo em uso no momento da troca só pode pular ou repetir itens daquela página.
-- name_key continua (dedupe, catálogo e agente dependem dele).

create function app.crm_search_key(p_text text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(regexp_replace(btrim(p_text), '\s+', ' ', 'g'),
    'ÁÀÂÃÄÅÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝáàâãäåçéèêëíìîïñóòôõöúùûüýÿ',
    'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy'))
$$;
revoke all on function app.crm_search_key(text) from public;
grant execute on function app.crm_search_key(text) to authenticated, service_role;

alter table public.customers add column search_key text generated always as (app.crm_search_key(name)) stored;
create index customers_tenant_search on public.customers (tenant_id, search_key, id);

create or replace function public.crm_customer_list(
  p_tenant_id uuid,
  p_query text default null,
  p_include_archived boolean default false,
  p_after_key text default null,
  p_after_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_key text := nullif(app.crm_search_key(coalesce(p_query, '')), '');
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
        or strpos(c.search_key, v_key) > 0
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
end $$;
