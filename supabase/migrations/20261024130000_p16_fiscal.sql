-- P16 · Fiscal seletivo: emissão de NFS-e num caso elegível (MEI, padrão nacional), por provedor fiscal atrás de porta,
-- com representação autorizada pelo dono e credencial válida no provedor; protocolo, documentos e pasta mensal para o
-- contador. Ver ADR-0026.
-- Invariantes (tasks/P16, docs/17, AGENTS.md):
-- * Elegibilidade decidida no servidor (perfil completo, MEI, CNPJ válido, item de serviço suportado, representação
--   ativa, credencial válida no provedor). Fora do caso elegível, nada é enviado.
-- * Representação: o dono autoriza a Tinindo a emitir em nome dele citando o hash dos termos; tem validade e é revogável.
--   A credencial (certificado ou procuração) fica no provedor: a Tinindo só guarda o status informado por ele.
-- * Homologação antes de produção: produção só com caso homologado (nota autorizada em homologação) E liberação do
--   backend (service_role). Nenhuma RPC do app liga produção.
-- * Emitir nota não confirma pagamento: nenhuma função daqui altera recebível, recebimento ou caixa.
-- * Resultado incerto do provedor fica `unknown` e é consultado pela referência (nunca reenviado às cegas).
-- Depende de: fundação, P02 (customers), P07 (receivables).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.fiscal_profiles (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 150),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  regime text not null check (regime in ('mei', 'simples_nacional', 'other')),
  municipality_ibge text not null check (municipality_ibge ~ '^[1-5][0-9]{6}$'),
  -- Item da lista de serviços (LC 116): 06.01 barbearia/cabeleireiros; 06.04 atividades físicas (personal).
  service_code text not null check (service_code in ('06.01', '06.04')),
  -- Liberado só pelo backend, depois de caso homologado. O app nunca escreve aqui.
  production_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);
comment on table public.fiscal_profiles is 'Dados fiscais do prestador para NFS-e. Produção só liberada pelo backend após homologação.';
create trigger fiscal_profiles_touch before update on public.fiscal_profiles for each row execute function app.touch_row();

create table public.fiscal_representations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  scope text not null default 'nfse_emit' check (scope = 'nfse_emit'),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  granted_by uuid not null,
  granted_at timestamptz not null default clock_timestamp(),
  valid_until timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint fiscal_representations_window check (valid_until > granted_at and valid_until <= granted_at + interval '366 days')
);
comment on table public.fiscal_representations is 'Autorização do dono para a Tinindo emitir NFS-e em nome dele (termos por hash, validade, revogação).';
create unique index fiscal_representations_one_open on public.fiscal_representations (tenant_id) where revoked_at is null;

create table public.fiscal_credentials (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  status text not null check (status in ('missing', 'valid', 'expired', 'invalid')),
  valid_until timestamptz,
  environment text not null check (environment in ('homologacao', 'producao')),
  checked_at timestamptz not null default clock_timestamp()
);
comment on table public.fiscal_credentials is 'Status da credencial no provedor fiscal, como o provedor informou. Nenhum certificado ou senha é guardado aqui.';

create table public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  environment text not null check (environment in ('homologacao', 'producao')),
  status text not null default 'submitting' check (status in (
    'submitting', 'processing', 'authorized', 'rejected', 'unknown', 'cancel_requested', 'cancelled')),
  receivable_id uuid,
  customer_id uuid,
  taker_name text not null check (char_length(btrim(taker_name)) between 1 and 150),
  -- CPF (11) ou CNPJ (14) do tomador, só dígitos; opcional para pessoa física. Nunca vai a log.
  taker_document text check (taker_document ~ '^([0-9]{11}|[0-9]{14})$'),
  service_code text not null,
  description text not null check (char_length(btrim(description)) between 3 and 500),
  amount_cents bigint not null check (amount_cents between 1 and 1000000000),
  competence_date date not null,
  provider_ref text not null unique,
  protocol text check (char_length(protocol) <= 80),
  number text check (char_length(number) <= 40),
  verification_code text check (char_length(verification_code) <= 80),
  pdf_url text check (pdf_url ~ '^https://'),
  xml_url text check (xml_url ~ '^https://'),
  reject_reason text check (char_length(reject_reason) <= 300),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  unknown_since timestamptz,
  authorized_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id),
  constraint fiscal_documents_receivable foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id) on delete restrict,
  constraint fiscal_documents_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint fiscal_documents_authorized check (status not in ('authorized', 'cancel_requested', 'cancelled') or (number is not null and authorized_at is not null))
);
comment on table public.fiscal_documents is 'NFS-e emitida pelo provedor. Emitir não confirma pagamento: não toca recebível nem caixa.';
-- Uma nota viva por recebível (cancelada ou rejeitada libera nova emissão).
create unique index fiscal_documents_one_per_receivable on public.fiscal_documents (receivable_id)
  where receivable_id is not null and status in ('submitting', 'processing', 'authorized', 'unknown', 'cancel_requested');
