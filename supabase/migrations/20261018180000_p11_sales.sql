-- P11 · Orçamentos e aceite: proposta comercial versionada, validade, aceite do cliente pelo link e vínculo à reserva.
-- Invariantes (doc15, doc17, AGENTS.md):
-- * Cada versão é um snapshot imutável (append-only) com hash; o aceite cita versão + hash e vale só dentro da validade.
-- * Aceite é idempotente: repetir devolve a mesma decisão e a mesma reserva; aceites simultâneos geram uma reserva.
-- * Aceite revalida o horário pela agenda (P03) na mesma transação; sem vaga, nada é aceito (SLOT_CONFLICT).
-- * Orçamento aceito NÃO marca pagamento nem cria recebimento: a cobrança segue pelo caixa (P07).
-- * Preço do orçamento aceito vira o preço combinado da reserva e não muda depois.
--
-- Escrita do dono só por RPC (autoriza → idempotency_claim → trava → valida → grava → auditoria sem PII → complete).
-- Link do cliente: anônimo, token de 256 bits (só o sha256 no banco), ver ≠ aceitar.
-- Depende de: fundação, P01 (app.token_sha256), P02 (customers, provider_services), P03 (bookings, agenda).

-- A reserva nascida de um orçamento aceito tem origem própria.
alter table public.bookings drop constraint bookings_source_check;
alter table public.bookings add constraint bookings_source_check
  check (source in ('owner', 'public_link', 'waitlist', 'agent', 'import', 'quote'));

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.sales_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  customer_id uuid not null,
  -- 'expired' não é gravado: é 'sent' com a validade da versão atual vencida (derivado na leitura e no aceite).
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'cancelled')),
  current_version integer not null default 1 check (current_version >= 1),
  -- Link do cliente: só o hash. Reenviar troca o token (o link antigo para de funcionar).
  token_hash text check (token_hash ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz,
  decided_at timestamptz,
  decided_version integer,
  booking_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint sales_quotes_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint sales_quotes_booking foreign key (tenant_id, booking_id)
    references public.bookings (tenant_id, id) on delete restrict,
  constraint sales_quotes_sent_has_link check (status <> 'sent' or (token_hash is not null and sent_at is not null)),
  constraint sales_quotes_decided check (
    (status in ('accepted', 'declined')) = (decided_at is not null and decided_version is not null)
  ),
  constraint sales_quotes_booking_only_accepted check (booking_id is null or status = 'accepted'),
  unique (tenant_id, id),
  unique (token_hash)
);
comment on table public.sales_quotes is 'Orçamento (cabeça). O conteúdo está em sales_quote_versions; aceito não implica pago.';
create index sales_quotes_tenant on public.sales_quotes (tenant_id, created_at desc);
create trigger sales_quotes_touch before update on public.sales_quotes
  for each row execute function app.touch_row();

create table public.sales_quote_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  quote_id uuid not null,
  version_no integer not null check (version_no >= 1),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  -- Itens normalizados pelo servidor: service_id, description, quantity, unit_price_cents, line_total_cents.
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  -- Calculado pelo servidor (soma das linhas). O cliente nunca envia o total.
  total_cents bigint not null check (total_cents between 0 and 9007199254740991),
  valid_until timestamptz not null,
  -- Horário proposto (opcional). O aceite revalida pela agenda; propor não reserva.
  slot_service_id uuid,
  slot_resource_id uuid,
  slot_starts_at timestamptz,
  slot_ends_at timestamptz,
  notes text check (char_length(notes) <= 500),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint sales_quote_versions_slot check (
    (slot_service_id is null and slot_resource_id is null and slot_starts_at is null and slot_ends_at is null)
    or (slot_service_id is not null and slot_resource_id is not null and slot_starts_at is not null
        and slot_ends_at > slot_starts_at)
  ),
  constraint sales_quote_versions_quote foreign key (tenant_id, quote_id)
    references public.sales_quotes (tenant_id, id) on delete restrict,
  constraint sales_quote_versions_service foreign key (tenant_id, slot_service_id)
    references public.provider_services (tenant_id, id) on delete restrict,
  constraint sales_quote_versions_resource foreign key (tenant_id, slot_resource_id)
    references public.resources (tenant_id, id) on delete restrict,
  unique (quote_id, version_no),
  unique (tenant_id, id)
);
comment on table public.sales_quote_versions is 'Snapshot imutável de cada versão do orçamento. Mudança = versão nova.';
create trigger sales_quote_versions_append_only before update or delete on public.sales_quote_versions
  for each row execute function app.forbid_mutation();

