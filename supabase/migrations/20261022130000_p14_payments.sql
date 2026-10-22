-- P14 · Pagamento conectado: cobrança Pix por recebível através de um provedor de pagamento (PSP) atrás de porta,
-- link público de pagamento, webhook assinado e deduplicado (notificação repetida NÃO dá baixa duas vezes),
-- resultado incerto que exige consulta (nunca presumir pago), estorno vinculado ao recebimento e conciliação
-- diária com as diferenças listadas. A Tinindo não custodia dinheiro: o PSP recebe e repassa ao negócio.
-- Invariantes (docs/02, docs/05, docs/09, docs/15):
-- * Provedor atrás de porta: 'simulated' (PSP fictício, dados em tabela de backend) ou 'psp' (real, só com
--   credenciais no servidor). Credenciais nunca no banco nem no app.
-- * A baixa no caixa (payment_entries, source = 'provider') só nasce de evidência do provedor: webhook assinado ou
--   consulta de status feita pelo backend. O dono não grava recebimento de provedor.
-- * Uma cobrança viva por recebível; valor = saldo em aberto no momento. Cobrança paga vira UM recebimento; o
--   mesmo evento ou um segundo evento 'pago' da mesma cobrança não cria outro.
-- * 'unknown' é estado próprio (timeout, 5xx): a cobrança não é presumida paga nem falha; o sync consulta.
-- * Estorno é total, vinculado ao recebimento (linha de reversão do P07), pedido pelo dono e confirmado pelo PSP.
-- * Conciliação: relatório do PSP do dia × cobranças/recebimentos do banco; diferenças ficam gravadas e listadas.
-- * payment_entries continua append-only; a fonte passa a aceitar 'provider' (aditivo).
-- Depende de: fundação, P01 (app.token_sha256), P07 (receivables, payment_entries), P06 (outbox).

-- ---------------------------------------------------------------------------
-- P07: recebimento com origem no provedor (aditivo)
-- ---------------------------------------------------------------------------

