-- P56 · Aviso de corte nas listas com teto (revisão de 10/11, be-banco-06; decisão D31 (a): manter o teto e avisar).
-- Quinze leituras devolvem no máximo 200 itens (algumas listas, 100 ou 50) sem dizer que cortaram. O teto fica como
-- está (os contratos fixam `.max(200)`); cada função passa a devolver também
--   truncated: { <lista>: true|false }
-- com true quando existem mais linhas do que as devolvidas. A conta usa o MESMO filtro da lista com `offset <teto>`:
-- não muda a lista, a ordem nem o teto. Cada função abaixo é a definição vigente com esse único acréscimo no retorno.
-- Fica de fora `public.my_bookings` (devolve TABLE; avisar o corte ali muda o contrato da função).

-- substitui 20261018170000_p08_agent.sql:344; muda: acrescenta `truncated` (packages).
create or replace function public.agent_finance_read(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pay record;
  v_exp record;
  v_open record;
  v_recv_count integer;
  v_first timestamptz;
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  select coalesce(sum(p.amount_cents), 0) as cents, count(*) as n into v_pay
  from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= p_from and p.received_at < p_to
    and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id);
  select coalesce(sum(e.amount_cents), 0) as cents, count(*) as n,
         coalesce(sum(e.amount_cents) filter (where e.category = 'supplies'), 0) as supplies_cents,
         count(*) filter (where e.category = 'supplies') as supplies_n
  into v_exp
  from public.expense_entries e
  where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= p_from and e.paid_at < p_to
    and not exists (select 1 from public.expense_entries x where x.reversal_of = e.id);
  select coalesce(sum(r.amount_cents - r.paid_cents), 0) as cents, count(*) as n, min(r.due_at) as next_due
  into v_open
  from public.receivables r where r.tenant_id = p_tenant_id and r.status in ('open', 'partially_paid');
  select count(*) into v_recv_count from public.receivables r
  where r.tenant_id = p_tenant_id and r.created_at >= p_from and r.created_at < p_to;
  select min(x.at) into v_first from (
    select min(p.received_at) as at from public.payment_entries p where p.tenant_id = p_tenant_id
    union all select min(e.paid_at) from public.expense_entries e where e.tenant_id = p_tenant_id
    union all select min(r.created_at) from public.receivables r where r.tenant_id = p_tenant_id) x;

  return jsonb_build_object(
    'period', jsonb_build_object('starts_at', app.fin_ts(p_from), 'ends_at', app.fin_ts(p_to)),
    'received_cents', v_pay.cents, 'payments_count', v_pay.n,
    'spent_cents', v_exp.cents, 'expenses_count', v_exp.n,
    'supplies_cents', v_exp.supplies_cents, 'supplies_count', v_exp.supplies_n,
    'receivable_open_cents', v_open.cents, 'receivable_open_count', v_open.n,
    'receivable_next_due_at', app.fin_ts(v_open.next_due),
    'records_count', v_pay.n + v_exp.n + v_recv_count,
    'first_record_at', app.fin_ts(v_first),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'customer_id', p.customer_id,
        'service_id', p.service_id, 'purchased_credits', p.purchased_credits,
        'remaining_credits', p.purchased_credits + coalesce((select sum(e.delta) from public.session_entries e
          where e.tenant_id = p.tenant_id and e.package_id = p.id), 0),
        'expires_at', app.fin_ts(p.expires_at)) order by p.created_at desc)
      from (select * from public.session_packages p where p.tenant_id = p_tenant_id
            order by p.created_at desc limit 200) p), '[]'::jsonb),
    'as_of', app.fin_ts(clock_timestamp()))
    || jsonb_build_object('truncated', jsonb_build_object(
    'packages', exists (select 1 from public.session_packages p where p.tenant_id = p_tenant_id offset 200)));
end $$;

