-- Integrações reais, bloco 2 · WhatsApp oficial pela Cloud API da Meta (release/WHATSAPP.md; ADR-0017).
-- O P12 já tinha a porta, a fila, o webhook deduplicado e os estados. Aqui o canal fica pronto para ligar a Meta:
-- 1. Modelos na Meta: cada modelo ganha nome, categoria, idioma, corpo com {{1}}…{{n}} e a origem de cada variável
--    ({{1}} = nome do negócio, as demais na ordem dos parâmetros do app). O despacho manda os parâmetros na ordem da
--    Meta (provider_template). Códigos (verificação do número e da reserva) são da categoria AUTHENTICATION da Meta,
--    que tem texto fixo e só aceita o código como variável. Aprovação = approved_providers, marcada pelo operador com
--    channel_template_set_approval (backend), nunca pela tela.
-- 2. Número da Meta: phone_number_id obrigatório (só dígitos) e o código de verificação vai para o WhatsApp PESSOAL do
--    dono (a Meta não entrega mensagem do número para ele mesmo). O estado do envio do código aparece no status.
-- 3. Limite e retentativa pela fila que já existe: 'retry' (429 e códigos de limite da Graph) volta para 'queued' com
--    espera crescente (next_attempt_at) e teto de tentativas; 'requeue' (o número já bateu o limite nesta rodada)
--    volta sem gastar tentativa. Teto de envios por número por rodada. 5xx/timeout seguem 'delivery_unknown' sem
--    reenvio (regra do P12).
-- 4. Opt-out no servidor: SAIR/PARAR/STOP/CANCELAR (qualquer caixa, com pontuação em volta) falha na hora o que estava
--    na fila daquele contato; o despacho confere de novo antes de entregar ao provedor (nada sai para quem saiu).
-- 5. Estados: status da Meta que chega ANTES do despacho gravar o id da mensagem fica guardado (sem payload) e é
--    aplicado quando o id chega. Enviado ≠ entregue ≠ lido; status fora de ordem não regride; falha é final.
-- Última definição de cada função redefinida aqui: channel_connect, channel_status, channel_webhook_ingest (P12
-- 20261022120000), channel_dispatch_claim (P55 20261120091000), channel_dispatch_result (P43 20261026164500),
-- app.ch_connection_json, app.ch_message_json (P12).

-- ---------------------------------------------------------------------------
-- Regras do despacho (um lugar só)
-- ---------------------------------------------------------------------------

/** Teto por número por rodada, teto de tentativas e espera crescente (segundos) da retentativa por limite. */
create function app.ch_dispatch_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('per_number', 20, 'max_attempts', 5, 'backoff_base_seconds', 60, 'backoff_max_seconds', 1800,
    'requeue_seconds', 60)
$$;
comment on function app.ch_dispatch_rules() is 'Despacho do canal: 20 envios por número por rodada; limite = 5 tentativas, espera 60 s × 2^(n-1) até 30 min.';

-- ---------------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------------

alter table public.channel_messages add column next_attempt_at timestamptz;
comment on column public.channel_messages.next_attempt_at is 'Fila: a partir de quando a mensagem pode sair de novo (retentativa por limite do provedor). NULL = já.';
create index channel_messages_due on public.channel_messages (next_attempt_at) where status = 'queued';

alter table public.channel_verifications
  add column send_to text check (send_to ~ '^\+[1-9][0-9]{7,14}$'),
  add column failure_reason text check (char_length(failure_reason) <= 200);
comment on column public.channel_verifications.send_to is 'Para onde o código vai. NULL = o próprio número (simulado). Na Meta, o WhatsApp pessoal do dono.';

-- Status de mensagem que ainda não tem o id do provedor gravado (o webhook chegou antes do resultado do despacho):
-- guarda só o id, o estado e o motivo, sem telefone nem texto.
alter table public.channel_webhook_events
  add column provider_message_id text check (char_length(provider_message_id) <= 200),
  add column status text check (status in ('sent', 'delivered', 'read', 'failed')),
  add column reason text check (char_length(reason) <= 200);
create index channel_webhook_events_pending on public.channel_webhook_events (provider_message_id) where outcome = 'unmatched_message';

