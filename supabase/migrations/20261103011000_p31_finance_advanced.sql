-- P31 · Financeiro ampliado: contas a pagar (vencimento, recorrência mensal, pago, estorno), categorias de receita e
-- despesa, conciliação de recebimentos por meio de pagamento (manual e PSP) e demonstrativo gerencial mensal de caixa.
-- Invariantes (docs/02, docs/17, tasks/P31, ADR-0033):
-- * Pagar uma conta cria UMA despesa no Caixa (P07). Pagar de novo não baixa de novo: índice único "um pagamento vivo
--   por conta" + lock da conta + idempotência. Estorno é linha nova no Caixa (reversal_of do P07), uma vez.
-- * Nenhuma tabela do P07/P14/P16 muda. Categoria é uma camada por cima (classificação do lançamento).
-- * Demonstrativo em REGIME DE CAIXA, com período escrito e fuso, e com cobertura (o que falta lançar). Não é DRE: os
--   critérios de reconhecimento (competência, impostos, depreciação) não estão definidos (ADR-0033).
-- Depende de: fundação, P03 (bookings), P07 (receivables, payment_entries, expense_entries), P14 (payment_charges,
-- payment_reconciliations), P16 (fiscal_documents), P28 (team_bookings, team_class_seats: origem de receitas da equipe).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.fin_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  kind text not null check (kind in ('income', 'expense')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- Despesa: categoria do Caixa (P07) em que a despesa é lançada. Receita: nulo.
  base text check (base in ('supplies', 'rent', 'utilities', 'fees', 'transport', 'marketing', 'other')),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint fin_categories_base check ((kind = 'expense') = (base is not null)),
  unique (tenant_id, id)
);
comment on table public.fin_categories is 'Categoria própria do negócio (receita ou despesa). As do Caixa (P07) valem sem cadastro.';
create unique index fin_categories_unique_name on public.fin_categories (tenant_id, kind, lower(btrim(name))) where active;
create trigger fin_categories_touch before update on public.fin_categories for each row execute function app.touch_row();

create table public.fin_classifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  entry_kind text not null check (entry_kind in ('payment', 'expense')),
  payment_entry_id uuid,
  expense_entry_id uuid,
  category_id uuid not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint fin_classifications_target check ((entry_kind = 'payment') = (payment_entry_id is not null and expense_entry_id is null)
    and (entry_kind = 'expense') = (expense_entry_id is not null and payment_entry_id is null)),
  constraint fin_classifications_payment foreign key (tenant_id, payment_entry_id) references public.payment_entries (tenant_id, id) on delete restrict,
  constraint fin_classifications_expense foreign key (tenant_id, expense_entry_id) references public.expense_entries (tenant_id, id) on delete restrict,
  constraint fin_classifications_category foreign key (tenant_id, category_id) references public.fin_categories (tenant_id, id) on delete restrict,
  unique (payment_entry_id),
  unique (expense_entry_id),
  unique (tenant_id, id)
);
comment on table public.fin_classifications is 'Categoria própria de um lançamento do Caixa. Uma por lançamento; trocar atualiza a linha (auditado).';
create trigger fin_classifications_touch before update on public.fin_classifications for each row execute function app.touch_row();

create table public.fin_payable_series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  base_category text not null check (base_category in ('supplies', 'rent', 'utilities', 'fees', 'transport', 'marketing', 'other')),
  category_id uuid,
  supplier text check (char_length(supplier) <= 80),
  day_of_month integer not null check (day_of_month between 1 and 28),
  starts_on date not null,
  -- Última competência gerada (mês). Gera-se até 12 meses à frente; "Gerar próximos meses" estende.
  generated_until date not null,
  ended_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint fin_payable_series_category foreign key (tenant_id, category_id) references public.fin_categories (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.fin_payable_series is 'Conta recorrente mensal. Cada mês vira uma conta a pagar própria (vencimento único por mês).';
create trigger fin_payable_series_touch before update on public.fin_payable_series for each row execute function app.touch_row();

create table public.fin_payables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  series_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  due_on date not null,
  base_category text not null check (base_category in ('supplies', 'rent', 'utilities', 'fees', 'transport', 'marketing', 'other')),
  category_id uuid,
  supplier text check (char_length(supplier) <= 80),
  -- open | cancelled. "Paga" é derivado: existe um pagamento vivo em fin_payable_payments.
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint fin_payables_series foreign key (tenant_id, series_id) references public.fin_payable_series (tenant_id, id) on delete restrict,
  constraint fin_payables_category foreign key (tenant_id, category_id) references public.fin_categories (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.fin_payables is 'Conta a pagar. Pagar cria uma despesa no Caixa (P07); estornar cria o estorno dela.';
create unique index fin_payables_one_per_month on public.fin_payables (series_id, due_on) where series_id is not null;
create index fin_payables_due on public.fin_payables (tenant_id, due_on);
create trigger fin_payables_touch before update on public.fin_payables for each row execute function app.touch_row();

create table public.fin_payable_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  payable_id uuid not null,
  expense_entry_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  paid_at timestamptz not null,
  -- Estorno: a linha de estorno da despesa no Caixa. Nulo = pagamento vivo.
  reversal_expense_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_payable_payments_payable foreign key (tenant_id, payable_id) references public.fin_payables (tenant_id, id) on delete restrict,
  constraint fin_payable_payments_expense foreign key (tenant_id, expense_entry_id) references public.expense_entries (tenant_id, id) on delete restrict,
  constraint fin_payable_payments_reversal foreign key (tenant_id, reversal_expense_id) references public.expense_entries (tenant_id, id) on delete restrict,
  unique (expense_entry_id),
  unique (reversal_expense_id),
  unique (tenant_id, id)
);
comment on table public.fin_payable_payments is 'Pagamento de uma conta. Um vivo por conta (índice único): pagar duas vezes não baixa duas vezes.';
create unique index fin_payable_payments_one_live on public.fin_payable_payments (payable_id) where reversal_expense_id is null;
-- Só o estorno muda a linha (de nulo para o estorno, uma vez).
create function app.fa_payment_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.reversal_expense_id is not null or new.reversal_expense_id is null
     or (new.payable_id, new.expense_entry_id, new.amount_cents, new.paid_at) is distinct from (old.payable_id, old.expense_entry_id, old.amount_cents, old.paid_at) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'pagamento só recebe o estorno, uma vez';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger fin_payable_payments_guard before update or delete on public.fin_payable_payments for each row execute function app.fa_payment_guard();

create table public.fin_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  day date not null,
  method text not null check (method in ('pix', 'cash', 'card', 'transfer', 'other')),
  source text not null check (source in ('manual', 'provider')),
  -- O que caiu de verdade, segundo o extrato/relatório que o dono conferiu.
  statement_cents bigint not null check (statement_cents between 0 and 9007199254740991),
  -- O que estava registrado na Tinindo no momento da conferência (líquido de estornos).
  ledger_cents bigint not null,
  difference_cents bigint not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.fin_reconciliations is 'Conferência do dia por meio e origem: extrato × registrado. Append-only; a última vale.';
create index fin_reconciliations_day on public.fin_reconciliations (tenant_id, day, method, source, created_at desc);
create trigger fin_reconciliations_append_only before update or delete on public.fin_reconciliations for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.fa_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.fa_tz(p_tenant_id uuid) returns text
language sql stable security definer set search_path = '' as $$ select t.timezone from public.tenants t where t.id = p_tenant_id $$;

create function app.fa_category_json(c public.fin_categories) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'base', c.base, 'active', c.active, 'version', c.version)
$$;

