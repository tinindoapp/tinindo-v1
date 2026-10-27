-- P30 · Materiais e custos: produtos e consumíveis com estoque e custo médio; compras (com despesa opcional no Caixa);
-- ficha de uso por serviço; consumo por atendimento concluído; estorno; margem real por serviço; custo estimado do
-- orçamento (P11).
-- Invariantes (docs/02, docs/17, tasks/P30, ADR-0032):
-- * Estoque é um razão append-only (material_movements); saldo e valor do item só mudam junto com um movimento, sob lock
--   do item, travando itens em ordem de id (sem deadlock, sem atualização perdida).
-- * Consumo e estorno não duplicam estoque: um consumo ativo por atendimento (índice único); cada movimento se estorna
--   uma vez (reversal_of único); estoque nunca fica negativo (CHECK) e falta de estoque recusa o consumo inteiro.
-- * Dinheiro em centavos inteiros. Custo médio ponderado: o valor de estoque sai na proporção da quantidade; a última
--   unidade leva o valor restante (o valor zera junto com a quantidade).
-- * Conta não depende de texto livre: margem e custo do orçamento vêm de fichas, quantidades e do razão.
-- Depende de: fundação, P02 (provider_services, customers), P03 (bookings), P07 (expense_entries), P11 (orçamentos).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.material_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null default 'consumable' check (kind in ('consumable', 'product')),
  unit text not null check (unit in ('un', 'ml', 'g')),
  active boolean not null default true,
  -- Mantidos só pelas RPCs, sob lock desta linha, junto com um movimento do razão.
  on_hand numeric(14, 3) not null default 0 check (on_hand >= 0),
  stock_value_cents bigint not null default 0 check (stock_value_cents >= 0),
  min_qty numeric(14, 3) check (min_qty >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint material_items_value_with_qty check (on_hand > 0 or stock_value_cents = 0),
  unique (tenant_id, id)
);
comment on table public.material_items is 'Produto ou consumível. Saldo e valor só mudam com um movimento do razão.';
create unique index material_items_unique_name on public.material_items (tenant_id, lower(btrim(name))) where active;
create trigger material_items_touch before update on public.material_items for each row execute function app.touch_row();

create table public.material_service_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  item_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint material_service_usage_service foreign key (tenant_id, service_id) references public.provider_services (tenant_id, id) on delete restrict,
  constraint material_service_usage_item foreign key (tenant_id, item_id) references public.material_items (tenant_id, id) on delete restrict,
  unique (service_id, item_id),
  unique (tenant_id, id)
);
comment on table public.material_service_usage is 'Ficha de uso: quanto de cada item um atendimento do serviço consome.';
create trigger material_service_usage_touch before update on public.material_service_usage for each row execute function app.touch_row();