alter table public.payment_entries drop constraint payment_entries_source_check;
alter table public.payment_entries add constraint payment_entries_source_check check (source in ('manual', 'provider'));
alter table public.payment_entries add column charge_id uuid;
comment on column public.payment_entries.charge_id is 'P14: cobrança do provedor que gerou este recebimento (source = provider).';

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.payment_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  receivable_id uuid not null,
  customer_id uuid,
  provider text not null check (provider in ('simulated', 'psp')),
  -- Id da cobrança no provedor; nulo enquanto o provedor não responde.
  external_id text check (char_length(external_id) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  description text not null check (char_length(description) between 1 and 120),
  -- creating → pending → paid | expired | cancelled | failed ; unknown = sem resposta do provedor (consultar).
  status text not null default 'creating' check (status in ('creating', 'pending', 'paid', 'expired', 'cancelled', 'failed', 'unknown')),
  pix_code text check (char_length(pix_code) <= 512),
  checkout_url text check (char_length(checkout_url) <= 512),
  link_token_hash text not null,
  expires_at timestamptz,
  paid_at timestamptz,
  paid_cents bigint check (paid_cents >= 0),
  -- Recebimento gerado pela baixa; nulo se a cobrança foi paga sem baixa possível (recebível cancelado): diferença.
  payment_entry_id uuid,
  settlement text check (settlement in ('entry', 'receivable_cancelled', 'already_settled')),
  failure_reason text check (char_length(failure_reason) <= 200),
  unknown_since timestamptz,
  refund_status text check (refund_status in ('requested', 'done', 'failed', 'unknown')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint payment_charges_receivable foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id) on delete restrict,
  constraint payment_charges_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint payment_charges_entry foreign key (tenant_id, payment_entry_id) references public.payment_entries (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.payment_charges is 'Cobrança no PSP por recebível. Paga só com evidência do provedor; unknown exige consulta.';
create unique index payment_charges_external on public.payment_charges (provider, external_id) where external_id is not null;
create unique index payment_charges_one_live on public.payment_charges (tenant_id, receivable_id) where status in ('creating', 'pending', 'unknown');
create unique index payment_charges_token on public.payment_charges (link_token_hash);
create index payment_charges_sync on public.payment_charges (status, unknown_since, expires_at) where status in ('pending', 'unknown');
create trigger payment_charges_touch before update on public.payment_charges for each row execute function app.touch_row();

alter table public.payment_entries add constraint payment_entries_charge foreign key (tenant_id, charge_id)
  references public.payment_charges (tenant_id, id) on delete restrict;
create unique index payment_entries_one_per_charge on public.payment_entries (charge_id) where charge_id is not null and reversal_of is null;

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  charge_id uuid not null,
  amount_cents bigint not null check (amount_cents >= 1),
  reason text not null check (char_length(btrim(reason)) between 1 and 280),
  status text not null default 'requested' check (status in ('requested', 'done', 'failed', 'unknown')),
  external_id text check (char_length(external_id) <= 120),
  reversal_entry_id uuid,
  failure_reason text check (char_length(failure_reason) <= 200),
  unknown_since timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint payment_refunds_charge foreign key (tenant_id, charge_id) references public.payment_charges (tenant_id, id) on delete restrict,
  constraint payment_refunds_entry foreign key (tenant_id, reversal_entry_id) references public.payment_entries (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.payment_refunds is 'Estorno total pedido pelo dono; concluído só com confirmação do PSP (vira linha de reversão no P07).';
create unique index payment_refunds_one_live on public.payment_refunds (charge_id) where status in ('requested', 'unknown', 'done');
create trigger payment_refunds_touch before update on public.payment_refunds for each row execute function app.touch_row();

create table public.payment_webhook_events (
  provider text not null check (provider in ('simulated', 'psp')),
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  kind text not null,
  outcome text not null,
  received_at timestamptz not null default now(),
  primary key (provider, external_event_id)
);
comment on table public.payment_webhook_events is 'Dedupe de notificações do PSP: (provider, external_event_id) só entra uma vez.';

create table public.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  provider text not null check (provider in ('simulated', 'psp')),
  day date not null,
  report_count integer not null,
  report_paid_cents bigint not null,
  ledger_paid_cents bigint not null,
  differences jsonb not null default '[]',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.payment_reconciliations is 'Conciliação do dia: relatório do PSP × recebimentos do banco. Append-only; a última vale.';
create index payment_reconciliations_day on public.payment_reconciliations (tenant_id, day desc, created_at desc);
create trigger payment_reconciliations_append_only before update or delete on public.payment_reconciliations
  for each row execute function app.forbid_mutation();

-- PSP fictício ("o outro lado"): só o backend lê e escreve. Nunca aparece como provedor real.
create table public.payment_sim_ledger (
  external_id text primary key,
  tenant_id uuid not null,
  amount_cents bigint not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled', 'refunded')),
  expires_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.payment_sim_ledger is 'Livro do PSP simulado (backend). Evidência fictícia, rotulada na tela.';

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.pay_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.pay_charge_json(c public.payment_charges) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'receivable_id', c.receivable_id, 'customer_id', c.customer_id, 'provider', c.provider,
    'simulated', c.provider = 'simulated', 'external_id', c.external_id, 'amount_cents', c.amount_cents, 'description', c.description,
    'status', c.status, 'pix_code', c.pix_code, 'checkout_url', c.checkout_url, 'expires_at', app.fin_ts(c.expires_at),
    'paid_at', app.fin_ts(c.paid_at), 'paid_cents', c.paid_cents, 'payment_entry_id', c.payment_entry_id, 'settlement', c.settlement,
    'failure_reason', c.failure_reason, 'refund_status', c.refund_status, 'created_at', app.fin_ts(c.created_at), 'version', c.version)
$$;

create function app.pay_refund_json(r public.payment_refunds) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'charge_id', r.charge_id, 'amount_cents', r.amount_cents, 'reason', r.reason, 'status', r.status,
    'external_id', r.external_id, 'reversal_entry_id', r.reversal_entry_id, 'failure_reason', r.failure_reason,
    'created_at', app.fin_ts(r.created_at), 'version', r.version,
    'charge_external_id', (select c.external_id from public.payment_charges c where c.id = r.charge_id),
    'charge_provider', (select c.provider from public.payment_charges c where c.id = r.charge_id))
$$;

/**
 * Baixa de uma cobrança paga, com a evidência do provedor. Idempotente por cobrança: a segunda chamada (evento
 * repetido, consulta depois do webhook) devolve 'already_settled' e NÃO cria outro recebimento. Recebível
 * cancelado: a cobrança fica paga sem recebimento (settlement = receivable_cancelled) e a conciliação lista.
 * O valor registrado é o pago, limitado ao saldo em aberto; a diferença fica em paid_cents para a conciliação.
 */
create function app.pay_settle(p_charge_id uuid, p_paid_cents bigint, p_paid_at timestamptz, p_correlation uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.payment_charges;
  v_r public.receivables;
  v_p public.payment_entries;
  v_amount bigint;
begin
  select * into v_c from public.payment_charges c where c.id = p_charge_id for update;
  if not found then return 'unmatched'; end if;
  if v_c.status = 'paid' then return 'already_settled'; end if;
  select * into v_r from public.receivables r where r.tenant_id = v_c.tenant_id and r.id = v_c.receivable_id for update;
  if v_r.status not in ('open', 'partially_paid') then
    update public.payment_charges c set status = 'paid', paid_at = coalesce(p_paid_at, clock_timestamp()), paid_cents = p_paid_cents,
      settlement = 'receivable_cancelled', unknown_since = null where c.id = v_c.id;
    perform app.audit(v_c.tenant_id, 'payment.paid_without_entry', 'payment_charge', v_c.id, p_correlation, null,
      jsonb_build_object('provider', v_c.provider, 'amount_cents', p_paid_cents));
    return 'receivable_cancelled';
  end if;
  v_amount := least(coalesce(p_paid_cents, v_c.amount_cents), v_r.amount_cents - v_r.paid_cents);
  insert into public.payment_entries (tenant_id, receivable_id, customer_id, amount_cents, method, source, received_at, charge_id, recorded_by)
  values (v_c.tenant_id, v_r.id, v_r.customer_id, v_amount, 'pix', 'provider', coalesce(p_paid_at, clock_timestamp()), v_c.id, null)
  returning * into v_p;
  update public.receivables r set paid_cents = r.paid_cents + v_amount, status = app.fin_status(r.amount_cents, r.paid_cents + v_amount)
  where r.tenant_id = v_c.tenant_id and r.id = v_r.id;
  update public.payment_charges c set status = 'paid', paid_at = v_p.received_at, paid_cents = p_paid_cents, payment_entry_id = v_p.id,
    settlement = 'entry', unknown_since = null where c.id = v_c.id;
  perform app.emit_event(v_c.tenant_id, 'payment.recorded.v1', v_p.id, 1, coalesce(p_correlation, gen_random_uuid()),
    jsonb_build_object('payment_id', v_p.id, 'receivable_id', v_r.id, 'amount_cents', v_p.amount_cents, 'method', v_p.method,
      'source', v_p.source, 'received_at', app.fin_ts(v_p.received_at), 'charge_id', v_c.id));
  perform app.audit(v_c.tenant_id, 'payment.settled', 'payment_charge', v_c.id, p_correlation, null,
    jsonb_build_object('provider', v_c.provider, 'amount_cents', v_amount, 'payment_id', v_p.id));
  return 'entry';
end $$;

/** Estorno confirmado pelo PSP: linha de reversão do P07 vinculada ao recebimento da cobrança. Idempotente. */
create function app.pay_refund_done(p_refund_id uuid, p_external_id text, p_correlation uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.payment_refunds;
  v_c public.payment_charges;
  v_orig public.payment_entries;
  v_rev public.payment_entries;
begin
  select * into v_f from public.payment_refunds f where f.id = p_refund_id for update;
  if not found then return 'unmatched'; end if;
  if v_f.status = 'done' then return 'already_done'; end if;
  select * into v_c from public.payment_charges c where c.id = v_f.charge_id for update;
  if v_c.payment_entry_id is null then
    update public.payment_refunds f set status = 'done', external_id = coalesce(p_external_id, f.external_id), unknown_since = null where f.id = v_f.id;
    update public.payment_charges c set refund_status = 'done' where c.id = v_c.id;
    return 'done_without_entry';
  end if;
  select * into v_orig from public.payment_entries p where p.id = v_c.payment_entry_id;
  perform 1 from public.receivables r where r.tenant_id = v_c.tenant_id and r.id = v_c.receivable_id for update;
  begin
    insert into public.payment_entries (tenant_id, receivable_id, customer_id, amount_cents, method, source, received_at, reversal_of, note, charge_id, recorded_by)
    values (v_c.tenant_id, v_orig.receivable_id, v_orig.customer_id, v_orig.amount_cents, v_orig.method, 'provider', clock_timestamp(), v_orig.id,
      left(v_f.reason, 280), v_c.id, v_f.created_by)
    returning * into v_rev;
  exception when unique_violation then
    -- Já estornado por outro caminho (P07 manual): registrar como concluído sem segunda reversão.
    update public.payment_refunds f set status = 'done', external_id = coalesce(p_external_id, f.external_id), unknown_since = null where f.id = v_f.id;
    update public.payment_charges c set refund_status = 'done' where c.id = v_c.id;
    return 'already_reversed';
  end;
  update public.receivables r set paid_cents = r.paid_cents - v_orig.amount_cents, status = app.fin_status(r.amount_cents, r.paid_cents - v_orig.amount_cents)
  where r.tenant_id = v_c.tenant_id and r.id = v_orig.receivable_id;
  update public.payment_refunds f set status = 'done', external_id = coalesce(p_external_id, f.external_id), reversal_entry_id = v_rev.id, unknown_since = null
  where f.id = v_f.id;
  update public.payment_charges c set refund_status = 'done' where c.id = v_c.id;
  perform app.audit(v_c.tenant_id, 'payment.refund_done', 'payment_refund', v_f.id, p_correlation, null,
    jsonb_build_object('charge_id', v_c.id, 'amount_cents', v_orig.amount_cents, 'reversal_entry_id', v_rev.id));
  return 'done';
end $$;

-- ---------------------------------------------------------------------------
-- Dono: cobranças
-- ---------------------------------------------------------------------------

/**
 * Cria a cobrança pelo saldo em aberto do recebível, em 'creating'. Devolve o token do link UMA vez (só o hash
 * fica). A função chama o provedor em seguida e grava o resultado com payment_charge_result (backend).
 */
create function public.payment_charge_create(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_provider text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_r public.receivables;
  v_c public.payment_charges;
  v_token text;
  v_body jsonb;
begin
  perform app.pay_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'payment.charge_create', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_provider is null or p_provider not in ('simulated', 'psp') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'provider';
  end if;
  select * into v_r from public.receivables r where r.tenant_id = p_tenant_id and r.id = p_receivable_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'receivable_id';
  end if;
  if v_r.status not in ('open', 'partially_paid') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  begin
    insert into public.payment_charges (tenant_id, receivable_id, customer_id, provider, amount_cents, description, link_token_hash, created_by)
    values (p_tenant_id, v_r.id, v_r.customer_id, p_provider, v_r.amount_cents - v_r.paid_cents, v_r.description, app.token_sha256(v_token), v_uid)
    returning * into v_c;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'charge', detail = 'já existe cobrança viva para este recebível';
  end;
  perform app.audit(p_tenant_id, 'payment.charge_create', 'payment_charge', v_c.id, p_request_id, null,
    jsonb_build_object('provider', p_provider, 'amount_cents', v_c.amount_cents));
  v_body := jsonb_build_object('charge', app.pay_charge_json(v_c), 'link_token', v_token);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'payment.charge_create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.payment_charge_cancel(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.payment_charges;
  v_body jsonb;
begin
  perform app.pay_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'payment.charge_cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_c from public.payment_charges c where c.tenant_id = p_tenant_id and c.id = p_charge_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_c.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_c.status not in ('pending', 'unknown', 'creating') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.payment_charges c set status = 'cancelled', unknown_since = null where c.id = v_c.id returning * into v_c;
  perform app.audit(p_tenant_id, 'payment.charge_cancel', 'payment_charge', v_c.id, p_request_id, null, jsonb_build_object('provider', v_c.provider));
  v_body := jsonb_build_object('charge', app.pay_charge_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'payment.charge_cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.payment_charges_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.pay_owner(p_tenant_id);
  return jsonb_build_object(
    'charges', coalesce((select jsonb_agg(app.pay_charge_json(c) order by c.created_at desc)
      from (select * from public.payment_charges c where c.tenant_id = p_tenant_id order by c.created_at desc limit 200) c), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(app.pay_refund_json(f) order by f.created_at desc)
      from (select * from public.payment_refunds f where f.tenant_id = p_tenant_id order by f.created_at desc limit 200) f), '[]'::jsonb),
    'unknown', (select count(*) from public.payment_charges c where c.tenant_id = p_tenant_id and c.status = 'unknown'));
end $$;

/** Pedido de estorno total de uma cobrança paga. Fica 'requested' até o PSP confirmar (payment_refund_result). */
create function public.payment_refund_request(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.payment_charges;
  v_f public.payment_refunds;
  v_body jsonb;
begin
  perform app.pay_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'payment.refund', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;
  select * into v_c from public.payment_charges c where c.tenant_id = p_tenant_id and c.id = p_charge_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_c.status <> 'paid' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if v_c.payment_entry_id is not null and exists (select 1 from public.payment_entries x where x.reversal_of = v_c.payment_entry_id) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversed', detail = 'recebimento já estornado';
  end if;
  begin
    insert into public.payment_refunds (tenant_id, charge_id, amount_cents, reason, created_by)
    values (p_tenant_id, v_c.id, coalesce(v_c.paid_cents, v_c.amount_cents), btrim(p_reason), v_uid)
    returning * into v_f;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'refund', detail = 'já existe estorno pedido ou concluído';
  end;
  update public.payment_charges c set refund_status = 'requested' where c.id = v_c.id;
  perform app.audit(p_tenant_id, 'payment.refund_request', 'payment_refund', v_f.id, p_request_id, null,
    jsonb_build_object('charge_id', v_c.id, 'amount_cents', v_f.amount_cents));
  v_body := jsonb_build_object('refund', app.pay_refund_json(v_f));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'payment.refund', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/**
 * Conciliação do dia: relatório do PSP (itens pagos/estornados no dia, trazidos pela função) × cobranças e
 * recebimentos do banco. Diferenças listadas, nunca corrigidas em silêncio:
 *  paid_without_entry   · PSP diz pago e não há recebimento (webhook perdido → rodar o sync; ou recebível cancelado)
 *  entry_without_report · há recebimento do provedor no dia e o PSP não lista a cobrança
 *  amount_mismatch      · valores diferentes entre o PSP e o recebimento
 *  unknown_charge       · o PSP lista uma cobrança que o banco não conhece
 */
create function public.payment_reconcile(
  p_tenant_id uuid,
  p_provider text,
  p_day date,
  p_report jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_diffs jsonb := '[]';
  v_report_cents bigint := 0;
  v_ledger_cents bigint := 0;
  v_count integer := 0;
  it jsonb;
  v_c public.payment_charges;
  v_p public.payment_entries;
  v_rec public.payment_reconciliations;
  v_body jsonb;
begin
  perform app.pay_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'payment.reconcile', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_provider not in ('simulated', 'psp') or p_day is null or jsonb_typeof(p_report) <> 'array' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'report';
  end if;
  for it in select value from jsonb_array_elements(p_report) loop
    v_count := v_count + 1;
    if it->>'status' <> 'paid' then continue; end if;
    v_report_cents := v_report_cents + coalesce((it->>'amount_cents')::bigint, 0);
    select * into v_c from public.payment_charges c where c.provider = p_provider and c.external_id = it->>'external_id' and c.tenant_id = p_tenant_id;
    if not found then
      v_diffs := v_diffs || jsonb_build_object('kind', 'unknown_charge', 'external_id', it->>'external_id', 'amount_cents', (it->>'amount_cents')::bigint);
      continue;
    end if;
    if v_c.payment_entry_id is null then
      v_diffs := v_diffs || jsonb_build_object('kind', 'paid_without_entry', 'charge_id', v_c.id, 'external_id', v_c.external_id,
        'amount_cents', (it->>'amount_cents')::bigint, 'charge_status', v_c.status, 'settlement', v_c.settlement);
      continue;
    end if;
    select * into v_p from public.payment_entries p where p.id = v_c.payment_entry_id;
    if v_p.amount_cents <> (it->>'amount_cents')::bigint then
      v_diffs := v_diffs || jsonb_build_object('kind', 'amount_mismatch', 'charge_id', v_c.id, 'external_id', v_c.external_id,
        'report_cents', (it->>'amount_cents')::bigint, 'entry_cents', v_p.amount_cents);
    end if;
  end loop;
  -- Recebimentos do provedor no dia que o relatório não lista.
  for v_p in
    select p.* from public.payment_entries p join public.payment_charges c on c.id = p.charge_id
    where p.tenant_id = p_tenant_id and p.source = 'provider' and p.reversal_of is null and c.provider = p_provider
      and not exists (select 1 from public.payment_entries x where x.reversal_of = p.id)
      and (p.received_at at time zone (select t.timezone from public.tenants t where t.id = p_tenant_id))::date = p_day
  loop
    v_ledger_cents := v_ledger_cents + v_p.amount_cents;
    select * into v_c from public.payment_charges c where c.id = v_p.charge_id;
    if not exists (select 1 from jsonb_array_elements(p_report) x where x->>'external_id' = v_c.external_id and x->>'status' = 'paid') then
      v_diffs := v_diffs || jsonb_build_object('kind', 'entry_without_report', 'charge_id', v_c.id, 'external_id', v_c.external_id,
        'entry_cents', v_p.amount_cents);
    end if;
  end loop;
  insert into public.payment_reconciliations (tenant_id, provider, day, report_count, report_paid_cents, ledger_paid_cents, differences, created_by)
  values (p_tenant_id, p_provider, p_day, v_count, v_report_cents, v_ledger_cents, v_diffs, v_uid)
  returning * into v_rec;
  perform app.audit(p_tenant_id, 'payment.reconcile', 'payment_reconciliation', v_rec.id, p_request_id, null,
    jsonb_build_object('provider', p_provider, 'day', p_day, 'differences', jsonb_array_length(v_diffs)));
  v_body := jsonb_build_object('reconciliation', jsonb_build_object('id', v_rec.id, 'provider', v_rec.provider, 'day', v_rec.day,
    'report_count', v_rec.report_count, 'report_paid_cents', v_rec.report_paid_cents, 'ledger_paid_cents', v_rec.ledger_paid_cents,
    'differences', v_rec.differences, 'created_at', app.fin_ts(v_rec.created_at)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'payment.reconcile', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.payment_reconciliations_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.pay_owner(p_tenant_id);
  return jsonb_build_object('reconciliations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'provider', r.provider, 'day', r.day,
      'report_count', r.report_count, 'report_paid_cents', r.report_paid_cents, 'ledger_paid_cents', r.ledger_paid_cents,
      'differences', r.differences, 'created_at', app.fin_ts(r.created_at)) order by r.day desc, r.created_at desc)
    from (select distinct on (r.day, r.provider) r.* from public.payment_reconciliations r where r.tenant_id = p_tenant_id
          order by r.day desc, r.provider, r.created_at desc limit 60) r), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Link público de pagamento (anônimo, token no corpo)
-- ---------------------------------------------------------------------------

create function public.payment_link_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.payment_charges;
begin
  select * into v_c from public.payment_charges c where c.link_token_hash = app.token_sha256(p_token);
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return (select jsonb_build_object('charge_id', v_c.id, 'business_name', t.name, 'description', v_c.description, 'amount_cents', v_c.amount_cents,
      'provider', v_c.provider, 'simulated', v_c.provider = 'simulated', 'status', v_c.status, 'pix_code', v_c.pix_code,
      'checkout_url', v_c.checkout_url, 'expires_at', app.fin_ts(v_c.expires_at), 'paid_at', app.fin_ts(v_c.paid_at))
    from public.tenants t where t.id = v_c.tenant_id);
end $$;

-- ---------------------------------------------------------------------------
-- Backend (service_role): resultado do provedor, sync, webhook, estorno, PSP simulado
-- ---------------------------------------------------------------------------

/** Resposta do provedor à criação: pending (com id, Pix e validade), failed (motivo) ou unknown (sem resposta). */
create function public.payment_charge_result(p_charge_id uuid, p_outcome text, p_external_id text, p_pix_code text, p_checkout_url text,
  p_expires_at timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.payment_charges;
begin
  if p_outcome not in ('pending', 'failed', 'unknown') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'outcome';
  end if;
  select * into v_c from public.payment_charges c where c.id = p_charge_id for update;
  if not found then
    return jsonb_build_object('charge_id', p_charge_id, 'status', 'unmatched', 'charge', null);
  end if;
  if v_c.status not in ('creating', 'unknown') then
    -- Resposta tardia ou repetida (replay da criação): devolve o estado atual sem mexer.
    return jsonb_build_object('charge_id', p_charge_id, 'status', 'ignored', 'charge', app.pay_charge_json(v_c));
  end if;
  update public.payment_charges c
  set status = p_outcome,
      external_id = coalesce(p_external_id, c.external_id), pix_code = coalesce(p_pix_code, c.pix_code), checkout_url = coalesce(p_checkout_url, c.checkout_url),
      expires_at = coalesce(p_expires_at, c.expires_at),
      failure_reason = case when p_outcome = 'failed' then left(p_reason, 200) else c.failure_reason end,
      unknown_since = case when p_outcome = 'unknown' then coalesce(c.unknown_since, clock_timestamp()) else null end
  where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('charge_id', v_c.id, 'status', 'applied', 'charge', app.pay_charge_json(v_c));
end $$;

/** Leitura de uma cobrança pelo backend (simulador: precisa do id no provedor). */
create function public.payment_charge_lookup(p_charge_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('charge', app.pay_charge_json(c)) from public.payment_charges c where c.id = p_charge_id
$$;

/** Cobranças a consultar: sem resposta há mais de 1 min, ou pendentes já vencidas (o PSP decide: pago ou expirado). */
create function public.payment_sync_claim(p_batch integer default 50) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('charge_id', c.id, 'provider', c.provider, 'external_id', c.external_id,
      'tenant_id', c.tenant_id, 'amount_cents', c.amount_cents, 'description', c.description, 'reason', case when c.status = 'unknown' then 'unknown' else 'expired' end))
    from (select * from public.payment_charges c
          where (c.status = 'unknown' and c.unknown_since < clock_timestamp() - interval '1 minute')
             or (c.status = 'pending' and c.expires_at < clock_timestamp() - interval '1 minute')
          order by coalesce(c.unknown_since, c.expires_at) limit least(greatest(coalesce(p_batch, 50), 1), 200)) c), '[]'::jsonb))
$$;

/** Resultado da consulta: o PSP informa o estado real. null = continua desconhecido (fica como está). */
create function public.payment_sync_result(p_charge_id uuid, p_status text, p_paid_cents bigint, p_paid_at timestamptz, p_external_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.payment_charges;
  v_out text;
begin
  select * into v_c from public.payment_charges c where c.id = p_charge_id for update;
  if not found then return jsonb_build_object('charge_id', p_charge_id, 'outcome', 'unmatched'); end if;
  if p_status is null then return jsonb_build_object('charge_id', p_charge_id, 'outcome', 'still_unknown'); end if;
  if p_status = 'paid' then
    v_out := app.pay_settle(v_c.id, coalesce(p_paid_cents, v_c.amount_cents), p_paid_at, gen_random_uuid());
  elsif p_status in ('pending', 'expired', 'cancelled', 'failed') and v_c.status in ('unknown', 'pending', 'creating') then
    update public.payment_charges c set status = p_status, external_id = coalesce(p_external_id, c.external_id), unknown_since = null,
      failure_reason = case when p_status = 'failed' then 'provider' else c.failure_reason end where c.id = v_c.id;
    v_out := p_status;
  else
    v_out := 'ignored';
  end if;
  perform app.audit(v_c.tenant_id, 'payment.sync', 'payment_charge', v_c.id, null, null, jsonb_build_object('outcome', v_out));
  return jsonb_build_object('charge_id', v_c.id, 'outcome', v_out);
end $$;

/**
 * Notificações do PSP já normalizadas pela função (assinatura conferida lá). Cada evento:
 * {external_event_id, kind: charge.paid|charge.expired|charge.failed|charge.cancelled|refund.done|refund.failed,
 *  external_id, amount_cents, paid_at, refund_external_id}. Deduplica por (provider, external_event_id);
 * o segundo 'charge.paid' da mesma cobrança, mesmo com outro id, não cria outro recebimento (already_settled).
 */
create function public.payment_webhook_ingest(p_provider text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  v_c public.payment_charges;
  v_f public.payment_refunds;
  v_out text;
  v_applied integer := 0;
  v_dupes integer := 0;
begin
  if p_provider not in ('simulated', 'psp') or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'events';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if coalesce(e->>'external_event_id', '') = '' or coalesce(e->>'kind', '') = '' then continue; end if;
    insert into public.payment_webhook_events (provider, external_event_id, kind, outcome)
    values (p_provider, left(e->>'external_event_id', 200), left(e->>'kind', 40), 'ignored') on conflict do nothing;
    if not found then
      v_dupes := v_dupes + 1;
      continue;
    end if;
    v_out := 'ignored';
    if e->>'kind' like 'charge.%' then
      select * into v_c from public.payment_charges c where c.provider = p_provider and c.external_id = e->>'external_id' for update;
      if not found then
        v_out := 'unmatched_charge';
      elsif e->>'kind' = 'charge.paid' then
        v_out := app.pay_settle(v_c.id, coalesce((e->>'amount_cents')::bigint, v_c.amount_cents), (e->>'paid_at')::timestamptz, gen_random_uuid());
      elsif e->>'kind' in ('charge.expired', 'charge.cancelled', 'charge.failed') and v_c.status in ('pending', 'unknown', 'creating') then
        update public.payment_charges c set status = substr(e->>'kind', 8), unknown_since = null,
          failure_reason = case when e->>'kind' = 'charge.failed' then left(coalesce(e->>'reason', 'provider'), 200) else c.failure_reason end
        where c.id = v_c.id;
        v_out := 'applied';
      end if;
    elsif e->>'kind' like 'refund.%' then
      select f.* into v_f from public.payment_refunds f join public.payment_charges c on c.id = f.charge_id
      where c.provider = p_provider and c.external_id = e->>'external_id' and f.status in ('requested', 'unknown', 'done') for update of f;
      if not found then
        v_out := 'unmatched_refund';
      elsif e->>'kind' = 'refund.done' then
        v_out := app.pay_refund_done(v_f.id, e->>'refund_external_id', gen_random_uuid());
      elsif e->>'kind' = 'refund.failed' and v_f.status in ('requested', 'unknown') then
        update public.payment_refunds f set status = 'failed', failure_reason = left(coalesce(e->>'reason', 'provider'), 200), unknown_since = null where f.id = v_f.id;
        update public.payment_charges c set refund_status = 'failed' where c.id = v_f.charge_id;
        v_out := 'applied';
      end if;
    end if;
    update public.payment_webhook_events w set outcome = v_out where w.provider = p_provider and w.external_event_id = left(e->>'external_event_id', 200);
    if v_out in ('applied', 'entry', 'done', 'receivable_cancelled', 'done_without_entry') then v_applied := v_applied + 1; end if;
  end loop;
  return jsonb_build_object('applied', v_applied, 'duplicates', v_dupes);
end $$;

/** Resposta do PSP ao pedido de estorno feito pela função: done, failed ou unknown. */
create function public.payment_refund_result(p_refund_id uuid, p_outcome text, p_external_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.payment_refunds;
  v_out text;
begin
  if p_outcome not in ('done', 'failed', 'unknown') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'outcome';
  end if;
  select * into v_f from public.payment_refunds f where f.id = p_refund_id for update;
  if not found then return jsonb_build_object('refund_id', p_refund_id, 'outcome', 'unmatched'); end if;
  if p_outcome = 'done' then
    v_out := app.pay_refund_done(v_f.id, p_external_id, gen_random_uuid());
  elsif v_f.status in ('requested', 'unknown') then
    update public.payment_refunds f set status = p_outcome, external_id = coalesce(p_external_id, f.external_id),
      failure_reason = case when p_outcome = 'failed' then left(p_reason, 200) else f.failure_reason end,
      unknown_since = case when p_outcome = 'unknown' then coalesce(f.unknown_since, clock_timestamp()) else null end
    where f.id = v_f.id;
    update public.payment_charges c set refund_status = p_outcome where c.id = v_f.charge_id;
    v_out := p_outcome;
  else
    v_out := 'ignored';
  end if;
  select * into v_f from public.payment_refunds f where f.id = v_f.id;
  return jsonb_build_object('refund_id', v_f.id, 'outcome', v_out, 'refund', app.pay_refund_json(v_f));
end $$;

-- PSP simulado: o "outro lado" da porta, só pelo backend.
create function public.payment_sim_create(p_external_id text, p_tenant_id uuid, p_amount_cents bigint, p_expires_at timestamptz) returns jsonb
language sql security definer set search_path = '' as $$
  insert into public.payment_sim_ledger (external_id, tenant_id, amount_cents, expires_at) values (p_external_id, p_tenant_id, p_amount_cents, p_expires_at)
  on conflict (external_id) do nothing;
  select jsonb_build_object('external_id', p_external_id, 'status', 'pending');
$$;

create function public.payment_sim_status(p_external_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('external_id', l.external_id, 'status', l.status, 'amount_cents', l.amount_cents, 'paid_at', app.fin_ts(l.paid_at))
  from public.payment_sim_ledger l where l.external_id = p_external_id
$$;

/** O "cliente" paga, a cobrança expira ou o dono cancela no PSP fictício. Só avança; pago não volta. */
create function public.payment_sim_transition(p_external_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.payment_sim_ledger;
begin
  if p_status not in ('paid', 'expired', 'cancelled', 'refunded') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'status';
  end if;
  select * into l from public.payment_sim_ledger x where x.external_id = p_external_id for update;
  if not found then return jsonb_build_object('external_id', p_external_id, 'status', null, 'changed', false); end if;
  if (p_status = 'refunded' and l.status <> 'paid') or (p_status <> 'refunded' and l.status <> 'pending') then
    return jsonb_build_object('external_id', l.external_id, 'status', l.status, 'amount_cents', l.amount_cents, 'paid_at', app.fin_ts(l.paid_at), 'changed', false);
  end if;
  update public.payment_sim_ledger x set status = p_status,
    paid_at = case when p_status = 'paid' then clock_timestamp() else x.paid_at end,
    refunded_at = case when p_status = 'refunded' then clock_timestamp() else x.refunded_at end
  where x.external_id = l.external_id returning * into l;
  return jsonb_build_object('external_id', l.external_id, 'status', l.status, 'amount_cents', l.amount_cents, 'paid_at', app.fin_ts(l.paid_at), 'changed', true);
end $$;

/** Relatório do dia do PSP fictício (o que o PSP diz que recebeu), no fuso do negócio. */
create function public.payment_sim_report(p_tenant_id uuid, p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('external_id', l.external_id, 'status', l.status,
      'amount_cents', l.amount_cents, 'paid_at', app.fin_ts(l.paid_at)) order by l.paid_at)
    from public.payment_sim_ledger l
    where l.tenant_id = p_tenant_id and l.status in ('paid', 'refunded') and l.paid_at is not null
      and (l.paid_at at time zone (select t.timezone from public.tenants t where t.id = p_tenant_id))::date = p_day), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function public.payment_charge_create(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.payment_charge_cancel(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.payment_charges_list(uuid) from public, anon;
revoke all on function public.payment_refund_request(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.payment_reconcile(uuid, text, date, jsonb, text, text, uuid) from public, anon;
revoke all on function public.payment_reconciliations_list(uuid) from public, anon;
grant execute on function public.payment_charge_create(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.payment_charge_cancel(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.payment_charges_list(uuid) to authenticated;
grant execute on function public.payment_refund_request(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.payment_reconcile(uuid, text, date, jsonb, text, text, uuid) to authenticated;
grant execute on function public.payment_reconciliations_list(uuid) to authenticated;

revoke all on function public.payment_link_view(text) from public;
grant execute on function public.payment_link_view(text) to anon, authenticated;

revoke all on function public.payment_charge_result(uuid, text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.payment_charge_lookup(uuid) from public, anon, authenticated;
revoke all on function public.payment_sync_claim(integer) from public, anon, authenticated;
revoke all on function public.payment_sync_result(uuid, text, bigint, timestamptz, text) from public, anon, authenticated;
revoke all on function public.payment_webhook_ingest(text, jsonb) from public, anon, authenticated;
revoke all on function public.payment_refund_result(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.payment_sim_create(text, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.payment_sim_status(text) from public, anon, authenticated;
revoke all on function public.payment_sim_transition(text, text) from public, anon, authenticated;
revoke all on function public.payment_sim_report(uuid, date) from public, anon, authenticated;
grant execute on function public.payment_charge_result(uuid, text, text, text, text, timestamptz, text) to service_role;
grant execute on function public.payment_charge_lookup(uuid) to service_role;
grant execute on function public.payment_sync_claim(integer) to service_role;
grant execute on function public.payment_sync_result(uuid, text, bigint, timestamptz, text) to service_role;
grant execute on function public.payment_webhook_ingest(text, jsonb) to service_role;
grant execute on function public.payment_refund_result(uuid, text, text, text) to service_role;
grant execute on function public.payment_sim_create(text, uuid, bigint, timestamptz) to service_role;
grant execute on function public.payment_sim_status(text) to service_role;
grant execute on function public.payment_sim_transition(text, text) to service_role;
grant execute on function public.payment_sim_report(uuid, date) to service_role;

revoke all on function app.pay_settle(uuid, bigint, timestamptz, uuid) from public, anon, authenticated;
revoke all on function app.pay_refund_done(uuid, text, uuid) from public, anon, authenticated;

alter table public.payment_charges enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.payment_reconciliations enable row level security;
alter table public.payment_sim_ledger enable row level security;
grant select on public.payment_charges, public.payment_refunds, public.payment_reconciliations to authenticated;
create policy payment_charges_select_owner on public.payment_charges for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy payment_refunds_select_owner on public.payment_refunds for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy payment_reconciliations_select_owner on public.payment_reconciliations for select to authenticated using (app.is_member(tenant_id, array['owner']));
-- payment_webhook_events e payment_sim_ledger: RLS ligada e nenhuma política nem grant para usuários.
