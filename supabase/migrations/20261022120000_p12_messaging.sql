-- P12 · Canal oficial de mensagens: conexão verificada do número do negócio, caixa de entrada por contato, envio por
-- texto (janela de 24 h) ou modelo aprovado, estados enviado/entregue/lido/falhou/desconhecido distintos, webhook
-- deduplicado por evento do provedor, transferência para humano e opt-out.
-- Invariantes (docs/02, docs/04, docs/05, docs/09):
-- * Provedor atrás de porta: 'simulated' (determinístico, rotulado) ou 'whatsapp_cloud' (API oficial). Nunca API
--   não oficial. O provedor real só funciona com segredos no ambiente; sem eles, 503 explícito.
-- * Um número pertence a um negócio e precisa ser verificado por código enviado pelo próprio canal.
-- * Ingestão de webhook e despacho só com service_role (a função valida a assinatura antes); o dono nunca grava
--   mensagens de entrada nem estados de entrega. UNIQUE (provider, external_event_id) deduplica.
-- * Enviado ≠ entregue ≠ lido. 'delivery_unknown' é estado próprio e não dispara reenvio automático.
-- * Texto livre só dentro da janela de 24 h após a última mensagem do contato; fora dela, só modelo aprovado e com
--   opt-in. Opt-out ("SAIR"/"PARAR") bloqueia envios. Conteúdo do cliente é dado, nunca instrução.
-- * Código de verificação fica em tabela sem acesso pela Data API. Auditoria sem telefone nem texto.
-- Depende de: fundação, P02 (customers), P06 (outbox/worker).

create table public.channel_templates (
  code text primary key check (code ~ '^[a-z0-9_]{3,40}$'),
  category text not null check (category in ('utility', 'marketing')),
  -- Corpo com {{1}}, {{2}}… como no WhatsApp. Sem PII: os parâmetros vêm na hora do envio.
  body text not null check (char_length(body) between 1 and 1024),
  params integer not null check (params between 0 and 10),
  -- Provedores em que o modelo está aprovado. O simulado aprova tudo; o real exige aprovação da Meta (service_role).
  approved_providers text[] not null default '{simulated}' check (approved_providers <@ array['simulated', 'whatsapp_cloud']),
  created_at timestamptz not null default now()
);
comment on table public.channel_templates is 'Modelos de mensagem (utility). Aprovação por provedor é decisão de backend.';
insert into public.channel_templates (code, category, body, params) values
  ('verificacao_numero', 'utility', 'Seu código para conectar o número à Tinindo é {{1}}. Vale por 10 minutos.', 1),
  ('confirmacao_agendamento', 'utility', 'Olá, {{1}}! Seu horário de {{2}} está confirmado para {{3}}. Responda SAIR para não receber mais avisos.', 3),
  ('lembrete_agendamento', 'utility', 'Lembrete: {{1}} em {{2}}. Se precisar remarcar, responda esta mensagem.', 2),
  ('link_orcamento', 'utility', 'Olá, {{1}}! Seu orçamento está pronto: {{2}}', 2),
  ('oferta_vaga', 'utility', 'Olá, {{1}}! Abriu um horário de {{2}} em {{3}}. Veja e aceite aqui: {{4}}', 4);

create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  provider text not null check (provider in ('simulated', 'whatsapp_cloud')),
  -- Identidade do número no provedor (phone_number_id na API oficial; no simulado, o próprio E.164).
  external_account_id text not null check (char_length(external_account_id) between 3 and 80),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'pending_verification' check (status in ('pending_verification', 'active', 'disconnected')),
  verified_at timestamptz,
  disconnected_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint channel_connections_verified check ((status = 'active') = (verified_at is not null and disconnected_at is null)),
  unique (tenant_id, id)
);
comment on table public.channel_connections is 'Número do negócio no canal. Um por negócio; um número não serve a dois negócios.';
create unique index channel_connections_one_live_per_tenant on public.channel_connections (tenant_id) where status <> 'disconnected';
create unique index channel_connections_one_business_per_number on public.channel_connections (provider, external_account_id) where status <> 'disconnected';
create trigger channel_connections_touch before update on public.channel_connections for each row execute function app.touch_row();

/** Backend-only: código de verificação em claro para o despacho enviar; o dono só compara pelo hash. */
create table public.channel_verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  connection_id uuid not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  dispatch_status text not null default 'queued' check (dispatch_status in ('queued', 'sending', 'sent', 'failed', 'delivery_unknown')),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint channel_verifications_connection foreign key (tenant_id, connection_id)
    references public.channel_connections (tenant_id, id) on delete restrict
);
comment on table public.channel_verifications is 'Backend-only. Sem acesso pela Data API.';
create index channel_verifications_queue on public.channel_verifications (dispatch_status) where dispatch_status in ('queued', 'sending');