create index fiscal_documents_tenant on public.fiscal_documents (tenant_id, competence_date desc, created_at desc);
create index fiscal_documents_pending on public.fiscal_documents (status) where status in ('submitting', 'unknown', 'processing');
create trigger fiscal_documents_touch before update on public.fiscal_documents for each row execute function app.touch_row();

create table public.fiscal_document_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  document_id uuid not null,
  from_status text,
  to_status text not null,
  note text check (char_length(note) <= 300),
  at timestamptz not null default clock_timestamp(),
  constraint fiscal_document_events_doc foreign key (tenant_id, document_id) references public.fiscal_documents (tenant_id, id) on delete restrict
);
comment on table public.fiscal_document_events is 'Linha do tempo de cada nota (protocolo, autorização, rejeição, cancelamento). Append-only.';
create trigger fiscal_document_events_append_only before update or delete on public.fiscal_document_events for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras e funções internas
-- ---------------------------------------------------------------------------

/** Termos da representação (o hash é o que o dono aprova). Mudar o texto é migration e exige nova autorização. */
create function app.fsc_terms() returns text
language sql immutable set search_path = '' as $$
  select 'Autorizo a Tinindo a emitir, em meu nome, Notas Fiscais de Serviço eletrônicas (NFS-e) dos atendimentos que eu '
    || 'pedir, usando a credencial que eu mesmo cadastrei no provedor fiscal. Cada nota é emitida só quando eu pedir, com os '
    || 'dados que eu conferir. Emitir a nota não confirma pagamento. Posso revogar esta autorização a qualquer momento; '
    || 'a revogação não cancela notas já emitidas.'
$$;

create function app.fsc_terms_hash() returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(app.fsc_terms(), 'sha256'), 'hex')
$$;