create table public.material_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  supplier text check (char_length(supplier) <= 80),
  purchased_at timestamptz not null,
  total_cents bigint not null check (total_cents between 0 and 9007199254740991),
  expense_id uuid,
  status text not null default 'recorded' check (status in ('recorded', 'reversed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint material_purchases_expense foreign key (tenant_id, expense_id) references public.expense_entries (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.material_purchases is 'Compra de materiais. As linhas são movimentos do razão; a despesa (P07) é opcional.';
create index material_purchases_period on public.material_purchases (tenant_id, purchased_at);
create trigger material_purchases_touch before update on public.material_purchases for each row execute function app.touch_row();

create table public.material_consumptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  booking_id uuid not null,
  status text not null default 'active' check (status in ('active', 'reversed')),
  cost_cents bigint not null check (cost_cents >= 0),
  source text not null check (source in ('usage', 'manual')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint material_consumptions_booking foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.material_consumptions is 'Uso de materiais num atendimento concluído. Um ativo por atendimento; estorno devolve ao estoque.';
create unique index material_consumptions_one_active on public.material_consumptions (booking_id) where status = 'active';
create trigger material_consumptions_touch before update on public.material_consumptions for each row execute function app.touch_row();

create table public.material_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  item_id uuid not null,
  kind text not null check (kind in ('purchase', 'consumption', 'adjustment', 'reversal')),
  -- Quantidade e valor com sinal: entrada positiva, saída negativa.
  quantity numeric(14, 3) not null check (quantity <> 0),
  value_cents bigint not null,
  purchase_id uuid,
  consumption_id uuid,
  reversal_of uuid references public.material_movements (id) on delete restrict,
  -- Motivo do ajuste de inventário (texto do dono): fora da auditoria.
  note text check (char_length(note) <= 140),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint material_movements_item foreign key (tenant_id, item_id) references public.material_items (tenant_id, id) on delete restrict,
  constraint material_movements_purchase foreign key (tenant_id, purchase_id) references public.material_purchases (tenant_id, id) on delete restrict,
  constraint material_movements_consumption foreign key (tenant_id, consumption_id) references public.material_consumptions (tenant_id, id) on delete restrict,
  constraint material_movements_shape check (
    (kind = 'purchase' and quantity > 0 and value_cents >= 0 and purchase_id is not null and reversal_of is null)
    or (kind = 'consumption' and quantity < 0 and value_cents <= 0 and consumption_id is not null and reversal_of is null)
    or (kind = 'adjustment' and reversal_of is null and note is not null)
    or (kind = 'reversal' and reversal_of is not null)),
  unique (tenant_id, id)
);
comment on table public.material_movements is 'Razão de estoque, append-only. Estorno é linha nova (reversal_of único).';
create unique index material_movements_one_reversal on public.material_movements (reversal_of) where reversal_of is not null;
create unique index material_movements_one_per_consumption on public.material_movements (consumption_id, item_id) where kind = 'consumption';
create index material_movements_item on public.material_movements (tenant_id, item_id, created_at);
create trigger material_movements_append_only before update or delete on public.material_movements for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.mt_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.mt_item_json(i public.material_items) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'name', i.name, 'kind', i.kind, 'unit', i.unit, 'active', i.active, 'on_hand', i.on_hand,
    'stock_value_cents', i.stock_value_cents,
    'unit_cost_cents', case when i.on_hand > 0 then round(i.stock_value_cents / i.on_hand)::bigint end,
    'min_qty', i.min_qty, 'low_stock', i.min_qty is not null and i.on_hand < i.min_qty, 'version', i.version)
$$;

create function app.mt_movement_json(m public.material_movements) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'item_id', m.item_id, 'item_name', (select i.name from public.material_items i where i.id = m.item_id),
    'kind', m.kind, 'quantity', m.quantity, 'value_cents', m.value_cents, 'purchase_id', m.purchase_id, 'consumption_id', m.consumption_id,
    'booking_id', (select c.booking_id from public.material_consumptions c where c.id = m.consumption_id),
    'reversal_of', m.reversal_of, 'reversed', exists (select 1 from public.material_movements x where x.reversal_of = m.id),
    'created_at', app.sched_ts(m.created_at))
$$;

create function app.mt_consumption_json(c public.material_consumptions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'booking_id', c.booking_id, 'status', c.status, 'cost_cents', c.cost_cents, 'source', c.source,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', m.item_id, 'item_name', i.name, 'unit', i.unit, 'quantity', -m.quantity, 'cost_cents', -m.value_cents)
      order by i.name) from public.material_movements m join public.material_items i on i.id = m.item_id
      where m.consumption_id = c.id and m.kind = 'consumption'), '[]'::jsonb),
    'created_at', app.sched_ts(c.created_at), 'version', c.version)
$$;