-- substitui 20261022120000_p12_messaging.sql:398; muda: acrescenta `truncated` (messages).
create or replace function public.channel_conversation(p_tenant_id uuid, p_contact_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.channel_contacts;
begin
  perform app.ch_owner(p_tenant_id);
  select * into v_k from public.channel_contacts k where k.tenant_id = p_tenant_id and k.id = p_contact_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_k.unread_count > 0 then
    update public.channel_contacts k set unread_count = 0 where k.id = v_k.id returning * into v_k;
  end if;
  return jsonb_build_object('contact', app.ch_contact_json(v_k) || jsonb_build_object(
      'customer_name', (select c.name from public.customers c where c.tenant_id = v_k.tenant_id and c.id = v_k.customer_id)),
    'messages', coalesce((select jsonb_agg(app.ch_message_json(m) order by m.created_at)
      from (select * from public.channel_messages m where m.tenant_id = p_tenant_id and m.contact_id = p_contact_id
            order by m.created_at desc limit 200) m), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'messages', exists (select 1 from public.channel_messages m where m.tenant_id = p_tenant_id and m.contact_id = p_contact_id offset 200)));
end $$;

-- substitui 20261022120000_p12_messaging.sql:384; muda: acrescenta `truncated` (contacts).
create or replace function public.channel_inbox(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.ch_owner(p_tenant_id);
  return jsonb_build_object('contacts', coalesce((select jsonb_agg(app.ch_contact_json(k) || jsonb_build_object(
      'customer_name', (select c.name from public.customers c where c.tenant_id = k.tenant_id and c.id = k.customer_id),
      'last_message', (select jsonb_build_object('direction', m.direction, 'body', left(m.body, 80), 'status', m.status)
        from public.channel_messages m where m.tenant_id = k.tenant_id and m.contact_id = k.id order by m.created_at desc limit 1))
      order by k.last_message_at desc nulls last)
    from (select * from public.channel_contacts k where k.tenant_id = p_tenant_id order by k.last_message_at desc nulls last limit 200) k),
    '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'contacts', exists (select 1 from public.channel_contacts k where k.tenant_id = p_tenant_id offset 200)));
end $$;

-- substitui 20261110093000_onda0_finance_ledger_abertos.sql:10; muda: acrescenta `truncated` (receivables, payments, expenses).
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
  )
    || jsonb_build_object('truncated', jsonb_build_object(
    'receivables', exists (select 1 from public.receivables r where r.tenant_id = p_tenant_id
        and (r.status in ('open', 'partially_paid') or (r.created_at >= p_from and r.created_at < p_to)) offset 200),
    'payments', exists (select 1 from public.payment_entries p where p.tenant_id = p_tenant_id and p.received_at >= p_from and p.received_at < p_to offset 200),
    'expenses', exists (select 1 from public.expense_entries e where e.tenant_id = p_tenant_id and e.paid_at >= p_from and e.paid_at < p_to offset 200)));
end $$;

-- substitui 20261022140000_p13_lifecycle.sql:562; muda: acrescenta `truncated` (steps).
create or replace function public.lifecycle_steps_list(p_tenant_id uuid, p_status text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.lc_owner(p_tenant_id);
  return jsonb_build_object('steps', coalesce((select jsonb_agg(app.lc_step_json(s) order by s.due_at desc)
    from (select * from public.lifecycle_steps s where s.tenant_id = p_tenant_id and (p_status is null or s.status = p_status)
          order by s.due_at desc limit 200) s), '[]'::jsonb),
    'counts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select s.status, count(*) as n from public.lifecycle_steps s where s.tenant_id = p_tenant_id group by s.status) x))
    || jsonb_build_object('truncated', jsonb_build_object(
    'steps', exists (select 1 from public.lifecycle_steps s where s.tenant_id = p_tenant_id and (p_status is null or s.status = p_status) offset 200)));
end $$;

-- substitui 20261027223200_p30_materials.sql:648; muda: acrescenta `truncated` (bookings).
create or replace function public.materials_bookings(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.mt_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '93 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  return jsonb_build_object('bookings', coalesce((select jsonb_agg(jsonb_build_object('booking_id', b.id, 'starts_at', app.sched_ts(b.starts_at),
      'service_id', b.service_id, 'service_name', s.name, 'customer_name', cu.name, 'agreed_price_cents', b.agreed_price_cents,
      'has_usage', exists (select 1 from public.material_service_usage u where u.service_id = b.service_id),
      'consumption', (select app.mt_consumption_json(c) from public.material_consumptions c where c.booking_id = b.id and c.status = 'active'))
      order by b.starts_at desc, b.id)
    from (select * from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed' and b.starts_at >= p_from and b.starts_at < p_to
      order by b.starts_at desc limit 200) b
    join public.provider_services s on s.id = b.service_id
    left join public.customers cu on cu.id = b.customer_id), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'bookings', exists (select 1 from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed' and b.starts_at >= p_from and b.starts_at < p_to offset 200)));
end $$;

-- substitui 20261027223200_p30_materials.sql:632; muda: acrescenta `truncated` (movements, purchases).
create or replace function public.materials_movements(p_tenant_id uuid, p_item_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.mt_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '93 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  return jsonb_build_object(
    'movements', coalesce((select jsonb_agg(app.mt_movement_json(m) order by m.created_at desc, m.id) from (select * from public.material_movements m
      where m.tenant_id = p_tenant_id and (p_item_id is null or m.item_id = p_item_id) and m.created_at >= p_from and m.created_at < p_to
      order by m.created_at desc limit 200) m), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(app.mt_purchase_json(p) order by p.purchased_at desc, p.id) from (select * from public.material_purchases p
      where p.tenant_id = p_tenant_id and p.purchased_at >= p_from and p.purchased_at < p_to order by p.purchased_at desc limit 100) p), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'movements', exists (select 1 from public.material_movements m where m.tenant_id = p_tenant_id and (p_item_id is null or m.item_id = p_item_id)
        and m.created_at >= p_from and m.created_at < p_to offset 200),
    'purchases', exists (select 1 from public.material_purchases p where p.tenant_id = p_tenant_id and p.purchased_at >= p_from and p.purchased_at < p_to offset 100)));
end $$;

-- substitui 20261018140000_p07_finance.sql:839; muda: acrescenta `truncated` (packages).
create or replace function public.package_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fin_owner(p_tenant_id);
  return jsonb_build_object('packages', coalesce((select jsonb_agg(
    app.fin_package_balance(p.tenant_id, p.id) || jsonb_build_object(
      'customer_id', p.customer_id, 'service_id', p.service_id, 'total_price_cents', p.total_price_cents,
      'created_at', app.fin_ts(p.created_at),
      'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'booking_id', e.booking_id,
          'delta', e.delta, 'reason', e.reason, 'reversal_of', e.reversal_of, 'created_at', app.fin_ts(e.created_at),
          'reversed', exists (select 1 from public.session_entries r where r.reversal_of = e.id))
        order by e.created_at desc)
        from (select * from public.session_entries e where e.tenant_id = p.tenant_id and e.package_id = p.id
              order by e.created_at desc limit 50) e), '[]'::jsonb))
    order by p.created_at desc)
    from (select * from public.session_packages p where p.tenant_id = p_tenant_id order by p.created_at desc limit 200) p),
    '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'packages', exists (select 1 from public.session_packages p where p.tenant_id = p_tenant_id offset 200)));
end $$;

-- substitui 20261022130000_p14_payments.sql:339; muda: acrescenta `truncated` (charges, refunds).
create or replace function public.payment_charges_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.pay_owner(p_tenant_id);
  return jsonb_build_object(
    'charges', coalesce((select jsonb_agg(app.pay_charge_json(c) order by c.created_at desc)
      from (select * from public.payment_charges c where c.tenant_id = p_tenant_id order by c.created_at desc limit 200) c), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(app.pay_refund_json(f) order by f.created_at desc)
      from (select * from public.payment_refunds f where f.tenant_id = p_tenant_id order by f.created_at desc limit 200) f), '[]'::jsonb),
    'unknown', (select count(*) from public.payment_charges c where c.tenant_id = p_tenant_id and c.status = 'unknown'))
    || jsonb_build_object('truncated', jsonb_build_object(
    'charges', exists (select 1 from public.payment_charges c where c.tenant_id = p_tenant_id offset 200),
    'refunds', exists (select 1 from public.payment_refunds f where f.tenant_id = p_tenant_id offset 200)));
