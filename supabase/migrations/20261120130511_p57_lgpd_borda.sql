-- P57 · LGPD e borda pública (revisão de 10/11; decisões D25, D26 e D30 (a), adotadas pelo Felipe e sujeitas à revisão
-- do advogado, docs/legal/PENDENCIAS.md).
-- 1. Retenção (D25): prazos numa tabela de configuração e uma rotina em `job_ticks` (app.retention_tick) que apaga em
--    lotes e registra só QUANTO apagou de cada categoria (public.retention_runs), nunca o conteúdo.
-- 2. Exportar os dados do negócio ou de um cliente final (D26): o banco monta o JSON só para o dono, a Edge Function
--    `privacy` grava o arquivo no bucket privado `privacy-exports` e devolve um link com prazo.
-- 3. Eliminar (D26): o negócio inteiro com carência de 7 dias, cancelável; um cliente final na hora, a pedido do dono.
--    Eliminar = anonimizar o que identifica a pessoa e apagar o que não precisa ficar; valores e datas dos lançamentos
--    (só acrescenta) e documentos fiscais ficam sem o nome (ver docs/legal/inventario-lgpd.md, ADV valida).
-- 4. Reserva pública (D30 a): teto de reservas provisórias do link por negócio, limite por contato em 24 h e limite por
--    origem (public.public_origin_check, que o handler da reserva chama com o hash da origem; recado ao integrador).
-- Depende de: P56 (job_ticks), P43/P55 (pedido pelo link), P08 (assistente), P12 (canal), P01/P02 (cadastro).

-- ---------------------------------------------------------------------------
-- 1. Retenção
-- ---------------------------------------------------------------------------

create table public.retention_policies (
  category text primary key check (category ~ '^[a-z_]+$'),
  -- Dias depois do fato que inicia a contagem (coluna `starts_at_column`). 0 = assim que o fato acontece.
  days integer not null check (days between 0 and 3650),
  starts_at text not null,
  decision text not null,
  note text not null
);
comment on table public.retention_policies is
  'Prazos de retenção (D25, sujeitos ao advogado). Mudar prazo = migration nova. Lida por app.retention_tick.';
alter table public.retention_policies enable row level security;
revoke all on public.retention_policies from public, anon, authenticated;

insert into public.retention_policies (category, days, starts_at, decision, note) values
  ('idempotency', 30, 'criação do registro', 'D25', 'Chaves de idempotência e a resposta guardada para repetição.'),
  ('outbox_events', 90, 'evento do fato (só entregues ou mortos)', 'D25', 'Fila de eventos: pendentes nunca são apagados.'),
  ('webhook_events', 90, 'recebimento', 'D25', 'Dedupe de webhooks do canal e do PSP (sem payload).'),
  ('channel_messages', 365, 'criação da mensagem', 'D25', 'Mensagens do canal (corpo do texto).'),
  ('agent_executions', 365, 'pergunta ao assistente', 'D25', 'Execuções do assistente: pergunta debitada, proposta, aprovação e recibo.'),
  ('verification_codes', 0, 'fim do envio (pedido sem espera ou código vencido)', 'D25', 'Código em claro e hash: do link público e da verificação do número.'),
  ('unconfirmed_requests', 30, 'pedido pelo link', 'D25', 'Pedido pelo link que não virou reserva: contato, bairro e o nome no horário liberado.'),
  ('origin_hits', 1, 'tentativa de reserva', 'P57', 'Hash da origem usado só no limite de abuso.'),
  ('privacy_exports', 1, 'arquivo pronto', 'P57', 'Arquivo de exportação: o link para baixar vale 15 min; o arquivo, 24 h.'),
  ('retention_runs', 400, 'rodada da retenção', 'P57', 'Relatório do que a retenção apagou (contagens, sem conteúdo).');

create table public.retention_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default clock_timestamp(),
  category text not null references public.retention_policies (category),
  -- Linhas apagadas ou com o dado limpo nesta rodada. Nunca o conteúdo nem a quem pertencia.
  affected integer not null check (affected > 0)
);
comment on table public.retention_runs is
  'Relatório da retenção: categoria, quando e quantas linhas. Sem conteúdo, sem negócio, sem titular.';
create index retention_runs_recent on public.retention_runs (ran_at);
alter table public.retention_runs enable row level security;
revoke all on public.retention_runs from public, anon, authenticated;

/** Dias de uma categoria (falha alto se a categoria sumir da tabela: melhor parar a rotina que apagar com prazo errado). */
create function app.retention_days(p_category text) returns interval
language plpgsql stable security definer set search_path = '' as $$
declare
  v integer;
begin
  select r.days into v from public.retention_policies r where r.category = p_category;
  if v is null then
    raise exception 'prazo de retenção ausente: %', p_category;
  end if;
  return make_interval(days => v);
end $$;
revoke all on function app.retention_days(text) from public, anon, authenticated;

-- Tabelas do assistente são "só acrescenta". A retenção é a única exceção, e só para DELETE, dentro da própria
-- transação (flag local `app.retention`). Ninguém fora das funções do banco tem DELETE nessas tabelas.
create function app.forbid_mutation_unless_retention() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.retention', true) = 'on' then
    return old;
  end if;
  raise exception using errcode = 'PT403', message = 'FORBIDDEN',
    detail = format('%s é append-only', tg_table_name);