/** Pagamento vivo (não estornado) de uma conta. */
create function app.fa_live_payment(p_payable_id uuid) returns public.fin_payable_payments
language sql stable security definer set search_path = '' as $$
  select * from public.fin_payable_payments p where p.payable_id = p_payable_id and p.reversal_expense_id is null
$$;

create function app.fa_payable_json(p public.fin_payables) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'series_id', p.series_id, 'description', p.description, 'amount_cents', p.amount_cents,
    'due_on', to_char(p.due_on, 'YYYY-MM-DD'), 'base_category', p.base_category, 'category_id', p.category_id,
    'category_name', (select c.name from public.fin_categories c where c.id = p.category_id), 'supplier', p.supplier,
    'status', case when p.status = 'cancelled' then 'cancelled' when lp.id is not null then 'paid'
      when p.due_on < (clock_timestamp() at time zone app.fa_tz(p.tenant_id))::date then 'overdue' else 'open' end,
    'paid_at', app.fin_ts(lp.paid_at), 'expense_entry_id', lp.expense_entry_id,
    'reversals', (select count(*) from public.fin_payable_payments x where x.payable_id = p.id and x.reversal_expense_id is not null),
    'version', p.version)
  from (select 1) _ left join lateral (select * from public.fin_payable_payments x where x.payable_id = p.id and x.reversal_expense_id is null) lp on true
$$;

create function app.fa_series_json(s public.fin_payable_series) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'description', s.description, 'amount_cents', s.amount_cents, 'base_category', s.base_category,
    'category_id', s.category_id, 'supplier', s.supplier, 'day_of_month', s.day_of_month, 'starts_on', to_char(s.starts_on, 'YYYY-MM-DD'),
    'generated_until', to_char(s.generated_until, 'YYYY-MM-DD'), 'active', s.ended_at is null, 'version', s.version)
$$;

/** Gera as contas mensais da série até p_until (inclusive), uma por mês (índice único): repetir não duplica. */
create function app.fa_materialize(p_series public.fin_payable_series, p_until date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_series.starts_on)::date;
  v_due date;
  v_n integer := 0;
begin
  while v_month <= p_until loop
    v_due := v_month + (p_series.day_of_month - 1);
    if v_due >= p_series.starts_on then
      insert into public.fin_payables (tenant_id, series_id, description, amount_cents, due_on, base_category, category_id, supplier, created_by)
      values (p_series.tenant_id, p_series.id, p_series.description, p_series.amount_cents, v_due, p_series.base_category, p_series.category_id,
        p_series.supplier, auth.uid())
      on conflict (series_id, due_on) where series_id is not null do nothing;
      if found then v_n := v_n + 1; end if;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  update public.fin_payable_series s set generated_until = greatest(s.generated_until, p_until) where s.id = p_series.id;
  return v_n;
end $$;

/** Valida uma categoria própria do tipo pedido; devolve a categoria do Caixa (despesa) ou nulo. */
create function app.fa_check_category(p_tenant_id uuid, p_category_id uuid, p_kind text) returns public.fin_categories
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.fin_categories;
begin
  if p_category_id is null then return null; end if;
  select * into c from public.fin_categories x where x.tenant_id = p_tenant_id and x.id = p_category_id and x.kind = p_kind and x.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'category_id';
  end if;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Dono: categorias e classificação
-- ---------------------------------------------------------------------------