/** Trava os itens em ordem de id (todo comando de estoque usa esta ordem). Devolve quantos achou. */
create function app.mt_lock_items(p_tenant_id uuid, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  perform 1 from public.material_items i where i.tenant_id = p_tenant_id and i.id = any (p_ids) order by i.id for update;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/**
 * Lança um movimento e atualiza saldo e valor do item (que DEVE estar travado). Saída sem valor informado sai pelo
 * custo médio; a última unidade leva o valor restante. Estoque insuficiente → POLICY_REJECTED (campo stock).
 */
create function app.mt_move(p_tenant_id uuid, p_item_id uuid, p_kind text, p_qty numeric, p_value bigint,
  p_purchase_id uuid, p_consumption_id uuid, p_reversal_of uuid, p_note text) returns public.material_movements
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.material_items;
  v_value bigint := p_value;
  v_m public.material_movements;
begin
  select * into v_i from public.material_items i where i.tenant_id = p_tenant_id and i.id = p_item_id;
  if p_qty < 0 then
    if v_i.on_hand + p_qty < 0 then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'stock', detail = 'estoque insuficiente';
    end if;
    if v_value is null then
      v_value := -(case when v_i.on_hand + p_qty = 0 then v_i.stock_value_cents else round(v_i.stock_value_cents * (-p_qty) / v_i.on_hand)::bigint end);
    end if;
    -- Valor nunca maior que o do estoque (nem deixa valor sem quantidade).
    if v_i.on_hand + p_qty = 0 then v_value := -v_i.stock_value_cents; end if;
    v_value := greatest(v_value, -v_i.stock_value_cents);
  end if;
  insert into public.material_movements (tenant_id, item_id, kind, quantity, value_cents, purchase_id, consumption_id, reversal_of, note, created_by)
  values (p_tenant_id, p_item_id, p_kind, p_qty, coalesce(v_value, 0), p_purchase_id, p_consumption_id, p_reversal_of, p_note, auth.uid())
  returning * into v_m;
  update public.material_items i set on_hand = i.on_hand + p_qty, stock_value_cents = i.stock_value_cents + v_m.value_cents where i.id = p_item_id;
  return v_m;
end $$;

-- ---------------------------------------------------------------------------
-- Dono: itens e ficha de uso
-- ---------------------------------------------------------------------------

create function public.materials_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.mt_owner(p_tenant_id);
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(app.mt_item_json(i) order by i.active desc, i.name) from public.material_items i where i.tenant_id = p_tenant_id), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(jsonb_build_object('service_id', u.service_id, 'item_id', u.item_id, 'quantity', u.quantity) order by u.created_at)
      from public.material_service_usage u where u.tenant_id = p_tenant_id), '[]'::jsonb),
    'timezone', (select t.timezone from public.tenants t where t.id = p_tenant_id));
end $$;

/** Cria/edita um item. A unidade não muda depois do primeiro movimento. Saldo só muda por compra, consumo ou ajuste. */
create function public.materials_item_save(
  p_tenant_id uuid,
  p_item_id uuid,
  p_expected_version integer,
  p_name text,
  p_kind text,
  p_unit text,
  p_active boolean,
  p_min_qty numeric,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_i public.material_items;
  v_body jsonb;
begin
  perform app.mt_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'materials.item_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  begin
    if p_item_id is null then
      insert into public.material_items (tenant_id, name, kind, unit, active, min_qty, created_by)
      values (p_tenant_id, btrim(p_name), coalesce(p_kind, 'consumable'), p_unit, coalesce(p_active, true), p_min_qty, v_uid)
      returning * into v_i;
    else
      select * into v_i from public.material_items i where i.tenant_id = p_tenant_id and i.id = p_item_id for update;
      if not found then
        raise exception using errcode = 'PT404', message = 'NOT_FOUND';
      end if;
      if p_expected_version is null or v_i.version <> p_expected_version then
        raise exception using errcode = 'PT409', message = 'STALE_VERSION';
      end if;
      if v_i.unit <> p_unit and exists (select 1 from public.material_movements m where m.item_id = v_i.id) then
        raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'unit', detail = 'unidade fixa depois do primeiro movimento';
      end if;
      update public.material_items i set name = btrim(p_name), kind = coalesce(p_kind, i.kind), unit = p_unit, active = coalesce(p_active, i.active), min_qty = p_min_qty
      where i.id = v_i.id returning * into v_i;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'name', detail = 'nome repetido';
    when check_violation or not_null_violation then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'item';
  end;
  perform app.audit(p_tenant_id, 'materials.item_save', 'material_item', v_i.id, p_request_id, null,
    jsonb_build_object('kind', v_i.kind, 'unit', v_i.unit, 'active', v_i.active));
  v_body := jsonb_build_object('item', app.mt_item_json(v_i));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'materials.item_save', p_idem_key, case when p_item_id is null then 201 else 200 end, v_body);
  return jsonb_build_object('status_code', case when p_item_id is null then 201 else 200 end, 'body', v_body);
end $$;