end $$;
revoke all on function app.forbid_mutation_unless_retention() from public, anon, authenticated;

drop trigger agent_runs_append_only on public.agent_runs;
create trigger agent_runs_append_only before update or delete on public.agent_runs
  for each row execute function app.forbid_mutation_unless_retention();
drop trigger agent_approvals_append_only on public.agent_approvals;
create trigger agent_approvals_append_only before update or delete on public.agent_approvals
  for each row execute function app.forbid_mutation_unless_retention();
drop trigger agent_receipts_append_only on public.agent_receipts;
create trigger agent_receipts_append_only before update or delete on public.agent_receipts
  for each row execute function app.forbid_mutation_unless_retention();

-- O código em claro só é necessário enquanto o envio pode acontecer (pedido esperando, reenvio incluído).
alter table public.public_booking_requests alter column code drop not null, alter column code_hash drop not null;
alter table public.channel_verifications alter column code drop not null, alter column code_hash drop not null;

/**
 * Uma rodada da retenção. Cada categoria apaga no máximo `p_batch` linhas por rodada (a rotina roda a cada minuto) e
 * registra a contagem em retention_runs. Devolve {categoria: linhas}.
 */
create function app.retention_tick(p_batch integer default 500) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := least(greatest(coalesce(p_batch, 500), 1), 5000);
  v_out jsonb := '{}'::jsonb;
  v_c integer;
  v_c2 integer;
  v_now timestamptz := clock_timestamp();
  v_runs uuid[];
  v_reqs uuid[];
  v_msgs uuid[];
begin
  perform set_config('app.retention', 'on', true);

  -- Idempotência (30 dias).
  delete from public.idempotency_records i where i.ctid in (
    select x.ctid from public.idempotency_records x
    where x.created_at < v_now - app.retention_days('idempotency') limit v_n);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('idempotency', v_c);

  -- Eventos entregues ou mortos (90 dias). Pendentes e em processamento ficam.
  delete from public.outbox_events o where o.event_id in (
    select x.event_id from public.outbox_events x
    where x.status in ('done', 'dead') and x.occurred_at < v_now - app.retention_days('outbox_events') limit v_n);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('outbox_events', v_c);

  -- Webhooks do canal e do PSP (90 dias).
  delete from public.channel_webhook_events w where w.ctid in (
    select x.ctid from public.channel_webhook_events x
    where x.received_at < v_now - app.retention_days('webhook_events') limit v_n);
  get diagnostics v_c = row_count;
  delete from public.payment_webhook_events w where w.ctid in (
    select x.ctid from public.payment_webhook_events x
    where x.received_at < v_now - app.retention_days('webhook_events') limit v_n);
  get diagnostics v_c2 = row_count;
  v_out := v_out || jsonb_build_object('webhook_events', v_c + v_c2);

  -- Mensagens do canal (12 meses). A régua guarda só a referência; ela vira nula antes.
  select coalesce(array_agg(x.id), '{}') into v_msgs from (
    select m.id from public.channel_messages m
    where m.created_at < v_now - app.retention_days('channel_messages') order by m.created_at limit v_n) x;
  update public.lifecycle_steps s set channel_message_id = null where s.channel_message_id = any (v_msgs);
  delete from public.channel_messages m where m.id = any (v_msgs);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('channel_messages', v_c);

  -- Execuções do assistente (12 meses): recibo → aprovação → proposta → pergunta, pela idade da pergunta.
  select coalesce(array_agg(x.id), '{}') into v_runs from (
    select r.id from public.agent_runs r
    where r.created_at < v_now - app.retention_days('agent_executions') order by r.created_at limit v_n) x;
  delete from public.agent_receipts c using public.agent_approvals a, public.agent_proposals p
  where c.tenant_id = a.tenant_id and c.approval_id = a.id and a.tenant_id = p.tenant_id and a.proposal_id = p.id
    and p.run_id = any (v_runs);
  delete from public.agent_approvals a using public.agent_proposals p
  where a.tenant_id = p.tenant_id and a.proposal_id = p.id and p.run_id = any (v_runs);
  delete from public.agent_proposals p where p.run_id = any (v_runs);
  delete from public.agent_runs r where r.id = any (v_runs);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('agent_executions', v_c);

  -- Códigos de verificação: apagados quando o envio acabou (o pedido não espera mais ou o código venceu).
  update public.public_booking_requests q set code = null, code_hash = null
  where q.id in (select x.id from public.public_booking_requests x
                 where x.code is not null and (x.status <> 'pending' or x.expires_at < v_now) limit v_n);
  get diagnostics v_c = row_count;
  update public.channel_verifications cv set code = null, code_hash = null
  where cv.id in (select x.id from public.channel_verifications x
                  where x.code is not null and (x.used_at is not null or x.expires_at < v_now) limit v_n);
  get diagnostics v_c2 = row_count;
  v_out := v_out || jsonb_build_object('verification_codes', v_c + v_c2);

  -- Pedido pelo link que não virou reserva (30 dias): some o pedido, e o horário liberado perde o nome digitado.
  select coalesce(array_agg(x.id), '{}') into v_reqs from (
    select q.id from public.public_booking_requests q
    where q.status <> 'confirmed' and q.created_at < v_now - app.retention_days('unconfirmed_requests')
    order by q.created_at limit v_n) x;
  update public.public_booking_requests q set replaced_request_id = null
  where q.replaced_request_id = any (v_reqs);
  update public.bookings b set guest_ref = null
  from public.public_booking_requests q
  where q.id = any (v_reqs) and b.tenant_id = q.tenant_id and b.id = q.booking_id
    and b.status not in ('held', 'confirmed', 'completed') and b.guest_ref is not null;
  delete from public.public_booking_requests q where q.id = any (v_reqs);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('unconfirmed_requests', v_c);

  -- Hash da origem do limite de abuso (1 dia).
  delete from public.public_origin_hits h where h.ctid in (
    select x.ctid from public.public_origin_hits x where x.created_at < v_now - app.retention_days('origin_hits') limit v_n);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('origin_hits', v_c);

  -- Exportações: o link vence com o arquivo; geração presa por mais de 1 h vira falha.
  update public.privacy_exports e set status = 'expired'
  where e.status = 'ready' and e.expires_at < v_now;
  get diagnostics v_c = row_count;
  update public.privacy_exports e set status = 'failed'
  where e.status = 'generating' and e.created_at < v_now - interval '1 hour';
  get diagnostics v_c2 = row_count;
  v_out := v_out || jsonb_build_object('privacy_exports', v_c + v_c2);

  -- O próprio relatório (400 dias).
  delete from public.retention_runs r where r.id in (
    select x.id from public.retention_runs x where x.ran_at < v_now - app.retention_days('retention_runs') limit v_n);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('retention_runs', v_c);

  insert into public.retention_runs (category, affected)
  select k, v::int from jsonb_each_text(v_out) e(k, v) where v::int > 0;
  perform set_config('app.retention', 'off', true);
  return v_out;