create function public.accounts_categories(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fa_owner(p_tenant_id);
  return jsonb_build_object('categories', coalesce((select jsonb_agg(app.fa_category_json(c) order by c.kind, c.active desc, c.name)
    from public.fin_categories c where c.tenant_id = p_tenant_id), '[]'::jsonb));
end $$;

create function public.accounts_category_save(
  p_tenant_id uuid,
  p_category_id uuid,
  p_expected_version integer,
  p_kind text,
  p_name text,
  p_base text,
  p_active boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.fin_categories;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.category_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  begin
    if p_category_id is null then
      insert into public.fin_categories (tenant_id, kind, name, base, active, created_by)
      values (p_tenant_id, p_kind, btrim(p_name), case when p_kind = 'expense' then coalesce(p_base, 'other') end, coalesce(p_active, true), v_uid)
      returning * into v_c;
    else
      select * into v_c from public.fin_categories c where c.tenant_id = p_tenant_id and c.id = p_category_id for update;
      if not found then
        raise exception using errcode = 'PT404', message = 'NOT_FOUND';
      end if;
      if p_expected_version is null or v_c.version <> p_expected_version then
        raise exception using errcode = 'PT409', message = 'STALE_VERSION';
      end if;
      if v_c.kind <> p_kind then
        raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
      end if;
      update public.fin_categories c set name = btrim(p_name), base = case when c.kind = 'expense' then coalesce(p_base, c.base) end,
        active = coalesce(p_active, c.active)
      where c.id = v_c.id returning * into v_c;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'name', detail = 'nome repetido';
    when check_violation or not_null_violation then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'category';
  end;
  perform app.audit(p_tenant_id, 'accounts.category_save', 'fin_category', v_c.id, p_request_id, null,
    jsonb_build_object('kind', v_c.kind, 'base', v_c.base, 'active', v_c.active));
  v_body := jsonb_build_object('category', app.fa_category_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.category_save', p_idem_key, case when p_category_id is null then 201 else 200 end, v_body);
  return jsonb_build_object('status_code', case when p_category_id is null then 201 else 200 end, 'body', v_body);
end $$;

/** Põe (ou tira, com p_category_id nulo) a categoria própria de um recebimento ou despesa do Caixa. */
create function public.accounts_classify(
  p_tenant_id uuid,
  p_entry_kind text,
  p_entry_id uuid,
  p_category_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.fin_categories;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.classify', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_entry_kind = 'payment' then
    perform 1 from public.payment_entries p where p.tenant_id = p_tenant_id and p.id = p_entry_id and p.reversal_of is null;
  elsif p_entry_kind = 'expense' then
    perform 1 from public.expense_entries e where e.tenant_id = p_tenant_id and e.id = p_entry_id and e.reversal_of is null;
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'entry_kind';
  end if;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'entry_id';
  end if;
  v_c := app.fa_check_category(p_tenant_id, p_category_id, case when p_entry_kind = 'payment' then 'income' else 'expense' end);
  if p_category_id is null then
    delete from public.fin_classifications x where x.tenant_id = p_tenant_id
      and (x.payment_entry_id = p_entry_id or x.expense_entry_id = p_entry_id);
  elsif p_entry_kind = 'payment' then
    insert into public.fin_classifications (tenant_id, entry_kind, payment_entry_id, category_id, created_by)
    values (p_tenant_id, 'payment', p_entry_id, v_c.id, v_uid)
    on conflict (payment_entry_id) do update set category_id = excluded.category_id;
  else
    insert into public.fin_classifications (tenant_id, entry_kind, expense_entry_id, category_id, created_by)
    values (p_tenant_id, 'expense', p_entry_id, v_c.id, v_uid)
    on conflict (expense_entry_id) do update set category_id = excluded.category_id;
  end if;
  perform app.audit(p_tenant_id, 'accounts.classify', 'fin_classification', p_entry_id, p_request_id, null,
    jsonb_build_object('entry_kind', p_entry_kind, 'category_id', p_category_id));
  v_body := jsonb_build_object('entry_kind', p_entry_kind, 'entry_id', p_entry_id, 'category_id', p_category_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.classify', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Lançamentos do Caixa (recebimentos e despesas vivos, sem estornos) do mês, com a categoria própria, para classificar. */
create function public.accounts_entries(p_tenant_id uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := app.fa_tz(p_tenant_id);
  v_first date;
  v_from timestamptz;
  v_to timestamptz;
begin
  perform app.fa_owner(p_tenant_id);
  if p_month is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'month';
  end if;
  v_first := date_trunc('month', p_month)::date;
  v_from := v_first::timestamp at time zone v_tz;
  v_to := (v_first + interval '1 month')::date::timestamp at time zone v_tz;
  return jsonb_build_object('entries', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
    select jsonb_build_object('entry_kind', 'payment', 'entry_id', p.id, 'at', app.fin_ts(p.received_at), 'amount_cents', p.amount_cents,
      'description', (select r.description from public.receivables r where r.id = p.receivable_id), 'method', p.method, 'source', p.source,
      'base', app.fa_income_origin(p.receivable_id), 'category_id', (select c.category_id from public.fin_classifications c where c.payment_entry_id = p.id)) as x
    from public.payment_entries p where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= v_from and p.received_at < v_to
      and not exists (select 1 from public.payment_entries y where y.reversal_of = p.id)
    union all
    select jsonb_build_object('entry_kind', 'expense', 'entry_id', e.id, 'at', app.fin_ts(e.paid_at), 'amount_cents', e.amount_cents,
      'description', coalesce(e.description, ''), 'method', null, 'source', null, 'base', e.category,
      'category_id', (select c.category_id from public.fin_classifications c where c.expense_entry_id = e.id))
    from public.expense_entries e where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= v_from and e.paid_at < v_to
      and not exists (select 1 from public.expense_entries y where y.reversal_of = e.id)
    order by 1 limit 300) q), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Dono: contas a pagar
-- ---------------------------------------------------------------------------

/** Contas com vencimento na janela (até 400 dias), as vencidas em aberto de antes e as séries. */
create function public.accounts_payables(p_tenant_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (clock_timestamp() at time zone app.fa_tz(p_tenant_id))::date;
begin
  perform app.fa_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window';
  end if;
  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'payables', coalesce((select jsonb_agg(app.fa_payable_json(p) order by p.due_on, p.created_at) from (select * from public.fin_payables p
      where p.tenant_id = p_tenant_id and ((p.due_on between p_from and p_to)
        or (p.due_on < p_from and p.status = 'open' and (app.fa_live_payment(p.id)).id is null))
      order by p.due_on limit 300) p), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(app.fa_series_json(s) order by s.ended_at nulls first, s.description)
      from public.fin_payable_series s where s.tenant_id = p_tenant_id), '[]'::jsonb));
end $$;

/**
 * Nova conta (única, ou recorrente mensal com p_monthly: gera os próximos 12 meses) ou edição de conta em aberto
 * (p_payable_id + versão). Conta paga não muda (estorne antes).
 */
create function public.accounts_payable_save(
  p_tenant_id uuid,
  p_payable_id uuid,
  p_expected_version integer,
  p_description text,
  p_amount_cents bigint,
  p_due_on date,
  p_base_category text,
  p_category_id uuid,
  p_supplier text,
  p_monthly boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.fin_categories;
  v_base text;
  v_p public.fin_payables;
  v_s public.fin_payable_series;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.payable_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_due_on is null or p_amount_cents is null or p_amount_cents < 1 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = case when p_due_on is null then 'due_on' else 'amount_cents' end;
  end if;
  v_c := app.fa_check_category(p_tenant_id, p_category_id, 'expense');
  v_base := coalesce(v_c.base, p_base_category, 'other');
  begin
    if p_payable_id is null and coalesce(p_monthly, false) then
      if extract(day from p_due_on) > 28 then
        raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'due_on', detail = 'recorrente vence até o dia 28';
      end if;
      insert into public.fin_payable_series (tenant_id, description, amount_cents, base_category, category_id, supplier, day_of_month, starts_on, generated_until, created_by)
      values (p_tenant_id, btrim(p_description), p_amount_cents, v_base, v_c.id, nullif(btrim(p_supplier), ''), extract(day from p_due_on)::integer,
        p_due_on, p_due_on, v_uid) returning * into v_s;
      perform app.fa_materialize(v_s, (date_trunc('month', p_due_on) + interval '11 months')::date);
      select * into v_s from public.fin_payable_series s where s.id = v_s.id;
      select * into v_p from public.fin_payables p where p.series_id = v_s.id order by p.due_on limit 1;
    elsif p_payable_id is null then
      insert into public.fin_payables (tenant_id, description, amount_cents, due_on, base_category, category_id, supplier, created_by)
      values (p_tenant_id, btrim(p_description), p_amount_cents, p_due_on, v_base, v_c.id, nullif(btrim(p_supplier), ''), v_uid)
      returning * into v_p;
    else
      select * into v_p from public.fin_payables p where p.tenant_id = p_tenant_id and p.id = p_payable_id for update;
      if not found then
        raise exception using errcode = 'PT404', message = 'NOT_FOUND';
      end if;
      if p_expected_version is null or v_p.version <> p_expected_version then
        raise exception using errcode = 'PT409', message = 'STALE_VERSION';
      end if;
      if v_p.status <> 'open' or (app.fa_live_payment(v_p.id)).id is not null then
        raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status', detail = 'conta paga ou cancelada não muda';
      end if;
      update public.fin_payables p set description = btrim(p_description), amount_cents = p_amount_cents, due_on = p_due_on, base_category = v_base,
        category_id = v_c.id, supplier = nullif(btrim(p_supplier), '')
      where p.id = v_p.id returning * into v_p;
    end if;
  exception
    when check_violation or not_null_violation then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'payable';
    when unique_violation then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'due_on', detail = 'a série já tem conta neste mês';
  end;
  perform app.audit(p_tenant_id, 'accounts.payable_save', 'fin_payable', v_p.id, p_request_id, null,
    jsonb_build_object('amount_cents', v_p.amount_cents, 'due_on', v_p.due_on, 'monthly', v_s.id is not null));
  v_body := jsonb_build_object('payable', app.fa_payable_json(v_p), 'series', case when v_s.id is null then null else app.fa_series_json(v_s) end,
    'created', case when v_s.id is null then 1 else (select count(*) from public.fin_payables p where p.series_id = v_s.id) end);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.payable_save', p_idem_key, case when p_payable_id is null then 201 else 200 end, v_body);
  return jsonb_build_object('status_code', case when p_payable_id is null then 201 else 200 end, 'body', v_body);
end $$;

/**
 * Paga a conta: UMA despesa no Caixa (P07) pelo valor da conta, na data informada, com a categoria. Pagar de novo é
 * recusado (POLICY_REJECTED/paid); a corrida é decidida pelo lock da conta e pelo índice "um pagamento vivo".
 */
create function public.accounts_payable_pay(
  p_tenant_id uuid,
  p_payable_id uuid,
  p_expected_version integer,
  p_paid_at timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.fin_payables;
  v_e public.expense_entries;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.payable_pay', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_p from public.fin_payables p where p.tenant_id = p_tenant_id and p.id = p_payable_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_p.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_p.status <> 'open' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if (app.fa_live_payment(v_p.id)).id is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'paid', detail = 'conta já paga';
  end if;
  if p_paid_at is null or p_paid_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'paid_at';
  end if;
  insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, description, recorded_by)
  values (p_tenant_id, v_p.amount_cents, p_paid_at, v_p.base_category, left(v_p.description, 120), v_uid) returning * into v_e;
  begin
    insert into public.fin_payable_payments (tenant_id, payable_id, expense_entry_id, amount_cents, paid_at, created_by)
    values (p_tenant_id, v_p.id, v_e.id, v_p.amount_cents, p_paid_at, v_uid);
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'paid', detail = 'conta já paga';
  end;
  if v_p.category_id is not null then
    insert into public.fin_classifications (tenant_id, entry_kind, expense_entry_id, category_id, created_by)
    values (p_tenant_id, 'expense', v_e.id, v_p.category_id, v_uid);
  end if;
  -- Toca a conta para subir a versão (quem viu "em aberto" não paga de novo com a versão antiga).
  update public.fin_payables p set description = p.description where p.id = v_p.id returning * into v_p;
  perform app.audit(p_tenant_id, 'accounts.payable_pay', 'fin_payable', v_p.id, p_request_id, null,
    jsonb_build_object('amount_cents', v_p.amount_cents, 'expense_entry_id', v_e.id));
  v_body := jsonb_build_object('payable', app.fa_payable_json(v_p));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.payable_pay', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Estorna o pagamento vivo: linha de estorno da despesa no Caixa (P07), uma vez. A conta volta a ficar em aberto. */
create function public.accounts_payable_reverse(
  p_tenant_id uuid,
  p_payable_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.fin_payables;
  v_pay public.fin_payable_payments;
  v_orig public.expense_entries;
  v_rev public.expense_entries;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.payable_reverse', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_p from public.fin_payables p where p.tenant_id = p_tenant_id and p.id = p_payable_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_p.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  v_pay := app.fa_live_payment(v_p.id);
  if v_pay.id is null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'not_paid';
  end if;
  select * into v_orig from public.expense_entries e where e.id = v_pay.expense_entry_id;
  begin
    insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, description, reversal_of, recorded_by)
    values (p_tenant_id, v_orig.amount_cents, clock_timestamp(), v_orig.category, v_orig.description, v_orig.id, v_uid) returning * into v_rev;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversed', detail = 'despesa já estornada no Caixa';
  end;
  update public.fin_payable_payments x set reversal_expense_id = v_rev.id where x.id = v_pay.id;
  update public.fin_payables p set description = p.description where p.id = v_p.id returning * into v_p;
  perform app.audit(p_tenant_id, 'accounts.payable_reverse', 'fin_payable', v_p.id, p_request_id, null,
    jsonb_build_object('amount_cents', v_orig.amount_cents, 'reversal_expense_id', v_rev.id));
  v_body := jsonb_build_object('payable', app.fa_payable_json(v_p));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.payable_reverse', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Cancela uma conta em aberto (não paga). */
create function public.accounts_payable_cancel(
  p_tenant_id uuid,
  p_payable_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_p public.fin_payables;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.payable_cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_p from public.fin_payables p where p.tenant_id = p_tenant_id and p.id = p_payable_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_p.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_p.status <> 'open' or (app.fa_live_payment(v_p.id)).id is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status', detail = 'estorne o pagamento antes';
  end if;
  update public.fin_payables p set status = 'cancelled' where p.id = v_p.id returning * into v_p;
  perform app.audit(p_tenant_id, 'accounts.payable_cancel', 'fin_payable', v_p.id, p_request_id, null, jsonb_build_object('status', 'cancelled'));
  v_body := jsonb_build_object('payable', app.fa_payable_json(v_p));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.payable_cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Série: estender mais 12 meses (p_action = 'extend') ou encerrar e cancelar as contas futuras em aberto ('end'). */
create function public.accounts_series_update(
  p_tenant_id uuid,
  p_series_id uuid,
  p_expected_version integer,
  p_action text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_s public.fin_payable_series;
  v_today date := (clock_timestamp() at time zone app.fa_tz(p_tenant_id))::date;
  v_n integer := 0;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.series_update', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_s from public.fin_payable_series s where s.tenant_id = p_tenant_id and s.id = p_series_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_s.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_s.ended_at is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if p_action = 'extend' then
    v_n := app.fa_materialize(v_s, (date_trunc('month', greatest(v_s.generated_until, v_today)) + interval '12 months')::date);
  elsif p_action = 'end' then
    update public.fin_payables p set status = 'cancelled'
    where p.series_id = v_s.id and p.status = 'open' and p.due_on >= v_today and (app.fa_live_payment(p.id)).id is null;
    get diagnostics v_n = row_count;
    update public.fin_payable_series s set ended_at = clock_timestamp() where s.id = v_s.id;
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'action';
  end if;
  select * into v_s from public.fin_payable_series s where s.id = v_s.id;
  perform app.audit(p_tenant_id, 'accounts.series_update', 'fin_payable_series', v_s.id, p_request_id, null,
    jsonb_build_object('action', p_action, 'affected', v_n));
  v_body := jsonb_build_object('series', app.fa_series_json(v_s), 'affected', v_n);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.series_update', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: conciliação por meio de pagamento e origem
-- ---------------------------------------------------------------------------

/** Registrado no dia (local) por meio e origem, líquido de estornos. */
create function app.fa_ledger_day(p_tenant_id uuid, p_day date, p_method text, p_source text) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(p.amount_cents), 0)::bigint from public.payment_entries p
  where p.tenant_id = p_tenant_id and p.reversal_of is null and p.method = p_method and p.source = p_source
    and (p.received_at at time zone app.fa_tz(p_tenant_id))::date = p_day
    and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id)
$$;

create function public.accounts_reconciliation(p_tenant_id uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := app.fa_tz(p_tenant_id);
begin
  perform app.fa_owner(p_tenant_id);
  if p_day is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'day';
  end if;
  return jsonb_build_object('day', to_char(p_day, 'YYYY-MM-DD'), 'timezone', v_tz, 'rows', coalesce((
    with keys as (
      select distinct p.method, p.source from public.payment_entries p
      where p.tenant_id = p_tenant_id and p.reversal_of is null and (p.received_at at time zone v_tz)::date = p_day
      union select r.method, r.source from public.fin_reconciliations r where r.tenant_id = p_tenant_id and r.day = p_day
    )
    select jsonb_agg(jsonb_build_object('method', k.method, 'source', k.source,
      'ledger_cents', app.fa_ledger_day(p_tenant_id, p_day, k.method, k.source),
      'entries', (select count(*) from public.payment_entries p where p.tenant_id = p_tenant_id and p.reversal_of is null and p.method = k.method
        and p.source = k.source and (p.received_at at time zone v_tz)::date = p_day
        and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id)),
      -- Parceiro (PSP): o que o provedor diz que pagou no dia (cobranças pagas do P14) e a última conciliação do P14.
      'partner_paid_cents', case when k.source = 'provider' then (select coalesce(sum(coalesce(c.paid_cents, c.amount_cents)), 0) from public.payment_charges c
        where c.tenant_id = p_tenant_id and c.status = 'paid' and coalesce(c.refund_status, '') <> 'done' and (c.paid_at at time zone v_tz)::date = p_day) end,
      'partner_differences', case when k.source = 'provider' then (select jsonb_array_length(r.differences) from public.payment_reconciliations r
        where r.tenant_id = p_tenant_id and r.day = p_day order by r.created_at desc limit 1) end,
      'statement', (select jsonb_build_object('statement_cents', r.statement_cents, 'ledger_cents', r.ledger_cents, 'difference_cents', r.difference_cents,
          'checked_at', app.fin_ts(r.created_at))
        from public.fin_reconciliations r where r.tenant_id = p_tenant_id and r.day = p_day and r.method = k.method and r.source = k.source
        order by r.created_at desc limit 1))
      order by k.source, k.method)
    from keys k), '[]'::jsonb));
end $$;

/** Registra a conferência do extrato de um meio/origem num dia: guarda o registrado e a diferença daquele momento. */
create function public.accounts_reconcile_save(
  p_tenant_id uuid,
  p_day date,
  p_method text,
  p_source text,
  p_statement_cents bigint,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_ledger bigint;
  v_r public.fin_reconciliations;
  v_body jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'accounts.reconcile_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_day is null or p_day > (clock_timestamp() at time zone app.fa_tz(p_tenant_id))::date then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'day';
  end if;
  v_ledger := app.fa_ledger_day(p_tenant_id, p_day, p_method, p_source);
  begin
    -- clock_timestamp: duas conferências na mesma transação ficam em ordem (a última vale).
    insert into public.fin_reconciliations (tenant_id, day, method, source, statement_cents, ledger_cents, difference_cents, created_by, created_at)
    values (p_tenant_id, p_day, p_method, p_source, p_statement_cents, v_ledger, p_statement_cents - v_ledger, v_uid, clock_timestamp()) returning * into v_r;
  exception when check_violation or not_null_violation then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'statement';
  end;
  perform app.audit(p_tenant_id, 'accounts.reconcile_save', 'fin_reconciliation', v_r.id, p_request_id, null,
    jsonb_build_object('day', p_day, 'method', p_method, 'source', p_source, 'difference_cents', v_r.difference_cents));
  v_body := jsonb_build_object('reconciliation', jsonb_build_object('day', to_char(v_r.day, 'YYYY-MM-DD'), 'method', v_r.method, 'source', v_r.source,
    'statement_cents', v_r.statement_cents, 'ledger_cents', v_r.ledger_cents, 'difference_cents', v_r.difference_cents, 'checked_at', app.fin_ts(v_r.created_at)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'accounts.reconcile_save', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: demonstrativo gerencial mensal (regime de caixa)
-- ---------------------------------------------------------------------------

/** Origem de um recebimento: atendimento (P03 ou equipe P28), pacote/assinatura (P07/P20) ou avulso. */
create function app.fa_income_origin(p_receivable_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when r.booking_id is not null then 'services'
    when r.package_id is not null then 'packages'
    when exists (select 1 from public.team_bookings b where b.receivable_id = r.id)
      or exists (select 1 from public.team_class_seats s where s.receivable_id = r.id) then 'services'
    else 'other' end
  from public.receivables r where r.id = p_receivable_id
$$;

/**
 * Mês local (p_month = primeiro dia) no fuso do negócio: entrou, saiu, sobrou, por categoria; cobertura do que falta
 * lançar. Regime de caixa: conta o que foi registrado como recebido/pago no mês; estornos anulam o original (como o
 * resumo do Caixa). Não é DRE.
 */
create function public.accounts_statement(p_tenant_id uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := app.fa_tz(p_tenant_id);
  v_first date;
  v_from timestamptz;
  v_to timestamptz;
  v_in bigint;
  v_out bigint;
  v_income jsonb;
  v_expenses jsonb;
begin
  perform app.fa_owner(p_tenant_id);
  if p_month is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'month';
  end if;
  v_first := date_trunc('month', p_month)::date;
  v_from := v_first::timestamp at time zone v_tz;
  v_to := (v_first + interval '1 month')::date::timestamp at time zone v_tz;
  with inc as (
    select coalesce(c.id::text, 'origin:' || app.fa_income_origin(p.receivable_id)) as key,
      coalesce(c.name, case app.fa_income_origin(p.receivable_id) when 'services' then 'Atendimentos' when 'packages' then 'Pacotes e assinaturas' else 'Outras receitas' end) as label,
      sum(p.amount_cents)::bigint as cents, count(*)::integer as n
    from public.payment_entries p
    left join public.fin_classifications x on x.payment_entry_id = p.id
    left join public.fin_categories c on c.id = x.category_id
    where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= v_from and p.received_at < v_to
      and not exists (select 1 from public.payment_entries y where y.reversal_of = p.id)
    group by 1, 2)
  select coalesce(sum(cents), 0), coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'cents', cents, 'entries', n) order by cents desc, label), '[]'::jsonb)
  into v_in, v_income from inc;
  with exp as (
    select coalesce(c.id::text, 'base:' || e.category) as key,
      coalesce(c.name, case e.category when 'supplies' then 'Materiais' when 'rent' then 'Aluguel' when 'utilities' then 'Contas da casa (água, luz, internet)'
        when 'fees' then 'Taxas' when 'transport' then 'Transporte' when 'marketing' then 'Divulgação' else 'Outras despesas' end) as label,
      sum(e.amount_cents)::bigint as cents, count(*)::integer as n
    from public.expense_entries e
    left join public.fin_classifications x on x.expense_entry_id = e.id
    left join public.fin_categories c on c.id = x.category_id
    where e.tenant_id = p_tenant_id and e.reversal_of is null and e.paid_at >= v_from and e.paid_at < v_to
      and not exists (select 1 from public.expense_entries y where y.reversal_of = e.id)
    group by 1, 2)
  select coalesce(sum(cents), 0), coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'cents', cents, 'entries', n) order by cents desc, label), '[]'::jsonb)
  into v_out, v_expenses from exp;
  return jsonb_build_object(
    'basis', 'cash',
    'period', jsonb_build_object('month', to_char(v_first, 'YYYY-MM'), 'starts_at', app.fin_ts(v_from), 'ends_at', app.fin_ts(v_to),
      'first_day', to_char(v_first, 'YYYY-MM-DD'), 'last_day', to_char((v_first + interval '1 month')::date - 1, 'YYYY-MM-DD'), 'timezone', v_tz),
    'in_cents', v_in, 'out_cents', v_out, 'net_cents', v_in - v_out,
    'income', v_income,
    'expenses', v_expenses,
    'coverage', jsonb_build_object(
      -- Atendimentos concluídos no mês sem cobrança ativa nem crédito: dinheiro que pode faltar lançar.
      'uncharged_bookings', (select count(*) from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed'
        and b.starts_at >= v_from and b.starts_at < v_to
        and not exists (select 1 from public.receivables r where r.tenant_id = b.tenant_id and r.booking_id = b.id and r.status <> 'cancelled')
        and not exists (select 1 from public.session_entries s where s.tenant_id = b.tenant_id and s.booking_id = b.id and s.reason = 'consume'
          and not exists (select 1 from public.session_entries z where z.reversal_of = s.id))),
      'uncharged_cents', (select coalesce(sum(coalesce(b.agreed_price_cents, 0)), 0) from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed'
        and b.starts_at >= v_from and b.starts_at < v_to
        and not exists (select 1 from public.receivables r where r.tenant_id = b.tenant_id and r.booking_id = b.id and r.status <> 'cancelled')
        and not exists (select 1 from public.session_entries s where s.tenant_id = b.tenant_id and s.booking_id = b.id and s.reason = 'consume'
          and not exists (select 1 from public.session_entries z where z.reversal_of = s.id))),
      -- Recebíveis em aberto que venceram até o fim do mês (a receber, não entrou).
      'receivables_open_cents', (select coalesce(sum(r.amount_cents - r.paid_cents), 0) from public.receivables r where r.tenant_id = p_tenant_id
        and r.status in ('open', 'partially_paid') and coalesce(r.due_at, r.created_at) < v_to),
      -- Contas a pagar do mês ainda não pagas (vão sair).
      'payables_unpaid', (select count(*) from public.fin_payables p where p.tenant_id = p_tenant_id and p.status = 'open'
        and p.due_on between v_first and (v_first + interval '1 month')::date - 1 and (app.fa_live_payment(p.id)).id is null),
      'payables_unpaid_cents', (select coalesce(sum(p.amount_cents), 0) from public.fin_payables p where p.tenant_id = p_tenant_id and p.status = 'open'
        and p.due_on between v_first and (v_first + interval '1 month')::date - 1 and (app.fa_live_payment(p.id)).id is null),
      -- Lançamentos sem categoria própria (ficam na categoria do Caixa/origem).
      'unclassified_entries', (select count(*) from public.payment_entries p where p.tenant_id = p_tenant_id and p.reversal_of is null
          and p.received_at >= v_from and p.received_at < v_to and not exists (select 1 from public.fin_classifications x where x.payment_entry_id = p.id))
        + (select count(*) from public.expense_entries e where e.tenant_id = p_tenant_id and e.reversal_of is null
          and e.paid_at >= v_from and e.paid_at < v_to and not exists (select 1 from public.fin_classifications x where x.expense_entry_id = e.id)),
      -- Dias com recebimento registrado e sem conferência de extrato.
      'days_unreconciled', (select count(distinct (p.received_at at time zone v_tz)::date) from public.payment_entries p
        where p.tenant_id = p_tenant_id and p.reversal_of is null and p.received_at >= v_from and p.received_at < v_to
          and not exists (select 1 from public.fin_reconciliations r where r.tenant_id = p_tenant_id and r.day = (p.received_at at time zone v_tz)::date
            and r.method = p.method and r.source = p.source)),
      -- Notas fiscais autorizadas com competência no mês (P16): informação, não entra no caixa.
      'fiscal_authorized', (select count(*) from public.fiscal_documents f where f.tenant_id = p_tenant_id and f.status = 'authorized'
        and f.competence_date between v_first and (v_first + interval '1 month')::date - 1),
      'fiscal_authorized_cents', (select coalesce(sum(f.amount_cents), 0) from public.fiscal_documents f where f.tenant_id = p_tenant_id and f.status = 'authorized'
        and f.competence_date between v_first and (v_first + interval '1 month')::date - 1)),
    'as_of', app.fin_ts(clock_timestamp()),
    'note', 'Demonstrativo gerencial de caixa: o que foi registrado como recebido e pago no mês, no fuso do negócio. Estornos anulam o lançamento original. Não é DRE nem saldo bancário.');
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.fa_owner(uuid), app.fa_tz(uuid), app.fa_category_json(public.fin_categories), app.fa_live_payment(uuid),
  app.fa_payable_json(public.fin_payables), app.fa_series_json(public.fin_payable_series), app.fa_materialize(public.fin_payable_series, date),
  app.fa_check_category(uuid, uuid, text), app.fa_ledger_day(uuid, date, text, text), app.fa_income_origin(uuid), app.fa_payment_guard()
  from public, anon, authenticated;

revoke all on function public.accounts_categories(uuid) from public, anon;
revoke all on function public.accounts_category_save(uuid, uuid, integer, text, text, text, boolean, text, text, uuid) from public, anon;
revoke all on function public.accounts_classify(uuid, text, uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.accounts_payables(uuid, date, date) from public, anon;
revoke all on function public.accounts_payable_save(uuid, uuid, integer, text, bigint, date, text, uuid, text, boolean, text, text, uuid) from public, anon;
revoke all on function public.accounts_payable_pay(uuid, uuid, integer, timestamptz, text, text, uuid) from public, anon;
revoke all on function public.accounts_payable_reverse(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.accounts_payable_cancel(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.accounts_series_update(uuid, uuid, integer, text, text, text, uuid) from public, anon;
revoke all on function public.accounts_reconciliation(uuid, date) from public, anon;
revoke all on function public.accounts_reconcile_save(uuid, date, text, text, bigint, text, text, uuid) from public, anon;
revoke all on function public.accounts_statement(uuid, date) from public, anon;
revoke all on function public.accounts_entries(uuid, date) from public, anon;
grant execute on function public.accounts_categories(uuid) to authenticated;
grant execute on function public.accounts_category_save(uuid, uuid, integer, text, text, text, boolean, text, text, uuid) to authenticated;
grant execute on function public.accounts_classify(uuid, text, uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.accounts_payables(uuid, date, date) to authenticated;
grant execute on function public.accounts_payable_save(uuid, uuid, integer, text, bigint, date, text, uuid, text, boolean, text, text, uuid) to authenticated;
grant execute on function public.accounts_payable_pay(uuid, uuid, integer, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.accounts_payable_reverse(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.accounts_payable_cancel(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.accounts_series_update(uuid, uuid, integer, text, text, text, uuid) to authenticated;
grant execute on function public.accounts_reconciliation(uuid, date) to authenticated;
grant execute on function public.accounts_reconcile_save(uuid, date, text, text, bigint, text, text, uuid) to authenticated;
grant execute on function public.accounts_statement(uuid, date) to authenticated;
grant execute on function public.accounts_entries(uuid, date) to authenticated;

alter table public.fin_categories enable row level security;
alter table public.fin_classifications enable row level security;
alter table public.fin_payable_series enable row level security;
alter table public.fin_payables enable row level security;
alter table public.fin_payable_payments enable row level security;
alter table public.fin_reconciliations enable row level security;
revoke all on public.fin_categories, public.fin_classifications, public.fin_payable_series, public.fin_payables, public.fin_payable_payments,
  public.fin_reconciliations from anon, authenticated;
grant select on public.fin_categories, public.fin_classifications, public.fin_payable_series, public.fin_payables, public.fin_payable_payments,
  public.fin_reconciliations to authenticated;
grant select, insert, update, delete on public.fin_categories, public.fin_classifications, public.fin_payable_series, public.fin_payables,
  public.fin_payable_payments to service_role;
grant select, insert on public.fin_reconciliations to service_role;
create policy fin_categories_select_owner on public.fin_categories for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy fin_classifications_select_owner on public.fin_classifications for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy fin_payable_series_select_owner on public.fin_payable_series for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy fin_payables_select_owner on public.fin_payables for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy fin_payable_payments_select_owner on public.fin_payable_payments for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy fin_reconciliations_select_owner on public.fin_reconciliations for select to authenticated using (app.is_member(tenant_id, array['owner']));
