-- P24 · Avaliações e verificação: experiência registrada só por quem teve atendimento concluído e verificável (login de
-- cliente vinculado ao cadastro do negócio, P01); resposta pública do profissional; denúncia com moderação pelo
-- backend; selos que não se confundem: identidade verificada (backend), atendimentos verificados (contagem real) e
-- competência certificada (P39, ainda inexistente). Ver ADR-0028.
-- Invariantes (tasks/P24, docs/17, docs/00):
-- * Uma avaliação por atendimento concluído, pelo próprio cliente vinculado, até 30 dias depois. Sem atendimento
--   verificável não há avaliação (indicação informal do P09 continua separada e nunca vira nota).
-- * O profissional não apaga nem edita avaliação; responde uma vez (pode corrigir a resposta) e pode denunciar.
-- * Denúncia não esconde nada sozinha: só a moderação (backend) oculta, com motivo; o autor pode retirar a própria.
-- * Média só com 3 ou mais avaliações publicadas (menos que isso não é média). Nada é comprável: nenhuma função ligada
--   a pagamento, plano ou benefício toca avaliações.
-- * Público vê "cliente verificado(a)", nunca nome, telefone ou dados do atendimento além do mês e do serviço.
-- Depende de: fundação, P01 (customer_links), P02 (provider_services), P03 (bookings), P09 (public_profiles).

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  booking_id uuid not null unique,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(btrim(body)) between 3 and 600),
  service_name text not null,
  service_month date not null,
  status text not null default 'published' check (status in ('published', 'withdrawn', 'hidden')),
  hidden_reason text check (char_length(hidden_reason) <= 200),
  reply_body text check (char_length(btrim(reply_body)) between 2 and 600),
  reply_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (tenant_id, id),
  constraint reviews_booking foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete restrict,
  constraint reviews_hidden check ((status = 'hidden') = (hidden_reason is not null))
);
comment on table public.reviews is 'Experiência de cliente com atendimento concluído e vínculo verificado. Não é comprável nem editável pelo profissional.';
create index reviews_tenant on public.reviews (tenant_id, created_at desc);
create trigger reviews_touch before update on public.reviews for each row execute function app.touch_row();

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  review_id uuid not null,
  reporter_user_id uuid not null,
  reason text not null check (reason in ('offensive', 'personal_data', 'not_a_customer', 'conflict_of_interest', 'other')),
  note text check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  resolved_at timestamptz,
  resolution_note text check (char_length(resolution_note) <= 200),
  created_at timestamptz not null default clock_timestamp(),
  constraint review_reports_review foreign key (tenant_id, review_id) references public.reviews (tenant_id, id) on delete restrict
);
comment on table public.review_reports is 'Denúncias de avaliação. Só a moderação (backend) decide; denunciar não esconde nada.';
create unique index review_reports_one_open on public.review_reports (review_id, reporter_user_id) where status = 'open';

create table public.identity_verifications (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  method text not null check (method in ('document_video_call', 'gov_br')),
  verified_by text not null check (char_length(btrim(verified_by)) between 2 and 80),
  verified_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz
);
comment on table public.identity_verifications is 'Identidade do responsável verificada pela equipe (backend). Nenhum documento é guardado aqui. Não é competência.';

-- ---------------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------------

create function app.rep_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('window_days', 30, 'min_reviews_for_average', 3, 'body_max', 600)
$$;

create function app.rep_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/** Projeção pública de uma avaliação: sem autor, sem atendimento além do mês e do serviço. */
create function app.rep_public_json(r public.reviews) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body, 'service_name', r.service_name, 'service_month', to_char(r.service_month, 'YYYY-MM'),
    'verified_booking', true, 'reply', case when r.reply_body is null then null else jsonb_build_object('body', r.reply_body, 'at', app.fin_ts(r.reply_at)) end,
    'created_at', app.fin_ts(r.created_at))
$$;

/** Selos e números públicos. Cada selo diz exatamente o que foi verificado; competência certificada é do P39. */
create function app.rep_summary(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'identity_verified', exists (select 1 from public.identity_verifications v where v.tenant_id = p_tenant_id and v.revoked_at is null),
    'completed_bookings', (select count(*)::int from public.bookings b where b.tenant_id = p_tenant_id and b.status = 'completed'),
    'reviews_count', s.n,
    'rating_average', case when s.n >= (app.rep_rules()->>'min_reviews_for_average')::int then round(s.avg, 1) end,
    'certified_competence', false)
  from (select count(*)::int as n, avg(r.rating)::numeric as avg from public.reviews r where r.tenant_id = p_tenant_id and r.status = 'published') s
