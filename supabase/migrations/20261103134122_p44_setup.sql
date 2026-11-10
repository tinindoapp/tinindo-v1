-- P44 · Configuração guiada ("Deixe seu negócio pronto"): estado de configuração calculado pelos dados reais, passos
-- opcionais dispensáveis, modelos de serviço por profissão (só por migration), aplicação confirmada de serviços e do
-- rascunho "descreva seu negócio em uma frase", evento `setup.step_completed.v1` e o indicador "negócios prontos em 24 h".
-- Invariantes (docs/12 §onboarding, docs/05, plano-assistente §3, tasks/P44, ADR-0035):
-- * O estado de cada passo vem das tabelas dos outros pacotes (P01, P02, P03, P07, P09, P12), nunca de uma flag gravada
--   à mão: `done` é consequência do dado existir, e `done_at` é a data real desse dado.
-- * Nada é gravado sem confirmação: os modelos são sugestão; criar serviços e aplicar o rascunho são comandos
--   idempotentes do dono, que passam pelas mesmas RPCs do P02 (serviço) e do P03 (expediente).
-- * O evento sai uma vez por (negócio, passo), com o tempo desde o cadastro medido pelo dado real.
-- * Modelos entram só por migration (revisão humana), como `content_templates` do P22.
-- Depende de: fundação, P01, P02, P03, P07, P09 (+ foto), P12, P15 (operador), P18.

-- ---------------------------------------------------------------------------
-- Catálogo dos passos (constante; a ordem é a de prioridade)
-- ---------------------------------------------------------------------------

create function app.setup_steps() returns table (step text, ord integer, required boolean, title text, why text, link text)
language sql immutable set search_path = '' as $$
  select * from (values
    ('hours', 1, true, 'Definir seus horários de atendimento',
      'Sem expediente, o link público não mostra horários e ninguém consegue reservar.', '/app/agenda/horarios'),
    ('service', 2, true, 'Cadastrar um serviço com duração e preço',
      'O cliente escolhe o serviço no link: a duração vira o horário e o preço vira o valor combinado.', '/app/clientes/servicos'),
    ('cancellation_policy', 3, true, 'Definir a antecedência para cancelar',
      'A política aparece para o cliente antes de reservar e evita discussão depois.', '/app/conta'),
    ('profile', 4, true, 'Publicar seu perfil e mandar o link',
      'O link público é como o cliente reserva com você. Sem ele, só por mensagem.', '/app/perfil'),
    ('first_customer', 5, false, 'Cadastrar seu primeiro cliente',
      'Com o cliente na lista, o atendimento já sai com nome e WhatsApp.', '/app/clientes'),
    ('photo_whatsapp', 6, false, 'Pôr foto e WhatsApp no perfil',
      'Foto e WhatsApp passam confiança a quem chega pelo link.', '/app/perfil'),
    ('channel', 7, false, 'Conectar e verificar seu número',
      'Com o número verificado, o código da reserva pelo link e os lembretes saem pelo canal.', '/app/mensagens'),
    ('first_cash', 8, false, 'Registrar o primeiro recebimento',
      'O Caixa mostra o que entrou e o que falta cobrar a partir do primeiro registro.', '/app/caixa')
  ) as v(step, ord, required, title, why, link)
$$;

/** 'required' | 'optional' | null (passo inexistente). Para as checks de tabela, que não aceitam subconsulta. */
create function app.setup_step_kind(p_step text) returns text
language sql immutable set search_path = '' as $$
  select case when s.required then 'required' else 'optional' end from app.setup_steps() s where s.step = p_step
$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