end $$;

-- substitui 20261022150000_p20_recurrence.sql:433; muda: acrescenta `truncated` (subscriptions).
create or replace function public.recurrence_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.rc_owner(p_tenant_id);
  return jsonb_build_object('subscriptions', coalesce((select jsonb_agg(app.rc_sub_json(s) order by s.status, s.next_renewal_at nulls last, s.created_at desc)
    from (select * from public.recurrence_subscriptions s where s.tenant_id = p_tenant_id order by s.created_at desc limit 200) s), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'subscriptions', exists (select 1 from public.recurrence_subscriptions s where s.tenant_id = p_tenant_id offset 200)));
end $$;

-- substitui 20261027220500_p28_team_resources.sql:1050; muda: acrescenta `truncated` (entries).
create or replace function public.resources_commissions(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tm_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '93 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  return jsonb_build_object(
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('professional_id', t.id, 'professional_name', t.name,
        'base_cents', x.base, 'accrued_cents', x.accrued, 'reversed_cents', x.reversed, 'net_cents', x.accrued + x.reversed, 'entries', x.n) order by t.name)
      from (select e.professional_id, coalesce(sum(e.base_cents) filter (where e.kind = 'accrual'), 0) as base,
              coalesce(sum(e.amount_cents) filter (where e.kind = 'accrual'), 0) as accrued,
              coalesce(sum(e.amount_cents) filter (where e.kind = 'reversal'), 0) as reversed, count(*) as n
            from public.team_commission_entries e where e.tenant_id = p_tenant_id and e.created_at >= p_from and e.created_at < p_to
            group by e.professional_id) x join public.team_resources t on t.id = x.professional_id), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(app.tm_entry_json(e) order by e.created_at desc, e.id) from (select * from public.team_commission_entries e
      where e.tenant_id = p_tenant_id and e.created_at >= p_from and e.created_at < p_to order by e.created_at desc limit 200) e), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'entries', exists (select 1 from public.team_commission_entries e where e.tenant_id = p_tenant_id and e.created_at >= p_from and e.created_at < p_to offset 200)));