$$;

-- P09 (aditivo): a reputação do perfil público passa a vir dos mecanismos verificáveis do P24.
create or replace function app.network_profile_json(p public.public_profiles, p_display_name text)
returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', p.slug,
    'category', p.category,
    'area', p.area,
    'public_fields', to_jsonb(p.public_fields),
    'values', jsonb_strip_nulls(jsonb_build_object(
      'display_name', case when 'display_name' = any (p.public_fields) then p_display_name end,
      'bio', case when 'bio' = any (p.public_fields) then (select c.body from public.profile_contents c where c.tenant_id = p.tenant_id) end
    )),
    'published_at', p.published_at,
    -- P24: identidade verificada pela equipe e avaliações de atendimentos verificados; nunca por convite ou benefício.
    'reputation', (select jsonb_build_object('identity_verified', (s->>'identity_verified')::boolean, 'reviews_count', (s->>'reviews_count')::int)
      from app.rep_summary(p.tenant_id) s),
    'version', p.version
  )
$$;

-- ---------------------------------------------------------------------------
-- Cliente (login vinculado ao cadastro do negócio)
-- ---------------------------------------------------------------------------

/** Atendimentos concluídos do próprio cliente, em todos os negócios em que tem vínculo, ainda avaliáveis. */
create function public.review_pending() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED'; end if;
  return jsonb_build_object('rules', app.rep_rules(),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('booking_id', b.id, 'tenant_name', t.name, 'service_name', s.name,
        'ended_at', app.fin_ts(b.ends_at), 'review_until', app.fin_ts(b.ends_at + make_interval(days => (app.rep_rules()->>'window_days')::int))) order by b.ends_at desc)
      from public.customer_links l
      join public.bookings b on b.tenant_id = l.tenant_id and b.customer_id = l.customer_id and b.status = 'completed'
      join public.tenants t on t.id = b.tenant_id
      join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
      where l.user_id = v_uid and l.revoked_at is null
        and b.ends_at > clock_timestamp() - make_interval(days => (app.rep_rules()->>'window_days')::int)
        and not exists (select 1 from public.reviews r where r.booking_id = b.id)), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(app.rep_public_json(r) || jsonb_build_object('status', r.status, 'tenant_name', t.name, 'version', r.version) order by r.created_at desc)
      from public.reviews r join public.tenants t on t.id = r.tenant_id where r.author_user_id = v_uid), '[]'::jsonb));
end $$;

/**
 * Registra a experiência. Exige: atendimento concluído, do cadastro vinculado a este login (vínculo ativo), dentro da
 * janela, sem avaliação anterior. Idempotência própria (o cliente não é membro do negócio): uma por atendimento.
 */