/** Ficha de uso do serviço: quantidade de um item por atendimento. p_quantity null remove o item da ficha. */
create function public.materials_usage_save(
  p_tenant_id uuid,
  p_service_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_body jsonb;
begin
  perform app.mt_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'materials.usage_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  perform 1 from public.material_items i where i.tenant_id = p_tenant_id and i.id = p_item_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'item_id';
  end if;
  if p_quantity is null then
    delete from public.material_service_usage u where u.tenant_id = p_tenant_id and u.service_id = p_service_id and u.item_id = p_item_id;
  elsif p_quantity <= 0 or p_quantity > 99999 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'quantity';
  else
    insert into public.material_service_usage (tenant_id, service_id, item_id, quantity) values (p_tenant_id, p_service_id, p_item_id, p_quantity)
    on conflict (service_id, item_id) do update set quantity = excluded.quantity;
  end if;
  perform app.audit(p_tenant_id, 'materials.usage_save', 'provider_service', p_service_id, p_request_id, null,
    jsonb_build_object('item_id', p_item_id, 'quantity', p_quantity));
  v_body := jsonb_build_object('usage', coalesce((select jsonb_agg(jsonb_build_object('service_id', u.service_id, 'item_id', u.item_id, 'quantity', u.quantity) order by u.created_at)
    from public.material_service_usage u where u.tenant_id = p_tenant_id), '[]'::jsonb));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'materials.usage_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: compras e ajustes
-- ---------------------------------------------------------------------------

create function app.mt_purchase_json(p public.material_purchases) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'supplier', p.supplier, 'purchased_at', app.sched_ts(p.purchased_at), 'total_cents', p.total_cents,
    'expense_id', p.expense_id, 'status', p.status,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', m.item_id, 'item_name', i.name, 'unit', i.unit, 'quantity', m.quantity, 'total_cents', m.value_cents)
      order by i.name) from public.material_movements m join public.material_items i on i.id = m.item_id where m.purchase_id = p.id and m.kind = 'purchase'), '[]'::jsonb),
    'version', p.version)
$$;

/**
 * Compra: cada linha entra no estoque pelo valor pago (custo médio recalculado). Opcionalmente registra a despesa no
 * Caixa (P07, categoria materiais) na mesma transação.
 */
create function public.materials_purchase(
  p_tenant_id uuid,
  p_supplier text,
  p_purchased_at timestamptz,
  p_lines jsonb,
  p_record_expense boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_ids uuid[];
  v_total bigint;
  v_p public.material_purchases;
  v_expense uuid;
  l record;
  v_body jsonb;
begin
  perform app.mt_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'materials.purchase', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 30 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'lines';
  end if;
  begin
    select array_agg(distinct x.item_id order by x.item_id), sum(x.total_cents) into v_ids, v_total
    from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity numeric, total_cents bigint);
  exception when others then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'lines';
  end;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity numeric, total_cents bigint)
      where x.item_id is null or x.quantity is null or x.quantity <= 0 or x.quantity > 999999 or x.quantity <> round(x.quantity, 3)
         or x.total_cents is null or x.total_cents < 0)
     or cardinality(v_ids) <> jsonb_array_length(p_lines) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'lines';
  end if;
  if p_purchased_at is null or p_purchased_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'purchased_at';
  end if;
  if app.mt_lock_items(p_tenant_id, v_ids) <> cardinality(v_ids) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'item_id';
  end if;
  if coalesce(p_record_expense, false) and v_total >= 1 then
    insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, description, recorded_by)
    values (p_tenant_id, v_total, p_purchased_at, 'supplies', left(coalesce('Materiais · ' || nullif(btrim(p_supplier), ''), 'Compra de materiais'), 120), v_uid)
    returning id into v_expense;
  end if;
  insert into public.material_purchases (tenant_id, supplier, purchased_at, total_cents, expense_id, created_by)
  values (p_tenant_id, nullif(btrim(p_supplier), ''), p_purchased_at, v_total, v_expense, v_uid) returning * into v_p;
  for l in select * from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity numeric, total_cents bigint) order by x.item_id loop
    perform app.mt_move(p_tenant_id, l.item_id, 'purchase', l.quantity, l.total_cents, v_p.id, null, null, null);
  end loop;
  perform app.audit(p_tenant_id, 'materials.purchase', 'material_purchase', v_p.id, p_request_id, null,
    jsonb_build_object('total_cents', v_total, 'lines', jsonb_array_length(p_lines), 'expense', v_expense is not null));
  v_body := jsonb_build_object('purchase', app.mt_purchase_json(v_p));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'materials.purchase', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/**
 * Estorno da compra: cada linha sai do estoque pelo custo médio atual (exige saldo) e a despesa do Caixa, se houver,
 * recebe o estorno do P07. Uma vez só.
 */