end $$;

-- substitui 20261018180000_p11_sales.sql:445; muda: acrescenta `truncated` (quotes).
create or replace function public.sales_quote_list(p_tenant_id uuid, p_status text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.sales_owner(p_tenant_id);
  if p_status is not null and p_status not in ('draft', 'sent', 'accepted', 'declined', 'expired', 'cancelled') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'status';
  end if;
  return jsonb_build_object('quotes', coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
    select app.sales_quote_json(q) as j, q.created_at
    from public.sales_quotes q
    where q.tenant_id = p_tenant_id
    order by q.created_at desc limit 200) x
    where p_status is null or x.j->>'status' = p_status), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'quotes', exists (select 1 from public.sales_quotes q where q.tenant_id = p_tenant_id offset 200)));
end $$;

-- substitui 20261018190000_p15_service_ops.sql:702; muda: acrescenta `truncated` (orders).
create or replace function public.service_ops_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
begin
  v_op := app.svc_operator();
  return jsonb_build_object('operator', jsonb_build_object('user_id', v_op.user_id, 'display_name', v_op.display_name),
    'operators', (select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'display_name', o.display_name) order by o.display_name)
      from public.platform_operators o where o.active),
    'orders', coalesce((select jsonb_agg(app.svc_order_json(s) || jsonb_build_object('tenant_name', t.name,
        'has_access', (app.svc_active_grant(s.id, v_op.user_id)).id is not null,
        'access_scopes', coalesce(to_jsonb((app.svc_active_grant(s.id, v_op.user_id)).scopes), '[]'::jsonb))
      order by s.due_at nulls last, s.created_at)
      from (select * from public.service_orders s
            where s.status not in ('delivered', 'cancelled') or s.updated_at > clock_timestamp() - interval '30 days'
            order by s.created_at limit 200) s
      join public.tenants t on t.id = s.tenant_id), '[]'::jsonb))
    || jsonb_build_object('truncated', jsonb_build_object(
    'orders', exists (select 1 from public.service_orders s
        where s.status not in ('delivered', 'cancelled') or s.updated_at > clock_timestamp() - interval '30 days' offset 200)));
end $$;

