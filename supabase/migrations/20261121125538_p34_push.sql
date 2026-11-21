-- P34 · Notificações no celular (Web Push), item 3 do pacote "App no celular e calendário".
--
-- O profissional escolhe, por aparelho, o que quer receber:
-- - reserva nova pelo link;
-- - cancelamento;
-- - lembrete 30 min antes do atendimento;
-- - resumo do dia às 7h, no fuso do negócio.
--
-- Assinatura por aparelho: o endereço (endpoint) que o navegador gera é único e pertence a uma pessoa num negócio.
-- Envio pela fila que já existe: a rotina `push` entra no registro das rotinas (`job_ticks`, P56). Ela roda junto com
-- o `jobs_run`, lê os eventos do outbox a partir de um cursor e põe as mensagens em `push_deliveries`.
-- A Edge Function `push` (rota push.dispatch, chamada pelo agendador com o segredo dos jobs) é quem entrega.
-- Cada mensagem tem chave de deduplicação por aparelho, então sai UMA vez só, mesmo com duas rodadas em paralelo.
--
-- Dado de cliente: só o primeiro nome (sem telefone, e-mail, sobrenome ou valor). Chaves VAPID só no segredo da
-- função, nunca no banco.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null,
  -- Endereço do serviço de push do navegador (FCM, Apple, Mozilla). Único: um aparelho, uma assinatura.
  endpoint text not null unique check (endpoint ~ '^https://[^\s]+$' and char_length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_-]{16,32}$'),
  device_label text check (char_length(btrim(device_label)) between 1 and 60),
  notify_booking_new boolean not null default true,
  notify_booking_cancelled boolean not null default true,
  notify_reminder_30 boolean not null default true,
  notify_daily_summary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz,
  unique (tenant_id, id)
);
comment on table public.push_subscriptions is 'Avisos no celular (P34): uma linha por aparelho. Só a própria pessoa lê; escrita só pelas RPCs.';
create index push_subscriptions_tenant on public.push_subscriptions (tenant_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select on public.push_subscriptions to authenticated;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid() and app.is_member(tenant_id));

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  subscription_id uuid not null,
  kind text not null check (kind in ('booking_new', 'booking_cancelled', 'reminder_30', 'daily_summary', 'test')),
  -- Uma vez só por aparelho: evento, atendimento + horário, ou dia.
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 120),
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 160),
  url text not null check (url ~ '^/app(/[A-Za-z0-9/_?=&.-]*)?$' and position('..' in url) = 0 and char_length(url) <= 200),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'gone')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_status integer,
  foreign key (tenant_id, subscription_id) references public.push_subscriptions (tenant_id, id) on delete cascade,
  unique (subscription_id, dedupe_key)
);
comment on table public.push_deliveries is 'Fila dos avisos no celular (P34). Só o backend (service role) lê e escreve.';
create index push_deliveries_ready on public.push_deliveries (next_attempt_at) where status in ('pending', 'sending');
create index push_deliveries_tenant on public.push_deliveries (tenant_id, created_at);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;

-- Cursor da leitura do outbox (uma linha). Começa agora: nada do passado vira aviso.
create table public.push_cursor (
  id boolean primary key default true check (id),
  last_occurred_at timestamptz not null default now(),
  last_event_id uuid not null default '00000000-0000-0000-0000-000000000000'
);
insert into public.push_cursor default values;
alter table public.push_cursor enable row level security;
revoke all on public.push_cursor from public, anon, authenticated;

-- Leitura do outbox por ordem de chegada, só dos dois tipos que viram aviso.
create index outbox_events_push on public.outbox_events (occurred_at, event_id)
  where event_type in ('booking.confirmed.v1', 'booking.cancelled.v1');

-- ---------------------------------------------------------------------------
-- Texto do aviso (só primeiro nome; serviço; dia e hora no fuso do negócio)
-- ---------------------------------------------------------------------------