create function public.materials_purchase_reverse(
  p_tenant_id uuid,
  p_purchase_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.material_purchases;
  v_ids uuid[];
  m public.material_movements;
  v_orig public.expense_entries;
  v_body jsonb;
begin
  perform app.mt_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'materials.purchase_reverse', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_p from public.material_purchases p where p.tenant_id = p_tenant_id and p.id = p_purchase_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_p.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_p.status <> 'recorded' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  select array_agg(m2.item_id order by m2.item_id) into v_ids from public.material_movements m2 where m2.purchase_id = v_p.id and m2.kind = 'purchase';
  perform app.mt_lock_items(p_tenant_id, v_ids);
  for m in select * from public.material_movements x where x.purchase_id = v_p.id and x.kind = 'purchase' order by x.item_id loop
    perform app.mt_move(p_tenant_id, m.item_id, 'reversal', -m.quantity, null, v_p.id, null, m.id, null);
  end loop;
  if v_p.expense_id is not null then
    select * into v_orig from public.expense_entries e where e.id = v_p.expense_id;
    begin
      insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, description, reversal_of, recorded_by)
      values (p_tenant_id, v_orig.amount_cents, clock_timestamp(), v_orig.category, v_orig.description, v_orig.id, v_uid);
    exception when unique_violation then
      null; -- a despesa já foi estornada no Caixa: nada a repetir.
    end;
  end if;
  update public.material_purchases p set status = 'reversed' where p.id = v_p.id returning * into v_p;
  perform app.audit(p_tenant_id, 'materials.purchase_reverse', 'material_purchase', v_p.id, p_request_id, null, jsonb_build_object('total_cents', v_p.total_cents));
  v_body := jsonb_build_object('purchase', app.mt_purchase_json(v_p));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'materials.purchase_reverse', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Ajuste de inventário: informa a quantidade contada; a diferença entra/sai pelo custo médio atual. Motivo obrigatório. */