-- substitui 20261018190000_p15_service_ops.sql:929; muda: acrescenta `truncated` (agenda, customers).
create or replace function public.service_ops_snapshot(p_tenant_id uuid, p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
  v_row public.service_orders;
  v_g public.access_grants;
begin
  v_op := app.svc_operator();
  select * into v_row from public.service_orders s where s.tenant_id = p_tenant_id and s.id = p_order_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_g := app.svc_active_grant(v_row.id, v_op.user_id);
  if v_g.id is null or v_row.status in ('delivered', 'cancelled') then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  perform app.audit(p_tenant_id, 'access.read', 'access_grant', v_g.id, null, null, jsonb_build_object('scopes', to_jsonb(v_g.scopes)));
  return jsonb_build_object('scopes', to_jsonb(v_g.scopes), 'expires_at', app.sched_ts(v_g.expires_at),
    'tenant_name', (select t.name from public.tenants t where t.id = p_tenant_id),
    'catalog', case when 'catalog' = any (v_g.scopes) then coalesce((select jsonb_agg(jsonb_build_object('name', s.name,
        'duration_min', s.duration_min, 'base_price_cents', s.base_price_cents, 'active', s.active) order by s.name)
      from public.provider_services s where s.tenant_id = p_tenant_id), '[]'::jsonb) end,
    'agenda', case when 'agenda' = any (v_g.scopes) then coalesce((select jsonb_agg(jsonb_build_object(
        'starts_at', app.sched_ts(b.starts_at), 'ends_at', app.sched_ts(b.ends_at), 'status', b.status,
        'service_name', (select s.name from public.provider_services s where s.tenant_id = b.tenant_id and s.id = b.service_id))
        order by b.starts_at)
      from (select * from public.bookings b where b.tenant_id = p_tenant_id and b.blocks_capacity
            and b.starts_at >= clock_timestamp() and b.starts_at < clock_timestamp() + interval '14 days'
            order by b.starts_at limit 200) b), '[]'::jsonb) end,
    'customers', case when 'customers' = any (v_g.scopes) then jsonb_build_object(
      'count', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.archived_at is null),
      'names', coalesce((select jsonb_agg(c.name order by c.name) from (select c.name from public.customers c
        where c.tenant_id = p_tenant_id and c.archived_at is null order by c.name limit 200) c), '[]'::jsonb)) end)
    || jsonb_build_object('truncated', jsonb_build_object(
    'agenda', 'agenda' = any (v_g.scopes) and exists (select 1 from public.bookings b where b.tenant_id = p_tenant_id and b.blocks_capacity
        and b.starts_at >= clock_timestamp() and b.starts_at < clock_timestamp() + interval '14 days' offset 200),
    'customers', 'customers' = any (v_g.scopes) and exists (select 1 from public.customers c where c.tenant_id = p_tenant_id and c.archived_at is null offset 200)));
end $$;

-- substitui 20261018160000_p06_waitlist_jobs.sql:502; muda: acrescenta `truncated` (entries, offers).
create or replace function public.waitlist_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(app.wl_entry_json(e) order by e.joined_at, e.id)
      from (select * from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.status in ('active', 'offered')
            order by e.joined_at, e.id limit 200) e), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'entry_id', c.entry_id,
        'slot', app.sched_range_json(c.slot), 'status', c.status) order by lower(c.slot), e.joined_at, e.id)
      from public.waitlist_candidates c join public.waitlist_entries e on e.id = c.entry_id
      where c.tenant_id = p_tenant_id and c.status = 'open' and lower(c.slot) > clock_timestamp()
        and e.status = 'active'), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(app.wl_offer_json(o) order by o.created_at desc)
      from (select * from public.waitlist_offers o where o.tenant_id = p_tenant_id
            order by o.created_at desc limit 50) o), '[]'::jsonb)
  )
    || jsonb_build_object('truncated', jsonb_build_object(
    'entries', exists (select 1 from public.waitlist_entries e where e.tenant_id = p_tenant_id and e.status in ('active', 'offered') offset 200),
    'offers', exists (select 1 from public.waitlist_offers o where o.tenant_id = p_tenant_id offset 50)));
end $$;