end $$;
revoke all on function app.retention_tick(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reserva pública: teto de reservas provisórias, limite por contato e por origem (D30 a)
-- ---------------------------------------------------------------------------

create table public.abuse_limits (
  key text primary key check (key ~ '^[a-z_0-9]+$'),
  value integer not null check (value > 0),
  note text not null
);
comment on table public.abuse_limits is 'Limites de abuso da reserva pública (D30 a). Mudar = migration nova.';
alter table public.abuse_limits enable row level security;
revoke all on public.abuse_limits from public, anon, authenticated;
insert into public.abuse_limits (key, value, note) values
  ('public_holds_per_tenant', 10, 'Reservas provisórias do link ao mesmo tempo num negócio.'),
  ('public_requests_per_contact_day', 10, 'Pedidos pelo link do mesmo WhatsApp em 24 h, em toda a Tinindo.'),
  ('public_requests_per_origin_10min', 10, 'Tentativas de reserva da mesma origem em 10 min.'),
  ('public_requests_per_origin_day', 60, 'Tentativas de reserva da mesma origem em 24 h.');

create function app.abuse_limit(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select l.value from public.abuse_limits l where l.key = p_key), 1)
$$;
revoke all on function app.abuse_limit(text) from public, anon, authenticated;

/**
 * Antes de gravar o pedido pelo link: o horário já foi segurado na mesma transação, então ele entra na conta do teto.
 * Recusar aqui desfaz tudo (hold incluído). Os limites por hora do P43/P55 continuam na própria função do pedido.
 */
create function app.pbk_abuse_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.bookings b
      where b.tenant_id = new.tenant_id and b.source = 'public_link' and b.status = 'held'
        and b.hold_expires_at > clock_timestamp()) > app.abuse_limit('public_holds_per_tenant') then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'public_holds';
  end if;
  if (select count(*) from public.public_booking_requests q
      where q.contact_phone_e164 = new.contact_phone_e164
        and q.created_at > clock_timestamp() - interval '24 hours') >= app.abuse_limit('public_requests_per_contact_day') then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'rate_limit';
  end if;
  return new;
end $$;
revoke all on function app.pbk_abuse_guard() from public, anon, authenticated;
create trigger public_booking_requests_abuse_guard before insert on public.public_booking_requests
  for each row execute function app.pbk_abuse_guard();