create function public.materials_adjust(
  p_tenant_id uuid,
  p_item_id uuid,
  p_expected_version integer,
  p_counted numeric,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_i public.material_items;
  v_delta numeric;
  v_value bigint;
  v_body jsonb;
begin
  perform app.mt_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'materials.adjust', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_counted is null or p_counted < 0 or p_counted > 999999 or p_counted <> round(p_counted, 3) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'counted';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 140 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;
  select * into v_i from public.material_items i where i.tenant_id = p_tenant_id and i.id = p_item_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_i.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  v_delta := p_counted - v_i.on_hand;
  if v_delta = 0 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'counted', detail = 'contagem igual ao saldo';
  end if;
  -- Sobra entra pelo custo médio atual (zero se não há custo conhecido); falta sai pelo custo médio.
  v_value := case when v_delta > 0 then case when v_i.on_hand > 0 then round(v_i.stock_value_cents * v_delta / v_i.on_hand)::bigint else 0 end end;
  perform app.mt_move(p_tenant_id, v_i.id, 'adjustment', v_delta, v_value, null, null, null, left(btrim(p_reason), 140));
  select * into v_i from public.material_items i where i.id = v_i.id;
  perform app.audit(p_tenant_id, 'materials.adjust', 'material_item', v_i.id, p_request_id, null, jsonb_build_object('delta', v_delta));
  v_body := jsonb_build_object('item', app.mt_item_json(v_i));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'materials.adjust', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: consumo por atendimento e estorno
-- ---------------------------------------------------------------------------

/**
 * Registra o uso de materiais num atendimento CONCLUÍDO: pela ficha do serviço (p_lines null) ou pelas quantidades
 * informadas. Tudo ou nada: falta de estoque em um item recusa o consumo inteiro. Um consumo ativo por atendimento.
 */
create function public.materials_consume(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_lines jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_b public.bookings;
  v_lines jsonb;
  v_ids uuid[];
  v_c public.material_consumptions;
  v_cost bigint := 0;
  v_m public.material_movements;
  l record;
  v_body jsonb;
begin
  perform app.mt_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'materials.consume', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_b from public.bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'booking_id';
  end if;
  if v_b.status <> 'completed' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status', detail = 'só atendimento concluído';
  end if;
  if p_lines is null then
    v_lines := (select jsonb_agg(jsonb_build_object('item_id', u.item_id, 'quantity', u.quantity)) from public.material_service_usage u
      join public.material_items i on i.id = u.item_id and i.active where u.tenant_id = p_tenant_id and u.service_id = v_b.service_id);
    if v_lines is null then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'usage', detail = 'serviço sem ficha de uso';
    end if;
  else
    v_lines := p_lines;
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) not between 1 and 30 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'lines';
  end if;
  begin
    select array_agg(distinct x.item_id order by x.item_id) into v_ids from jsonb_to_recordset(v_lines) as x(item_id uuid, quantity numeric);
  exception when others then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'lines';
  end;
  if exists (select 1 from jsonb_to_recordset(v_lines) as x(item_id uuid, quantity numeric)
      where x.item_id is null or x.quantity is null or x.quantity <= 0 or x.quantity > 999999 or x.quantity <> round(x.quantity, 3))
     or cardinality(v_ids) <> jsonb_array_length(v_lines) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'lines';
  end if;
  if app.mt_lock_items(p_tenant_id, v_ids) <> cardinality(v_ids) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'item_id';
  end if;
  begin
    insert into public.material_consumptions (tenant_id, booking_id, cost_cents, source, created_by)
    values (p_tenant_id, v_b.id, 0, case when p_lines is null then 'usage' else 'manual' end, v_uid) returning * into v_c;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'consumed', detail = 'atendimento já tem consumo registrado';
  end;
  for l in select * from jsonb_to_recordset(v_lines) as x(item_id uuid, quantity numeric) order by x.item_id loop
    v_m := app.mt_move(p_tenant_id, l.item_id, 'consumption', -l.quantity, null, null, v_c.id, null, null);
    v_cost := v_cost - v_m.value_cents;
  end loop;
  update public.material_consumptions c set cost_cents = v_cost where c.id = v_c.id returning * into v_c;
  perform app.audit(p_tenant_id, 'materials.consume', 'booking', v_b.id, p_request_id, null, jsonb_build_object('cost_cents', v_cost, 'source', v_c.source));
  v_body := jsonb_build_object('consumption', app.mt_consumption_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'materials.consume', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Estorno do consumo: devolve ao estoque cada item pelo valor com que saiu. Uma vez; depois pode registrar de novo. */
create function public.materials_consume_reverse(
  p_tenant_id uuid,
  p_consumption_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.material_consumptions;
  v_ids uuid[];
  m public.material_movements;
  v_body jsonb;
begin
  perform app.mt_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'materials.consume_reverse', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_c from public.material_consumptions c where c.tenant_id = p_tenant_id and c.id = p_consumption_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_c.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_c.status <> 'active' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversed';
  end if;
  select array_agg(x.item_id order by x.item_id) into v_ids from public.material_movements x where x.consumption_id = v_c.id and x.kind = 'consumption';
  perform app.mt_lock_items(p_tenant_id, v_ids);
  for m in select * from public.material_movements x where x.consumption_id = v_c.id and x.kind = 'consumption' order by x.item_id loop
    perform app.mt_move(p_tenant_id, m.item_id, 'reversal', -m.quantity, -m.value_cents, null, v_c.id, m.id, null);
  end loop;
  update public.material_consumptions c set status = 'reversed' where c.id = v_c.id returning * into v_c;
  perform app.audit(p_tenant_id, 'materials.consume_reverse', 'booking', v_c.booking_id, p_request_id, null, jsonb_build_object('cost_cents', v_c.cost_cents));
  v_body := jsonb_build_object('consumption', app.mt_consumption_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'materials.consume_reverse', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: leituras (movimentos, atendimentos para registrar, margem, custo do orçamento)
-- ---------------------------------------------------------------------------

create function public.materials_movements(p_tenant_id uuid, p_item_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
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
      where p.tenant_id = p_tenant_id and p.purchased_at >= p_from and p.purchased_at < p_to order by p.purchased_at desc limit 100) p), '[]'::jsonb));
end $$;

/** Atendimentos concluídos no período com o consumo ativo (se houver): onde registrar o uso de materiais. */
create function public.materials_bookings(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
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
    left join public.customers cu on cu.id = b.customer_id), '[]'::jsonb));