create table public.channel_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  connection_id uuid not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Cadastro do CRM do MESMO negócio (vínculo por telefone ou feito pelo dono). Nunca cruza negócios.
  customer_id uuid,
  -- Nome que o provedor informa no perfil do contato: dado do cliente, não instrução.
  profile_name text check (char_length(profile_name) <= 120),
  handling text not null default 'assistant' check (handling in ('assistant', 'human')),
  opt_in_at timestamptz,
  opt_in_source text check (opt_in_source in ('inbound', 'owner_declared')),
  opted_out_at timestamptz,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint channel_contacts_connection foreign key (tenant_id, connection_id)
    references public.channel_connections (tenant_id, id) on delete restrict,
  constraint channel_contacts_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint channel_contacts_opt_in check ((opt_in_at is null) = (opt_in_source is null)),
  unique (tenant_id, phone_e164),
  unique (tenant_id, id)
);
create index channel_contacts_inbox on public.channel_contacts (tenant_id, last_message_at desc nulls last);
create trigger channel_contacts_touch before update on public.channel_contacts for each row execute function app.touch_row();

create table public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  contact_id uuid not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  kind text not null check (kind in ('text', 'template')),
  body text not null check (char_length(body) between 1 and 4096),
  template_code text references public.channel_templates (code) on delete restrict,
  template_params jsonb check (template_params is null or jsonb_typeof(template_params) = 'array'),
  -- outbound: queued → sending → sent → delivered → read | failed | delivery_unknown. inbound: received.
  status text not null check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'delivery_unknown', 'received')),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  external_event_id text check (char_length(external_event_id) <= 200),
  failure_reason text check (char_length(failure_reason) <= 200),
  attempts integer not null default 0 check (attempts between 0 and 10),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  -- Desde quando o resultado é desconhecido (consulta de status, nunca reenvio).
  unknown_since timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint channel_messages_direction_status check (
    (direction = 'inbound' and status = 'received' and external_event_id is not null)
    or (direction = 'outbound' and status <> 'received')
  ),
  constraint channel_messages_template check ((kind = 'template') = (template_code is not null)),
  constraint channel_messages_contact foreign key (tenant_id, contact_id)
    references public.channel_contacts (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.channel_messages is 'Mensagens do canal. Estados de saída são distintos e só o webhook do provedor avança entregue/lido.';
create unique index channel_messages_provider_id on public.channel_messages (provider_message_id) where provider_message_id is not null;
create unique index channel_messages_inbound_event on public.channel_messages (external_event_id) where direction = 'inbound';
create index channel_messages_conversation on public.channel_messages (tenant_id, contact_id, created_at);
create index channel_messages_queue on public.channel_messages (created_at) where status in ('queued', 'sending', 'delivery_unknown');
create trigger channel_messages_touch before update on public.channel_messages for each row execute function app.touch_row();

/** Deduplicação de webhooks: um evento do provedor entra uma vez, mesmo reenviado. */
create table public.channel_webhook_events (
  provider text not null check (provider in ('simulated', 'whatsapp_cloud')),
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  kind text not null check (kind in ('inbound', 'status')),
  outcome text not null check (outcome in ('applied', 'unmatched_account', 'unmatched_message', 'ignored')),
  received_at timestamptz not null default now(),
  primary key (provider, external_event_id)
);
comment on table public.channel_webhook_events is 'Backend-only. Sem payload: só a chave do evento e o desfecho.';

/** Caixa do telefone SIMULADO (lado do provedor fictício). Backend-only; o dono lê por RPC só em modo simulado. */
create table public.channel_sim_phone (
  id bigint generated always as identity primary key,
  phone_e164 text not null,
  from_account text not null,
  body text not null,
  provider_message_id text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.ch_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.ch_window_open(p_last_inbound timestamptz) returns boolean
language sql immutable set search_path = '' as $$
  select p_last_inbound is not null and p_last_inbound > clock_timestamp() - interval '24 hours'
$$;

create function app.ch_connection_json(c public.channel_connections) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'provider', c.provider, 'phone_e164', c.phone_e164, 'status', c.status,
    'verified_at', app.fin_ts(c.verified_at), 'version', c.version,
    'simulated', c.provider = 'simulated')
$$;

create function app.ch_contact_json(k public.channel_contacts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', k.id, 'phone_e164', k.phone_e164, 'customer_id', k.customer_id, 'profile_name', k.profile_name,
    'handling', k.handling, 'opted_out', k.opted_out_at is not null, 'opt_in_source', k.opt_in_source,
    'window_open', app.ch_window_open(k.last_inbound_at),
    'window_until', case when k.last_inbound_at is null then null else app.sched_ts(k.last_inbound_at + interval '24 hours') end,
    'last_message_at', app.fin_ts(k.last_message_at), 'unread_count', k.unread_count, 'version', k.version)
$$;

create function app.ch_message_json(m public.channel_messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'contact_id', m.contact_id, 'direction', m.direction, 'kind', m.kind, 'body', m.body,
    'template_code', m.template_code, 'status', m.status, 'failure_reason', m.failure_reason,
    'created_at', app.sched_ts(m.created_at), 'sent_at', app.fin_ts(m.sent_at), 'delivered_at', app.fin_ts(m.delivered_at),
    'read_at', app.fin_ts(m.read_at), 'failed_at', app.fin_ts(m.failed_at))
$$;

/** Renderiza um modelo com os parâmetros ({{n}} → texto). Parâmetros são dados: entram como estão. */
create function app.ch_render(p_code text, p_params jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare
  v_t public.channel_templates;
  v_out text;
  i integer;
begin
  select * into v_t from public.channel_templates t where t.code = p_code;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'template_code';
  end if;
  if coalesce(jsonb_array_length(p_params), 0) <> v_t.params then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'template_params';
  end if;
  v_out := v_t.body;
  for i in 1..v_t.params loop
    v_out := replace(v_out, '{{' || i || '}}', left(coalesce(p_params->>(i - 1), ''), 300));
  end loop;
  return v_out;
end $$;

create function app.ch_active_connection(p_tenant_id uuid) returns public.channel_connections
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.channel_connections;
begin
  select * into v_c from public.channel_connections c where c.tenant_id = p_tenant_id and c.status = 'active';
  if not found then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'connection';
  end if;
  return v_c;
end $$;

-- ---------------------------------------------------------------------------
-- Dono: conexão do número
-- ---------------------------------------------------------------------------

create function public.channel_status(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.channel_connections;
begin
  perform app.ch_owner(p_tenant_id);
  select * into v_c from public.channel_connections c where c.tenant_id = p_tenant_id and c.status <> 'disconnected';
  return jsonb_build_object('connection', case when v_c.id is null then null else app.ch_connection_json(v_c) end,
    'queued', (select count(*) from public.channel_messages m where m.tenant_id = p_tenant_id and m.status in ('queued', 'sending')),
    'unknown', (select count(*) from public.channel_messages m where m.tenant_id = p_tenant_id and m.status = 'delivery_unknown'),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'category', t.category, 'body', t.body, 'params', t.params,
        'approved', coalesce(v_c.provider, 'simulated') = any (t.approved_providers)) order by t.code), '[]'::jsonb)
      from public.channel_templates t));