create function public.review_submit(p_booking_id uuid, p_rating integer, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b public.bookings;
  r public.reviews;
  v_service text;
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'rating'; end if;
  if p_body is not null and char_length(btrim(p_body)) not between 3 and 600 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'body'; end if;
  select * into b from public.bookings x where x.id = p_booking_id for share;
  -- Mesmo erro para "não existe" e "não é seu": não revela atendimentos de outras pessoas.
  if not found or not exists (select 1 from public.customer_links l where l.tenant_id = b.tenant_id and l.customer_id = b.customer_id
      and l.user_id = v_uid and l.revoked_at is null) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if b.status <> 'completed' then raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'booking_status'; end if;
  if b.ends_at <= clock_timestamp() - make_interval(days => (app.rep_rules()->>'window_days')::int) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'window';
  end if;
  select * into r from public.reviews x where x.booking_id = b.id;
  if found then
    if r.author_user_id = v_uid and r.rating = p_rating and r.body is not distinct from nullif(btrim(p_body), '') then
      return jsonb_build_object('review', app.rep_public_json(r) || jsonb_build_object('status', r.status, 'version', r.version));
    end if;
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'already_reviewed';
  end if;
  select s.name into v_service from public.provider_services s where s.tenant_id = b.tenant_id and s.id = b.service_id;
  begin
    insert into public.reviews (tenant_id, booking_id, author_user_id, rating, body, service_name, service_month)
    values (b.tenant_id, b.id, v_uid, p_rating, nullif(btrim(p_body), ''), v_service, date_trunc('month', b.starts_at)::date) returning * into r;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'already_reviewed';
  end;
  perform app.audit(b.tenant_id, 'review.submit', 'review', r.id, null, null, jsonb_build_object('rating', r.rating));
  perform app.emit_event(b.tenant_id, 'review.published.v1', r.id, 1, gen_random_uuid(), jsonb_build_object('rating', r.rating));
  return jsonb_build_object('review', app.rep_public_json(r) || jsonb_build_object('status', r.status, 'version', r.version));
end $$;

/** O autor retira a própria avaliação (definitivo: o atendimento não volta a ser avaliável). */
create function public.review_withdraw(p_review_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.reviews;
begin
  select * into r from public.reviews x where x.id = p_review_id and x.author_user_id = auth.uid() for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if r.status = 'published' then
    update public.reviews x set status = 'withdrawn', version = x.version + 1 where x.id = r.id returning * into r;
    perform app.audit(r.tenant_id, 'review.withdraw', 'review', r.id, null, null, '{}'::jsonb);
  end if;
  return jsonb_build_object('review', app.rep_public_json(r) || jsonb_build_object('status', r.status, 'version', r.version));
end $$;

/** Qualquer pessoa com login denuncia uma avaliação publicada. Não esconde nada sozinha. */
create function public.review_report(p_review_id uuid, p_reason text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r public.reviews;
  rp public.review_reports;
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED'; end if;
  if p_reason not in ('offensive', 'personal_data', 'not_a_customer', 'conflict_of_interest', 'other') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;
  select * into r from public.reviews x where x.id = p_review_id and x.status = 'published';
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  select * into rp from public.review_reports x where x.review_id = r.id and x.reporter_user_id = v_uid and x.status = 'open';
  if not found then
    begin
      insert into public.review_reports (tenant_id, review_id, reporter_user_id, reason, note) values (r.tenant_id, r.id, v_uid, p_reason, nullif(btrim(p_note), ''))
      returning * into rp;
    exception when unique_violation then
      select * into rp from public.review_reports x where x.review_id = r.id and x.reporter_user_id = v_uid and x.status = 'open';
    end;
  end if;
  return jsonb_build_object('report', jsonb_build_object('id', rp.id, 'status', rp.status, 'reason', rp.reason, 'created_at', app.fin_ts(rp.created_at)));
end $$;

-- ---------------------------------------------------------------------------
-- Dono
-- ---------------------------------------------------------------------------

create function public.review_owner_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.rep_owner(p_tenant_id);
  return jsonb_build_object('rules', app.rep_rules(), 'summary', app.rep_summary(p_tenant_id),
    'reviews', coalesce((select jsonb_agg(app.rep_public_json(r) || jsonb_build_object('status', r.status, 'hidden_reason', r.hidden_reason, 'version', r.version,
        'open_reports', (select count(*)::int from public.review_reports p where p.review_id = r.id and p.status = 'open')) order by r.created_at desc)
      from (select * from public.reviews x where x.tenant_id = p_tenant_id and x.status <> 'withdrawn' order by x.created_at desc limit 100) r), '[]'::jsonb));
end $$;

create function public.review_reply(
  p_tenant_id uuid,
  p_review_id uuid,
  p_expected_version integer,
  p_body text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  r public.reviews;
  v_body jsonb;
begin
  perform app.rep_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'review.reply', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_body is null or char_length(btrim(p_body)) not between 2 and 600 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'body'; end if;
  select * into r from public.reviews x where x.tenant_id = p_tenant_id and x.id = p_review_id for update;
  if not found or r.status = 'withdrawn' then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if r.version <> p_expected_version then raise exception using errcode = 'PT409', message = 'STALE_VERSION'; end if;
  -- Só a resposta muda: nota e texto do cliente ficam como estão.
  update public.reviews x set reply_body = btrim(p_body), reply_at = clock_timestamp(), version = x.version + 1 where x.id = r.id returning * into r;
  perform app.audit(p_tenant_id, 'review.reply', 'review', r.id, p_request_id, null, '{}'::jsonb);
  v_body := jsonb_build_object('review', app.rep_public_json(r) || jsonb_build_object('status', r.status, 'hidden_reason', r.hidden_reason, 'version', r.version,
    'open_reports', (select count(*)::int from public.review_reports p where p.review_id = r.id and p.status = 'open')));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'review.reply', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Moderação e verificação (backend)
-- ---------------------------------------------------------------------------

/** Decide uma denúncia: procedente oculta a avaliação com motivo; improcedente mantém. */
create function public.review_moderate(p_report_id uuid, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rp public.review_reports;
begin
  if p_decision not in ('upheld', 'dismissed') then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'decision'; end if;
  if p_note is null or char_length(btrim(p_note)) not between 5 and 200 then raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'note'; end if;
  select * into rp from public.review_reports x where x.id = p_report_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  if rp.status <> 'open' then return jsonb_build_object('report_status', rp.status); end if;
  update public.review_reports x set status = p_decision, resolved_at = clock_timestamp(), resolution_note = btrim(p_note) where x.id = rp.id;
  if p_decision = 'upheld' then
    update public.reviews x set status = 'hidden', hidden_reason = btrim(p_note), version = x.version + 1 where x.id = rp.review_id and x.status = 'published';
    -- As demais denúncias abertas da mesma avaliação ficam resolvidas junto.
    update public.review_reports x set status = 'upheld', resolved_at = clock_timestamp(), resolution_note = btrim(p_note) where x.review_id = rp.review_id and x.status = 'open';
  end if;
  perform app.audit(rp.tenant_id, 'review.moderate.' || p_decision, 'review', rp.review_id, null, null, jsonb_build_object('reason', rp.reason));
  return jsonb_build_object('report_status', p_decision);
end $$;

create function public.identity_verify_set(p_tenant_id uuid, p_action text, p_method text, p_verified_by text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_action = 'verify' then
    if p_method not in ('document_video_call', 'gov_br') or p_verified_by is null or char_length(btrim(p_verified_by)) not between 2 and 80 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'method';
    end if;
    insert into public.identity_verifications (tenant_id, method, verified_by) values (p_tenant_id, p_method, btrim(p_verified_by))
    on conflict (tenant_id) do update set method = excluded.method, verified_by = excluded.verified_by, verified_at = clock_timestamp(), revoked_at = null;
  elsif p_action = 'revoke' then
    update public.identity_verifications x set revoked_at = clock_timestamp() where x.tenant_id = p_tenant_id;
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'action';
  end if;
  perform app.audit(p_tenant_id, 'identity.' || p_action, 'identity_verification', p_tenant_id, null, null, jsonb_build_object('method', p_method));
  return app.rep_summary(p_tenant_id);
end $$;

-- ---------------------------------------------------------------------------
-- Público
-- ---------------------------------------------------------------------------

create function public.review_public_list(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.public_profiles;
begin
  select * into p from public.public_profiles x where x.slug = lower(btrim(p_slug)) and x.published_at is not null;
  if not found then raise exception using errcode = 'PT404', message = 'NOT_FOUND'; end if;
  return jsonb_build_object('rules', app.rep_rules(), 'summary', app.rep_summary(p.tenant_id),
    'reviews', coalesce((select jsonb_agg(app.rep_public_json(r) order by r.created_at desc)
      from (select * from public.reviews x where x.tenant_id = p.tenant_id and x.status = 'published' order by x.created_at desc limit 50) r), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.rep_summary(uuid) from public, anon, authenticated;
revoke all on function public.review_pending() from public, anon;
revoke all on function public.review_submit(uuid, integer, text) from public, anon;
revoke all on function public.review_withdraw(uuid) from public, anon;
revoke all on function public.review_report(uuid, text, text) from public, anon;
revoke all on function public.review_owner_list(uuid) from public, anon;
revoke all on function public.review_reply(uuid, uuid, integer, text, text, text, uuid) from public, anon;
revoke all on function public.review_moderate(uuid, text, text) from public, anon, authenticated;
revoke all on function public.identity_verify_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.review_public_list(text) from public;
grant execute on function public.review_pending() to authenticated;
grant execute on function public.review_submit(uuid, integer, text) to authenticated;
grant execute on function public.review_withdraw(uuid) to authenticated;
grant execute on function public.review_report(uuid, text, text) to authenticated;
grant execute on function public.review_owner_list(uuid) to authenticated;
grant execute on function public.review_reply(uuid, uuid, integer, text, text, text, uuid) to authenticated;
grant execute on function public.review_moderate(uuid, text, text) to service_role;
grant execute on function public.identity_verify_set(uuid, text, text, text) to service_role;
grant execute on function public.review_public_list(text) to anon, authenticated, service_role;

alter table public.reviews enable row level security;
alter table public.review_reports enable row level security;
alter table public.identity_verifications enable row level security;
revoke all on public.reviews, public.review_reports, public.identity_verifications from anon, authenticated;
grant select, insert, update on public.reviews, public.review_reports, public.identity_verifications to service_role;
-- Sem políticas para usuários: o autor lê pela review_pending, o dono pela review_owner_list, o público pela
-- review_public_list (nenhuma expõe o autor).