end $$;

/**
 * Margem real sobre materiais, por serviço: receita combinada dos atendimentos concluídos no período menos o custo dos
 * materiais efetivamente consumidos. Cobertura: atendimentos sem consumo registrado são contados à parte (margem
 * desses é bruta, não real).
 */
create function public.materials_margin(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.mt_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '93 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  return (
    with b as (
      select b.id, b.service_id, coalesce(b.agreed_price_cents, 0) as revenue,
        (select c.cost_cents from public.material_consumptions c where c.booking_id = b.id and c.status = 'active') as cost
      from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed' and b.starts_at >= p_from and b.starts_at < p_to
    ), per as (
      select b.service_id, count(*) as completed, count(b.cost) as with_materials, coalesce(sum(b.revenue), 0) as revenue,
        coalesce(sum(b.revenue) filter (where b.cost is not null), 0) as revenue_covered, coalesce(sum(b.cost), 0) as cost
      from b group by b.service_id
    )
    select jsonb_build_object(
      'services', coalesce(jsonb_agg(jsonb_build_object('service_id', per.service_id, 'service_name', s.name, 'completed', per.completed,
        'with_materials', per.with_materials, 'revenue_cents', per.revenue, 'covered_revenue_cents', per.revenue_covered,
        'material_cost_cents', per.cost, 'margin_cents', per.revenue_covered - per.cost,
        'margin_bps', case when per.revenue_covered > 0 then round((per.revenue_covered - per.cost) * 10000.0 / per.revenue_covered)::integer end)
        order by s.name), '[]'::jsonb),
      'totals', jsonb_build_object('completed', coalesce(sum(per.completed), 0), 'with_materials', coalesce(sum(per.with_materials), 0),
        'revenue_cents', coalesce(sum(per.revenue), 0), 'covered_revenue_cents', coalesce(sum(per.revenue_covered), 0),
        'material_cost_cents', coalesce(sum(per.cost), 0), 'margin_cents', coalesce(sum(per.revenue_covered - per.cost), 0)),
      'period', jsonb_build_object('starts_at', app.sched_ts(p_from), 'ends_at', app.sched_ts(p_to)))
    from per join public.provider_services s on s.id = per.service_id);
end $$;

/**
 * Custo estimado de materiais da versão atual de um orçamento (P11): ficha de cada serviço × quantidade × custo médio
 * atual. Itens sem ficha ou sem custo conhecido aparecem como não cobertos. Não muda o orçamento.
 */
