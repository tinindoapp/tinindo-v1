-- P03 · Recado #64, item 3 · scheduling/booking.list_by_customer: histórico inteiro de um cliente na agenda.
-- A ficha do cliente lia booking.list em duas janelas de 60 dias e filtrava no navegador; o que passava de 60 dias não
-- aparecia. Esta leitura não tem janela: todos os atendimentos do cliente no negócio, do mais recente para o mais antigo
-- (starts_at desc, id desc), em páginas de até 100 com cursor (starts_at, id). Só membro do negócio lê; cliente de outro
-- negócio ou inexistente → NOT_FOUND. Mesma projeção de sched_booking_json (visão do dono). Só leitura.

create index bookings_customer_starts on public.bookings (tenant_id, customer_id, starts_at desc, id desc)
  where customer_id is not null;

create function public.scheduling_booking_list_by_customer(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_before_starts timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_rows public.bookings[];
  v_last public.bookings;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if (p_before_starts is null) <> (p_before_id is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cursor';
  end if;
  if not exists (select 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  select coalesce(array_agg(x order by x.starts_at desc, x.id desc), '{}') into v_rows from (
    select * from public.bookings b
    where b.tenant_id = p_tenant_id and b.customer_id = p_customer_id
      and (p_before_starts is null or (b.starts_at, b.id) < (p_before_starts, p_before_id))
    order by b.starts_at desc, b.id desc
    limit v_limit + 1
  ) x;

  if cardinality(v_rows) > v_limit then
    v_last := v_rows[v_limit];
    v_rows := v_rows[1:v_limit];
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(app.sched_booking_json(r) order by r.starts_at desc, r.id desc) from unnest(v_rows) r),
                      '[]'::jsonb),
    'next', case when v_last.id is null then null
                 else jsonb_build_object('key', app.sched_ts(v_last.starts_at), 'id', v_last.id) end
  );
end $$;

revoke all on function public.scheduling_booking_list_by_customer(uuid, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.scheduling_booking_list_by_customer(uuid, uuid, timestamptz, uuid, integer) to authenticated;