alter table public.channel_templates
  add column meta_name text check (meta_name ~ '^[a-z0-9_]+$' and char_length(meta_name) <= 512),
  add column meta_category text check (meta_category in ('utility', 'marketing', 'authentication')),
  add column meta_language text not null default 'pt_BR' check (meta_language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  add column meta_body text check (char_length(meta_body) between 1 and 1024),
  -- Origem de cada variável da Meta, na ordem {{1}}, {{2}}…: 0 = nome do negócio; k = k-ésimo parâmetro do app.
  add column meta_params integer[] check (cardinality(meta_params) between 1 and 10 and 0 <= all (meta_params) and 10 >= all (meta_params)),
  add constraint channel_templates_meta check (
    (meta_name is null) = (meta_body is null) and (meta_name is null) = (meta_params is null) and (meta_name is null) = (meta_category is null));
comment on column public.channel_templates.meta_body is 'Corpo como cadastrado na Meta ({{1}} = negócio nos modelos ao cliente). Tabela completa: docs/handoffs/INTEGRACOES-REAIS-claude.md.';

-- O corpo do modelo na Meta não pode terminar em variável: os dois que terminavam no link ganham uma frase.
update public.channel_templates set body = 'Olá, {{1}}! {{negocio}} preparou seu orçamento. Veja e responda pelo link: {{2}} Se tiver dúvida, responda esta mensagem.'
where code = 'link_orcamento';
update public.channel_templates set body = 'Olá, {{1}}! Abriu um horário de {{2}} em {{3}} com {{negocio}}. Veja e aceite aqui: {{4}} Se não puder, é só ignorar.'
where code = 'oferta_vaga';

-- Modelos na Meta (texto do app = texto da Meta com {{1}} = negócio; o teste confere a equivalência).
update public.channel_templates t set meta_name = m.code, meta_category = m.cat, meta_body = m.body, meta_params = m.params
from (values
  ('verificacao_numero', 'authentication', '{{1}} é seu código de verificação.', '{1}'::integer[]),
  ('codigo_reserva', 'authentication', '{{1}} é seu código de verificação.', '{3}'),
  ('confirmacao_agendamento', 'utility', 'Olá, {{2}}! {{1}} confirmou seu horário de {{3}} em {{4}}. Para remarcar, responda aqui. Responda SAIR para não receber mais avisos.', '{0,1,2,3}'),
  ('lembrete_agendamento', 'utility', 'Lembrete de {{1}}: {{2}} em {{3}}. Se precisar remarcar, responda esta mensagem.', '{0,1,2}'),
  ('link_orcamento', 'utility', 'Olá, {{2}}! {{1}} preparou seu orçamento. Veja e responda pelo link: {{3}} Se tiver dúvida, responda esta mensagem.', '{0,1,2}'),
  ('oferta_vaga', 'utility', 'Olá, {{2}}! Abriu um horário de {{3}} em {{4}} com {{1}}. Veja e aceite aqui: {{5}} Se não puder, é só ignorar.', '{0,1,2,3,4}'),
  ('lembrete_orcamento', 'utility', 'Olá, {{2}}! Seu orçamento de {{3}} com {{1}} continua disponível até {{4}}. Se tiver dúvida, responda esta mensagem.', '{0,1,2,3}'),
  ('lembrete_cobranca', 'utility', 'Olá, {{2}}! Aqui é {{1}}. Ficou em aberto {{3}} de {{4}}. Se já pagou, desconsidere. Dúvidas, responda aqui.', '{0,1,2,3}'),
  ('pacote_vencendo', 'utility', 'Olá, {{2}}! Aqui é {{1}}. Seu pacote de {{3}} ainda tem {{4}} e vale até {{5}}. Quer marcar? Responda esta mensagem.', '{0,1,2,3,4}'),
  -- Estes dois já recebem o nome do negócio como 2º parâmetro do app: na Meta ele vira {{1}}.
  ('reativacao', 'marketing', 'Olá, {{2}}! Faz tempo que não nos vemos no {{1}}. Quer agendar um horário? Responda SAIR para não receber mais convites.', '{2,1}'),
  ('oferta_campanha', 'marketing', 'Olá, {{2}}! {{1}} tem uma oferta para você: {{3}}. Vale até {{4}}. Responda SAIR para não receber mais convites.', '{2,1,3,4}')
) as m(code, cat, body, params)
where t.code = m.code;

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

/** Nome do negócio como entra nas mensagens (o mesmo de app.ch_fill_business, P55). */
create function app.ch_business_name(p_tenant_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select left(coalesce((select t.name from public.tenants t where t.id = p_tenant_id), 'seu profissional'), 120)
$$;

/** Modelo pode sair por este provedor: aprovado nele e, na Meta, com o cadastro do modelo. */
create function app.ch_template_ready(p_code text, p_provider text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.channel_templates t where t.code = p_code and p_provider = any (t.approved_providers)
    and (p_provider = 'simulated' or t.meta_name is not null))
$$;

/** Parâmetros na ordem da Meta: 0 = nome do negócio, k = k-ésimo parâmetro do app. Parâmetro é dado, entra como está. */
create function app.ch_meta_values(p_meta_params integer[], p_business text, p_params jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(case when s.src = 0 then p_business else left(coalesce(p_params->>(s.src - 1), ''), 300) end order by s.ord), '[]'::jsonb)
  from unnest(p_meta_params) with ordinality as s(src, ord)
$$;

/** O que o provedor real precisa para mandar o modelo. NULL no simulado (ele usa o texto já pronto). */
create function app.ch_provider_template(p_provider text, p_code text, p_tenant_id uuid, p_params jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_provider = 'simulated' or p_code is null then null else (
    select jsonb_build_object('name', t.meta_name, 'language', t.meta_language, 'category', t.meta_category,
      'params', app.ch_meta_values(t.meta_params, app.ch_business_name(p_tenant_id), coalesce(p_params, '[]'::jsonb)))
    from public.channel_templates t where t.code = p_code and t.meta_name is not null) end
$$;

/** Corpo com {{n}} trocado pelos valores (para conferir que o texto do app = texto da Meta). */
create function app.ch_fill_numbered(p_body text, p_values jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_out text := p_body;
  i integer;
begin
  for i in reverse coalesce(jsonb_array_length(p_values), 0)..1 loop
    v_out := replace(v_out, '{{' || i || '}}', coalesce(p_values->>(i - 1), ''));
  end loop;
  return v_out;
end $$;

/** Falha uma mensagem de saída com motivo (final) e avisa os consumidores. */
create function app.ch_fail_message(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.channel_messages;
begin
  update public.channel_messages m set status = 'failed', failed_at = clock_timestamp(), failure_reason = left(p_reason, 200), next_attempt_at = null
  where m.id = p_id and m.direction = 'outbound' and m.status not in ('failed', 'delivered', 'read', 'received') returning * into v_m;
  if found then
    perform app.emit_event(v_m.tenant_id, 'channel.message.failed.v1', v_m.id, v_m.version, gen_random_uuid(),
      jsonb_build_object('message_id', v_m.id, 'contact_id', v_m.contact_id, 'reason', v_m.failure_reason));
  end if;
end $$;

/**
 * Estado do provedor para uma mensagem de saída. Só avança: enviado → entregue → lido; lido não volta a entregue;
 * entregue não volta a enviado; falha é final (e não vem depois de entregue/lido). true = aplicado.
 */
create function app.ch_apply_status(p_id uuid, p_status text, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.channel_messages;
begin
  select * into v_m from public.channel_messages m where m.id = p_id and m.direction = 'outbound' for update;
  if not found then return false; end if;
  if p_status = 'delivered' and v_m.status in ('sent', 'delivery_unknown') then
    update public.channel_messages m set status = 'delivered', delivered_at = clock_timestamp(), sent_at = coalesce(m.sent_at, clock_timestamp()) where m.id = v_m.id;
  elsif p_status = 'read' and v_m.status in ('sent', 'delivered', 'delivery_unknown') then
    update public.channel_messages m set status = 'read', sent_at = coalesce(m.sent_at, clock_timestamp()),
      delivered_at = coalesce(m.delivered_at, clock_timestamp()), read_at = clock_timestamp() where m.id = v_m.id;
  elsif p_status = 'failed' and v_m.status in ('sent', 'delivery_unknown', 'sending') then
    perform app.ch_fail_message(v_m.id, coalesce(p_reason, 'provider'));
  elsif p_status = 'sent' and v_m.status in ('sending', 'delivery_unknown') then
    update public.channel_messages m set status = 'sent', sent_at = coalesce(m.sent_at, clock_timestamp()), unknown_since = null where m.id = v_m.id;
  else
    return false;
  end if;
  return true;
end $$;

/** Palavra de saída da própria cliente: SAIR, PARAR, STOP ou CANCELAR, em qualquer caixa e com pontuação em volta. */
create function app.ch_is_opt_out(p_text text) returns boolean
language sql immutable set search_path = '' as $$
  select regexp_replace(upper(coalesce(p_text, '')), '^[[:space:][:punct:]]+|[[:space:][:punct:]]+$', '', 'g')
    in ('SAIR', 'PARAR', 'STOP', 'CANCELAR')
$$;

create or replace function app.ch_connection_json(c public.channel_connections) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'provider', c.provider, 'phone_e164', c.phone_e164, 'status', c.status,
    'verified_at', app.fin_ts(c.verified_at), 'version', c.version,
    'simulated', c.provider = 'simulated',
    -- phone_number_id na Meta (não é segredo); no simulado, o próprio número.
    'external_account_id', c.external_account_id)
$$;

create or replace function app.ch_message_json(m public.channel_messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'contact_id', m.contact_id, 'direction', m.direction, 'kind', m.kind, 'body', m.body,
    'template_code', m.template_code, 'status', m.status, 'failure_reason', case when m.status = 'failed' then m.failure_reason end,
    'created_at', app.sched_ts(m.created_at), 'sent_at', app.fin_ts(m.sent_at), 'delivered_at', app.fin_ts(m.delivered_at),
    'read_at', app.fin_ts(m.read_at), 'failed_at', app.fin_ts(m.failed_at),
    'next_attempt_at', case when m.status = 'queued' then app.fin_ts(m.next_attempt_at) end,
    'retry_reason', case when m.status = 'queued' and m.next_attempt_at is not null then m.failure_reason end)
$$;

-- ---------------------------------------------------------------------------
-- Dono: conexão do número
-- ---------------------------------------------------------------------------

drop function public.channel_connect(uuid, text, text, text, text, text, uuid);
/**
 * Registra o número e enfileira o código de verificação. Na Meta: phone_number_id (só dígitos) obrigatório e o código
 * vai para o WhatsApp pessoal do dono (p_verify_to_e164), diferente do número do negócio. Repetir devolve a mesma
 * conexão. A função `messaging` confere o phone_number_id na Graph antes de chegar aqui.
 */
create function public.channel_connect(
  p_tenant_id uuid,
  p_provider text,
  p_phone_e164 text,
  p_external_account_id text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null,
  p_verify_to_e164 text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.channel_connections;
  v_code text;
  v_body jsonb;
  v_account text := nullif(btrim(p_external_account_id), '');
  v_send_to text;
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
  if p_provider = 'whatsapp_cloud' then
    if v_account is null or v_account !~ '^[0-9]{5,30}$' then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'external_account_id';
    end if;
    if p_verify_to_e164 is null or p_verify_to_e164 !~ '^\+[1-9][0-9]{7,14}$' or p_verify_to_e164 = p_phone_e164 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'verify_to_e164';
    end if;
    v_send_to := p_verify_to_e164;
  end if;
  if exists (select 1 from public.channel_connections c where c.tenant_id = p_tenant_id and c.status <> 'disconnected') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'connection';
  end if;
  begin
    insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, created_by)
    values (p_tenant_id, p_provider, coalesce(v_account, p_phone_e164), p_phone_e164, v_uid)
    returning * into v_c;
  exception when unique_violation then
    -- O número já é de outro negócio: não revelar qual.
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'phone_e164';
  end;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.channel_verifications (tenant_id, connection_id, code, code_hash, expires_at, send_to)
  values (p_tenant_id, v_c.id, v_code, app.token_sha256(v_code), clock_timestamp() + interval '10 minutes', v_send_to);
  v_body := jsonb_build_object('connection', app.ch_connection_json(v_c));
  perform app.audit(p_tenant_id, 'channel.connect', 'channel_connection', v_c.id, p_request_id, null,
    jsonb_build_object('provider', v_c.provider));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'channel.connect', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Estado do canal. Com número aguardando o código: o envio do código (na fila, enviado, falhou e por quê). */
create or replace function public.channel_status(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.channel_connections;
  v_v public.channel_verifications;
begin
  perform app.ch_owner(p_tenant_id);
  select * into v_c from public.channel_connections c where c.tenant_id = p_tenant_id and c.status <> 'disconnected';
  if v_c.id is not null and v_c.status = 'pending_verification' then
    select * into v_v from public.channel_verifications v where v.connection_id = v_c.id and v.used_at is null order by v.created_at desc limit 1;
  end if;
  return jsonb_build_object('connection', case when v_c.id is null then null else app.ch_connection_json(v_c) end,
    'verification', case when v_v.id is null then null else jsonb_build_object('status', v_v.dispatch_status,
      'failure_reason', case when v_v.dispatch_status = 'failed' then v_v.failure_reason end,
      'expires_at', app.fin_ts(v_v.expires_at), 'send_to_e164', coalesce(v_v.send_to, v_c.phone_e164)) end,
    'queued', (select count(*) from public.channel_messages m where m.tenant_id = p_tenant_id and m.status in ('queued', 'sending')),
    'unknown', (select count(*) from public.channel_messages m where m.tenant_id = p_tenant_id and m.status = 'delivery_unknown'),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'category', t.category, 'body', t.body, 'params', t.params,
        'approved', app.ch_template_ready(t.code, coalesce(v_c.provider, 'simulated'))) order by t.code), '[]'::jsonb)
      from public.channel_templates t));
end $$;

-- ---------------------------------------------------------------------------
-- Backend (service_role): despacho, resultado, webhook e aprovação de modelo
-- ---------------------------------------------------------------------------

/**
 * Reserva o que sai nesta rodada (SKIP LOCKED): mensagens vencidas da fila, até `per_number` por número; verificações
 * e códigos de reserva (P43). Antes de entregar ao provedor confere de novo: conexão ativa, opt-out, modelo aprovado e,
 * na Meta, a janela de 24 h do texto livre (a Meta recusaria). O que não pode sair falha com motivo aqui.
 * `provider_template`: nome, idioma, categoria e parâmetros na ordem da Meta ({{1}} = negócio).
 */
create or replace function public.channel_dispatch_claim(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb := app.ch_dispatch_rules();
  v_items jsonb := '[]';
  v_params jsonb;
  v_reason text;
  v record;
  r record;
begin
  for r in
    update public.channel_messages m set status = 'sending', attempts = m.attempts + 1, next_attempt_at = null
    where m.id in (
      select x.id from public.channel_messages x
      where x.status = 'queued' and x.id in (
        select y.id from (
          select q.id, q.created_at, row_number() over (partition by k.connection_id order by q.created_at, q.id) as rn
          from public.channel_messages q join public.channel_contacts k on k.tenant_id = q.tenant_id and k.id = q.contact_id
          where q.status = 'queued' and (q.next_attempt_at is null or q.next_attempt_at <= clock_timestamp())) y
        where y.rn <= (v_rules->>'per_number')::int
        order by y.created_at, y.id limit least(greatest(coalesce(p_batch, 50), 1), 200))
      order by x.created_at, x.id
      for update skip locked)
    returning m.id, m.tenant_id, m.contact_id, m.body, m.kind, m.template_code, m.template_params, m.created_at
  loop
    select k.phone_e164 as to_phone, k.opted_out_at, k.last_inbound_at, c.provider, c.external_account_id, c.status as conn_status
    into v from public.channel_contacts k join public.channel_connections c on c.id = k.connection_id where k.id = r.contact_id;
    v_reason := case
      when v.conn_status <> 'active' then 'disconnected'
      when v.opted_out_at is not null then 'opted_out'
      when r.kind = 'template' and not app.ch_template_ready(r.template_code, v.provider) then 'template_not_approved'
      when r.kind = 'text' and v.provider <> 'simulated' and not app.ch_window_open(v.last_inbound_at) then 'window_closed'
    end;
    if v_reason is not null then
      perform app.ch_fail_message(r.id, v_reason);
      continue;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('ref', 'msg:' || r.id, 'provider', v.provider,
      'external_account_id', v.external_account_id, 'to', v.to_phone, 'body', r.body, 'kind', r.kind,
      'template_code', r.template_code, 'template_params', r.template_params,
      'provider_template', app.ch_provider_template(v.provider, r.template_code, r.tenant_id, r.template_params)));
  end loop;
  for r in
    update public.channel_verifications cv set dispatch_status = 'sending'
    where cv.id in (select x.id from public.channel_verifications x where x.dispatch_status = 'queued' and x.expires_at > clock_timestamp()
                    and x.code is not null order by x.created_at limit 20 for update skip locked)
    returning cv.id, cv.tenant_id, cv.connection_id, cv.code, cv.send_to
  loop
    select c.provider, c.external_account_id, c.phone_e164 into v from public.channel_connections c where c.id = r.connection_id;
    v_reason := case
      when not app.ch_template_ready('verificacao_numero', v.provider) then 'template_not_approved'
      when v.provider <> 'simulated' and r.send_to is null then 'no_recipient'
    end;
    if v_reason is not null then
      update public.channel_verifications cv set dispatch_status = 'failed', failure_reason = v_reason where cv.id = r.id;
      continue;
    end if;
    v_params := jsonb_build_array(r.code);
    v_items := v_items || jsonb_build_array(jsonb_build_object('ref', 'ver:' || r.id, 'provider', v.provider,
      'external_account_id', v.external_account_id, 'to', coalesce(r.send_to, v.phone_e164),
      'body', app.ch_render('verificacao_numero', v_params), 'kind', 'template', 'template_code', 'verificacao_numero',
      'template_params', v_params, 'provider_template', app.ch_provider_template(v.provider, 'verificacao_numero', r.tenant_id, v_params)));
  end loop;
  for r in
    update public.public_booking_requests q set dispatch_status = 'sending'
    where q.id in (select x.id from public.public_booking_requests x
                   where x.dispatch_status = 'queued' and x.status = 'pending' and x.expires_at > clock_timestamp()
                   order by x.queued_at limit 20 for update skip locked)
    returning q.id, q.tenant_id, q.booking_id, q.connection_id, q.contact_phone_e164, q.code
  loop
    select c.provider, c.external_account_id into v from public.channel_connections c where c.tenant_id = r.tenant_id and c.id = r.connection_id;
    if not app.ch_template_ready('codigo_reserva', v.provider) then
      update public.public_booking_requests q set dispatch_status = 'failed' where q.id = r.id;
      continue;
    end if;
    select jsonb_build_array(s.name, to_char(b.starts_at at time zone t.timezone, 'DD/MM "às" HH24:MI'), r.code, left(t.name, 120)) into v_params
    from public.bookings b
    join public.tenants t on t.id = b.tenant_id
    join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
    where b.tenant_id = r.tenant_id and b.id = r.booking_id;
    v_items := v_items || jsonb_build_array(jsonb_build_object('ref', 'pbk:' || r.id, 'provider', v.provider,
      'external_account_id', v.external_account_id, 'to', r.contact_phone_e164,
      'body', app.ch_render('codigo_reserva', v_params),
      'kind', 'template', 'template_code', 'codigo_reserva', 'template_params', v_params,
      'provider_template', app.ch_provider_template(v.provider, 'codigo_reserva', r.tenant_id, v_params)));
  end loop;
  return jsonb_build_object('items', v_items);
end $$;

drop function public.channel_dispatch_result(text, text, text, text);
/**
 * Resultado do provedor para um item: sent (com id), failed (motivo), delivery_unknown (resultado desconhecido, sem
 * reenvio), retry (limite do provedor: volta à fila com espera crescente até o teto de tentativas) ou requeue (o número
 * já bateu o limite nesta rodada: volta sem gastar tentativa). `p_retry_after_s`: espera mínima pedida pelo provedor.
 */
create function public.channel_dispatch_result(p_ref text, p_outcome text, p_provider_message_id text, p_reason text,
  p_retry_after_s integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb := app.ch_dispatch_rules();
  v_id uuid;
  v_m public.channel_messages;
  v_provider text;
  v_wait integer;
  v_applied boolean;
  e record;
begin
  if p_outcome is null or p_outcome not in ('sent', 'failed', 'delivery_unknown', 'retry', 'requeue') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'outcome';
  end if;
  v_id := split_part(p_ref, ':', 2)::uuid;
  if p_ref like 'ver:%' then
    update public.channel_verifications cv
    set dispatch_status = case when p_outcome in ('retry', 'requeue') then 'queued' else p_outcome end,
        failure_reason = case when p_outcome = 'sent' then null else left(p_reason, 200) end
    where cv.id = v_id and (p_outcome not in ('retry', 'requeue') or cv.dispatch_status = 'sending');
    return jsonb_build_object('ref', p_ref, 'status', case when p_outcome in ('retry', 'requeue') then 'queued' else p_outcome end);
  end if;
  if p_ref like 'pbk:%' then
    update public.public_booking_requests q set dispatch_status = case when p_outcome in ('retry', 'requeue') then 'queued' else p_outcome end
    where q.id = v_id and (p_outcome not in ('retry', 'requeue') or q.dispatch_status = 'sending');
    return jsonb_build_object('ref', p_ref, 'status', case when p_outcome in ('retry', 'requeue') then 'queued' else p_outcome end);
  end if;
  if p_outcome = 'sent' and p_provider_message_id is not null then
    -- Mesma trava do webhook para este id: um status que chegue junto não se perde (ver channel_webhook_ingest).
    perform pg_advisory_xact_lock(hashtextextended('channel_pmid:' || p_provider_message_id, 0));
  end if;
  select * into v_m from public.channel_messages m where m.id = v_id and m.status in ('sending', 'delivery_unknown') for update;
  if not found then
    return jsonb_build_object('ref', p_ref, 'status', 'ignored');
  end if;
  if p_outcome in ('retry', 'requeue') then
    if v_m.status <> 'sending' then
      return jsonb_build_object('ref', p_ref, 'status', 'ignored');
    end if;
    if p_outcome = 'retry' and v_m.attempts >= (v_rules->>'max_attempts')::int then
      perform app.ch_fail_message(v_m.id, 'retries_exhausted');
      return jsonb_build_object('ref', p_ref, 'status', 'failed');
    end if;
    v_wait := case when p_outcome = 'requeue' then (v_rules->>'requeue_seconds')::int
      else greatest(least((v_rules->>'backoff_base_seconds')::int * (2 ^ greatest(v_m.attempts - 1, 0))::int, (v_rules->>'backoff_max_seconds')::int),
        least(greatest(coalesce(p_retry_after_s, 0), 0), (v_rules->>'backoff_max_seconds')::int)) end;
    update public.channel_messages m
    set status = 'queued', next_attempt_at = clock_timestamp() + make_interval(secs => v_wait), failure_reason = left(p_reason, 200),
        attempts = case when p_outcome = 'requeue' then greatest(m.attempts - 1, 0) else m.attempts end
    where m.id = v_m.id returning * into v_m;
    return jsonb_build_object('ref', p_ref, 'status', 'queued', 'next_attempt_at', app.fin_ts(v_m.next_attempt_at));
  end if;
  if p_outcome = 'failed' then
    perform app.ch_fail_message(v_m.id, p_reason);
    return jsonb_build_object('ref', p_ref, 'status', 'failed');
  end if;
  update public.channel_messages m
  set status = p_outcome,
      provider_message_id = coalesce(p_provider_message_id, m.provider_message_id),
      sent_at = case when p_outcome = 'sent' then clock_timestamp() else m.sent_at end,
      failure_reason = case when p_outcome = 'sent' then null else m.failure_reason end,
      unknown_since = case when p_outcome = 'delivery_unknown' then coalesce(m.unknown_since, clock_timestamp()) else null end
  where m.id = v_m.id returning * into v_m;
  -- Status que chegou antes deste resultado: aplica agora, na ordem em que chegou (só avança).
  if p_outcome = 'sent' and v_m.provider_message_id is not null then
    select c.provider into v_provider from public.channel_contacts k join public.channel_connections c on c.id = k.connection_id where k.id = v_m.contact_id;
    for e in select w.external_event_id, w.status, w.reason from public.channel_webhook_events w
             where w.provider = v_provider and w.outcome = 'unmatched_message' and w.provider_message_id = v_m.provider_message_id
             order by w.received_at, w.external_event_id loop
      v_applied := app.ch_apply_status(v_m.id, e.status, e.reason);
      update public.channel_webhook_events w set outcome = case when v_applied then 'applied' else 'ignored' end
      where w.provider = v_provider and w.external_event_id = e.external_event_id;
    end loop;
    select * into v_m from public.channel_messages m where m.id = v_m.id;
  end if;
  return jsonb_build_object('ref', p_ref, 'status', v_m.status);
end $$;

/**
 * Ingestão de eventos já normalizados pela função (assinatura conferida lá). Cada evento:
 * {external_event_id, kind: 'inbound'|'status', external_account_id, phone_e164, provider_message_id, text, profile_name,
 *  status: 'sent'|'delivered'|'read'|'failed', reason}. Deduplica por (provider, external_event_id).
 * Opt-out da própria cliente falha na hora o que estava na fila para ela. Status de mensagem cujo id ainda não foi
 * gravado pelo despacho fica guardado ('unmatched_message') e é aplicado quando o id chega.
 */
create or replace function public.channel_webhook_ingest(p_provider text, p_events jsonb) returns jsonb
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
  v_pmid text;
  v_status text;
  v_reason text;
  q record;
begin
  if p_provider is null or p_provider not in ('simulated', 'whatsapp_cloud') or jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 500 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'events';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'external_event_id', '') = '' or coalesce(e->>'kind', '') not in ('inbound', 'status') then
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
    v_pmid := null;
    v_status := null;
    v_reason := null;
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
        -- Opt-out pela própria cliente: palavras fixas (ADR-0017); o resto do texto é dado.
        v_optout := app.ch_is_opt_out(v_text);
        if v_optout then
          update public.channel_contacts k set opted_out_at = coalesce(k.opted_out_at, clock_timestamp()) where k.id = v_k.id returning * into v_k;
          -- O que estava na fila para ela não sai (o que o provedor já aceitou não dá para desfazer).
          for q in select m.id from public.channel_messages m where m.tenant_id = v_k.tenant_id and m.contact_id = v_k.id
                   and m.direction = 'outbound' and m.status = 'queued' order by m.created_at for update loop
            perform app.ch_fail_message(q.id, 'opted_out');
          end loop;
        end if;
        insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, status, external_event_id)
        values (v_c.tenant_id, v_k.id, 'inbound', 'text', v_text, 'received', left(e->>'external_event_id', 200))
        returning * into v_m;
        perform app.emit_event(v_c.tenant_id, 'channel.message.received.v1', v_m.id, 1, gen_random_uuid(),
          jsonb_build_object('message_id', v_m.id, 'contact_id', v_k.id, 'customer_id', v_k.customer_id, 'handling', v_k.handling,
            'opted_out', v_optout));
        v_outcome := 'applied';
      end if;
    elsif coalesce(e->>'provider_message_id', '') = '' or coalesce(e->>'status', '') not in ('sent', 'delivered', 'read', 'failed') then
      v_outcome := 'ignored';
    else
      v_pmid := left(e->>'provider_message_id', 200);
      -- Mesma trava de channel_dispatch_result: ou ele grava o id antes e este status se aplica, ou este status fica
      -- guardado antes e ele o aplica.
      perform pg_advisory_xact_lock(hashtextextended('channel_pmid:' || v_pmid, 0));
      select * into v_m from public.channel_messages m where m.provider_message_id = v_pmid and m.direction = 'outbound';
      if not found then
        v_outcome := 'unmatched_message';
        v_status := e->>'status';
        v_reason := left(e->>'reason', 200);
      elsif app.ch_apply_status(v_m.id, e->>'status', left(e->>'reason', 200)) then
        v_outcome := 'applied';
      end if;
    end if;
    update public.channel_webhook_events w set outcome = v_outcome,
      provider_message_id = case when v_outcome = 'unmatched_message' then v_pmid end,
      status = case when v_outcome = 'unmatched_message' then v_status end,
      reason = case when v_outcome = 'unmatched_message' then v_reason end
    where w.provider = p_provider and w.external_event_id = left(e->>'external_event_id', 200);
    if v_outcome = 'applied' then v_applied := v_applied + 1; end if;
  end loop;
  return jsonb_build_object('applied', v_applied, 'duplicates', v_dupes);
end $$;

/**
 * Operador (backend): marca ou desmarca um modelo como aprovado num provedor. Na Meta, só depois de o modelo estar
 * APROVADO no Gerenciador do WhatsApp com o mesmo nome, idioma e corpo de channel_templates (release/WHATSAPP.md).
 */
create function public.channel_template_set_approval(p_code text, p_provider text, p_approved boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.channel_templates;
begin
  if p_provider is null or p_provider not in ('simulated', 'whatsapp_cloud') or p_approved is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = case when p_approved is null then 'approved' else 'provider' end;
  end if;
  select * into v_t from public.channel_templates t where t.code = p_code for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'template_code';
  end if;
  if p_provider = 'whatsapp_cloud' and p_approved and v_t.meta_name is null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'meta_name';
  end if;
  update public.channel_templates t
  set approved_providers = case when p_approved then (select array_agg(distinct x order by x) from unnest(t.approved_providers || p_provider) x)
                                else array_remove(t.approved_providers, p_provider) end
  where t.code = v_t.code returning * into v_t;
  return jsonb_build_object('code', v_t.code, 'meta_name', v_t.meta_name, 'approved_providers', to_jsonb(v_t.approved_providers));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function app.ch_dispatch_rules() from public;
revoke all on function app.ch_business_name(uuid) from public, anon, authenticated;
revoke all on function app.ch_template_ready(text, text) from public, anon, authenticated;
revoke all on function app.ch_meta_values(integer[], text, jsonb) from public, anon, authenticated;
revoke all on function app.ch_provider_template(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function app.ch_fill_numbered(text, jsonb) from public, anon, authenticated;
revoke all on function app.ch_fail_message(uuid, text) from public, anon, authenticated;
revoke all on function app.ch_apply_status(uuid, text, text) from public, anon, authenticated;
revoke all on function app.ch_is_opt_out(text) from public, anon, authenticated;

revoke all on function public.channel_connect(uuid, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.channel_connect(uuid, text, text, text, text, text, uuid, text) to authenticated;
revoke all on function public.channel_dispatch_result(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.channel_dispatch_result(text, text, text, text, integer) to service_role;
revoke all on function public.channel_template_set_approval(text, text, boolean) from public, anon, authenticated;
grant execute on function public.channel_template_set_approval(text, text, boolean) to service_role;