create function public.materials_quote_cost(p_tenant_id uuid, p_quote_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q public.sales_quotes;
  v_v public.sales_quote_versions;
begin
  perform app.mt_owner(p_tenant_id);
  select * into v_q from public.sales_quotes q where q.tenant_id = p_tenant_id and q.id = p_quote_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  select * into v_v from public.sales_quote_versions v where v.quote_id = v_q.id and v.version_no = v_q.current_version;
  return (
    with lines as (
      select (x.ord - 1)::integer as line, nullif(x.item->>'service_id', '')::uuid as service_id, x.item->>'description' as description,
        coalesce((x.item->>'quantity')::numeric, 1) as quantity, coalesce((x.item->>'line_total_cents')::bigint, 0) as line_total
      from jsonb_array_elements(v_v.items) with ordinality as x(item, ord)
    ), costed as (
      select l.*,
        (select count(*) from public.material_service_usage u where u.service_id = l.service_id) as usage_items,
        (select count(*) from public.material_service_usage u join public.material_items i on i.id = u.item_id
          where u.service_id = l.service_id and i.on_hand = 0) as unknown_cost_items,
        (select coalesce(sum(round(u.quantity * l.quantity * i.stock_value_cents / nullif(i.on_hand, 0))), 0)::bigint
          from public.material_service_usage u join public.material_items i on i.id = u.item_id where u.service_id = l.service_id) as cost
      from lines l
    )
    select jsonb_build_object('quote_id', v_q.id, 'version_no', v_v.version_no, 'total_cents', v_v.total_cents,
      'lines', coalesce(jsonb_agg(jsonb_build_object('line', c.line, 'service_id', c.service_id, 'description', c.description, 'quantity', c.quantity,
        'line_total_cents', c.line_total, 'material_cost_cents', c.cost, 'covered', c.usage_items > 0 and c.unknown_cost_items = 0) order by c.line), '[]'::jsonb),
      'material_cost_cents', coalesce(sum(c.cost), 0)::bigint,
      'margin_cents', v_v.total_cents - coalesce(sum(c.cost), 0)::bigint,
      'covered', coalesce(bool_and(c.usage_items > 0 and c.unknown_cost_items = 0), false))
    from costed c);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.mt_owner(uuid), app.mt_item_json(public.material_items), app.mt_movement_json(public.material_movements),
  app.mt_consumption_json(public.material_consumptions), app.mt_lock_items(uuid, uuid[]),
  app.mt_move(uuid, uuid, text, numeric, bigint, uuid, uuid, uuid, text), app.mt_purchase_json(public.material_purchases)
  from public, anon, authenticated;

revoke all on function public.materials_list(uuid) from public, anon;
revoke all on function public.materials_item_save(uuid, uuid, integer, text, text, text, boolean, numeric, text, text, uuid) from public, anon;
revoke all on function public.materials_usage_save(uuid, uuid, uuid, numeric, text, text, uuid) from public, anon;
revoke all on function public.materials_purchase(uuid, text, timestamptz, jsonb, boolean, text, text, uuid) from public, anon;
revoke all on function public.materials_purchase_reverse(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.materials_adjust(uuid, uuid, integer, numeric, text, text, text, uuid) from public, anon;
revoke all on function public.materials_consume(uuid, uuid, jsonb, text, text, uuid) from public, anon;
revoke all on function public.materials_consume_reverse(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.materials_movements(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.materials_bookings(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.materials_margin(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.materials_quote_cost(uuid, uuid) from public, anon;
grant execute on function public.materials_list(uuid) to authenticated;
grant execute on function public.materials_item_save(uuid, uuid, integer, text, text, text, boolean, numeric, text, text, uuid) to authenticated;
grant execute on function public.materials_usage_save(uuid, uuid, uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.materials_purchase(uuid, text, timestamptz, jsonb, boolean, text, text, uuid) to authenticated;
grant execute on function public.materials_purchase_reverse(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.materials_adjust(uuid, uuid, integer, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.materials_consume(uuid, uuid, jsonb, text, text, uuid) to authenticated;
grant execute on function public.materials_consume_reverse(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.materials_movements(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.materials_bookings(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.materials_margin(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.materials_quote_cost(uuid, uuid) to authenticated;

alter table public.material_items enable row level security;
alter table public.material_service_usage enable row level security;
alter table public.material_purchases enable row level security;
alter table public.material_consumptions enable row level security;
alter table public.material_movements enable row level security;
revoke all on public.material_items, public.material_service_usage, public.material_purchases, public.material_consumptions, public.material_movements
  from anon, authenticated;
grant select on public.material_items, public.material_service_usage, public.material_purchases, public.material_consumptions to authenticated;
-- Motivo do ajuste (texto livre do dono) fica fora da leitura direta.
grant select (id, tenant_id, item_id, kind, quantity, value_cents, purchase_id, consumption_id, reversal_of, created_by, created_at)
  on public.material_movements to authenticated;
grant select, insert, update, delete on public.material_items, public.material_service_usage, public.material_purchases, public.material_consumptions to service_role;
grant select, insert on public.material_movements to service_role;
create policy material_items_select_owner on public.material_items for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy material_service_usage_select_owner on public.material_service_usage for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy material_purchases_select_owner on public.material_purchases for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy material_consumptions_select_owner on public.material_consumptions for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy material_movements_select_owner on public.material_movements for select to authenticated using (app.is_member(tenant_id, array['owner']));