create table public.sales_quote_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  quote_id uuid not null,
  version_no integer not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('accepted', 'declined')),
  -- Piloto: decisão pelo link compartilhado manualmente.
  channel text not null default 'link' check (channel = 'link'),
  booking_id uuid,
  decided_at timestamptz not null default now(),
  constraint sales_quote_decisions_quote foreign key (tenant_id, quote_id)
    references public.sales_quotes (tenant_id, id) on delete restrict,
  constraint sales_quote_decisions_version foreign key (quote_id, version_no)
    references public.sales_quote_versions (quote_id, version_no) on delete restrict,
  constraint sales_quote_decisions_booking foreign key (tenant_id, booking_id)
    references public.bookings (tenant_id, id) on delete restrict,
  constraint sales_quote_decisions_booking_only_accepted check (booking_id is null or decision = 'accepted'),
  -- Uma decisão por orçamento: aceite repetido não duplica.
  unique (quote_id),
  unique (tenant_id, id)
);
comment on table public.sales_quote_decisions is 'Aceite/recusa do cliente, vinculado a versão + hash. Append-only.';
create trigger sales_quote_decisions_append_only before update or delete on public.sales_quote_decisions
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- JSON e regras internas
-- ---------------------------------------------------------------------------

create function app.sales_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.sales_effective_status(p_status text, p_valid_until timestamptz) returns text
language sql stable set search_path = '' as $$
  select case when p_status = 'sent' and p_valid_until <= clock_timestamp() then 'expired' else p_status end
$$;

create function app.sales_version_json(v public.sales_quote_versions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('version_no', v.version_no, 'title', v.title, 'items', v.items,
    'total_cents', v.total_cents, 'currency', 'BRL', 'valid_until', app.sched_ts(v.valid_until),
    'slot', case when v.slot_service_id is null then null else jsonb_build_object('service_id', v.slot_service_id,
      'starts_at', app.sched_ts(v.slot_starts_at), 'ends_at', app.sched_ts(v.slot_ends_at)) end,
    'notes', v.notes, 'snapshot_hash', v.snapshot_hash, 'created_at', app.sched_ts(v.created_at))
$$;

create function app.sales_quote_json(q public.sales_quotes) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', q.id, 'customer_id', q.customer_id,
    'status', app.sales_effective_status(q.status, v.valid_until), 'current_version', q.current_version,
    'link_active', q.status = 'sent' and q.token_hash is not null and v.valid_until > clock_timestamp(),
    'sent_at', app.fin_ts(q.sent_at), 'decided_at', app.fin_ts(q.decided_at), 'decided_version', q.decided_version,
    'booking_id', q.booking_id, 'version', q.version, 'created_at', app.sched_ts(q.created_at),
    'current', app.sales_version_json(v))
  from public.sales_quote_versions v
  where v.quote_id = q.id and v.version_no = q.current_version
$$;

/**
 * Valida e grava uma versão. Itens normalizados (só campos conhecidos), total calculado aqui, horário
 * conferido contra a agenda sem reservar (o aceite revalida sob lock). Chamador já autorizou e travou.
 */