-- Modelos de serviço por profissão. Entram só por migration (revisão humana); a tela só lê e sugere.
create table public.setup_service_templates (
  code text primary key check (code ~ '^[a-z0-9_]{3,40}$'),
  profession text not null check (profession in ('barber', 'hairdresser', 'personal_trainer', 'other')),
  -- 'service' vira um serviço do catálogo (P02); 'package' é só informação (pacote vende-se no Caixa, P07).
  kind text not null default 'service' check (kind in ('service', 'package')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  duration_min integer not null check (duration_min between 5 and 1440),
  buffer_before_min integer not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min integer not null default 0 check (buffer_after_min between 0 and 240),
  -- Faixa típica de preço, em centavos. Nunca "média de mercado": é um ponto de partida que o dono revisa.
  price_from_cents bigint check (price_from_cents between 0 and 9007199254740991),
  price_to_cents bigint check (price_to_cents between 0 and 9007199254740991),
  ord integer not null check (ord between 1 and 50),
  approved_by text not null default 'tinindo',
  created_at timestamptz not null default now(),
  constraint setup_service_templates_range check ((price_from_cents is null) = (price_to_cents is null) and coalesce(price_from_cents <= price_to_cents, true))
);
comment on table public.setup_service_templates is 'Modelos de serviço por profissão, aprovados por migration. Sugestão marcável; nada é criado sem confirmação do dono.';
create trigger setup_service_templates_append_only before update or delete on public.setup_service_templates
  for each row execute function app.forbid_mutation();

insert into public.setup_service_templates (code, profession, kind, name, duration_min, buffer_before_min, buffer_after_min, price_from_cents, price_to_cents, ord) values
  ('barber_corte', 'barber', 'service', 'Corte', 30, 0, 10, 3500, 7000, 1),
  ('barber_barba', 'barber', 'service', 'Barba', 20, 0, 5, 2500, 5000, 2),
  ('barber_corte_barba', 'barber', 'service', 'Corte e barba', 50, 0, 10, 5500, 11000, 3),
  ('hair_corte', 'hairdresser', 'service', 'Corte', 45, 0, 10, 5000, 15000, 1),
  ('hair_escova', 'hairdresser', 'service', 'Escova', 40, 0, 10, 4000, 10000, 2),
  ('hair_coloracao', 'hairdresser', 'service', 'Coloração', 120, 0, 15, 12000, 35000, 3),
  ('hair_hidratacao', 'hairdresser', 'service', 'Hidratação', 45, 0, 10, 5000, 15000, 4),
  ('pt_avaliacao', 'personal_trainer', 'service', 'Avaliação física', 45, 15, 15, 8000, 20000, 1),
  ('pt_sessao', 'personal_trainer', 'service', 'Sessão individual', 60, 15, 15, 8000, 20000, 2),
  ('pt_pacote_10', 'personal_trainer', 'package', 'Pacote de 10 sessões', 60, 15, 15, 70000, 180000, 3),
  ('other_atendimento', 'other', 'service', 'Atendimento', 60, 0, 10, null, null, 1);

-- Passos opcionais que o dono dispensou ("agora não"). Um por (negócio, passo); tirar a dispensa apaga a linha.
create table public.setup_dismissals (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  step text not null,
  dismissed_by uuid,
  dismissed_at timestamptz not null default now(),
  primary key (tenant_id, step),
  constraint setup_dismissals_optional check (app.setup_step_kind(step) = 'optional')
);
comment on table public.setup_dismissals is 'Passos opcionais dispensados pelo dono. Passo obrigatório nunca entra aqui.';

-- Primeira vez que cada passo foi visto concluído: medição ("negócios prontos em 24 h") e dedupe do evento. Backend-only.
create table public.setup_step_completions (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  step text not null check (app.setup_step_kind(step) is not null),
  -- Data real do dado que concluiu o passo (criação do serviço, publicação do perfil…), não a da leitura.
  completed_at timestamptz not null,
  detected_at timestamptz not null default now(),
  seconds_since_signup bigint not null check (seconds_since_signup >= 0),
  primary key (tenant_id, step)
);
comment on table public.setup_step_completions is 'Backend-only. Uma linha por (negócio, passo) quando o passo foi visto concluído; o evento sai junto, uma vez.';
create trigger setup_step_completions_append_only before update or delete on public.setup_step_completions
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Estado calculado pelos dados reais
-- ---------------------------------------------------------------------------

/** Cada passo com `done` e a data real do dado (nula enquanto não feito). Sem autorização: quem chama já autorizou. */
create function app.setup_state(p_tenant_id uuid) returns table (step text, done boolean, done_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'hours', count(*) > 0, min(r.created_at) from public.availability_rules r where r.tenant_id = p_tenant_id
  union all
  select 'service', count(*) > 0, min(s.created_at) from public.provider_services s
    where s.tenant_id = p_tenant_id and s.active and s.base_price_cents > 0
  union all
  select 'cancellation_policy', coalesce(bool_or(o.cancellation_notice_hours is not null), false),
    max(o.updated_at) filter (where o.cancellation_notice_hours is not null)
    from public.tenant_onboarding o where o.tenant_id = p_tenant_id
  union all
  select 'profile', coalesce(bool_or(p.published_at is not null), false), max(p.published_at)
    from public.public_profiles p where p.tenant_id = p_tenant_id
  union all
  select 'first_customer', count(*) > 0, min(c.created_at) from public.customers c where c.tenant_id = p_tenant_id and c.archived_at is null
  union all
  select 'photo_whatsapp',
    coalesce(bool_or(p.photo_path is not null or (p.show_whatsapp and app.network_whatsapp(p_tenant_id) is not null)), false),
    max(p.updated_at) filter (where p.photo_path is not null or (p.show_whatsapp and app.network_whatsapp(p_tenant_id) is not null))
    from public.public_profiles p where p.tenant_id = p_tenant_id
  union all
  select 'channel', count(*) > 0, min(c.verified_at) from public.channel_connections c where c.tenant_id = p_tenant_id and c.status = 'active'
  union all
  select 'first_cash', count(*) > 0, min(e.created_at) from public.payment_entries e where e.tenant_id = p_tenant_id
$$;

/** Quando o negócio ficou pronto (todos os obrigatórios feitos): a data do último obrigatório. Nulo se falta algum. */
create function app.setup_ready_at(p_tenant_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when bool_and(s.done) then max(s.done_at) end
  from app.setup_state(p_tenant_id) s join app.setup_steps() d on d.step = s.step
  where d.required
$$;

/** Grava a primeira conclusão de cada passo e emite `setup.step_completed.v1` uma vez por (negócio, passo). */
create function app.setup_record_completions(p_tenant_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_created timestamptz;
  v_n integer := 0;
  r record;
begin
  select t.created_at into v_created from public.tenants t where t.id = p_tenant_id;
  -- Serializa por negócio: duas leituras ao mesmo tempo gravam uma conclusão (e um evento) por passo.
  perform pg_advisory_xact_lock(hashtext('setup:' || p_tenant_id::text));
  for r in
    select s.step, s.done_at, d.required
    from app.setup_state(p_tenant_id) s join app.setup_steps() d on d.step = s.step
    where s.done and not exists (select 1 from public.setup_step_completions c where c.tenant_id = p_tenant_id and c.step = s.step)
    order by d.ord
  loop
    insert into public.setup_step_completions (tenant_id, step, completed_at, seconds_since_signup)
    values (p_tenant_id, r.step, coalesce(r.done_at, now()), greatest(0, floor(extract(epoch from coalesce(r.done_at, now()) - v_created)))::bigint);
    v_n := v_n + 1;
    perform app.emit_event(p_tenant_id, 'setup.step_completed.v1', p_tenant_id,
      (select count(*)::int from public.setup_step_completions c where c.tenant_id = p_tenant_id), gen_random_uuid(),
      jsonb_build_object('step', r.step, 'required', r.required,
        'completed_at', app.sched_ts(coalesce(r.done_at, now())),
        'seconds_since_signup', greatest(0, floor(extract(epoch from coalesce(r.done_at, now()) - v_created)))::bigint,
        'ready', app.setup_ready_at(p_tenant_id) is not null));
  end loop;
  return v_n;
end $$;

/** Progresso como a tela mostra: passos em ordem com done, why, link e dispensa; próximo passo; pronto. */
create function app.setup_progress_json(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select x.id, x.name, x.profession, x.created_at, x.timezone from public.tenants x where x.id = p_tenant_id),
  rows as (
    select d.step, d.ord, d.required, d.title, d.why, d.link, s.done, s.done_at,
      exists (select 1 from public.setup_dismissals m where m.tenant_id = p_tenant_id and m.step = d.step) as dismissed
    from app.setup_steps() d join app.setup_state(p_tenant_id) s on s.step = d.step
  )
  select jsonb_build_object(
    'business_name', (select name from t),
    'profession', (select profession from t),
    'created_at', app.sched_ts((select created_at from t)),
    'steps', (select jsonb_agg(jsonb_build_object('step', r.step, 'required', r.required, 'title', r.title,
        'why', case when r.done then null else r.why end, 'link', r.link, 'done', r.done,
        'done_at', case when r.done then app.sched_ts(r.done_at) end, 'dismissed', r.dismissed and not r.done) order by r.ord) from rows r),
    'done_count', (select count(*) from rows r where r.done),
    'resolved_count', (select count(*) from rows r where r.done or r.dismissed),
    'total', (select count(*) from rows),
    'next', (select r.step from rows r where not r.done and not r.dismissed order by (not r.required), r.ord limit 1),
    'ready', app.setup_ready_at(p_tenant_id) is not null,
    'ready_at', app.sched_ts(app.setup_ready_at(p_tenant_id)),
    'ready_in_24h', app.setup_ready_at(p_tenant_id) is not null and app.setup_ready_at(p_tenant_id) <= (select created_at from t) + interval '24 hours')
$$;

/** Indicador da operação (P18): negócios criados no período e quantos ficaram prontos em até 24 h do cadastro. */
create function app.setup_ready_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select t.id, t.created_at, app.setup_ready_at(t.id) as ready_at
    from public.tenants t where t.created_at >= p_from and t.created_at < p_to
  )
  select jsonb_build_object(
    'businesses', count(*),
    'ready', count(*) filter (where ready_at is not null),
    'ready_in_24h', count(*) filter (where ready_at is not null and ready_at <= created_at + interval '24 hours'),
    'note', 'Pronto = expediente, serviço com preço, antecedência de cancelamento e perfil publicado, pela data real de cada dado. Conta só negócios criados no período.')
  from b
$$;

-- ---------------------------------------------------------------------------
-- RPCs do dono (uma transação cada; o rpc-handler só traduz)
-- ---------------------------------------------------------------------------

create function app.setup_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/** Leitura que grava a medição: membros do negócio. Cada leitura registra os passos vistos concluídos pela primeira vez. */
create function public.setup_progress(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  perform app.setup_record_completions(p_tenant_id);
  return app.setup_progress_json(p_tenant_id);
end $$;

/** Dispensa (ou volta a mostrar) um passo opcional. Passo obrigatório → 400 (campo step). */
create function public.setup_dismiss(
  p_tenant_id uuid,
  p_step text,
  p_dismissed boolean,
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
  perform app.setup_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'setup.dismiss', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if not exists (select 1 from app.setup_steps() s where s.step = p_step and not s.required) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'step';
  end if;
  if coalesce(p_dismissed, true) then
    insert into public.setup_dismissals (tenant_id, step, dismissed_by) values (p_tenant_id, p_step, v_uid)
    on conflict (tenant_id, step) do nothing;
  else
    delete from public.setup_dismissals m where m.tenant_id = p_tenant_id and m.step = p_step;
  end if;
  perform app.audit(p_tenant_id, 'setup.dismiss', 'setup_step', null, p_request_id, null,
    jsonb_build_object('step', p_step, 'dismissed', coalesce(p_dismissed, true)));
  v_body := jsonb_build_object('step', p_step, 'dismissed', coalesce(p_dismissed, true), 'progress', app.setup_progress_json(p_tenant_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'setup.dismiss', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Modelos da profissão do negócio, marcando os que já existem no catálogo (mesmo nome normalizado). */
create function public.setup_templates(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_prof text;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select t.profession into v_prof from public.tenants t where t.id = p_tenant_id;
  return jsonb_build_object(
    'profession', v_prof,
    'templates', coalesce((select jsonb_agg(jsonb_build_object('code', m.code, 'kind', m.kind, 'name', m.name, 'duration_min', m.duration_min,
        'buffer_before_min', m.buffer_before_min, 'buffer_after_min', m.buffer_after_min,
        'price_from_cents', m.price_from_cents, 'price_to_cents', m.price_to_cents,
        'exists', exists (select 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.active and s.name_key = app.crm_name_key(m.name)))
        order by m.ord)
      from public.setup_service_templates m where m.profession = v_prof), '[]'::jsonb));
end $$;

/**
 * Cria os serviços confirmados pelo dono, um a um pela RPC do P02 (mesmas regras: nome único entre ativos, limites).
 * Tudo ou nada. Entrada: [{template_code|null, name, duration_min, base_price_cents}]. Devolve os criados.
 */
create function app.setup_apply_services(p_tenant_id uuid, p_services jsonb, p_idem_key text, p_request_hash text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
  v_t public.setup_service_templates;
  v_i integer := 0;
  r record;
begin
  if p_services is null or jsonb_typeof(p_services) <> 'array' or jsonb_array_length(p_services) not between 1 and 20 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'services';
  end if;
  for r in
    select x.template_code, x.name, x.duration_min, x.base_price_cents
    from jsonb_to_recordset(p_services) as x(template_code text, name text, duration_min integer, base_price_cents bigint)
  loop
    v_i := v_i + 1;
    v_t := null;
    if r.template_code is not null then
      select * into v_t from public.setup_service_templates m where m.code = r.template_code and m.kind = 'service';
      if not found then
        raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'template_code';
      end if;
    end if;
    if r.name is null or char_length(btrim(r.name)) not between 1 and 120 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'name';
    end if;
    if r.duration_min is null or r.duration_min not between 5 and 1440 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'duration_min';
    end if;
    if r.base_price_cents is null or r.base_price_cents not between 0 and 9007199254740991 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'base_price_cents';
    end if;
    -- Chave derivada e única por item: a repetição do comando inteiro é resolvida antes, pelo claim de fora.
    v_res := public.crm_service_save(p_tenant_id, null, null, r.name, r.duration_min,
      coalesce(v_t.buffer_before_min, 0), coalesce(v_t.buffer_after_min, 0), r.base_price_cents, r.base_price_cents, null, null, true,
      'setup-' || md5(p_idem_key || ':' || v_i), p_request_hash, p_request_id);
    v_out := v_out || jsonb_build_object('id', v_res #>> '{body,service,id}', 'template_code', r.template_code,
      'name', v_res #>> '{body,service,name}', 'duration_min', (v_res #>> '{body,service,duration_min}')::int,
      'base_price_cents', (v_res #>> '{body,service,base_price_cents}')::bigint);
  end loop;
  return v_out;
end $$;

create function public.setup_services_apply(
  p_tenant_id uuid,
  p_services jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_created jsonb;
  v_body jsonb;
begin
  perform app.setup_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'setup.services_apply', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  v_created := app.setup_apply_services(p_tenant_id, p_services, p_idem_key, p_request_hash, p_request_id);
  perform app.setup_record_completions(p_tenant_id);
  perform app.audit(p_tenant_id, 'setup.services_apply', 'provider_service', null, p_request_id, null,
    jsonb_build_object('created', jsonb_array_length(v_created)));
  v_body := jsonb_build_object('created', v_created, 'progress', app.setup_progress_json(p_tenant_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'setup.services_apply', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/**
 * Aplica o rascunho revisado pelo dono ("descreva seu negócio em uma frase"): profissão (opcional), expediente
 * (substitui as regras da agenda principal pela RPC do P03; nulo = não mexe) e serviços (pela RPC do P02). Tudo ou nada.
 */
create function public.setup_draft_apply(
  p_tenant_id uuid,
  p_profession text,
  p_hours jsonb,
  p_services jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_res public.resources;
  v_hours jsonb := null;
  v_created jsonb := '[]'::jsonb;
  v_prof text;
  v_body jsonb;
begin
  perform app.setup_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'setup.draft_apply', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_profession is not null then
    if p_profession not in ('barber', 'hairdresser', 'personal_trainer', 'other') then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'profession';
    end if;
    update public.tenants t set profession = p_profession where t.id = p_tenant_id and t.profession <> p_profession;
  end if;
  select t.profession into v_prof from public.tenants t where t.id = p_tenant_id;
  if p_hours is not null then
    if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 50 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'hours';
    end if;
    select * into v_res from public.resources r where r.tenant_id = p_tenant_id and r.active order by r.created_at, r.id limit 1;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
    end if;
    v_hours := public.scheduling_rules_save(p_tenant_id, v_res.id, v_res.version, p_hours,
      'setup-' || md5(p_idem_key || ':hours'), p_request_hash, p_request_id) -> 'body';
  end if;
  if p_services is not null and jsonb_typeof(p_services) = 'array' and jsonb_array_length(p_services) > 0 then
    v_created := app.setup_apply_services(p_tenant_id, p_services, p_idem_key, p_request_hash, p_request_id);
  end if;
  perform app.setup_record_completions(p_tenant_id);
  perform app.audit(p_tenant_id, 'setup.draft_apply', 'tenant', p_tenant_id, p_request_id, null,
    jsonb_build_object('profession', p_profession, 'hours', case when v_hours is null then null else jsonb_array_length(v_hours -> 'rules') end,
      'services', jsonb_array_length(v_created)));
  v_body := jsonb_build_object('profession', v_prof, 'hours', case when v_hours is null then null else v_hours -> 'rules' end,
    'created', v_created, 'progress', app.setup_progress_json(p_tenant_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'setup.draft_apply', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- P18 · indicador "negócios prontos em 24 h" na consulta da operação (aditivo: campo novo no mesmo JSON)
-- ---------------------------------------------------------------------------

create or replace function public.analytics_cost_to_serve(p_from timestamptz, p_to timestamptz, p_hourly_cost_cents bigint)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_op public.platform_operators;
begin
  v_op := app.svc_operator();
  perform app.an_period(p_from, p_to);
  if p_hourly_cost_cents is null or p_hourly_cost_cents < 0 or p_hourly_cost_cents > 10000000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'hourly_cost_cents';
  end if;
  return (
    with per as (
      select t.id as tenant_id, t.name as tenant_name,
        coalesce(sum(w.minutes) filter (where w.kind = 'human'), 0)::int as human_minutes,
        coalesce(sum(w.minutes) filter (where w.kind = 'automation'), 0)::int as automation_minutes,
        coalesce(sum(w.minutes) filter (where w.reprocess), 0)::int as reprocess_minutes
      from public.tenants t
      left join public.work_logs w on w.tenant_id = t.id and w.logged_at >= p_from and w.logged_at < p_to
      where exists (select 1 from public.service_orders s where s.tenant_id = t.id)
         or exists (select 1 from public.subscriptions s where s.tenant_id = t.id)
      group by t.id, t.name
    ), rows as (
      select p.*,
        round(p.human_minutes::numeric * p_hourly_cost_cents / 60)::bigint as estimated_cost_cents,
        coalesce((select s.price_cents from public.subscriptions s where s.tenant_id = p.tenant_id and s.status = 'active'), 0) as plan_monthly_cents,
        coalesce((select sum(o.price_cents) from public.service_orders o where o.tenant_id = p.tenant_id and o.status <> 'cancelled'
          and o.created_at >= p_from and o.created_at < p_to), 0)::bigint as services_contracted_cents
      from per p
    )
    select jsonb_build_object(
      'period', jsonb_build_object('starts_at', app.sched_ts(p_from), 'ends_at', app.sched_ts(p_to)),
      'hourly_cost_cents', p_hourly_cost_cents,
      'as_of', app.sched_ts(clock_timestamp()),
      'tenants', coalesce(jsonb_agg(to_jsonb(r) order by r.human_minutes desc, r.tenant_name), '[]'::jsonb),
      'totals', jsonb_build_object('human_minutes', coalesce(sum(r.human_minutes), 0), 'automation_minutes', coalesce(sum(r.automation_minutes), 0),
        'reprocess_minutes', coalesce(sum(r.reprocess_minutes), 0), 'estimated_cost_cents', coalesce(sum(r.estimated_cost_cents), 0)),
      'setup_ready_24h', app.setup_ready_summary(p_from, p_to),
      'note', 'Custo estimado = minutos humanos medidos × custo-hora informado; não inclui infraestrutura, canal, impostos nem aquisição. Valores contratados têm cobrança manual: não são pagamentos confirmados.')
    from rows r
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.setup_steps(), app.setup_step_kind(text), app.setup_state(uuid), app.setup_ready_at(uuid), app.setup_record_completions(uuid),
  app.setup_progress_json(uuid), app.setup_ready_summary(timestamptz, timestamptz), app.setup_owner(uuid),
  app.setup_apply_services(uuid, jsonb, text, text, uuid) from public;
revoke all on function public.setup_progress(uuid) from public, anon;
revoke all on function public.setup_dismiss(uuid, text, boolean, text, text, uuid) from public, anon;
revoke all on function public.setup_templates(uuid) from public, anon;
revoke all on function public.setup_services_apply(uuid, jsonb, text, text, uuid) from public, anon;
revoke all on function public.setup_draft_apply(uuid, text, jsonb, jsonb, text, text, uuid) from public, anon;
grant execute on function public.setup_progress(uuid) to authenticated;
grant execute on function public.setup_dismiss(uuid, text, boolean, text, text, uuid) to authenticated;
grant execute on function public.setup_templates(uuid) to authenticated;
grant execute on function public.setup_services_apply(uuid, jsonb, text, text, uuid) to authenticated;
grant execute on function public.setup_draft_apply(uuid, text, jsonb, jsonb, text, text, uuid) to authenticated;

alter table public.setup_service_templates enable row level security;
alter table public.setup_dismissals enable row level security;
alter table public.setup_step_completions enable row level security;
revoke all on public.setup_service_templates, public.setup_dismissals, public.setup_step_completions from anon, authenticated;
grant select on public.setup_service_templates, public.setup_dismissals to authenticated;
grant select on public.setup_service_templates, public.setup_dismissals, public.setup_step_completions to service_role;
grant insert, delete on public.setup_dismissals to service_role;
grant insert on public.setup_step_completions to service_role;
create policy setup_service_templates_read on public.setup_service_templates for select to authenticated using (true);
create policy setup_dismissals_select_member on public.setup_dismissals for select to authenticated using (app.is_member(tenant_id));
-- setup_step_completions: sem política = ninguém lê pela Data API (backend-only).