create function app.fsc_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/** Dígitos verificadores do CNPJ (módulo 11). Sequências repetidas são inválidas. */
create function app.fsc_cnpj_ok(p_cnpj text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  w1 integer[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  w2 integer[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  s integer := 0;
  d1 integer;
  d2 integer;
  i integer;
begin
  if p_cnpj !~ '^[0-9]{14}$' or p_cnpj ~ '^(.)\1{13}$' then return false; end if;
  for i in 1 .. 12 loop s := s + substr(p_cnpj, i, 1)::integer * w1[i]; end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0;
  for i in 1 .. 13 loop s := s + substr(p_cnpj, i, 1)::integer * w2[i]; end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return d1 = substr(p_cnpj, 13, 1)::integer and d2 = substr(p_cnpj, 14, 1)::integer;
end $$;

/** Dígitos verificadores do CPF. */
create function app.fsc_cpf_ok(p_cpf text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  s integer := 0;
  d1 integer;
  d2 integer;
  i integer;
begin
  if p_cpf !~ '^[0-9]{11}$' or p_cpf ~ '^(.)\1{10}$' then return false; end if;
  for i in 1 .. 9 loop s := s + substr(p_cpf, i, 1)::integer * (11 - i); end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0;
  for i in 1 .. 10 loop s := s + substr(p_cpf, i, 1)::integer * (12 - i); end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return d1 = substr(p_cpf, 10, 1)::integer and d2 = substr(p_cpf, 11, 1)::integer;
end $$;

/** Ambiente em que o negócio emite: produção só com caso homologado e liberação do backend. */
create function app.fsc_environment(p_tenant_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce((select f.production_enabled from public.fiscal_profiles f where f.tenant_id = p_tenant_id), false)
    and exists (select 1 from public.fiscal_documents d where d.tenant_id = p_tenant_id and d.environment = 'homologacao' and d.authorized_at is not null)
    then 'producao' else 'homologacao' end
$$;

/** Elegibilidade decidida aqui, com cada motivo. Vazio = elegível. */
create function app.fsc_eligibility(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.fiscal_profiles;
  c public.fiscal_credentials;
  v_reasons text[] := '{}';
  v_env text := app.fsc_environment(p_tenant_id);
begin
  select * into f from public.fiscal_profiles x where x.tenant_id = p_tenant_id;
  if not found then
    v_reasons := array_append(v_reasons, 'profile_missing');
  else
    if f.regime <> 'mei' then v_reasons := array_append(v_reasons, 'regime_not_eligible'); end if;
    if not app.fsc_cnpj_ok(f.cnpj) then v_reasons := array_append(v_reasons, 'cnpj_invalid'); end if;
  end if;
  if not exists (select 1 from public.fiscal_representations r where r.tenant_id = p_tenant_id and r.revoked_at is null
      and r.valid_until > clock_timestamp() and r.terms_hash = app.fsc_terms_hash()) then
    v_reasons := array_append(v_reasons, 'representation_missing');
  end if;
  select * into c from public.fiscal_credentials x where x.tenant_id = p_tenant_id;
  if not found or c.status <> 'valid' or (c.valid_until is not null and c.valid_until <= clock_timestamp()) or c.environment <> v_env then
    v_reasons := array_append(v_reasons, 'credential_invalid');
  end if;
  return jsonb_build_object('eligible', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'environment', v_env);
end $$;

create function app.fsc_doc_json(d public.fiscal_documents) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'environment', d.environment, 'status', d.status, 'receivable_id', d.receivable_id, 'customer_id', d.customer_id,
    'taker_name', d.taker_name,
    -- Documento do tomador mascarado na leitura (só os 2 últimos dígitos).
    'taker_document_masked', case when d.taker_document is null then null else repeat('•', char_length(d.taker_document) - 2) || right(d.taker_document, 2) end,
    'service_code', d.service_code, 'description', d.description, 'amount_cents', d.amount_cents, 'competence_date', d.competence_date::text,
    'protocol', d.protocol, 'number', d.number, 'verification_code', d.verification_code, 'pdf_url', d.pdf_url, 'xml_url', d.xml_url,
    'reject_reason', d.reject_reason, 'cancel_reason', d.cancel_reason, 'authorized_at', app.fin_ts(d.authorized_at), 'cancelled_at', app.fin_ts(d.cancelled_at),
    'created_at', app.fin_ts(d.created_at), 'version', d.version)
$$;

create function app.fsc_transition(p_doc public.fiscal_documents, p_to text, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.fiscal_document_events (tenant_id, document_id, from_status, to_status, note) values (p_doc.tenant_id, p_doc.id, p_doc.status, p_to, p_note)
$$;

create function app.fsc_overview(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.fiscal_profiles;
  r public.fiscal_representations;
  c public.fiscal_credentials;
begin
  select * into f from public.fiscal_profiles x where x.tenant_id = p_tenant_id;
  select * into r from public.fiscal_representations x where x.tenant_id = p_tenant_id and x.revoked_at is null;
  select * into c from public.fiscal_credentials x where x.tenant_id = p_tenant_id;
  return jsonb_build_object(
    'profile', case when f.tenant_id is null then null else jsonb_build_object('legal_name', f.legal_name, 'cnpj', f.cnpj, 'regime', f.regime,
      'municipality_ibge', f.municipality_ibge, 'service_code', f.service_code, 'production_enabled', f.production_enabled, 'version', f.version) end,
    'terms', jsonb_build_object('text', app.fsc_terms(), 'hash', app.fsc_terms_hash()),
    'representation', case when r.id is null then null else jsonb_build_object('id', r.id, 'granted_at', app.fin_ts(r.granted_at),
      'valid_until', app.fin_ts(r.valid_until), 'current_terms', r.terms_hash = app.fsc_terms_hash(), 'active', r.valid_until > clock_timestamp()) end,
    'credential', case when c.tenant_id is null then null else jsonb_build_object('status', c.status, 'valid_until', app.fin_ts(c.valid_until),
      'environment', c.environment, 'checked_at', app.fin_ts(c.checked_at)) end,
    'eligibility', app.fsc_eligibility(p_tenant_id),
    'homologated', exists (select 1 from public.fiscal_documents d where d.tenant_id = p_tenant_id and d.environment = 'homologacao' and d.authorized_at is not null),
    'documents', coalesce((select jsonb_agg(app.fsc_doc_json(d) order by d.created_at desc, d.id)
      from (select * from public.fiscal_documents x where x.tenant_id = p_tenant_id order by x.created_at desc limit 50) d), '[]'::jsonb),
    'receivables', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'description', v.description, 'amount_cents', v.amount_cents, 'status', v.status,
        'customer_id', v.customer_id, 'customer_name', (select cu.name from public.customers cu where cu.tenant_id = v.tenant_id and cu.id = v.customer_id),
        'created_at', app.fin_ts(v.created_at)) order by v.created_at desc)
      from (select * from public.receivables x where x.tenant_id = p_tenant_id and x.status <> 'cancelled'
            and not exists (select 1 from public.fiscal_documents d where d.receivable_id = x.id
              and d.status in ('submitting', 'processing', 'authorized', 'unknown', 'cancel_requested'))
            order by x.created_at desc limit 30) v), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Dono
-- ---------------------------------------------------------------------------

create function public.fiscal_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fsc_owner(p_tenant_id);
  return app.fsc_overview(p_tenant_id);
end $$;

create function public.fiscal_profile_save(
  p_tenant_id uuid,
  p_expected_version integer,
  p_legal_name text,
  p_cnpj text,
  p_regime text,
  p_municipality_ibge text,
  p_service_code text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  f public.fiscal_profiles;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_body jsonb;
begin
  perform app.fsc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'fiscal.profile_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if not app.fsc_cnpj_ok(v_cnpj) then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cnpj'; end if;
  if p_municipality_ibge is null or p_municipality_ibge !~ '^[1-5][0-9]{6}$' then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'municipality_ibge'; end if;
  if p_regime not in ('mei', 'simples_nacional', 'other') then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'regime'; end if;
  if p_service_code not in ('06.01', '06.04') then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'service_code'; end if;
  if p_legal_name is null or char_length(btrim(p_legal_name)) not between 2 and 150 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'legal_name'; end if;
  select * into f from public.fiscal_profiles x where x.tenant_id = p_tenant_id for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    insert into public.fiscal_profiles (tenant_id, legal_name, cnpj, regime, municipality_ibge, service_code)
    values (p_tenant_id, btrim(p_legal_name), v_cnpj, p_regime, p_municipality_ibge, p_service_code) returning * into f;
  else
    if f.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
    -- Trocar o CNPJ depois de homologar desliga a produção (o novo CNPJ precisa homologar de novo).
    update public.fiscal_profiles x set legal_name = btrim(p_legal_name), cnpj = v_cnpj, regime = p_regime, municipality_ibge = p_municipality_ibge,
      service_code = p_service_code, production_enabled = case when x.cnpj = v_cnpj then x.production_enabled else false end, version = x.version + 1
    where x.tenant_id = p_tenant_id returning * into f;
  end if;
  perform app.audit(p_tenant_id, 'fiscal.profile.save', 'fiscal_profile', p_tenant_id, p_request_id, null,
    jsonb_build_object('regime', f.regime, 'service_code', f.service_code, 'version', f.version));
  v_body := app.fsc_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'fiscal.profile_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.fiscal_representation_set(
  p_tenant_id uuid,
  p_action text,
  p_terms_hash text,
  p_valid_days integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  r public.fiscal_representations;
  v_body jsonb;
begin
  perform app.fsc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'fiscal.representation', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into r from public.fiscal_representations x where x.tenant_id = p_tenant_id and x.revoked_at is null for update;
  if p_action = 'grant' then
    -- Aprovação vinculada aos termos vistos.
    if p_terms_hash is distinct from app.fsc_terms_hash() then raise exception using errcode = 'PT409', message = 'STALE_VERSION', hint = 'terms_hash'; end if;
    if p_valid_days is null or p_valid_days not between 30 and 365 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'valid_days'; end if;
    if r.id is not null then
      update public.fiscal_representations x set revoked_at = clock_timestamp() where x.id = r.id;
    end if;
    insert into public.fiscal_representations (tenant_id, terms_hash, granted_by, valid_until)
    values (p_tenant_id, p_terms_hash, v_uid, clock_timestamp() + make_interval(days => p_valid_days)) returning * into r;
    perform app.audit(p_tenant_id, 'fiscal.representation.grant', 'fiscal_representation', r.id, p_request_id, null,
      jsonb_build_object('valid_until', app.fin_ts(r.valid_until), 'terms_hash', r.terms_hash));
  elsif p_action = 'revoke' then
    if r.id is null then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'representation'; end if;
    update public.fiscal_representations x set revoked_at = clock_timestamp() where x.id = r.id;
    perform app.audit(p_tenant_id, 'fiscal.representation.revoke', 'fiscal_representation', r.id, p_request_id, null, '{}'::jsonb);
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'action';
  end if;
  v_body := app.fsc_overview(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'fiscal.representation', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Dono pede a conferência da credencial: autoriza e devolve o ambiente; a função consulta o provedor. */
create function public.fiscal_credential_target(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fsc_owner(p_tenant_id);
  if not exists (select 1 from public.fiscal_profiles f where f.tenant_id = p_tenant_id) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'profile';
  end if;
  return jsonb_build_object('tenant_id', p_tenant_id, 'environment', app.fsc_environment(p_tenant_id),
    'cnpj', (select f.cnpj from public.fiscal_profiles f where f.tenant_id = p_tenant_id));
end $$;

/** Backend: grava o status da credencial informado pelo provedor. */
create function public.fiscal_credential_record(p_tenant_id uuid, p_environment text, p_status text, p_valid_until timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('missing', 'valid', 'expired', 'invalid') or p_environment not in ('homologacao', 'producao') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'status';
  end if;
  insert into public.fiscal_credentials (tenant_id, status, valid_until, environment) values (p_tenant_id, p_status, p_valid_until, p_environment)
  on conflict (tenant_id) do update set status = excluded.status, valid_until = excluded.valid_until, environment = excluded.environment, checked_at = clock_timestamp();
  perform app.audit(p_tenant_id, 'fiscal.credential.check', 'fiscal_credential', p_tenant_id, null, null, jsonb_build_object('status', p_status, 'environment', p_environment));
  return app.fsc_overview(p_tenant_id);
end $$;

/**
 * Pede a emissão: confere elegibilidade e dados, grava a nota em `submitting` com referência única e devolve o pedido
 * para a função enviar ao provedor. Nunca altera o recebível (emitir não é receber).
 */
create function public.fiscal_emit(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_taker_name text,
  p_taker_document text,
  p_description text,
  p_amount_cents bigint,
  p_competence_date date,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_el jsonb := app.fsc_eligibility(p_tenant_id);
  f public.fiscal_profiles;
  v_rec public.receivables;
  v_doc_num text := nullif(regexp_replace(coalesce(p_taker_document, ''), '[^0-9]', '', 'g'), '');
  d public.fiscal_documents;
  v_id uuid := gen_random_uuid();
  v_body jsonb;
  v_t public.tenants;
begin
  perform app.fsc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'fiscal.emit', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if not (v_el->>'eligible')::boolean then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'eligibility';
  end if;
  select * into f from public.fiscal_profiles x where x.tenant_id = p_tenant_id;
  if v_doc_num is not null and not (app.fsc_cpf_ok(v_doc_num) or app.fsc_cnpj_ok(v_doc_num)) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'taker_document';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 1000000000 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'amount_cents'; end if;
  select * into v_t from public.tenants x where x.id = p_tenant_id;
  if p_competence_date is null or p_competence_date > (clock_timestamp() at time zone v_t.timezone)::date
     or p_competence_date < (clock_timestamp() at time zone v_t.timezone)::date - 60 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'competence_date';
  end if;
  if p_receivable_id is not null then
    select * into v_rec from public.receivables x where x.tenant_id = p_tenant_id and x.id = p_receivable_id;
    if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'receivable_id'; end if;
    if v_rec.status = 'cancelled' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'receivable'; end if;
    if p_amount_cents > v_rec.amount_cents then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'amount_cents'; end if;
  end if;
  begin
    insert into public.fiscal_documents (id, tenant_id, environment, receivable_id, customer_id, taker_name, taker_document, service_code, description,
      amount_cents, competence_date, provider_ref, created_by)
    values (v_id, p_tenant_id, v_el->>'environment', p_receivable_id, v_rec.customer_id, btrim(p_taker_name), v_doc_num, f.service_code, btrim(p_description),
      p_amount_cents, p_competence_date, 'nfse:' || v_id, v_uid)
    returning * into d;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'receivable_has_document';
  end;
  perform app.fsc_transition(d, 'submitting', 'Pedido de emissão em ' || d.environment || '.');
  perform app.audit(p_tenant_id, 'fiscal.emit', 'fiscal_document', d.id, p_request_id, null,
    jsonb_build_object('environment', d.environment, 'amount_cents', d.amount_cents, 'receivable_id', d.receivable_id));
  -- O pedido para o provedor leva o documento do tomador; a resposta guardada na idempotência não.
  v_body := jsonb_build_object('document', app.fsc_doc_json(d));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'fiscal.emit', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body || jsonb_build_object('request', jsonb_build_object(
    'provider_ref', d.provider_ref, 'environment', d.environment, 'cnpj', f.cnpj, 'municipality_ibge', f.municipality_ibge, 'service_code', d.service_code,
    'taker_name', d.taker_name, 'taker_document', d.taker_document, 'description', d.description, 'amount_cents', d.amount_cents,
    'competence_date', d.competence_date::text)));
end $$;

/** Backend: resultado do provedor para a emissão (ou a consulta de um incerto). */
create function public.fiscal_emit_result(p_document_id uuid, p_outcome text, p_protocol text, p_number text, p_verification_code text,
  p_pdf_url text, p_xml_url text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.fiscal_documents;
begin
  if p_outcome not in ('authorized', 'processing', 'rejected', 'unknown') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'outcome';
  end if;
  select * into d from public.fiscal_documents x where x.id = p_document_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  -- Estados finais não voltam (resposta atrasada ou repetida do provedor é ignorada).
  if d.status in ('authorized', 'rejected', 'cancel_requested', 'cancelled') then
    return jsonb_build_object('document', app.fsc_doc_json(d));
  end if;
  if p_outcome = 'authorized' and (p_number is null or p_protocol is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'number';
  end if;
  perform app.fsc_transition(d, p_outcome, case p_outcome when 'authorized' then 'Autorizada: nota ' || p_number || ', protocolo ' || p_protocol || '.'
    when 'rejected' then left('Rejeitada: ' || coalesce(p_reason, 'sem motivo informado'), 300)
    when 'processing' then 'Em processamento no provedor (protocolo ' || coalesce(p_protocol, '—') || ').' else 'Resposta incerta: consultar pela referência.' end);
  update public.fiscal_documents x set status = p_outcome, protocol = coalesce(p_protocol, x.protocol), number = coalesce(p_number, x.number),
    verification_code = coalesce(p_verification_code, x.verification_code), pdf_url = coalesce(p_pdf_url, x.pdf_url), xml_url = coalesce(p_xml_url, x.xml_url),
    reject_reason = case when p_outcome = 'rejected' then left(p_reason, 300) else x.reject_reason end,
    authorized_at = case when p_outcome = 'authorized' then clock_timestamp() else x.authorized_at end,
    unknown_since = case when p_outcome = 'unknown' then coalesce(x.unknown_since, clock_timestamp()) else null end,
    version = x.version + 1
  where x.id = d.id returning * into d;
  if p_outcome = 'authorized' then
    perform app.emit_event(d.tenant_id, 'fiscal.document.authorized.v1', d.id, d.version, gen_random_uuid(),
      jsonb_build_object('environment', d.environment, 'amount_cents', d.amount_cents, 'receivable_id', d.receivable_id));
  end if;
  return jsonb_build_object('document', app.fsc_doc_json(d));
end $$;

create function public.fiscal_cancel(
  p_tenant_id uuid,
  p_document_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  d public.fiscal_documents;
  v_body jsonb;
begin
  perform app.fsc_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'fiscal.cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 15 and 300 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;
  select * into d from public.fiscal_documents x where x.tenant_id = p_tenant_id and x.id = p_document_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if d.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  if d.status <> 'authorized' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status'; end if;
  perform app.fsc_transition(d, 'cancel_requested', left('Cancelamento pedido: ' || btrim(p_reason), 300));
  update public.fiscal_documents x set status = 'cancel_requested', cancel_reason = btrim(p_reason), version = x.version + 1 where x.id = d.id returning * into d;
  perform app.audit(p_tenant_id, 'fiscal.cancel', 'fiscal_document', d.id, p_request_id, null, jsonb_build_object('number', d.number));
  v_body := jsonb_build_object('document', app.fsc_doc_json(d));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'fiscal.cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body || jsonb_build_object('request', jsonb_build_object(
    'provider_ref', d.provider_ref, 'environment', d.environment, 'number', d.number, 'reason', d.cancel_reason)));
end $$;

/** Backend: resultado do cancelamento no provedor. Recusado → a nota continua autorizada, com o motivo na linha do tempo. */
create function public.fiscal_cancel_result(p_document_id uuid, p_outcome text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.fiscal_documents;
begin
  if p_outcome not in ('cancelled', 'refused') then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'outcome'; end if;
  select * into d from public.fiscal_documents x where x.id = p_document_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if d.status <> 'cancel_requested' then return jsonb_build_object('document', app.fsc_doc_json(d)); end if;
  if p_outcome = 'cancelled' then
    perform app.fsc_transition(d, 'cancelled', 'Cancelada no provedor.');
    update public.fiscal_documents x set status = 'cancelled', cancelled_at = clock_timestamp(), version = x.version + 1 where x.id = d.id returning * into d;
  else
    perform app.fsc_transition(d, 'authorized', left('Cancelamento recusado: ' || coalesce(p_reason, 'sem motivo informado'), 300));
    update public.fiscal_documents x set status = 'authorized', version = x.version + 1 where x.id = d.id returning * into d;
  end if;
  return jsonb_build_object('document', app.fsc_doc_json(d));
end $$;

/** Backend: notas incertas, em processamento ou presas no envio há mais de 1 minuto, para consultar pela referência. */
create function public.fiscal_sync_claim(p_batch integer default 50) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('document_id', d.id, 'provider_ref', d.provider_ref, 'environment', d.environment))
    from (select * from public.fiscal_documents x where x.status in ('submitting', 'unknown', 'processing') and coalesce(x.unknown_since, x.updated_at) < clock_timestamp() - interval '1 minute'
          order by coalesce(x.unknown_since, x.updated_at) limit least(greatest(coalesce(p_batch, 50), 1), 200)) d), '[]'::jsonb))
$$;

/** Pasta do mês para o contador: notas autorizadas e canceladas por competência, com totais (cancelada não soma). */
create function public.fiscal_folder(p_tenant_id uuid, p_month text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start date;
begin
  perform app.fsc_owner(p_tenant_id);
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'month'; end if;
  v_start := (p_month || '-01')::date;
  return jsonb_build_object('month', p_month,
    'profile', (select jsonb_build_object('legal_name', f.legal_name, 'cnpj', f.cnpj, 'regime', f.regime, 'municipality_ibge', f.municipality_ibge)
      from public.fiscal_profiles f where f.tenant_id = p_tenant_id),
    'documents', coalesce((select jsonb_agg(app.fsc_doc_json(d) order by d.competence_date, d.number)
      from public.fiscal_documents d where d.tenant_id = p_tenant_id and d.status in ('authorized', 'cancel_requested', 'cancelled')
        and d.competence_date >= v_start and d.competence_date < (v_start + interval '1 month')::date), '[]'::jsonb),
    'totals', (select jsonb_build_object(
        'authorized_count', count(*) filter (where d.status in ('authorized', 'cancel_requested')),
        'authorized_cents', coalesce(sum(d.amount_cents) filter (where d.status in ('authorized', 'cancel_requested')), 0),
        'cancelled_count', count(*) filter (where d.status = 'cancelled'),
        'homologacao_count', count(*) filter (where d.environment = 'homologacao'))
      from public.fiscal_documents d where d.tenant_id = p_tenant_id and d.status in ('authorized', 'cancel_requested', 'cancelled')
        and d.competence_date >= v_start and d.competence_date < (v_start + interval '1 month')::date));
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.fsc_eligibility(uuid), app.fsc_overview(uuid), app.fsc_environment(uuid), app.fsc_transition(public.fiscal_documents, text, text)
  from public, anon, authenticated;
revoke all on function public.fiscal_get(uuid) from public, anon;
revoke all on function public.fiscal_profile_save(uuid, integer, text, text, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.fiscal_representation_set(uuid, text, text, integer, text, text, uuid) from public, anon;
revoke all on function public.fiscal_credential_target(uuid) from public, anon;
revoke all on function public.fiscal_emit(uuid, uuid, text, text, text, bigint, date, text, text, uuid) from public, anon;
revoke all on function public.fiscal_cancel(uuid, uuid, integer, text, text, text, uuid) from public, anon;
revoke all on function public.fiscal_folder(uuid, text) from public, anon;
revoke all on function public.fiscal_credential_record(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fiscal_emit_result(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fiscal_cancel_result(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fiscal_sync_claim(integer) from public, anon, authenticated;
grant execute on function public.fiscal_get(uuid) to authenticated;
grant execute on function public.fiscal_profile_save(uuid, integer, text, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.fiscal_representation_set(uuid, text, text, integer, text, text, uuid) to authenticated;
grant execute on function public.fiscal_credential_target(uuid) to authenticated;
grant execute on function public.fiscal_emit(uuid, uuid, text, text, text, bigint, date, text, text, uuid) to authenticated;
grant execute on function public.fiscal_cancel(uuid, uuid, integer, text, text, text, uuid) to authenticated;
grant execute on function public.fiscal_folder(uuid, text) to authenticated;
grant execute on function public.fiscal_credential_record(uuid, text, text, timestamptz) to service_role;
grant execute on function public.fiscal_emit_result(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.fiscal_cancel_result(uuid, text, text) to service_role;
grant execute on function public.fiscal_sync_claim(integer) to service_role;

alter table public.fiscal_profiles enable row level security;
alter table public.fiscal_representations enable row level security;
alter table public.fiscal_credentials enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_document_events enable row level security;
revoke all on public.fiscal_profiles, public.fiscal_representations, public.fiscal_credentials, public.fiscal_documents, public.fiscal_document_events
  from anon, authenticated;
grant select on public.fiscal_document_events to authenticated;
create policy fiscal_document_events_owner on public.fiscal_document_events for select to authenticated using (app.is_member(tenant_id, array['owner']));
grant select, insert, update on public.fiscal_profiles, public.fiscal_representations, public.fiscal_credentials, public.fiscal_documents to service_role;
grant select, insert on public.fiscal_document_events to service_role;
-- fiscal_profiles, fiscal_representations, fiscal_credentials, fiscal_documents: RLS ligada e nenhuma política para
-- usuários (o documento do tomador só sai mascarado, pela fiscal_get; o completo vai só ao provedor na emissão).
