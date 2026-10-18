-- P07 · Caixa registrado: recebíveis, recebimentos manuais, despesas e pacotes de sessões.
-- Separações (docs/02, doc15): agendar ≠ receber; recebível ≠ recebimento; crédito de sessão ≠ caixa.
-- Recebimentos e despesas são append-only: correção é estorno vinculado (reversal_of), nunca edição.
-- Pacote de 10 sessões por R$1.000 gera UM recebível de R$1.000; consumir sessão debita crédito, não caixa.
--
-- Escrita só por RPC do dono (autoriza → idempotency_claim → trava a linha-mãe → valida → grava →
-- auditoria sem PII → idempotency_complete). Leitura só do dono: cliente e staff não leem o caixa.
-- Depende de: fundação, P02 (customers, provider_services), P03 (bookings, app.sched_ts).

create function app.fin_ts(p_ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select case when p_ts is null then null else app.sched_ts(p_ts) end
$$;

-- ---------------------------------------------------------------------------
-- Pacotes de sessões e o ledger de créditos
-- ---------------------------------------------------------------------------

create table public.session_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid not null,
  service_id uuid not null,
  purchased_credits integer not null check (purchased_credits between 1 and 500),
  -- Preço contratado: protegido de mudanças posteriores de preço do serviço.
  total_price_cents bigint not null check (total_price_cents between 0 and 9007199254740991),
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint session_packages_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint session_packages_service foreign key (tenant_id, service_id)
    references public.provider_services (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.session_packages is 'Pacote pré-pago. Saldo = purchased_credits + soma de session_entries.delta.';
create trigger session_packages_touch before update on public.session_packages
  for each row execute function app.touch_row();

create table public.session_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  package_id uuid not null,
  booking_id uuid,
  delta integer not null check (delta in (-1, 1)),
  reason text not null check (reason in ('consume', 'reversal')),
  -- Evento de origem do consumo (booking.completed.v1): débito único por evento.
  source_event_id uuid,
  reversal_of uuid references public.session_entries (id) on delete restrict,
  note text check (char_length(note) <= 280),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint session_entries_shape check (
    (reason = 'consume' and delta = -1 and booking_id is not null and source_event_id is not null and reversal_of is null)
    or (reason = 'reversal' and delta = 1 and reversal_of is not null)
  ),
  constraint session_entries_package foreign key (tenant_id, package_id)
    references public.session_packages (tenant_id, id) on delete restrict,
  constraint session_entries_booking foreign key (tenant_id, booking_id)
    references public.bookings (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
create unique index session_entries_one_per_event on public.session_entries (tenant_id, source_event_id)
  where source_event_id is not null;
create unique index session_entries_one_per_booking on public.session_entries (tenant_id, booking_id)
  where reason = 'consume';
create unique index session_entries_one_reversal on public.session_entries (reversal_of) where reversal_of is not null;
create index session_entries_package on public.session_entries (tenant_id, package_id, created_at);
create trigger session_entries_append_only before update or delete on public.session_entries
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Recebíveis (valor devido) e recebimentos (dinheiro registrado)
-- ---------------------------------------------------------------------------

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid,
  booking_id uuid,
  package_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  -- Mantido só pelas RPCs de recebimento/estorno, sob lock desta linha.
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'partially_paid', 'paid', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint receivables_paid_le_amount check (paid_cents <= amount_cents),
  constraint receivables_status_matches check (
    status = 'cancelled' and paid_cents = 0
    or status = 'open' and paid_cents = 0
    or status = 'partially_paid' and paid_cents > 0 and paid_cents < amount_cents
    or status = 'paid' and paid_cents = amount_cents
  ),
  constraint receivables_one_origin check (booking_id is null or package_id is null),
  constraint receivables_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint receivables_booking foreign key (tenant_id, booking_id)
    references public.bookings (tenant_id, id) on delete restrict,
  constraint receivables_package foreign key (tenant_id, package_id)
    references public.session_packages (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.receivables is 'Valor devido. Não implica recebido. Status derivado de paid_cents.';
create unique index receivables_one_per_booking on public.receivables (tenant_id, booking_id)
  where booking_id is not null and status <> 'cancelled';
create unique index receivables_one_per_package on public.receivables (tenant_id, package_id)
  where package_id is not null;
create index receivables_open on public.receivables (tenant_id, status, due_at) where status in ('open', 'partially_paid');
create trigger receivables_touch before update on public.receivables
  for each row execute function app.touch_row();

create table public.payment_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  receivable_id uuid not null,
  customer_id uuid,
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  method text not null check (method in ('pix', 'cash', 'card', 'transfer', 'other')),
  -- Só registro manual no piloto; recebimento via provedor exige evidência do provedor (fase futura).
  source text not null default 'manual' check (source = 'manual'),
  received_at timestamptz not null,
  -- Estorno: nova linha que anula a original (efeito negativo); a original nunca muda.
  reversal_of uuid references public.payment_entries (id) on delete restrict,
  note text check (char_length(note) <= 280),
  recorded_by uuid,
  created_at timestamptz not null default now(),
  constraint payment_entries_receivable foreign key (tenant_id, receivable_id)
    references public.receivables (tenant_id, id) on delete restrict,
  constraint payment_entries_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.payment_entries is 'Recebimentos manuais, append-only. Estorno é linha nova com reversal_of.';
create unique index payment_entries_one_reversal on public.payment_entries (reversal_of) where reversal_of is not null;
create index payment_entries_period on public.payment_entries (tenant_id, received_at);
create trigger payment_entries_append_only before update or delete on public.payment_entries
  for each row execute function app.forbid_mutation();

create table public.expense_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  paid_at timestamptz not null,
  category text not null check (category in ('supplies', 'rent', 'utilities', 'fees', 'transport', 'marketing', 'other')),
  description text check (char_length(description) <= 120),
  reversal_of uuid references public.expense_entries (id) on delete restrict,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.expense_entries is 'Despesas simples, append-only, sem DRE contábil. Estorno é linha nova.';
create unique index expense_entries_one_reversal on public.expense_entries (reversal_of) where reversal_of is not null;
create index expense_entries_period on public.expense_entries (tenant_id, paid_at);
create trigger expense_entries_append_only before update or delete on public.expense_entries
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- JSON e regras internas
-- ---------------------------------------------------------------------------

create function app.fin_receivable_json(r public.receivables) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'customer_id', r.customer_id, 'booking_id', r.booking_id,
    'package_id', r.package_id, 'description', r.description, 'amount_cents', r.amount_cents,
    'paid_cents', r.paid_cents, 'open_cents', case when r.status = 'cancelled' then 0 else r.amount_cents - r.paid_cents end,
    'due_at', app.fin_ts(r.due_at), 'status', r.status, 'version', r.version, 'created_at', app.fin_ts(r.created_at))
$$;

create function app.fin_payment_json(p public.payment_entries) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'tenant_id', p.tenant_id, 'customer_id', p.customer_id,
    'amount_cents', p.amount_cents, 'method', p.method, 'source', p.source, 'received_at', app.fin_ts(p.received_at),
    'reversal_of', p.reversal_of, 'receivable_id', p.receivable_id,
    'reversed', exists (select 1 from public.payment_entries x where x.reversal_of = p.id))
$$;

create function app.fin_expense_json(e public.expense_entries) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'amount_cents', e.amount_cents, 'paid_at', app.fin_ts(e.paid_at),
    'category', e.category, 'description', e.description, 'reversal_of', e.reversal_of,
    'reversed', exists (select 1 from public.expense_entries x where x.reversal_of = e.id))
$$;

create function app.fin_package_balance(p_tenant_id uuid, p_package_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('package_id', p.id, 'purchased_credits', p.purchased_credits,
    'remaining_credits', p.purchased_credits + coalesce((select sum(e.delta) from public.session_entries e
      where e.tenant_id = p.tenant_id and e.package_id = p.id), 0),
    'expires_at', app.fin_ts(p.expires_at))
  from public.session_packages p where p.tenant_id = p_tenant_id and p.id = p_package_id
$$;

create function app.fin_status(p_amount bigint, p_paid bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_paid = 0 then 'open' when p_paid < p_amount then 'partially_paid' else 'paid' end
$$;

create function app.fin_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.fin_period(p_from timestamptz, p_to timestamptz) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Recebíveis
-- ---------------------------------------------------------------------------

create function public.finance_receivable_create(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_due_at timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_row public.receivables;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'finance.create_receivable', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_customer_id is not null then
    perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
    end if;
  end if;
  if p_description is null or char_length(btrim(p_description)) not between 1 and 120 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'description';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'amount_cents';
  end if;
  insert into public.receivables (tenant_id, customer_id, description, amount_cents, due_at, created_by)
  values (p_tenant_id, p_customer_id, btrim(p_description), p_amount_cents, p_due_at, v_uid)
  returning * into v_row;
  v_body := jsonb_build_object('receivable', app.fin_receivable_json(v_row));
  perform app.audit(p_tenant_id, 'finance.create_receivable', 'receivable', v_row.id, p_request_id, null,
    jsonb_build_object('amount_cents', v_row.amount_cents));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'finance.create_receivable', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Cobrança de um atendimento: valor = preço combinado congelado na reserva. Um recebível ativo por reserva. */
create function public.finance_charge_booking(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_due_at timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_b public.bookings;
  v_row public.receivables;
  v_svc text;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'finance.charge_booking', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  select * into v_b from public.bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_b.status not in ('confirmed', 'completed') or v_b.agreed_price_cents is null or v_b.agreed_price_cents < 1 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if exists (select 1 from public.session_entries e where e.tenant_id = p_tenant_id and e.booking_id = p_booking_id
             and e.reason = 'consume'
             and not exists (select 1 from public.session_entries r where r.reversal_of = e.id)) then
    -- Atendimento pago com crédito de pacote: cobrar de novo seria receita repetida.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'package';
  end if;
  select s.name into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = v_b.service_id;

  begin
    insert into public.receivables (tenant_id, customer_id, booking_id, description, amount_cents, due_at, created_by)
    values (p_tenant_id, v_b.customer_id, v_b.id, left(coalesce(v_svc, 'Atendimento'), 120), v_b.agreed_price_cents,
      coalesce(p_due_at, v_b.starts_at), v_uid)
    returning * into v_row;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'booking_id',
      detail = 'atendimento já tem cobrança';
  end;
  v_body := jsonb_build_object('receivable', app.fin_receivable_json(v_row));
  perform app.audit(p_tenant_id, 'finance.charge_booking', 'receivable', v_row.id, p_request_id, null,
    jsonb_build_object('booking_id', v_b.id, 'amount_cents', v_row.amount_cents));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'finance.charge_booking', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.finance_receivable_cancel(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.receivables;
  v_new public.receivables;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'finance.cancel_receivable', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_old from public.receivables r where r.tenant_id = p_tenant_id and r.id = p_receivable_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_old.status <> 'open' or v_old.package_id is not null then
    -- Com recebimento registrado, estorne primeiro; pacote vendido não é cancelado por aqui.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.receivables r set status = 'cancelled' where r.tenant_id = p_tenant_id and r.id = p_receivable_id
  returning * into v_new;
  v_body := jsonb_build_object('receivable', app.fin_receivable_json(v_new));
  perform app.audit(p_tenant_id, 'finance.cancel_receivable', 'receivable', v_new.id, p_request_id,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new.status));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'finance.cancel_receivable', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Recebimentos (manuais) e estorno
-- ---------------------------------------------------------------------------

create function public.finance_record_payment(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_received_at timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_r public.receivables;
  v_p public.payment_entries;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'finance.record_payment', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_amount_cents is null or p_amount_cents < 1 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'amount_cents';
  end if;
  if p_received_at is null or p_received_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'received_at',
      detail = 'recebimento no futuro';
  end if;

  -- Lock do recebível: recebimentos simultâneos não ultrapassam o valor devido.
  select * into v_r from public.receivables r where r.tenant_id = p_tenant_id and r.id = p_receivable_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_r.status not in ('open', 'partially_paid') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if v_r.paid_cents + p_amount_cents > v_r.amount_cents then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'amount_cents',
      detail = 'valor maior que o saldo em aberto';
  end if;

  insert into public.payment_entries (tenant_id, receivable_id, customer_id, amount_cents, method, received_at, recorded_by)
  values (p_tenant_id, v_r.id, v_r.customer_id, p_amount_cents, p_method, p_received_at, v_uid)
  returning * into v_p;
  update public.receivables r
  set paid_cents = r.paid_cents + p_amount_cents, status = app.fin_status(r.amount_cents, r.paid_cents + p_amount_cents)
  where r.tenant_id = p_tenant_id and r.id = v_r.id;

  perform app.emit_event(p_tenant_id, 'payment.recorded.v1', v_p.id, 1, coalesce(p_request_id, gen_random_uuid()),
    jsonb_build_object('payment_id', v_p.id, 'receivable_id', v_r.id, 'amount_cents', v_p.amount_cents,
      'method', v_p.method, 'source', v_p.source, 'received_at', app.fin_ts(v_p.received_at)));
  perform app.audit(p_tenant_id, 'finance.record_payment', 'payment', v_p.id, p_request_id, null,
    jsonb_build_object('receivable_id', v_r.id, 'amount_cents', v_p.amount_cents, 'method', v_p.method));
  v_body := app.fin_payment_json(v_p);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'finance.record_payment', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.finance_reverse_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_orig public.payment_entries;
  v_rev public.payment_entries;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'finance.reverse_payment', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;
  select * into v_orig from public.payment_entries p where p.tenant_id = p_tenant_id and p.id = p_payment_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_orig.reversal_of is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversal_of';
  end if;
  perform 1 from public.receivables r where r.tenant_id = p_tenant_id and r.id = v_orig.receivable_id for update;

  begin
    insert into public.payment_entries (tenant_id, receivable_id, customer_id, amount_cents, method, received_at,
      reversal_of, note, recorded_by)
    values (p_tenant_id, v_orig.receivable_id, v_orig.customer_id, v_orig.amount_cents, v_orig.method,
      clock_timestamp(), v_orig.id, btrim(p_reason), v_uid)
    returning * into v_rev;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversal_of',
      detail = 'recebimento já estornado';
  end;
  update public.receivables r
  set paid_cents = r.paid_cents - v_orig.amount_cents, status = app.fin_status(r.amount_cents, r.paid_cents - v_orig.amount_cents)
  where r.tenant_id = p_tenant_id and r.id = v_orig.receivable_id;

  perform app.audit(p_tenant_id, 'finance.reverse_payment', 'payment', v_rev.id, p_request_id, null,
    jsonb_build_object('reversal_of', v_orig.id, 'amount_cents', v_orig.amount_cents));
  v_body := app.fin_payment_json(v_rev);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'finance.reverse_payment', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Despesas
-- ---------------------------------------------------------------------------

create function public.finance_record_expense(
  p_tenant_id uuid,
  p_amount_cents bigint,
  p_paid_at timestamptz,
  p_category text,
  p_description text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_e public.expense_entries;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'finance.record_expense', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_amount_cents is null or p_amount_cents < 1 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'amount_cents';
  end if;
  if p_paid_at is null or p_paid_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'paid_at';
  end if;
  insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, description, recorded_by)
  values (p_tenant_id, p_amount_cents, p_paid_at, p_category, nullif(btrim(p_description), ''), v_uid)
  returning * into v_e;
  perform app.audit(p_tenant_id, 'finance.record_expense', 'expense', v_e.id, p_request_id, null,
    jsonb_build_object('amount_cents', v_e.amount_cents, 'category', v_e.category));
  v_body := app.fin_expense_json(v_e);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'finance.record_expense', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.finance_reverse_expense(
  p_tenant_id uuid,
  p_expense_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_orig public.expense_entries;
  v_rev public.expense_entries;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'finance.reverse_expense', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_orig from public.expense_entries e where e.tenant_id = p_tenant_id and e.id = p_expense_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_orig.reversal_of is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversal_of';
  end if;
  begin
    insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, description, reversal_of, recorded_by)
    values (p_tenant_id, v_orig.amount_cents, clock_timestamp(), v_orig.category, v_orig.description, v_orig.id, v_uid)
    returning * into v_rev;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversal_of';
  end;
  perform app.audit(p_tenant_id, 'finance.reverse_expense', 'expense', v_rev.id, p_request_id, null,
    jsonb_build_object('reversal_of', v_orig.id));
  v_body := app.fin_expense_json(v_rev);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'finance.reverse_expense', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Pacotes de sessões
-- ---------------------------------------------------------------------------

/** Venda: cria o pacote e UM recebível do valor total, na mesma transação. */
create function public.package_sell(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_service_id uuid,
  p_credits integer,
  p_total_price_cents bigint,
  p_expires_at timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_pkg public.session_packages;
  v_rec public.receivables;
  v_svc text;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'package.sell', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  select s.name into v_svc from public.provider_services s
  where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_credits is null or p_credits not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'credits';
  end if;
  if p_total_price_cents is null or p_total_price_cents < 1 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'total_price_cents';
  end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'expires_at';
  end if;

  insert into public.session_packages (tenant_id, customer_id, service_id, purchased_credits, total_price_cents,
    expires_at, created_by)
  values (p_tenant_id, p_customer_id, p_service_id, p_credits, p_total_price_cents, p_expires_at, v_uid)
  returning * into v_pkg;
  insert into public.receivables (tenant_id, customer_id, package_id, description, amount_cents, due_at, created_by)
  values (p_tenant_id, p_customer_id, v_pkg.id, left(format('Pacote %s × %s', p_credits, v_svc), 120),
    p_total_price_cents, clock_timestamp(), v_uid)
  returning * into v_rec;

  v_body := jsonb_build_object('package', app.fin_package_balance(p_tenant_id, v_pkg.id),
    'receivable', app.fin_receivable_json(v_rec));
  perform app.audit(p_tenant_id, 'package.sell', 'session_package', v_pkg.id, p_request_id, null,
    jsonb_build_object('credits', p_credits, 'total_price_cents', p_total_price_cents));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'package.sell', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/**
 * Consome 1 crédito por atendimento concluído. Débito único por evento: repetir o mesmo evento
 * (retry do worker ou outra chave) devolve o saldo sem debitar de novo.
 */
create function public.package_consume(
  p_tenant_id uuid,
  p_package_id uuid,
  p_booking_id uuid,
  p_event_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_pkg public.session_packages;
  v_b public.bookings;
  v_remaining integer;
  v_entry uuid;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'package.consume', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  -- Lock do pacote: consumos simultâneos não deixam saldo negativo.
  select * into v_pkg from public.session_packages p where p.tenant_id = p_tenant_id and p.id = p_package_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'package_id';
  end if;

  select e.package_id into v_entry from public.session_entries e
  where e.tenant_id = p_tenant_id and e.source_event_id = p_event_id;
  if found then
    if v_entry <> p_package_id then
      -- O evento já debitou outro pacote: não debita este nem finge sucesso.
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'event_id';
    end if;
    v_body := app.fin_package_balance(p_tenant_id, p_package_id);
    perform app.idempotency_complete(p_tenant_id, v_uid, 'package.consume', p_idem_key, 200, v_body);
    return jsonb_build_object('status_code', 200, 'body', v_body);
  end if;

  select * into v_b from public.bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'booking_id';
  end if;
  -- O evento precisa ser a conclusão DESTA reserva (política padrão: consumir no atendimento concluído).
  perform 1 from public.outbox_events o
  where o.tenant_id = p_tenant_id and o.event_id = p_event_id
    and o.event_type = 'booking.completed.v1' and o.aggregate_id = p_booking_id;
  if not found or v_b.status <> 'completed' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'event_id';
  end if;
  if v_b.customer_id is distinct from v_pkg.customer_id or v_b.service_id <> v_pkg.service_id then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'package_id';
  end if;
  if v_pkg.expires_at is not null and v_b.starts_at > v_pkg.expires_at then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expires_at';
  end if;
  if exists (select 1 from public.receivables r where r.tenant_id = p_tenant_id and r.booking_id = p_booking_id
             and r.status <> 'cancelled') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'booking_id',
      detail = 'atendimento já cobrado à parte';
  end if;
  v_remaining := (app.fin_package_balance(p_tenant_id, p_package_id)->>'remaining_credits')::int;
  if v_remaining < 1 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'remaining_credits';
  end if;

  begin
    insert into public.session_entries (tenant_id, package_id, booking_id, delta, reason, source_event_id, created_by)
    values (p_tenant_id, p_package_id, p_booking_id, -1, 'consume', p_event_id, v_uid)
    returning id into v_entry;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'booking_id',
      detail = 'atendimento já consumiu crédito';
  end;
  perform app.audit(p_tenant_id, 'package.consume', 'session_entry', v_entry, p_request_id, null,
    jsonb_build_object('package_id', p_package_id, 'booking_id', p_booking_id));
  v_body := app.fin_package_balance(p_tenant_id, p_package_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'package.consume', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Estorno de consumo: devolve 1 crédito, vinculado ao débito original (uma vez). */
create function public.package_reverse(
  p_tenant_id uuid,
  p_entry_id uuid,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_orig public.session_entries;
  v_entry uuid;
  v_body jsonb;
begin
  perform app.fin_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'package.reverse', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;
  select * into v_orig from public.session_entries e where e.tenant_id = p_tenant_id and e.id = p_entry_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_orig.reason <> 'consume' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'entry_id';
  end if;
  perform 1 from public.session_packages p where p.tenant_id = p_tenant_id and p.id = v_orig.package_id for update;
  begin
    insert into public.session_entries (tenant_id, package_id, booking_id, delta, reason, reversal_of, note, created_by)
    values (p_tenant_id, v_orig.package_id, v_orig.booking_id, 1, 'reversal', v_orig.id, btrim(p_reason), v_uid)
    returning id into v_entry;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'entry_id',
      detail = 'consumo já estornado';
  end;
  perform app.audit(p_tenant_id, 'package.reverse', 'session_entry', v_entry, p_request_id, null,
    jsonb_build_object('reversal_of', v_orig.id));
  v_body := app.fin_package_balance(p_tenant_id, v_orig.package_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'package.reverse', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Leituras (dono)
-- ---------------------------------------------------------------------------

/**
 * Caixa registrado no período. Recebido = recebimentos com data no período e não estornados;
 * gasto = despesas idem; a receber = saldo em aberto hoje. Não é lucro, DRE nem saldo bancário.
 */
create function public.finance_summary(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_received bigint;
  v_spent bigint;
  v_open bigint;
  v_count integer;
  v_tz text;
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  select coalesce(sum(p.amount_cents), 0), count(*) into v_received, v_count
  from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= p_from and p.received_at < p_to
    and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id);
  select coalesce(sum(e.amount_cents), 0), v_count + count(*) into v_spent, v_count
  from public.expense_entries e
  where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= p_from and e.paid_at < p_to
    and not exists (select 1 from public.expense_entries x where x.reversal_of = e.id);
  select coalesce(sum(r.amount_cents - r.paid_cents), 0) into v_open
  from public.receivables r where r.tenant_id = p_tenant_id and r.status in ('open', 'partially_paid');
  return jsonb_build_object(
    'period', jsonb_build_object('starts_at', app.fin_ts(p_from), 'ends_at', app.fin_ts(p_to)),
    'timezone', v_tz,
    'received_cents', v_received,
    'spent_cents', v_spent,
    'receivable_open_cents', v_open,
    'records_count', v_count,
    'as_of', app.fin_ts(clock_timestamp()),
    'coverage_note', 'Só o que foi registrado manualmente na Tinindo. Estornos anulam o registro original. Não é lucro nem saldo bancário.'
  );
end $$;

create function public.finance_ledger(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  return jsonb_build_object(
    'receivables', coalesce((select jsonb_agg(app.fin_receivable_json(r) order by r.due_at nulls last, r.created_at)
      from (select * from public.receivables r where r.tenant_id = p_tenant_id
              and (r.status in ('open', 'partially_paid') or (r.created_at >= p_from and r.created_at < p_to))
            order by r.due_at nulls last, r.created_at limit 200) r), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(app.fin_payment_json(p) order by p.received_at desc)
      from (select * from public.payment_entries p where p.tenant_id = p_tenant_id
              and p.received_at >= p_from and p.received_at < p_to order by p.received_at desc limit 200) p), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(app.fin_expense_json(e) order by e.paid_at desc)
      from (select * from public.expense_entries e where e.tenant_id = p_tenant_id
              and e.paid_at >= p_from and e.paid_at < p_to order by e.paid_at desc limit 200) e), '[]'::jsonb)
  );
end $$;

/** Atendimentos concluídos no período sem cobrança ativa nem crédito consumido (até 100). */
create function public.finance_uncharged(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  return jsonb_build_object('bookings', coalesce((select jsonb_agg(x order by x->>'starts_at') from (
    select jsonb_build_object(
      'booking_id', b.id, 'customer_id', b.customer_id, 'service_id', b.service_id,
      'starts_at', app.fin_ts(b.starts_at), 'agreed_price_cents', b.agreed_price_cents,
      'completed_event_id', (select o.event_id from public.outbox_events o where o.tenant_id = b.tenant_id
        and o.aggregate_id = b.id and o.event_type = 'booking.completed.v1' order by o.occurred_at desc limit 1),
      'package_ids', coalesce((select jsonb_agg(p.id order by p.created_at) from public.session_packages p
        where p.tenant_id = b.tenant_id and p.customer_id = b.customer_id and p.service_id = b.service_id
          and (p.expires_at is null or p.expires_at >= b.starts_at)
          and p.purchased_credits + coalesce((select sum(e.delta) from public.session_entries e
            where e.tenant_id = p.tenant_id and e.package_id = p.id), 0) > 0), '[]'::jsonb)
    ) as x
    from public.bookings b
    where b.tenant_id = p_tenant_id and b.status = 'completed' and b.starts_at >= p_from and b.starts_at < p_to
      and not exists (select 1 from public.receivables r where r.tenant_id = b.tenant_id and r.booking_id = b.id
                      and r.status <> 'cancelled')
      and not exists (select 1 from public.session_entries e where e.tenant_id = b.tenant_id and e.booking_id = b.id
                      and e.reason = 'consume'
                      and not exists (select 1 from public.session_entries r where r.reversal_of = e.id))
    order by b.starts_at limit 100) s), '[]'::jsonb));
end $$;

create function public.package_list(p_tenant_id uuid) returns jsonb
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
    '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS: só o dono lê; ninguém escreve direto.
-- ---------------------------------------------------------------------------

revoke all on function app.fin_ts(timestamptz) from public;
revoke all on function app.fin_receivable_json(public.receivables) from public;
revoke all on function app.fin_payment_json(public.payment_entries) from public;
revoke all on function app.fin_expense_json(public.expense_entries) from public;
revoke all on function app.fin_package_balance(uuid, uuid) from public;
revoke all on function app.fin_status(bigint, bigint) from public;
revoke all on function app.fin_owner(uuid) from public;
revoke all on function app.fin_period(timestamptz, timestamptz) from public;

revoke all on function public.finance_receivable_create(uuid, uuid, text, bigint, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.finance_charge_booking(uuid, uuid, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.finance_receivable_cancel(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.finance_record_payment(uuid, uuid, bigint, text, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.finance_reverse_payment(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.finance_record_expense(uuid, bigint, timestamptz, text, text, text, text, uuid) from public, anon;
revoke all on function public.finance_reverse_expense(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.package_sell(uuid, uuid, uuid, integer, bigint, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.package_consume(uuid, uuid, uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.package_reverse(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.finance_summary(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.finance_ledger(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.finance_uncharged(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.package_list(uuid) from public, anon;

grant execute on function public.finance_receivable_create(uuid, uuid, text, bigint, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.finance_charge_booking(uuid, uuid, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.finance_receivable_cancel(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.finance_record_payment(uuid, uuid, bigint, text, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.finance_reverse_payment(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.finance_record_expense(uuid, bigint, timestamptz, text, text, text, text, uuid) to authenticated;
grant execute on function public.finance_reverse_expense(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.package_sell(uuid, uuid, uuid, integer, bigint, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.package_consume(uuid, uuid, uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.package_reverse(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.finance_summary(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.finance_ledger(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.finance_uncharged(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.package_list(uuid) to authenticated;

alter table public.session_packages enable row level security;
alter table public.session_entries enable row level security;
alter table public.receivables enable row level security;
alter table public.payment_entries enable row level security;
alter table public.expense_entries enable row level security;

revoke all on public.session_packages, public.session_entries, public.receivables, public.payment_entries,
  public.expense_entries from anon, authenticated;
grant select on public.session_packages, public.session_entries, public.receivables, public.payment_entries,
  public.expense_entries to authenticated;
grant select, insert, update on public.session_packages, public.receivables to service_role;
grant select, insert on public.session_entries, public.payment_entries, public.expense_entries to service_role;

create policy session_packages_select_owner on public.session_packages
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy session_entries_select_owner on public.session_entries
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy receivables_select_owner on public.receivables
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy payment_entries_select_owner on public.payment_entries
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy expense_entries_select_owner on public.expense_entries
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