end $$;

/** Registra o número e enfileira o código de verificação pelo próprio canal. Repetir devolve a mesma conexão. */
create function public.channel_connect(
  p_tenant_id uuid,
  p_provider text,
  p_phone_e164 text,
  p_external_account_id text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.channel_connections;
  v_code text;
  v_body jsonb;
begin
  perform app.ch_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'channel.connect', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_provider is null or p_provider not in ('simulated', 'whatsapp_cloud') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'provider';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'phone_e164';
  end if;
  if exists (select 1 from public.channel_connections c where c.tenant_id = p_tenant_id and c.status <> 'disconnected') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'connection';
  end if;
  begin
    insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, created_by)
    values (p_tenant_id, p_provider, coalesce(nullif(btrim(p_external_account_id), ''), p_phone_e164), p_phone_e164, v_uid)
    returning * into v_c;
  exception when unique_violation then
    -- O número já é de outro negócio: não revelar qual.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'phone_e164';
  end;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.channel_verifications (tenant_id, connection_id, code, code_hash, expires_at)
  values (p_tenant_id, v_c.id, v_code, app.token_sha256(v_code), clock_timestamp() + interval '10 minutes');
  v_body := jsonb_build_object('connection', app.ch_connection_json(v_c));
  perform app.audit(p_tenant_id, 'channel.connect', 'channel_connection', v_c.id, p_request_id, null,
    jsonb_build_object('provider', v_c.provider));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'channel.connect', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.channel_verify(
  p_tenant_id uuid,
  p_code text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.channel_connections;
  v_v public.channel_verifications;
  v_body jsonb;
begin
  perform app.ch_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'channel.verify', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_c from public.channel_connections c where c.tenant_id = p_tenant_id and c.status = 'pending_verification' for update;
  if not found then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'connection';
  end if;
  select * into v_v from public.channel_verifications v where v.connection_id = v_c.id and v.used_at is null
  order by v.created_at desc limit 1 for update;
  if not found or v_v.expires_at <= clock_timestamp() or v_v.attempts >= 5 then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'expired';
  end if;
  if p_code is null or app.token_sha256(btrim(p_code)) <> v_v.code_hash then
    -- Sem RAISE: a tentativa precisa ficar gravada (um erro desfaria a contagem). O handler traduz o envelope 4xx.
    update public.channel_verifications v set attempts = v.attempts + 1 where v.id = v_v.id;
    perform app.idempotency_complete(p_tenant_id, v_uid, 'channel.verify', p_idem_key, 422, null);
    return jsonb_build_object('status_code', 422, 'error', 'POLICY_REJECTED', 'field', 'code');
  end if;
  update public.channel_verifications v set used_at = clock_timestamp() where v.id = v_v.id;
  update public.channel_connections c set status = 'active', verified_at = clock_timestamp() where c.id = v_c.id returning * into v_c;
  v_body := jsonb_build_object('connection', app.ch_connection_json(v_c));
  perform app.audit(p_tenant_id, 'channel.verify', 'channel_connection', v_c.id, p_request_id, null, null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'channel.verify', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.channel_disconnect(
  p_tenant_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.channel_connections;
  v_body jsonb;
begin
  perform app.ch_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'channel.disconnect', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_c from public.channel_connections c where c.tenant_id = p_tenant_id and c.status <> 'disconnected' for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  update public.channel_connections c set status = 'disconnected', verified_at = null, disconnected_at = clock_timestamp()
  where c.id = v_c.id returning * into v_c;
  -- Nada em fila sai depois de desconectar.
  update public.channel_messages m set status = 'failed', failure_reason = 'disconnected', failed_at = clock_timestamp()
  where m.tenant_id = p_tenant_id and m.status in ('queued', 'sending');
  v_body := jsonb_build_object('connection', app.ch_connection_json(v_c));
  perform app.audit(p_tenant_id, 'channel.disconnect', 'channel_connection', v_c.id, p_request_id, null, null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'channel.disconnect', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: caixa de entrada, conversa, envio, transferência, vínculo e opt-out
-- ---------------------------------------------------------------------------

create function public.channel_inbox(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.ch_owner(p_tenant_id);
  return jsonb_build_object('contacts', coalesce((select jsonb_agg(app.ch_contact_json(k) || jsonb_build_object(
      'customer_name', (select c.name from public.customers c where c.tenant_id = k.tenant_id and c.id = k.customer_id),
      'last_message', (select jsonb_build_object('direction', m.direction, 'body', left(m.body, 80), 'status', m.status)
        from public.channel_messages m where m.tenant_id = k.tenant_id and m.contact_id = k.id order by m.created_at desc limit 1))
      order by k.last_message_at desc nulls last)
    from (select * from public.channel_contacts k where k.tenant_id = p_tenant_id order by k.last_message_at desc nulls last limit 200) k),
    '[]'::jsonb));
end $$;

/** Mensagens de um contato (até 200, mais recentes). Zera as não lidas. */
create function public.channel_conversation(p_tenant_id uuid, p_contact_id uuid) returns jsonb
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
            order by m.created_at desc limit 200) m), '[]'::jsonb));
end $$;

/**
 * Envio pelo dono (ou por outro módulo, como as réguas do P13). Texto livre só com a janela de 24 h aberta; modelo
 * só se aprovado no provedor e com janela aberta ou opt-in. Opt-out bloqueia. A mensagem nasce 'queued':
 * enviada mesmo só quando o despacho confirmar.
 */
create function public.channel_send(
  p_tenant_id uuid,
  p_contact_id uuid,
  p_kind text,
  p_text text,
  p_template_code text,
  p_template_params jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.channel_connections;
  v_k public.channel_contacts;
  v_body_text text;
  v_m public.channel_messages;
  v_body jsonb;
begin
  perform app.ch_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'message.send', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_c := app.ch_active_connection(p_tenant_id);
  select * into v_k from public.channel_contacts k where k.tenant_id = p_tenant_id and k.id = p_contact_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'contact_id';
  end if;
  if v_k.opted_out_at is not null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'opted_out';
  end if;
  if p_kind = 'text' then
    if p_text is null or char_length(btrim(p_text)) not between 1 and 4096 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'text';
    end if;
    if not app.ch_window_open(v_k.last_inbound_at) then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'window';
    end if;
    v_body_text := btrim(p_text);
  elsif p_kind = 'template' then
    if not exists (select 1 from public.channel_templates t where t.code = p_template_code and v_c.provider = any (t.approved_providers)) then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'template_code';
    end if;
    if not app.ch_window_open(v_k.last_inbound_at) and v_k.opt_in_at is null then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'opt_in';
    end if;
    v_body_text := app.ch_render(p_template_code, coalesce(p_template_params, '[]'::jsonb));
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
  end if;
  insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, template_code, template_params, status, created_by)
  values (p_tenant_id, v_k.id, 'outbound', p_kind, v_body_text, case when p_kind = 'template' then p_template_code end,
    case when p_kind = 'template' then coalesce(p_template_params, '[]'::jsonb) end, 'queued', v_uid)
  returning * into v_m;
  update public.channel_contacts k set last_message_at = v_m.created_at where k.id = v_k.id;
  v_body := jsonb_build_object('message', app.ch_message_json(v_m));
  perform app.audit(p_tenant_id, 'message.send', 'channel_message', v_m.id, p_request_id, null,
    jsonb_build_object('kind', v_m.kind, 'template_code', v_m.template_code));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'message.send', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.channel_handoff(
  p_tenant_id uuid,
  p_contact_id uuid,
  p_handling text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_k public.channel_contacts;
  v_body jsonb;
begin
  perform app.ch_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'conversation.handoff', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_handling is null or p_handling not in ('assistant', 'human') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'handling';
  end if;
  update public.channel_contacts k set handling = p_handling where k.tenant_id = p_tenant_id and k.id = p_contact_id returning * into v_k;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_body := jsonb_build_object('contact', app.ch_contact_json(v_k));
  perform app.audit(p_tenant_id, 'conversation.handoff', 'channel_contact', v_k.id, p_request_id, null, jsonb_build_object('handling', p_handling));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'conversation.handoff', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.channel_contact_link(
  p_tenant_id uuid,
  p_contact_id uuid,
  p_customer_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_k public.channel_contacts;
  v_body jsonb;
begin
  perform app.ch_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'contact.link', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_customer_id is not null then
    perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
    end if;
  end if;
  update public.channel_contacts k set customer_id = p_customer_id where k.tenant_id = p_tenant_id and k.id = p_contact_id returning * into v_k;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_body := jsonb_build_object('contact', app.ch_contact_json(v_k));
  perform app.audit(p_tenant_id, 'contact.link', 'channel_contact', v_k.id, p_request_id, null, jsonb_build_object('customer_id', p_customer_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'contact.link', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Opt-in/opt-out declarados pelo dono (o cliente pediu pessoalmente). Opt-out do próprio cliente vem pelo webhook. */
create function public.channel_contact_consent(
  p_tenant_id uuid,
  p_contact_id uuid,
  p_opted_in boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_k public.channel_contacts;
  v_body jsonb;
begin
  perform app.ch_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'contact.consent', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_opted_in then
    update public.channel_contacts k set opted_out_at = null, opt_in_at = coalesce(k.opt_in_at, clock_timestamp()),
      opt_in_source = coalesce(k.opt_in_source, 'owner_declared')
    where k.tenant_id = p_tenant_id and k.id = p_contact_id returning * into v_k;
  else
    update public.channel_contacts k set opted_out_at = coalesce(k.opted_out_at, clock_timestamp())
    where k.tenant_id = p_tenant_id and k.id = p_contact_id returning * into v_k;
  end if;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_body := jsonb_build_object('contact', app.ch_contact_json(v_k));
  perform app.audit(p_tenant_id, 'contact.consent', 'channel_contact', v_k.id, p_request_id, null, jsonb_build_object('opted_in', p_opted_in));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'contact.consent', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Telefone simulado: o que o provedor fictício "entregou" ao número. Só para conexão simulada; rotulado na tela. */
create function public.channel_sim_phone(p_tenant_id uuid, p_phone_e164 text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.channel_connections;
begin
  perform app.ch_owner(p_tenant_id);
  select * into v_c from public.channel_connections c where c.tenant_id = p_tenant_id and c.status <> 'disconnected';
  if not found or v_c.provider <> 'simulated' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'provider';
  end if;
  return jsonb_build_object('phone_e164', p_phone_e164, 'messages', coalesce((select jsonb_agg(jsonb_build_object('body', s.body,
      'provider_message_id', s.provider_message_id, 'created_at', app.sched_ts(s.created_at)) order by s.created_at)
    from (select * from public.channel_sim_phone s where s.phone_e164 = p_phone_e164 and s.from_account = v_c.external_account_id
          order by s.created_at desc limit 50) s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Backend (service_role): despacho e webhook
-- ---------------------------------------------------------------------------

/** Reserva mensagens e verificações em fila para o despacho (SKIP LOCKED). Devolve o que o provedor precisa. */
create function public.channel_dispatch_claim(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb := '[]';
  r record;
begin
  for r in
    update public.channel_messages m set status = 'sending', attempts = m.attempts + 1
    where m.id in (select x.id from public.channel_messages x where x.status = 'queued' order by x.created_at
                   limit least(greatest(coalesce(p_batch, 50), 1), 200) for update skip locked)
    returning m.id, m.tenant_id, m.contact_id, m.body, m.kind, m.template_code, m.template_params
  loop
    v_items := v_items || jsonb_build_array((select jsonb_build_object('ref', 'msg:' || r.id, 'provider', c.provider,
      'external_account_id', c.external_account_id, 'to', k.phone_e164, 'body', r.body, 'kind', r.kind,
      'template_code', r.template_code, 'template_params', r.template_params)
      from public.channel_contacts k join public.channel_connections c on c.id = k.connection_id where k.id = r.contact_id));
  end loop;
  for r in
    update public.channel_verifications v set dispatch_status = 'sending'
    where v.id in (select x.id from public.channel_verifications x where x.dispatch_status = 'queued' and x.expires_at > clock_timestamp()
                   order by x.created_at limit 20 for update skip locked)
    returning v.id, v.connection_id, v.code
  loop
    v_items := v_items || jsonb_build_array((select jsonb_build_object('ref', 'ver:' || r.id, 'provider', c.provider,
      'external_account_id', c.external_account_id, 'to', c.phone_e164, 'body', app.ch_render('verificacao_numero', jsonb_build_array(r.code)),
      'kind', 'template', 'template_code', 'verificacao_numero', 'template_params', jsonb_build_array(r.code))
      from public.channel_connections c where c.id = r.connection_id));
  end loop;
  return jsonb_build_object('items', v_items);
end $$;

/** Resultado do provedor para um item: sent (com id), failed (motivo) ou delivery_unknown (resultado desconhecido). */
create function public.channel_dispatch_result(p_ref text, p_outcome text, p_provider_message_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_m public.channel_messages;
begin
  if p_outcome not in ('sent', 'failed', 'delivery_unknown') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'outcome';
  end if;
  v_id := split_part(p_ref, ':', 2)::uuid;
  if p_ref like 'ver:%' then
    update public.channel_verifications v set dispatch_status = p_outcome where v.id = v_id;
    return jsonb_build_object('ref', p_ref, 'status', p_outcome);
  end if;
  select * into v_m from public.channel_messages m where m.id = v_id and m.status in ('sending', 'delivery_unknown') for update;
  if not found then
    return jsonb_build_object('ref', p_ref, 'status', 'ignored');
  end if;
  update public.channel_messages m
  set status = p_outcome,
      provider_message_id = coalesce(p_provider_message_id, m.provider_message_id),
      sent_at = case when p_outcome = 'sent' then clock_timestamp() else m.sent_at end,
      failed_at = case when p_outcome = 'failed' then clock_timestamp() else m.failed_at end,
      failure_reason = case when p_outcome = 'failed' then left(p_reason, 200) else m.failure_reason end,
      unknown_since = case when p_outcome = 'delivery_unknown' then coalesce(m.unknown_since, clock_timestamp()) else null end
  where m.id = v_m.id returning * into v_m;
  if p_outcome = 'failed' then
    perform app.emit_event(v_m.tenant_id, 'channel.message.failed.v1', v_m.id, v_m.version, gen_random_uuid(),
      jsonb_build_object('message_id', v_m.id, 'contact_id', v_m.contact_id, 'reason', v_m.failure_reason));
  end if;
  return jsonb_build_object('ref', p_ref, 'status', v_m.status);
end $$;

/** Mensagens com resultado desconhecido há mais de 1 minuto: candidatas à consulta de status (nunca reenvio). */
create function public.channel_dispatch_unknown(p_batch integer default 50) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('ref', 'msg:' || m.id, 'provider', c.provider,
      'external_account_id', c.external_account_id, 'provider_message_id', m.provider_message_id))
    from (select * from public.channel_messages m where m.status = 'delivery_unknown' and m.unknown_since < clock_timestamp() - interval '1 minute'
          order by m.unknown_since limit least(greatest(coalesce(p_batch, 50), 1), 200)) m
    join public.channel_contacts k on k.id = m.contact_id
    join public.channel_connections c on c.id = k.connection_id), '[]'::jsonb))
$$;

/** Provedor simulado "entregou" ao telefone: guarda na caixa fictícia. */
create function public.channel_sim_deliver(p_phone_e164 text, p_from_account text, p_body text, p_provider_message_id text) returns void
language sql security definer set search_path = '' as $$
  insert into public.channel_sim_phone (phone_e164, from_account, body, provider_message_id)
  values (p_phone_e164, p_from_account, left(p_body, 4096), p_provider_message_id)
$$;

/**
 * Ingestão de eventos já normalizados pela função (assinatura conferida lá). Cada evento:
 * {external_event_id, kind: 'inbound'|'status', external_account_id, phone_e164, provider_message_id, text, profile_name,
 *  status: 'sent'|'delivered'|'read'|'failed', reason}. Deduplica por (provider, external_event_id).
 */
create function public.channel_webhook_ingest(p_provider text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  v_c public.channel_connections;
  v_k public.channel_contacts;
  v_m public.channel_messages;
  v_outcome text;
  v_applied integer := 0;
  v_dupes integer := 0;
  v_text text;
  v_optout boolean;
begin
  if p_provider not in ('simulated', 'whatsapp_cloud') or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'events';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if coalesce(e->>'external_event_id', '') = '' or coalesce(e->>'kind', '') not in ('inbound', 'status') then
      continue;
    end if;
    insert into public.channel_webhook_events (provider, external_event_id, kind, outcome)
    values (p_provider, left(e->>'external_event_id', 200), e->>'kind', 'ignored')
    on conflict do nothing;
    if not found then
      v_dupes := v_dupes + 1;
      continue;
    end if;
    v_outcome := 'ignored';
    select * into v_c from public.channel_connections c where c.provider = p_provider and c.external_account_id = e->>'external_account_id'
      and c.status = 'active';
    if not found then
      v_outcome := 'unmatched_account';
    elsif e->>'kind' = 'inbound' then
      v_text := left(coalesce(e->>'text', ''), 4096);
      if v_text = '' or coalesce(e->>'phone_e164', '') !~ '^\+[1-9][0-9]{7,14}$' then
        v_outcome := 'ignored';
      else
        insert into public.channel_contacts (tenant_id, connection_id, phone_e164, customer_id, profile_name, opt_in_at, opt_in_source, last_inbound_at, last_message_at, unread_count)
        values (v_c.tenant_id, v_c.id, e->>'phone_e164',
          (select c.id from public.customers c where c.tenant_id = v_c.tenant_id and c.phone = e->>'phone_e164' and c.archived_at is null
           order by c.created_at limit 1),
          left(e->>'profile_name', 120), clock_timestamp(), 'inbound', clock_timestamp(), clock_timestamp(), 1)
        on conflict (tenant_id, phone_e164) do update
          set last_inbound_at = clock_timestamp(), last_message_at = clock_timestamp(),
              profile_name = coalesce(excluded.profile_name, public.channel_contacts.profile_name),
              opt_in_at = coalesce(public.channel_contacts.opt_in_at, clock_timestamp()),
              opt_in_source = coalesce(public.channel_contacts.opt_in_source, 'inbound'),
              unread_count = public.channel_contacts.unread_count + 1
        returning * into v_k;
        -- Opt-out pelo próprio cliente: palavras fixas, qualquer caixa; o resto do texto é dado.
        v_optout := upper(btrim(v_text)) in ('SAIR', 'PARAR', 'STOP', 'CANCELAR');
        if v_optout then
          update public.channel_contacts k set opted_out_at = coalesce(k.opted_out_at, clock_timestamp()) where k.id = v_k.id returning * into v_k;
        end if;
        insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, status, external_event_id)
        values (v_c.tenant_id, v_k.id, 'inbound', 'text', v_text, 'received', left(e->>'external_event_id', 200))
        returning * into v_m;
        perform app.emit_event(v_c.tenant_id, 'channel.message.received.v1', v_m.id, 1, gen_random_uuid(),
          jsonb_build_object('message_id', v_m.id, 'contact_id', v_k.id, 'customer_id', v_k.customer_id, 'handling', v_k.handling,
            'opted_out', v_optout));
        v_outcome := 'applied';
      end if;
    else
      select * into v_m from public.channel_messages m where m.provider_message_id = e->>'provider_message_id' and m.direction = 'outbound' for update;
      if not found then
        v_outcome := 'unmatched_message';
      else
        -- Só avança: lido não volta a entregue; entregue não volta a enviado. Falha é final.
        if e->>'status' = 'delivered' and v_m.status in ('sent', 'delivery_unknown') then
          update public.channel_messages m set status = 'delivered', delivered_at = clock_timestamp() where m.id = v_m.id;
          v_outcome := 'applied';
        elsif e->>'status' = 'read' and v_m.status in ('sent', 'delivered', 'delivery_unknown') then
          update public.channel_messages m set status = 'read', delivered_at = coalesce(m.delivered_at, clock_timestamp()), read_at = clock_timestamp() where m.id = v_m.id;
          v_outcome := 'applied';
        elsif e->>'status' = 'failed' and v_m.status in ('sent', 'delivery_unknown', 'sending') then
          update public.channel_messages m set status = 'failed', failed_at = clock_timestamp(), failure_reason = left(coalesce(e->>'reason', 'provider'), 200)
          where m.id = v_m.id returning * into v_m;
          perform app.emit_event(v_m.tenant_id, 'channel.message.failed.v1', v_m.id, v_m.version, gen_random_uuid(),
            jsonb_build_object('message_id', v_m.id, 'contact_id', v_m.contact_id, 'reason', v_m.failure_reason));
          v_outcome := 'applied';
        elsif e->>'status' = 'sent' and v_m.status in ('sending', 'delivery_unknown') then
          update public.channel_messages m set status = 'sent', sent_at = coalesce(m.sent_at, clock_timestamp()) where m.id = v_m.id;
          v_outcome := 'applied';
        end if;
      end if;
    end if;
    update public.channel_webhook_events w set outcome = v_outcome where w.provider = p_provider and w.external_event_id = left(e->>'external_event_id', 200);
    if v_outcome = 'applied' then v_applied := v_applied + 1; end if;
  end loop;
  return jsonb_build_object('applied', v_applied, 'duplicates', v_dupes);
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.ch_owner(uuid) from public;
revoke all on function app.ch_window_open(timestamptz) from public;
revoke all on function app.ch_connection_json(public.channel_connections) from public;
revoke all on function app.ch_contact_json(public.channel_contacts) from public;
revoke all on function app.ch_message_json(public.channel_messages) from public;
revoke all on function app.ch_render(text, jsonb) from public;
revoke all on function app.ch_active_connection(uuid) from public;

revoke all on function public.channel_status(uuid) from public, anon;
revoke all on function public.channel_connect(uuid, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.channel_verify(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.channel_disconnect(uuid, text, text, uuid) from public, anon;
revoke all on function public.channel_inbox(uuid) from public, anon;
revoke all on function public.channel_conversation(uuid, uuid) from public, anon;
revoke all on function public.channel_send(uuid, uuid, text, text, text, jsonb, text, text, uuid) from public, anon;
revoke all on function public.channel_handoff(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.channel_contact_link(uuid, uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.channel_contact_consent(uuid, uuid, boolean, text, text, uuid) from public, anon;
revoke all on function public.channel_sim_phone(uuid, text) from public, anon;
revoke all on function public.channel_dispatch_claim(integer) from public, anon, authenticated;
revoke all on function public.channel_dispatch_result(text, text, text, text) from public, anon, authenticated;
revoke all on function public.channel_dispatch_unknown(integer) from public, anon, authenticated;
revoke all on function public.channel_sim_deliver(text, text, text, text) from public, anon, authenticated;
revoke all on function public.channel_webhook_ingest(text, jsonb) from public, anon, authenticated;

grant execute on function public.channel_status(uuid) to authenticated;
grant execute on function public.channel_connect(uuid, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.channel_verify(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.channel_disconnect(uuid, text, text, uuid) to authenticated;
grant execute on function public.channel_inbox(uuid) to authenticated;
grant execute on function public.channel_conversation(uuid, uuid) to authenticated;
grant execute on function public.channel_send(uuid, uuid, text, text, text, jsonb, text, text, uuid) to authenticated;
grant execute on function public.channel_handoff(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.channel_contact_link(uuid, uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.channel_contact_consent(uuid, uuid, boolean, text, text, uuid) to authenticated;
grant execute on function public.channel_sim_phone(uuid, text) to authenticated;
grant execute on function public.channel_dispatch_claim(integer) to service_role;
grant execute on function public.channel_dispatch_result(text, text, text, text) to service_role;
grant execute on function public.channel_dispatch_unknown(integer) to service_role;
grant execute on function public.channel_sim_deliver(text, text, text, text) to service_role;
grant execute on function public.channel_webhook_ingest(text, jsonb) to service_role;

alter table public.channel_templates enable row level security;
alter table public.channel_connections enable row level security;
alter table public.channel_verifications enable row level security;
alter table public.channel_contacts enable row level security;
alter table public.channel_messages enable row level security;
alter table public.channel_webhook_events enable row level security;
alter table public.channel_sim_phone enable row level security;

revoke all on public.channel_templates, public.channel_connections, public.channel_verifications, public.channel_contacts,
  public.channel_messages, public.channel_webhook_events, public.channel_sim_phone from anon, authenticated;
grant select on public.channel_templates, public.channel_connections, public.channel_contacts, public.channel_messages to authenticated;
grant select, insert, update on public.channel_templates, public.channel_connections, public.channel_verifications, public.channel_contacts,
  public.channel_messages, public.channel_webhook_events to service_role;
grant select, insert on public.channel_sim_phone to service_role;

create policy channel_templates_select on public.channel_templates for select to authenticated using (true);
create policy channel_connections_select_owner on public.channel_connections
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy channel_contacts_select_owner on public.channel_contacts
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy channel_messages_select_owner on public.channel_messages
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
-- channel_verifications, channel_webhook_events e channel_sim_phone: RLS ligada e nenhuma política para usuários.