create function app.sales_insert_version(
  p_tenant_id uuid, p_quote_id uuid, p_version_no integer, p_title text, p_items jsonb, p_valid_until timestamptz,
  p_slot_service_id uuid, p_slot_starts_at timestamptz, p_notes text
) returns public.sales_quote_versions
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_qty integer;
  v_unit bigint;
  v_svc_id uuid;
  v_desc text;
  v_svc public.provider_services;
  v_res uuid;
  v_ends timestamptz;
  v_row public.sales_quote_versions;
  v_snapshot jsonb;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'title';
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'notes';
  end if;
  if p_valid_until is null or p_valid_until <= clock_timestamp() or p_valid_until > clock_timestamp() + interval '90 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'valid_until';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'items';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_svc_id := nullif(v_item->>'service_id', '')::uuid;
      v_qty := (v_item->>'quantity')::integer;
      v_unit := (v_item->>'unit_price_cents')::bigint;
    exception when others then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'items';
    end;
    v_desc := btrim(coalesce(v_item->>'description', ''));
    if v_qty is null or v_qty not between 1 and 99 or v_unit is null or v_unit < 0 or v_unit > 9007199254740991
       or char_length(v_desc) not between 1 and 120 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'items';
    end if;
    if v_svc_id is not null then
      perform 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.id = v_svc_id and s.active;
      if not found then
        raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
      end if;
    end if;
    v_total := v_total + v_qty::numeric * v_unit;
    v_items := v_items || jsonb_build_array(jsonb_build_object('service_id', v_svc_id, 'description', v_desc,
      'quantity', v_qty, 'unit_price_cents', v_unit, 'line_total_cents', v_qty::numeric * v_unit));
  end loop;
  if v_total > 9007199254740991 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'items';
  end if;

  if (p_slot_service_id is null) <> (p_slot_starts_at is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot';
  end if;
  if p_slot_service_id is not null then
    -- O horário é de um serviço do próprio orçamento.
    if not exists (select 1 from jsonb_array_elements(v_items) i where (i->>'service_id')::uuid = p_slot_service_id) then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot';
    end if;
    select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_slot_service_id;
    select r.id into v_res from public.resources r where r.tenant_id = p_tenant_id and r.active;
    if v_res is null then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
    end if;
    if p_slot_starts_at <= clock_timestamp() then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot';
    end if;
    v_ends := p_slot_starts_at + make_interval(mins => v_svc.duration_min);
    -- Conferência sem reserva: propor um horário que já não existe é erro de quem propõe.
    perform app.sched_assert_bookable(p_tenant_id, v_res,
      tstzrange(p_slot_starts_at - make_interval(mins => v_svc.buffer_before_min),
                v_ends + make_interval(mins => v_svc.buffer_after_min), '[)'), p_slot_starts_at, v_ends);
    if exists (select 1 from public.bookings b where b.tenant_id = p_tenant_id and b.resource_id = v_res
               and b.blocks_capacity and (b.status <> 'held' or b.hold_expires_at > clock_timestamp())
               and b.occupied_range && tstzrange(p_slot_starts_at - make_interval(mins => v_svc.buffer_before_min),
                 v_ends + make_interval(mins => v_svc.buffer_after_min), '[)')) then
      raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT';
    end if;
  end if;

  v_snapshot := jsonb_build_object('quote_id', p_quote_id, 'version_no', p_version_no, 'title', btrim(p_title),
    'items', v_items, 'total_cents', v_total, 'currency', 'BRL', 'valid_until', app.sched_ts(p_valid_until),
    'slot', case when p_slot_service_id is null then null else jsonb_build_object('service_id', p_slot_service_id,
      'starts_at', app.sched_ts(p_slot_starts_at), 'ends_at', app.sched_ts(v_ends)) end,
    'notes', nullif(btrim(coalesce(p_notes, '')), ''));
  insert into public.sales_quote_versions (tenant_id, quote_id, version_no, title, items, total_cents, valid_until,
    slot_service_id, slot_resource_id, slot_starts_at, slot_ends_at, notes, snapshot_hash, created_by)
  values (p_tenant_id, p_quote_id, p_version_no, btrim(p_title), v_items, v_total, p_valid_until,
    p_slot_service_id, v_res, p_slot_starts_at, v_ends, nullif(btrim(coalesce(p_notes, '')), ''),
    encode(pg_catalog.sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex'), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

create function app.sales_audit_after(q public.sales_quotes, v public.sales_quote_versions) returns jsonb
language sql stable set search_path = '' as $$
  -- Sem título, itens ou observações (texto livre pode ter dado pessoal).
  select jsonb_build_object('status', q.status, 'version_no', v.version_no, 'total_cents', v.total_cents,
    'snapshot_hash', v.snapshot_hash, 'has_slot', v.slot_service_id is not null)
$$;

-- ---------------------------------------------------------------------------
-- Dono
-- ---------------------------------------------------------------------------

create function public.sales_quote_create(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_title text,
  p_items jsonb,
  p_valid_until timestamptz,
  p_slot_service_id uuid,
  p_slot_starts_at timestamptz,
  p_notes text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_q public.sales_quotes;
  v_v public.sales_quote_versions;
  v_body jsonb;
begin
  perform app.sales_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'quote.create', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  insert into public.sales_quotes (tenant_id, customer_id, created_by) values (p_tenant_id, p_customer_id, v_uid)
  returning * into v_q;
  v_v := app.sales_insert_version(p_tenant_id, v_q.id, 1, p_title, p_items, p_valid_until, p_slot_service_id,
    p_slot_starts_at, p_notes);
  v_body := jsonb_build_object('quote', app.sales_quote_json(v_q));
  perform app.audit(p_tenant_id, 'quote.create', 'sales_quote', v_q.id, p_request_id, null, app.sales_audit_after(v_q, v_v));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'quote.create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Nova versão (snapshot novo, hash novo). O link continua o mesmo; quem abrir vê a versão nova. */
create function public.sales_quote_revise(
  p_tenant_id uuid,
  p_quote_id uuid,
  p_expected_version integer,
  p_title text,
  p_items jsonb,
  p_valid_until timestamptz,
  p_slot_service_id uuid,
  p_slot_starts_at timestamptz,
  p_notes text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_q public.sales_quotes;
  v_v public.sales_quote_versions;
  v_body jsonb;
begin
  perform app.sales_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'quote.revise', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_q from public.sales_quotes q where q.tenant_id = p_tenant_id and q.id = p_quote_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_q.current_version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_q.status not in ('draft', 'sent') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  v_v := app.sales_insert_version(p_tenant_id, v_q.id, v_q.current_version + 1, p_title, p_items, p_valid_until,
    p_slot_service_id, p_slot_starts_at, p_notes);
  update public.sales_quotes q set current_version = v_v.version_no where q.id = v_q.id returning * into v_q;
  v_body := jsonb_build_object('quote', app.sales_quote_json(v_q));
  perform app.audit(p_tenant_id, 'quote.revise', 'sales_quote', v_q.id, p_request_id,
    jsonb_build_object('version_no', p_expected_version), app.sales_audit_after(v_q, v_v));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'quote.revise', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/**
 * Gera o link do cliente. O token aparece só nesta resposta (a repetição devolve token null). Gerar de novo
 * troca o token: o link anterior deixa de funcionar. A Tinindo não envia: o dono compartilha.
 */
create function public.sales_quote_send(
  p_tenant_id uuid,
  p_quote_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_q public.sales_quotes;
  v_valid timestamptz;
  v_token text;
  v_body jsonb;
begin
  perform app.sales_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'quote.send', p_idem_key, p_request_hash);
  if v_replay is not null then
    return jsonb_set(v_replay, '{body,token}', 'null'::jsonb);
  end if;
  select * into v_q from public.sales_quotes q where q.tenant_id = p_tenant_id and q.id = p_quote_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_q.current_version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_q.status not in ('draft', 'sent') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  select v.valid_until into v_valid from public.sales_quote_versions v
  where v.quote_id = v_q.id and v.version_no = v_q.current_version;
  if v_valid <= clock_timestamp() then
    -- Vencido: revisar (nova validade) antes de gerar outro link.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'valid_until';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  update public.sales_quotes q
  set status = 'sent', token_hash = app.token_sha256(v_token), sent_at = clock_timestamp()
  where q.id = v_q.id returning * into v_q;
  v_body := jsonb_build_object('quote', app.sales_quote_json(v_q));
  perform app.audit(p_tenant_id, 'quote.send', 'sales_quote', v_q.id, p_request_id, null,
    jsonb_build_object('version_no', v_q.current_version));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'quote.send', p_idem_key, 200, v_body || jsonb_build_object('token', null));
  return jsonb_build_object('status_code', 200, 'body', v_body || jsonb_build_object('token', v_token));
end $$;

create function public.sales_quote_cancel(
  p_tenant_id uuid,
  p_quote_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_q public.sales_quotes;
  v_body jsonb;
begin
  perform app.sales_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'quote.cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_q from public.sales_quotes q where q.tenant_id = p_tenant_id and q.id = p_quote_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_q.status not in ('draft', 'sent') then
    -- Aceito vira reserva: desfazer é cancelar a reserva pela agenda, não apagar o aceite.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.sales_quotes q set status = 'cancelled', token_hash = null where q.id = v_q.id returning * into v_q;
  v_body := jsonb_build_object('quote', app.sales_quote_json(v_q));
  perform app.audit(p_tenant_id, 'quote.cancel', 'sales_quote', v_q.id, p_request_id, null,
    jsonb_build_object('status', v_q.status));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'quote.cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.sales_quote_list(p_tenant_id uuid, p_status text) returns jsonb
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
    where p_status is null or x.j->>'status' = p_status), '[]'::jsonb));
end $$;

create function public.sales_quote_get(p_tenant_id uuid, p_quote_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q public.sales_quotes;
begin
  perform app.sales_owner(p_tenant_id);
  select * into v_q from public.sales_quotes q where q.tenant_id = p_tenant_id and q.id = p_quote_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('quote', app.sales_quote_json(v_q),
    'versions', (select jsonb_agg(app.sales_version_json(v) order by v.version_no desc)
      from public.sales_quote_versions v where v.quote_id = v_q.id),
    'decision', (select jsonb_build_object('decision', d.decision, 'version_no', d.version_no,
        'snapshot_hash', d.snapshot_hash, 'booking_id', d.booking_id, 'decided_at', app.sched_ts(d.decided_at))
      from public.sales_quote_decisions d where d.quote_id = v_q.id));
end $$;

-- ---------------------------------------------------------------------------
-- Link do cliente (anônimo, por token): ver não muda nada; aceitar e recusar são POST explícitos.
-- ---------------------------------------------------------------------------

/** O que o cliente vê: a versão atual, sem tenant, sem outros clientes, sem nome do cadastro. */
create function public.sales_quote_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q public.sales_quotes;
  v_version integer;
begin
  select * into v_q from public.sales_quotes q where q.token_hash = app.token_sha256(p_token);
  if not found or v_q.status = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  -- Depois de decidido, o cliente vê a versão que decidiu.
  v_version := coalesce(v_q.decided_version, v_q.current_version);
  return (
    select app.sales_version_json(v) || jsonb_build_object('business_name', t.name, 'timezone', t.timezone,
      'status', case when v_q.status = 'sent' then app.sales_effective_status(v_q.status, v.valid_until) else v_q.status end,
      'slot_service_name', s.name)
    from public.sales_quote_versions v
    join public.tenants t on t.id = v.tenant_id
    left join public.provider_services s on s.tenant_id = v.tenant_id and s.id = v.slot_service_id
    where v.quote_id = v_q.id and v.version_no = v_version
  );
end $$;

/**
 * Aceite: cita versão e hash do que o cliente viu. Trava o orçamento, confere status/validade/versão, reserva
 * o horário pela agenda (lock do recurso, expediente, bloqueios, constraint) e grava a decisão, tudo numa
 * transação. Sem vaga: SLOT_CONFLICT e nada muda. Repetir devolve a mesma decisão e a mesma reserva.
 */
create function public.sales_quote_accept(p_token text, p_version_no integer, p_snapshot_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.sales_quotes;
  v_v public.sales_quote_versions;
  v_b public.bookings;
  v_d public.sales_quote_decisions;
begin
  select * into v_q from public.sales_quotes q where q.token_hash = app.token_sha256(p_token) for update;
  if not found or v_q.status = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_q.status = 'accepted' then
    select * into v_d from public.sales_quote_decisions d where d.quote_id = v_q.id;
    if v_d.version_no <> p_version_no or v_d.snapshot_hash <> p_snapshot_hash then
      raise exception using errcode = 'PT409', message = 'STALE_VERSION';
    end if;
    select * into v_b from public.bookings b where b.tenant_id = v_q.tenant_id and b.id = v_d.booking_id;
    return jsonb_build_object('status', 'accepted', 'version_no', v_d.version_no, 'decided_at', app.sched_ts(v_d.decided_at),
      'booking', case when v_d.booking_id is null then null else app.sched_booking_json(v_b) end);
  end if;
  if v_q.status <> 'sent' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  select * into v_v from public.sales_quote_versions v where v.quote_id = v_q.id and v.version_no = v_q.current_version;
  if v_v.version_no <> p_version_no or v_v.snapshot_hash <> p_snapshot_hash then
    -- O profissional mudou o orçamento depois que o cliente abriu: aceitar só o que foi visto.
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_v.valid_until <= clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'valid_until';
  end if;

  if v_v.slot_service_id is not null then
    if v_v.slot_starts_at <= clock_timestamp() then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'slot';
    end if;
    -- Mesmo protocolo da agenda (lock do recurso → expediente → bloqueio → constraint de sobreposição).
    v_b := app.sched_insert_booking(v_q.tenant_id, v_v.slot_resource_id, v_v.slot_service_id, v_q.customer_id, null,
      v_v.slot_starts_at, v_v.slot_ends_at, null, 'hold', 'quote', null, null);
    -- Preço combinado = total do orçamento aceito (congelado na reserva).
    update public.bookings b set status = 'confirmed', hold_expires_at = null, agreed_price_cents = v_v.total_cents
    where b.id = v_b.id returning * into v_b;
    perform app.emit_event(v_q.tenant_id, 'booking.confirmed.v1', v_b.id, v_b.version, gen_random_uuid(),
      app.sched_event_payload(v_b));
  end if;

  insert into public.sales_quote_decisions (tenant_id, quote_id, version_no, snapshot_hash, decision, booking_id)
  values (v_q.tenant_id, v_q.id, v_v.version_no, v_v.snapshot_hash, 'accepted', v_b.id)
  returning * into v_d;
  update public.sales_quotes q set status = 'accepted', decided_at = v_d.decided_at, decided_version = v_v.version_no,
    booking_id = v_b.id
  where q.id = v_q.id returning * into v_q;
  perform app.emit_event(v_q.tenant_id, 'sales.quote.accepted.v1', v_q.id, v_q.version, gen_random_uuid(),
    jsonb_build_object('quote_id', v_q.id, 'customer_id', v_q.customer_id, 'version_no', v_v.version_no,
      'total_cents', v_v.total_cents, 'booking_id', v_b.id));
  perform app.audit(v_q.tenant_id, 'quote.accept', 'sales_quote', v_q.id, null, null,
    jsonb_build_object('version_no', v_v.version_no, 'snapshot_hash', v_v.snapshot_hash, 'booking_id', v_b.id));
  return jsonb_build_object('status', 'accepted', 'version_no', v_v.version_no, 'decided_at', app.sched_ts(v_d.decided_at),
    'booking', case when v_b.id is null then null else app.sched_booking_json(v_b) end);
end $$;

create function public.sales_quote_decline(p_token text, p_version_no integer, p_snapshot_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.sales_quotes;
  v_v public.sales_quote_versions;
  v_d public.sales_quote_decisions;
begin
  select * into v_q from public.sales_quotes q where q.token_hash = app.token_sha256(p_token) for update;
  if not found or v_q.status = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_q.status = 'declined' then
    select * into v_d from public.sales_quote_decisions d where d.quote_id = v_q.id;
    return jsonb_build_object('status', 'declined', 'version_no', v_d.version_no, 'decided_at', app.sched_ts(v_d.decided_at),
      'booking', null);
  end if;
  if v_q.status <> 'sent' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  select * into v_v from public.sales_quote_versions v where v.quote_id = v_q.id and v.version_no = v_q.current_version;
  if v_v.version_no <> p_version_no or v_v.snapshot_hash <> p_snapshot_hash then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  insert into public.sales_quote_decisions (tenant_id, quote_id, version_no, snapshot_hash, decision)
  values (v_q.tenant_id, v_q.id, v_v.version_no, v_v.snapshot_hash, 'declined')
  returning * into v_d;
  update public.sales_quotes q set status = 'declined', decided_at = v_d.decided_at, decided_version = v_v.version_no
  where q.id = v_q.id returning * into v_q;
  perform app.emit_event(v_q.tenant_id, 'sales.quote.declined.v1', v_q.id, v_q.version, gen_random_uuid(),
    jsonb_build_object('quote_id', v_q.id, 'customer_id', v_q.customer_id, 'version_no', v_v.version_no));
  perform app.audit(v_q.tenant_id, 'quote.decline', 'sales_quote', v_q.id, null, null,
    jsonb_build_object('version_no', v_v.version_no));
  return jsonb_build_object('status', 'declined', 'version_no', v_v.version_no, 'decided_at', app.sched_ts(v_d.decided_at),
    'booking', null);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS: só o dono lê; ninguém escreve direto; o hash do token não é legível.
-- ---------------------------------------------------------------------------

revoke all on function app.sales_owner(uuid) from public;
revoke all on function app.sales_effective_status(text, timestamptz) from public;
revoke all on function app.sales_version_json(public.sales_quote_versions) from public;
revoke all on function app.sales_quote_json(public.sales_quotes) from public;
revoke all on function app.sales_insert_version(uuid, uuid, integer, text, jsonb, timestamptz, uuid, timestamptz, text) from public;
revoke all on function app.sales_audit_after(public.sales_quotes, public.sales_quote_versions) from public;

revoke all on function public.sales_quote_create(uuid, uuid, text, jsonb, timestamptz, uuid, timestamptz, text, text, text, uuid) from public, anon;
revoke all on function public.sales_quote_revise(uuid, uuid, integer, text, jsonb, timestamptz, uuid, timestamptz, text, text, text, uuid) from public, anon;
revoke all on function public.sales_quote_send(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.sales_quote_cancel(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.sales_quote_list(uuid, text) from public, anon;
revoke all on function public.sales_quote_get(uuid, uuid) from public, anon;
revoke all on function public.sales_quote_view(text) from public;
revoke all on function public.sales_quote_accept(text, integer, text) from public;
revoke all on function public.sales_quote_decline(text, integer, text) from public;

grant execute on function public.sales_quote_create(uuid, uuid, text, jsonb, timestamptz, uuid, timestamptz, text, text, text, uuid) to authenticated;
grant execute on function public.sales_quote_revise(uuid, uuid, integer, text, jsonb, timestamptz, uuid, timestamptz, text, text, text, uuid) to authenticated;
grant execute on function public.sales_quote_send(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.sales_quote_cancel(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.sales_quote_list(uuid, text) to authenticated;
grant execute on function public.sales_quote_get(uuid, uuid) to authenticated;
grant execute on function public.sales_quote_view(text) to anon, authenticated;
grant execute on function public.sales_quote_accept(text, integer, text) to anon, authenticated;
grant execute on function public.sales_quote_decline(text, integer, text) to anon, authenticated;

alter table public.sales_quotes enable row level security;
alter table public.sales_quote_versions enable row level security;
alter table public.sales_quote_decisions enable row level security;

revoke all on public.sales_quotes, public.sales_quote_versions, public.sales_quote_decisions from anon, authenticated;
grant select (id, tenant_id, customer_id, status, current_version, sent_at, decided_at, decided_version, booking_id,
  created_by, created_at, updated_at, version) on public.sales_quotes to authenticated;
grant select on public.sales_quote_versions, public.sales_quote_decisions to authenticated;
grant select, insert, update on public.sales_quotes to service_role;
grant select, insert on public.sales_quote_versions, public.sales_quote_decisions to service_role;

create policy sales_quotes_select_owner on public.sales_quotes
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy sales_quote_versions_select_owner on public.sales_quote_versions
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy sales_quote_decisions_select_owner on public.sales_quote_decisions
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