/** Primeiro nome de quem foi atendido: o cadastro do cliente ou o nome informado no link. Nunca telefone ou e-mail. */
create function app.push_first_name(p_tenant_id uuid, p_booking_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select left(nullif(split_part(btrim(coalesce(
    (select c.name from public.bookings b join public.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id
     where b.tenant_id = p_tenant_id and b.id = p_booking_id),
    (select q.contact_name from public.public_booking_requests q
     where q.tenant_id = p_tenant_id and q.booking_id = p_booking_id order by q.created_at desc limit 1),
    '')), ' ', 1), ''), 30)
$$;

/** "Corte · Ana · qui 22/10, 14:00" (sem nome quando não houver). */
create function app.push_booking_line(p_tenant_id uuid, p_booking_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select concat_ws(' · ',
    left(s.name, 40),
    app.push_first_name(b.tenant_id, b.id),
    (array['dom','seg','ter','qua','qui','sex','sáb'])[extract(dow from b.starts_at at time zone t.timezone)::int + 1]
      || ' ' || to_char(b.starts_at at time zone t.timezone, 'DD/MM, HH24:MI'))
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
  where b.tenant_id = p_tenant_id and b.id = p_booking_id
$$;

create function app.push_day_url(p_tenant_id uuid, p_at timestamptz) returns text
language sql stable security definer set search_path = '' as $$
  select '/app/agenda?dia=' || to_char(p_at at time zone t.timezone, 'YYYY-MM-DD') from public.tenants t where t.id = p_tenant_id
$$;

/** Põe um aviso na fila para cada aparelho do negócio que pediu esse tipo (e que não seja de quem fez a ação). */
create function app.push_enqueue(p_tenant_id uuid, p_kind text, p_dedupe text, p_title text, p_body text, p_url text,
  p_skip_user uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  insert into public.push_deliveries (tenant_id, subscription_id, kind, dedupe_key, title, body, url)
  select s.tenant_id, s.id, p_kind, p_dedupe, left(p_title, 60), left(p_body, 160), p_url
  from public.push_subscriptions s
  where s.tenant_id = p_tenant_id
    and (p_skip_user is null or s.user_id <> p_skip_user)
    and app.is_member_user(s.tenant_id, s.user_id)
    and case p_kind
      when 'booking_new' then s.notify_booking_new
      when 'booking_cancelled' then s.notify_booking_cancelled
      when 'reminder_30' then s.notify_reminder_30
      when 'daily_summary' then s.notify_daily_summary
      else false end
  on conflict (subscription_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

/** A pessoa ainda é do negócio (saiu da equipe = para de receber, sem depender de apagar a assinatura). */
create function app.is_member_user(p_tenant_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.active and t.status <> 'closed')
$$;

-- ---------------------------------------------------------------------------
-- Rotina da fila (job_ticks): eventos novos, lembretes de 30 min e resumo do dia
-- ---------------------------------------------------------------------------

create function app.push_tick(p_batch integer default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.push_cursor;
  e record;
  b record;
  v_events integer := 0;
  v_queued integer := 0;
  v_actor uuid;
  v_line text;
begin
  -- Sem nenhum aparelho assinado, só anda o cursor (nada a fazer).
  select * into c from public.push_cursor where id for update skip locked;
  if not found then return jsonb_build_object('skipped', true); end if;

  -- 1 · eventos do outbox a partir do cursor, relendo 15 minutos para trás. `occurred_at` é a hora em que a transação
  --     começou: uma transação longa pode gravar um evento "no passado" depois de a rodada já ter passado por ali.
  --     Reler a janela não duplica nada: a chave `event:<id>` por aparelho é única.
  for e in
    select o.event_id, o.event_type, o.tenant_id, o.aggregate_id, o.occurred_at, o.payload, o.correlation_id
    from public.outbox_events o
    where o.event_type in ('booking.confirmed.v1', 'booking.cancelled.v1')
      and o.occurred_at >= c.last_occurred_at - interval '15 minutes'
    order by o.occurred_at, o.event_id
    limit least(greatest(coalesce(p_batch, 200), 1), 1000)
  loop
    v_events := v_events + 1;
    if exists (select 1 from public.push_subscriptions s where s.tenant_id = e.tenant_id) then
      v_line := app.push_booking_line(e.tenant_id, e.aggregate_id);
      if v_line is not null and e.event_type = 'booking.confirmed.v1' and e.payload ->> 'source' = 'public_link' then
        v_queued := v_queued + app.push_enqueue(e.tenant_id, 'booking_new', 'event:' || e.event_id, 'Reserva nova pelo link',
          v_line, app.push_day_url(e.tenant_id, (e.payload ->> 'starts_at')::timestamptz));
      elsif v_line is not null and e.event_type = 'booking.cancelled.v1' then
        -- Quem cancelou já sabe: os aparelhos dessa pessoa ficam de fora.
        -- A auditoria do MESMO cancelamento: mesmo request_id (a RPC usa o mesmo id no evento e na auditoria) ou,
        -- sem ele, a mesma transação (o now() do evento e da auditoria é o mesmo).
        v_actor := null;
        select a.actor_user_id into v_actor from public.audit_events a
        where a.tenant_id = e.tenant_id and a.object_type = 'booking' and a.object_id = e.aggregate_id and a.action like '%cancel%'
          and (a.request_id = e.correlation_id or a.occurred_at = e.occurred_at)
        order by (a.request_id = e.correlation_id) desc nulls last, a.id desc limit 1;
        v_queued := v_queued + app.push_enqueue(e.tenant_id, 'booking_cancelled', 'event:' || e.event_id, 'Atendimento cancelado',
          v_line, app.push_day_url(e.tenant_id, (e.payload ->> 'starts_at')::timestamptz), v_actor);
      end if;
    end if;
    if e.occurred_at > c.last_occurred_at then
      c.last_occurred_at := e.occurred_at;
      c.last_event_id := e.event_id;
    end if;
  end loop;
  update public.push_cursor set last_occurred_at = c.last_occurred_at, last_event_id = c.last_event_id where id;

  -- 2 · lembrete 30 min antes (janela de 25 a 35 min, para a rodada de minuto em minuto não perder nenhum).
  for b in
    select x.tenant_id, x.id, x.starts_at from public.bookings x
    where x.status = 'confirmed'
      and x.starts_at between clock_timestamp() + interval '25 minutes' and clock_timestamp() + interval '35 minutes'
      and exists (select 1 from public.push_subscriptions s where s.tenant_id = x.tenant_id and s.notify_reminder_30)
    limit 1000
  loop
    v_queued := v_queued + app.push_enqueue(b.tenant_id, 'reminder_30',
      'reminder:' || b.id || ':' || extract(epoch from b.starts_at)::bigint, 'Atendimento em 30 min',
      app.push_booking_line(b.tenant_id, b.id), app.push_day_url(b.tenant_id, b.starts_at));
  end loop;

  -- 3 · resumo do dia, das 7h às 7h30 no fuso do negócio, uma vez por dia (só com atendimento marcado).
  for b in
    select t.id as tenant_id, (clock_timestamp() at time zone t.timezone)::date as day, t.timezone
    from public.tenants t
    where exists (select 1 from public.push_subscriptions s where s.tenant_id = t.id and s.notify_daily_summary)
      and (clock_timestamp() at time zone t.timezone)::time between time '07:00' and time '07:30'
  loop
    declare
      v_n integer;
      v_first timestamptz;
    begin
      select count(*), min(x.starts_at) into v_n, v_first from public.bookings x
      where x.tenant_id = b.tenant_id and x.status = 'confirmed'
        and (x.starts_at at time zone b.timezone)::date = b.day;
      if v_n > 0 then
        v_queued := v_queued + app.push_enqueue(b.tenant_id, 'daily_summary', 'summary:' || b.day, 'Seu dia',
          'Hoje: ' || v_n || case when v_n = 1 then ' atendimento' else ' atendimentos' end
            || ', o primeiro às ' || to_char(v_first at time zone b.timezone, 'HH24:MI') || '.',
          '/app');
      end if;
    end;
  end loop;

  -- Limpeza: entregues ou desistidos há mais de 30 dias.
  delete from public.push_deliveries d where d.status in ('sent', 'failed', 'gone') and d.created_at < clock_timestamp() - interval '30 days';
  return jsonb_build_object('events', v_events, 'queued', v_queued);
end $$;

insert into public.job_ticks (name, fn, takes_batch, batch, phase, position) values
  ('push', 'app.push_tick', true, 200, 'after_outbox', 50);

-- ---------------------------------------------------------------------------
-- Entrega (service role): pega um lote com prazo e anota o resultado
-- ---------------------------------------------------------------------------

/** Pega até p_batch avisos prontos, com prazo de 2 min. Duas rodadas em paralelo nunca pegam o mesmo (skip locked). */
create function public.push_claim(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  with picked as (
    update public.push_deliveries d
    set status = 'sending', leased_until = clock_timestamp() + interval '2 minutes', attempts = d.attempts + 1
    where d.id in (
      select x.id from public.push_deliveries x
      where (x.status = 'pending' and x.next_attempt_at <= clock_timestamp())
         or (x.status = 'sending' and x.leased_until < clock_timestamp())
      order by x.next_attempt_at
      limit least(greatest(coalesce(p_batch, 50), 1), 200)
      for update skip locked)
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'title', p.title, 'body', p.body, 'url', p.url, 'attempts', p.attempts,
    'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret)), '[]'::jsonb)
  into v
  from picked p join public.push_subscriptions s on s.tenant_id = p.tenant_id and s.id = p.subscription_id;
  return v;
end $$;

/**
 * Resultado do envio: sent; gone (o serviço de push disse 404/410 = o aparelho cancelou → a assinatura sai);
 * failed = tenta de novo com espera crescente, até 5 vezes.
 */
create function public.push_report(p_id uuid, p_result text, p_http integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.push_deliveries;
begin
  select * into d from public.push_deliveries x where x.id = p_id and x.status = 'sending' for update;
  if not found then return; end if;
  if p_result = 'sent' then
    update public.push_deliveries x set status = 'sent', sent_at = clock_timestamp(), leased_until = null, last_status = p_http where x.id = p_id;
    update public.push_subscriptions s set last_sent_at = clock_timestamp() where s.tenant_id = d.tenant_id and s.id = d.subscription_id;
  elsif p_result = 'gone' then
    update public.push_deliveries x set status = 'gone', leased_until = null, last_status = p_http where x.id = p_id;
    delete from public.push_subscriptions s where s.tenant_id = d.tenant_id and s.id = d.subscription_id;
  else
    update public.push_deliveries x
    set status = case when d.attempts >= 5 then 'failed' else 'pending' end,
        leased_until = null, last_status = p_http,
        next_attempt_at = clock_timestamp() + make_interval(secs => least(3600, 30 * power(2, d.attempts - 1)::integer))
    where x.id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Aparelho (pessoa logada): assinar, preferências, cancelar, ver, testar
-- ---------------------------------------------------------------------------

create function app.push_sub_json(s public.push_subscriptions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'device_label', s.device_label, 'created_at', s.created_at, 'last_sent_at', s.last_sent_at,
    'prefs', jsonb_build_object('booking_new', s.notify_booking_new, 'booking_cancelled', s.notify_booking_cancelled,
      'reminder_30', s.notify_reminder_30, 'daily_summary', s.notify_daily_summary))
$$;

/**
 * Assina este aparelho no negócio. O mesmo endereço já assinado (por outra pessoa ou outro negócio, ou seja, o
 * aparelho trocou de conta) passa para quem assinou agora, com as preferências novas.
 */
create function public.push_subscribe(p_tenant_id uuid, p_endpoint text, p_p256dh text, p_auth text,
  p_label text default null, p_prefs jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.push_subscriptions;
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'prefs';
  end if;
  insert into public.push_subscriptions as s (tenant_id, user_id, endpoint, p256dh, auth_secret, device_label,
    notify_booking_new, notify_booking_cancelled, notify_reminder_30, notify_daily_summary)
  values (p_tenant_id, v_uid, p_endpoint, p_p256dh, p_auth, nullif(btrim(p_label), ''),
    coalesce((p_prefs ->> 'booking_new')::boolean, true), coalesce((p_prefs ->> 'booking_cancelled')::boolean, true),
    coalesce((p_prefs ->> 'reminder_30')::boolean, true), coalesce((p_prefs ->> 'daily_summary')::boolean, false))
  on conflict (endpoint) do update set
    tenant_id = excluded.tenant_id, user_id = excluded.user_id, p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
    device_label = excluded.device_label, notify_booking_new = excluded.notify_booking_new,
    notify_booking_cancelled = excluded.notify_booking_cancelled, notify_reminder_30 = excluded.notify_reminder_30,
    notify_daily_summary = excluded.notify_daily_summary, updated_at = clock_timestamp()
  returning * into v;
  return app.push_sub_json(v);
end $$;

/** Liga/desliga por tipo. Só a própria pessoa, no negócio onde o aparelho está assinado. */
create function public.push_prefs_save(p_tenant_id uuid, p_endpoint text, p_prefs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.push_subscriptions;
begin
  if not app.is_member(p_tenant_id) then raise exception using errcode = 'PT403', message = 'FORBIDDEN'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'prefs';
  end if;
  update public.push_subscriptions s set
    notify_booking_new = coalesce((p_prefs ->> 'booking_new')::boolean, s.notify_booking_new),
    notify_booking_cancelled = coalesce((p_prefs ->> 'booking_cancelled')::boolean, s.notify_booking_cancelled),
    notify_reminder_30 = coalesce((p_prefs ->> 'reminder_30')::boolean, s.notify_reminder_30),
    notify_daily_summary = coalesce((p_prefs ->> 'daily_summary')::boolean, s.notify_daily_summary),
    updated_at = clock_timestamp()
  where s.endpoint = p_endpoint and s.user_id = auth.uid() and s.tenant_id = p_tenant_id
  returning * into v;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  return app.push_sub_json(v);
end $$;

/** Para de receber neste aparelho (apaga a assinatura; a fila dela sai junto). */
create function public.push_unsubscribe(p_tenant_id uuid, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not app.is_member(p_tenant_id) then raise exception using errcode = 'PT403', message = 'FORBIDDEN'; end if;
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid();
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n > 0);
end $$;

/** A assinatura deste aparelho neste negócio, ou null. */
create function public.push_device(p_tenant_id uuid, p_endpoint text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.is_member(p_tenant_id) then (
    select app.push_sub_json(s) from public.push_subscriptions s
    where s.endpoint = p_endpoint and s.user_id = auth.uid() and s.tenant_id = p_tenant_id) end
$$;

/** "Enviar um teste": um aviso para este aparelho, no máximo um por minuto. */
create function public.push_test(p_tenant_id uuid, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.push_subscriptions;
  v_n integer;
begin
  if not app.is_member(p_tenant_id) then raise exception using errcode = 'PT403', message = 'FORBIDDEN'; end if;
  select * into s from public.push_subscriptions x where x.endpoint = p_endpoint and x.user_id = auth.uid() and x.tenant_id = p_tenant_id;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  insert into public.push_deliveries (tenant_id, subscription_id, kind, dedupe_key, title, body, url)
  values (s.tenant_id, s.id, 'test', 'test:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MI'), 'Tinindo',
    'Teste: os avisos deste aparelho estão ligados.', '/app')
  on conflict (subscription_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('queued', v_n > 0);
end $$;

revoke all on function app.push_first_name(uuid, uuid) from public, anon, authenticated;
revoke all on function app.push_booking_line(uuid, uuid) from public, anon, authenticated;
revoke all on function app.push_day_url(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.push_enqueue(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function app.is_member_user(uuid, uuid) from public, anon, authenticated;
revoke all on function app.push_tick(integer) from public, anon, authenticated;
revoke all on function app.push_sub_json(public.push_subscriptions) from public, anon, authenticated;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
revoke all on function public.push_report(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;
grant execute on function public.push_report(uuid, text, integer) to service_role;
revoke all on function public.push_subscribe(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.push_prefs_save(uuid, text, jsonb) from public, anon;
revoke all on function public.push_unsubscribe(uuid, text) from public, anon;
revoke all on function public.push_device(uuid, text) from public, anon;
revoke all on function public.push_test(uuid, text) from public, anon;
grant execute on function public.push_subscribe(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.push_prefs_save(uuid, text, jsonb) to authenticated;
grant execute on function public.push_unsubscribe(uuid, text) to authenticated;
grant execute on function public.push_device(uuid, text) to authenticated;
grant execute on function public.push_test(uuid, text) to authenticated;