create table public.public_origin_hits (
  -- sha256 da origem (IP) com o dia: o banco nunca vê o endereço.
  origin_hash text not null check (origin_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.public_origin_hits is 'Backend-only. Tentativas de reserva por origem (hash), apagadas em 1 dia.';
create index public_origin_hits_recent on public.public_origin_hits (origin_hash, created_at);
alter table public.public_origin_hits enable row level security;
revoke all on public.public_origin_hits from public, anon, authenticated;

/** Conta uma tentativa de reserva da origem e recusa acima do limite. O handler chama antes de public_booking_request. */
create function public.public_origin_check(p_origin_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_origin_hash is null or p_origin_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'origin';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public_origin:' || p_origin_hash, 0));
  if (select count(*) from public.public_origin_hits h where h.origin_hash = p_origin_hash
      and h.created_at > clock_timestamp() - interval '10 minutes') >= app.abuse_limit('public_requests_per_origin_10min')
     or (select count(*) from public.public_origin_hits h where h.origin_hash = p_origin_hash
      and h.created_at > clock_timestamp() - interval '24 hours') >= app.abuse_limit('public_requests_per_origin_day') then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'origin';
  end if;
  insert into public.public_origin_hits (origin_hash) values (p_origin_hash);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.public_origin_check(text) from public, anon, authenticated;
grant execute on function public.public_origin_check(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Exportar (D26)
-- ---------------------------------------------------------------------------

create table public.privacy_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  scope text not null check (scope in ('business', 'customer')),
  customer_id uuid,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed', 'expired')),
  requested_by uuid not null,
  storage_path text not null unique,
  bytes bigint check (bytes between 1 and 52428800),
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  expires_at timestamptz,
  unique (tenant_id, id),
  constraint privacy_exports_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint privacy_exports_scope check ((scope = 'customer') = (customer_id is not null)),
  constraint privacy_exports_ready check ((status in ('ready', 'expired')) = (ready_at is not null and expires_at is not null and bytes is not null))
);
comment on table public.privacy_exports is 'Backend-only. Pedidos de exportação (D26): quem pediu, estado e caminho do arquivo. Sem o conteúdo.';
create index privacy_exports_tenant_recent on public.privacy_exports (tenant_id, created_at);
alter table public.privacy_exports enable row level security;
revoke all on public.privacy_exports from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('privacy-exports', 'privacy-exports', false, 52428800, array['application/json'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

/**
 * Pode gravar (`write`) ou ler/apagar (`read`) o objeto do bucket de exportações? Gravar: só quem pediu, enquanto a
 * exportação está sendo gerada. Ler: o dono do negócio, com o arquivo pronto e dentro do prazo.
 */
create function public.privacy_export_object_ok(p_name text, p_mode text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_mode
      when 'write' then e.status = 'generating' and e.requested_by = auth.uid() and app.is_member(e.tenant_id, array['owner'])
      when 'read' then e.status = 'ready' and e.expires_at > clock_timestamp() and app.is_member(e.tenant_id, array['owner'])
      else false end
    from public.privacy_exports e where e.storage_path = p_name), false)
$$;
revoke all on function public.privacy_export_object_ok(text, text) from public, anon, authenticated;
grant execute on function public.privacy_export_object_ok(text, text) to authenticated;

create policy privacy_exports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'privacy-exports' and public.privacy_export_object_ok(name, 'write'));
-- Repetir a gravação (upsert) depois de uma falha no meio: só enquanto gera, só quem pediu.
create policy privacy_exports_update on storage.objects for update to authenticated
  using (bucket_id = 'privacy-exports' and public.privacy_export_object_ok(name, 'write'))
  with check (bucket_id = 'privacy-exports' and public.privacy_export_object_ok(name, 'write'));
-- Ler: dono com o arquivo pronto e no prazo. Quem grava também precisa ver a linha enquanto gera (o upsert da API
-- do Storage passa pela política de leitura).
create policy privacy_exports_select on storage.objects for select to authenticated
  using (bucket_id = 'privacy-exports'
    and (public.privacy_export_object_ok(name, 'read') or public.privacy_export_object_ok(name, 'write')));
create policy privacy_exports_delete on storage.objects for delete to authenticated
  using (bucket_id = 'privacy-exports' and public.privacy_export_object_ok(name, 'read'));

create function app.privacy_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;
revoke all on function app.privacy_owner(uuid) from public, anon, authenticated;

create function app.privacy_export_json(e public.privacy_exports) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'scope', e.scope, 'customer_id', e.customer_id, 'status', e.status,
    'bytes', e.bytes, 'created_at', app.sched_ts(e.created_at), 'ready_at', app.sched_ts(e.ready_at),
    'expires_at', app.sched_ts(e.expires_at))
$$;
revoke all on function app.privacy_export_json(public.privacy_exports) from public, anon, authenticated;

/** Colunas que nunca saem numa exportação: segredos, hashes de token e de código, chaves de idempotência. */
create function app.privacy_hidden_column(p_column text) returns boolean
language sql immutable set search_path = '' as $$
  select p_column ~ '^(code|code_hash|token_hash|booking_token|request_hash|idem_key|payload_hash|audience_hash|key|.*secret.*|.*credential.*|.*password.*)$'
$$;
revoke all on function app.privacy_hidden_column(text) from public, anon, authenticated;

/** Tabelas de uso interno (fila, idempotência, medição, limites) ou de segredo: não entram na exportação. */
create function app.privacy_hidden_table(p_table text) returns boolean
language sql immutable set search_path = '' as $$
  select p_table = any (array['idempotency_records', 'outbox_events', 'job_ticks', 'fiscal_credentials',
    'retention_runs', 'public_origin_hits', 'privacy_exports', 'setup_step_completions', 'lifecycle_processed_events',
    'channel_sim_phone', 'payment_sim_ledger', 'agent_quotas'])
$$;
revoke all on function app.privacy_hidden_table(text) from public, anon, authenticated;

/** Linhas de uma tabela de `public` filtradas por `where`, sem as colunas escondidas. */
create function app.privacy_rows(p_table text, p_where text, p_args uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cols text;
  v jsonb;
begin
  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and not app.privacy_hidden_column(c.column_name);
  if v_cols is null then return '[]'::jsonb; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select %s from public.%I t where %s) x',
    v_cols, p_table, p_where) into v using p_args;
  return v;
end $$;
revoke all on function app.privacy_rows(text, text, uuid[]) from public, anon, authenticated;

/** Dados do negócio inteiro: toda tabela de `public` com `tenant_id`, menos as internas. */
create function app.privacy_business_data(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t text;
  v_out jsonb := '{}'::jsonb;
  v jsonb;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and not app.privacy_hidden_table(c.table_name)
    order by c.table_name
  loop
    v := app.privacy_rows(t, 'tenant_id = ($1)[1]', array[p_tenant_id]);
    if jsonb_array_length(v) > 0 then v_out := v_out || jsonb_build_object(t, v); end if;
  end loop;
  -- O negócio em si (a tabela não tem tenant_id).
  return jsonb_build_object('tenants', app.privacy_rows('tenants', 'id = ($1)[1]', array[p_tenant_id])) || v_out;
end $$;
revoke all on function app.privacy_business_data(uuid) from public, anon, authenticated;

/** Dados de um cliente final: o cadastro, toda tabela com `customer_id`, mensagens e pedidos pelo link do mesmo telefone. */
create function app.privacy_customer_data(p_tenant_id uuid, p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t text;
  v_out jsonb := '{}'::jsonb;
  v jsonb;
  v_phone text;
begin
  select c.phone into v_phone from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id;
  v_out := jsonb_build_object('customers', app.privacy_rows('customers', 'tenant_id = ($1)[1] and id = ($1)[2]', array[p_tenant_id, p_customer_id]));
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'customer_id' and not app.privacy_hidden_table(c.table_name)
      and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.table_name and k.column_name = 'tenant_id')
    order by c.table_name
  loop
    v := app.privacy_rows(t, 'tenant_id = ($1)[1] and customer_id = ($1)[2]', array[p_tenant_id, p_customer_id]);
    if jsonb_array_length(v) > 0 then v_out := v_out || jsonb_build_object(t, v); end if;
  end loop;
  v_out := v_out || jsonb_build_object('channel_messages', coalesce((
    select jsonb_agg(jsonb_build_object('direction', m.direction, 'kind', m.kind, 'body', m.body, 'status', m.status, 'created_at', m.created_at) order by m.created_at)
    from public.channel_messages m join public.channel_contacts k on k.tenant_id = m.tenant_id and k.id = m.contact_id
    where m.tenant_id = p_tenant_id and (k.customer_id = p_customer_id or (v_phone is not null and k.phone_e164 = v_phone))), '[]'::jsonb));
  v_out := v_out || jsonb_build_object('public_booking_requests', coalesce((
    select jsonb_agg(jsonb_build_object('booking_id', q.booking_id, 'contact_name', q.contact_name, 'contact_phone_e164', q.contact_phone_e164,
      'neighborhood', q.neighborhood, 'status', q.status, 'created_at', q.created_at) order by q.created_at)
    from public.public_booking_requests q
    where q.tenant_id = p_tenant_id and v_phone is not null and q.contact_phone_e164 = v_phone), '[]'::jsonb));
  v_out := v_out || jsonb_build_object('reviews', coalesce((
    select jsonb_agg(jsonb_build_object('rating', r.rating, 'body', r.body, 'service_name', r.service_name, 'created_at', r.created_at))
    from public.reviews r join public.bookings b on b.tenant_id = r.tenant_id and b.id = r.booking_id
    where r.tenant_id = p_tenant_id and b.customer_id = p_customer_id), '[]'::jsonb));
  return v_out;
end $$;
revoke all on function app.privacy_customer_data(uuid, uuid) from public, anon, authenticated;

/** Começa uma exportação: o dono pede, o banco reserva o caminho do arquivo. Até 5 por dia por negócio. */
create function public.privacy_export_start(
  p_tenant_id uuid,
  p_scope text,
  p_customer_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_id uuid := gen_random_uuid();
  v_e public.privacy_exports;
  v_body jsonb;
begin
  perform app.privacy_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'privacy.export', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_scope not in ('business', 'customer') or (p_scope = 'customer') <> (p_customer_id is not null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'scope';
  end if;
  if p_scope = 'customer' and not exists (select 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('privacy_export:' || p_tenant_id::text, 0));
  if (select count(*) from public.privacy_exports e where e.tenant_id = p_tenant_id
      and e.created_at > clock_timestamp() - interval '24 hours') >= 5 then
    raise exception using errcode = 'PT429', message = 'QUOTA_EXCEEDED', hint = 'exports';
  end if;
  insert into public.privacy_exports (id, tenant_id, scope, customer_id, requested_by, storage_path)
  values (v_id, p_tenant_id, p_scope, p_customer_id, v_uid, format('%s/%s.json', p_tenant_id, v_id))
  returning * into v_e;
  perform app.audit(p_tenant_id, 'privacy.export', 'privacy_export', v_e.id, p_request_id, null,
    jsonb_build_object('scope', p_scope, 'customer', p_customer_id is not null));
  v_body := jsonb_build_object('export', app.privacy_export_json(v_e), 'storage_path', v_e.storage_path);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'privacy.export', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Conteúdo da exportação em geração: só para quem pediu. Lido pela Edge Function, que grava o arquivo. */
create function public.privacy_export_data(p_tenant_id uuid, p_export_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.privacy_exports;
begin
  perform app.privacy_owner(p_tenant_id);
  select * into v_e from public.privacy_exports e where e.tenant_id = p_tenant_id and e.id = p_export_id;
  if not found or v_e.requested_by <> auth.uid() then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_e.status <> 'generating' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  return jsonb_build_object(
    'format', 'tinindo.export.v1',
    'generated_at', app.sched_ts(clock_timestamp()),
    'scope', v_e.scope,
    'business_id', p_tenant_id,
    'customer_id', v_e.customer_id,
    'notes', jsonb_build_array(
      'Valores em centavos de real; datas em UTC (ISO 8601).',
      'Segredos, códigos de verificação, hashes de token e chaves internas não são exportados.'),
    'data', case when v_e.scope = 'business' then app.privacy_business_data(p_tenant_id)
                 else app.privacy_customer_data(p_tenant_id, v_e.customer_id) end);
end $$;

/** Arquivo gravado: a exportação fica pronta por 24 h. Repetir devolve o mesmo estado. */
create function public.privacy_export_finish(p_tenant_id uuid, p_export_id uuid, p_bytes bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_e public.privacy_exports;
begin
  perform app.privacy_owner(p_tenant_id);
  select * into v_e from public.privacy_exports e where e.tenant_id = p_tenant_id and e.id = p_export_id for update;
  if not found or v_e.requested_by <> auth.uid() then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_e.status = 'generating' then
    if p_bytes is null or p_bytes not between 1 and 52428800 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'bytes';
    end if;
    update public.privacy_exports e
    set status = 'ready', bytes = p_bytes, ready_at = clock_timestamp(),
        expires_at = clock_timestamp() + app.retention_days('privacy_exports')
    where e.id = v_e.id returning * into v_e;
  elsif v_e.status <> 'ready' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  return jsonb_build_object('export', app.privacy_export_json(v_e), 'storage_path', v_e.storage_path);
end $$;

/** Uma exportação (para gerar outro link) ou a lista das últimas 20. */
create function public.privacy_exports_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.privacy_owner(p_tenant_id);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(app.privacy_export_json(x) order by x.created_at desc)
    from (select e.* from public.privacy_exports e where e.tenant_id = p_tenant_id order by e.created_at desc limit 20) x), '[]'::jsonb));
end $$;

create function public.privacy_export_get(p_tenant_id uuid, p_export_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.privacy_exports;
begin
  perform app.privacy_owner(p_tenant_id);
  select * into v_e from public.privacy_exports e where e.tenant_id = p_tenant_id and e.id = p_export_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('export', app.privacy_export_json(v_e), 'storage_path', v_e.storage_path);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Eliminar (D26)
-- ---------------------------------------------------------------------------

create table public.privacy_erasures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  scope text not null check (scope in ('business', 'customer')),
  customer_id uuid,
  status text not null check (status in ('scheduled', 'cancelled', 'done')),
  requested_by uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  -- Carência: até este momento o dono cancela. Cliente final: executado no pedido.
  execute_after timestamptz not null,
  cancelled_at timestamptz,
  cancelled_by uuid,
  done_at timestamptz,
  -- Quantas linhas cada passo tocou. Sem conteúdo.
  summary jsonb,
  unique (tenant_id, id),
  constraint privacy_erasures_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint privacy_erasures_scope check ((scope = 'customer') = (customer_id is not null)),
  constraint privacy_erasures_cancelled check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint privacy_erasures_done check ((status = 'done') = (done_at is not null))
);
comment on table public.privacy_erasures is
  'Backend-only. Pedidos de eliminação (D26): negócio com carência de 7 dias, cliente final na hora. Trilha sem conteúdo.';
create unique index privacy_erasures_one_business on public.privacy_erasures (tenant_id) where scope = 'business' and status = 'scheduled';
create index privacy_erasures_due on public.privacy_erasures (execute_after) where status = 'scheduled';
alter table public.privacy_erasures enable row level security;
revoke all on public.privacy_erasures from public, anon, authenticated;

create function app.privacy_erasure_json(e public.privacy_erasures) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'scope', e.scope, 'customer_id', e.customer_id, 'status', e.status,
    'requested_at', app.sched_ts(e.requested_at), 'execute_after', app.sched_ts(e.execute_after),
    'cancelled_at', app.sched_ts(e.cancelled_at), 'done_at', app.sched_ts(e.done_at), 'summary', e.summary)
$$;
revoke all on function app.privacy_erasure_json(public.privacy_erasures) from public, anon, authenticated;

/**
 * Anonimiza um cliente final do negócio. O cadastro fica (lançamentos e reservas apontam para ele), sem nome, telefone
 * nem e-mail; mensagens, contato do canal e pedidos pelo link do mesmo telefone somem; vínculos e convites acabam;
 * textos que o citam (régua, avaliação) são limpos. Valores, datas e documentos fiscais ficam (obrigação legal).
 */
create function app.privacy_anonymize_customer(p_tenant_id uuid, p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_contacts uuid[];
  v_reqs uuid[];
  v_out jsonb := '{}'::jsonb;
  v_c integer;
begin
  select c.phone into v_phone from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  select coalesce(array_agg(k.id), '{}') into v_contacts from public.channel_contacts k
  where k.tenant_id = p_tenant_id and (k.customer_id = p_customer_id or (v_phone is not null and k.phone_e164 = v_phone));
  update public.lifecycle_steps s set channel_message_id = null
  from public.channel_messages m
  where s.tenant_id = p_tenant_id and m.tenant_id = s.tenant_id and m.id = s.channel_message_id and m.contact_id = any (v_contacts);
  delete from public.channel_messages m where m.tenant_id = p_tenant_id and m.contact_id = any (v_contacts);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('channel_messages', v_c);
  delete from public.channel_contacts k where k.tenant_id = p_tenant_id and k.id = any (v_contacts);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('channel_contacts', v_c);

  select coalesce(array_agg(q.id), '{}') into v_reqs from public.public_booking_requests q
  where q.tenant_id = p_tenant_id and v_phone is not null and q.contact_phone_e164 = v_phone;
  update public.public_booking_requests q set replaced_request_id = null where q.replaced_request_id = any (v_reqs);
  update public.bookings b set guest_ref = null
  from public.public_booking_requests q
  where q.id = any (v_reqs) and b.tenant_id = q.tenant_id and b.id = q.booking_id and b.guest_ref is not null;
  delete from public.public_booking_requests q where q.id = any (v_reqs);
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('public_booking_requests', v_c);

  update public.lifecycle_steps s set body = '[removido a pedido do titular]', params = '{}'::jsonb
  where s.tenant_id = p_tenant_id and s.customer_id = p_customer_id;
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('lifecycle_steps', v_c);
  update public.reviews r set body = null
  from public.bookings b
  where r.tenant_id = p_tenant_id and b.tenant_id = r.tenant_id and b.id = r.booking_id and b.customer_id = p_customer_id and r.body is not null;
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('reviews', v_c);
  update public.customer_links l set revoked_at = clock_timestamp()
  where l.tenant_id = p_tenant_id and l.customer_id = p_customer_id and l.revoked_at is null;
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('customer_links', v_c);
  delete from public.customer_link_invites i where i.tenant_id = p_tenant_id and i.customer_id = p_customer_id;
  update public.waitlist_entries w set status = 'withdrawn'
  where w.tenant_id = p_tenant_id and w.customer_id = p_customer_id and w.status in ('active', 'offered');

  update public.customers c
  set name = 'Cliente removido', phone = null, email = null, declared_source = null,
      archived_at = coalesce(c.archived_at, clock_timestamp())
  where c.tenant_id = p_tenant_id and c.id = p_customer_id;
  v_out := v_out || jsonb_build_object('customers', 1);
  return v_out;
end $$;
revoke all on function app.privacy_anonymize_customer(uuid, uuid) from public, anon, authenticated;

/**
 * Elimina o negócio depois da carência: anonimiza todos os clientes, apaga mensagens, contatos e pedidos pelo link
 * que sobrarem, tira o perfil público do ar e limpa seus textos, encerra o acesso (memberships) e fecha o negócio.
 */
create function app.privacy_erase_business(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_n integer := 0;
  v_out jsonb := '{}'::jsonb;
  v_c integer;
begin
  for v_customer in select c.id from public.customers c where c.tenant_id = p_tenant_id and c.name <> 'Cliente removido' loop
    perform app.privacy_anonymize_customer(p_tenant_id, v_customer);
    v_n := v_n + 1;
  end loop;
  v_out := v_out || jsonb_build_object('customers', v_n);
  update public.lifecycle_steps s set channel_message_id = null where s.tenant_id = p_tenant_id and s.channel_message_id is not null;
  delete from public.channel_messages m where m.tenant_id = p_tenant_id;
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('channel_messages', v_c);
  delete from public.channel_contacts k where k.tenant_id = p_tenant_id;
  update public.public_booking_requests q set replaced_request_id = null where q.tenant_id = p_tenant_id;
  delete from public.public_booking_requests q where q.tenant_id = p_tenant_id;
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('public_booking_requests', v_c);
  update public.bookings b set guest_ref = null where b.tenant_id = p_tenant_id and b.guest_ref is not null;
  update public.public_profiles p
  set published_at = null, address = null, opening_hours = null, cancellation_policy = null,
      photo_path = null, show_photo = false, show_whatsapp = false
  where p.tenant_id = p_tenant_id;
  update public.reviews r set body = null, reply_body = null where r.tenant_id = p_tenant_id;
  update public.discovery_listings d set status = 'unlisted' where d.tenant_id = p_tenant_id and d.status = 'listed';
  update public.referrals f set invitee_name = 'Removido' where f.inviter_tenant_id = p_tenant_id;
  update public.tenant_memberships m set active = false where m.tenant_id = p_tenant_id and m.active;
  get diagnostics v_c = row_count;
  v_out := v_out || jsonb_build_object('memberships', v_c);
  update public.tenants t set status = 'closed', name = 'Negócio encerrado' where t.id = p_tenant_id;
  return v_out;
end $$;
revoke all on function app.privacy_erase_business(uuid) from public, anon, authenticated;

/** Pedido de eliminação. Negócio: agenda para daqui a 7 dias (cancelável). Cliente final: anonimiza agora. */
create function public.privacy_erasure_request(
  p_tenant_id uuid,
  p_scope text,
  p_customer_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_e public.privacy_erasures;
  v_summary jsonb;
  v_body jsonb;
begin
  perform app.privacy_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'privacy.erase', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_scope not in ('business', 'customer') or (p_scope = 'customer') <> (p_customer_id is not null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'scope';
  end if;
  if p_scope = 'business' then
    if exists (select 1 from public.privacy_erasures e where e.tenant_id = p_tenant_id and e.scope = 'business' and e.status = 'scheduled') then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'scheduled';
    end if;
    insert into public.privacy_erasures (tenant_id, scope, status, requested_by, execute_after)
    values (p_tenant_id, 'business', 'scheduled', v_uid, clock_timestamp() + interval '7 days')
    returning * into v_e;
  else
    if not exists (select 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id) then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
    end if;
    v_summary := app.privacy_anonymize_customer(p_tenant_id, p_customer_id);
    insert into public.privacy_erasures (tenant_id, scope, customer_id, status, requested_by, execute_after, done_at, summary)
    values (p_tenant_id, 'customer', p_customer_id, 'done', v_uid, clock_timestamp(), clock_timestamp(), v_summary)
    returning * into v_e;
  end if;
  perform app.audit(p_tenant_id, 'privacy.erase_' || p_scope, 'privacy_erasure', v_e.id, p_request_id, null,
    jsonb_build_object('scope', p_scope, 'status', v_e.status, 'execute_after', v_e.execute_after, 'summary', v_summary));
  v_body := jsonb_build_object('erasure', app.privacy_erasure_json(v_e));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'privacy.erase', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Cancela a eliminação do negócio dentro da carência. */
create function public.privacy_erasure_cancel(
  p_tenant_id uuid,
  p_erasure_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_e public.privacy_erasures;
  v_body jsonb;
begin
  perform app.privacy_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'privacy.erase_cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_e from public.privacy_erasures e where e.tenant_id = p_tenant_id and e.id = p_erasure_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_e.status <> 'scheduled' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.privacy_erasures e set status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = v_uid
  where e.id = v_e.id returning * into v_e;
  perform app.audit(p_tenant_id, 'privacy.erase_cancel', 'privacy_erasure', v_e.id, p_request_id, null,
    jsonb_build_object('scope', v_e.scope));
  v_body := jsonb_build_object('erasure', app.privacy_erasure_json(v_e));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'privacy.erase_cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.privacy_erasures_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.privacy_owner(p_tenant_id);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(app.privacy_erasure_json(x) order by x.requested_at desc)
    from (select e.* from public.privacy_erasures e where e.tenant_id = p_tenant_id order by e.requested_at desc limit 20) x), '[]'::jsonb));
end $$;

/** Rotina: executa as eliminações de negócio vencidas. Uma por vez, com auditoria e resumo de contagens. */
create function app.privacy_erasure_tick(p_batch integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_e public.privacy_erasures;
  v_summary jsonb;
  v_done integer := 0;
begin
  for v_e in
    select * from public.privacy_erasures e
    where e.status = 'scheduled' and e.execute_after <= clock_timestamp()
    order by e.execute_after limit least(greatest(coalesce(p_batch, 5), 1), 50)
    for update skip locked
  loop
    v_summary := app.privacy_erase_business(v_e.tenant_id);
    update public.privacy_erasures e set status = 'done', done_at = clock_timestamp(), summary = v_summary where e.id = v_e.id;
    perform app.audit(v_e.tenant_id, 'privacy.erase_business_done', 'privacy_erasure', v_e.id, null, null,
      jsonb_build_object('summary', v_summary));
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('done', v_done);
end $$;
revoke all on function app.privacy_erasure_tick(integer) from public, anon, authenticated;

revoke all on function public.privacy_export_start(uuid, text, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.privacy_export_data(uuid, uuid) from public, anon, authenticated;
revoke all on function public.privacy_export_finish(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.privacy_exports_list(uuid) from public, anon, authenticated;
revoke all on function public.privacy_export_get(uuid, uuid) from public, anon, authenticated;
revoke all on function public.privacy_erasure_request(uuid, text, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.privacy_erasure_cancel(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.privacy_erasures_list(uuid) from public, anon, authenticated;
grant execute on function public.privacy_export_start(uuid, text, uuid, text, text, uuid) to authenticated;
grant execute on function public.privacy_export_data(uuid, uuid) to authenticated;
grant execute on function public.privacy_export_finish(uuid, uuid, bigint) to authenticated;
grant execute on function public.privacy_exports_list(uuid) to authenticated;
grant execute on function public.privacy_export_get(uuid, uuid) to authenticated;
grant execute on function public.privacy_erasure_request(uuid, text, uuid, text, text, uuid) to authenticated;
grant execute on function public.privacy_erasure_cancel(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.privacy_erasures_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Rotinas novas (P56: pacote novo insere linha, não reescreve jobs_run)
-- ---------------------------------------------------------------------------

insert into public.job_ticks (name, fn, takes_batch, batch, phase, position) values
  ('retention', 'app.retention_tick', true, 500, 'after_outbox', 30),
  ('privacy_erasure', 'app.privacy_erasure_tick', true, 5, 'after_outbox', 40);
