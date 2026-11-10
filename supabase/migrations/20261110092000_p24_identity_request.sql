-- Recado #89, pedido 3: o dono pede a verificação de identidade pelo app (item 43 da onda 3).
-- Hoje a tela de Avaliações só explica e manda falar com a equipe. Agora há um pedido registrado:
--   * identity.request (dono): abre um pedido com o meio preferido (videochamada com documento ou gov.br).
--     Um pedido aberto por negócio; pedir de novo devolve o mesmo pedido. Já verificado → POLICY_REJECTED.
--   * review.owner_list passa a trazer `identity_request` (o pedido aberto, ou null).
--   * a equipe continua verificando por identity_verify_set (backend). Ao verificar, o pedido aberto fecha como 'done'.
-- Nenhum documento é pedido nem guardado aqui. O pedido não verifica nada nem promete prazo.
-- Substituições por `create or replace`: public.review_owner_list e public.identity_verify_set (mesmo corpo + pedido).

create table public.identity_verification_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  requested_by uuid not null,
  preferred_method text not null check (preferred_method in ('document_video_call', 'gov_br')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  requested_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  constraint identity_verification_requests_closed check ((status = 'open') = (closed_at is null))
);
comment on table public.identity_verification_requests is
  'Pedido de verificação de identidade feito pelo dono. A equipe atende pelo backend. Sem documento.';
create unique index identity_verification_requests_one_open on public.identity_verification_requests (tenant_id) where status = 'open';

alter table public.identity_verification_requests enable row level security;
revoke all on public.identity_verification_requests from anon, authenticated;
grant select, insert, update on public.identity_verification_requests to service_role;

create function app.rep_identity_request_json(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', q.id, 'status', q.status, 'preferred_method', q.preferred_method,
    'requested_at', app.sched_ts(q.requested_at))
  from public.identity_verification_requests q where q.tenant_id = p_tenant_id and q.status = 'open'
$$;
revoke all on function app.rep_identity_request_json(uuid) from public, anon, authenticated;

create function public.identity_request(
  p_tenant_id uuid,
  p_preferred_method text,
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
  perform app.rep_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'identity.request', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_preferred_method is null or p_preferred_method not in ('document_video_call', 'gov_br') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'preferred_method';
  end if;
  if exists (select 1 from public.identity_verifications v where v.tenant_id = p_tenant_id and v.revoked_at is null) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'already_verified';
  end if;
  -- Um pedido aberto por negócio: pedir de novo devolve o mesmo, sem trocar o meio escolhido antes.
  insert into public.identity_verification_requests (tenant_id, requested_by, preferred_method)
  values (p_tenant_id, v_uid, p_preferred_method)
  on conflict (tenant_id) where status = 'open' do nothing;
  if found then
    perform app.audit(p_tenant_id, 'identity.request', 'identity_verification', p_tenant_id, p_request_id, null,
      jsonb_build_object('preferred_method', p_preferred_method));
  end if;
  v_body := jsonb_build_object('identity_request', app.rep_identity_request_json(p_tenant_id));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'identity.request', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;
revoke all on function public.identity_request(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.identity_request(uuid, text, text, text, uuid) to authenticated;

create or replace function public.review_owner_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.rep_owner(p_tenant_id);
  return jsonb_build_object('rules', app.rep_rules(), 'summary', app.rep_summary(p_tenant_id),
    'identity_request', app.rep_identity_request_json(p_tenant_id),
    'reviews', coalesce((select jsonb_agg(app.rep_public_json(r) || jsonb_build_object('status', r.status, 'hidden_reason', r.hidden_reason, 'version', r.version,
        'open_reports', (select count(*)::int from public.review_reports p where p.review_id = r.id and p.status = 'open')) order by r.created_at desc)
      from (select * from public.reviews x where x.tenant_id = p_tenant_id and x.status <> 'withdrawn' order by x.created_at desc limit 100) r), '[]'::jsonb));
end $$;

create or replace function public.identity_verify_set(p_tenant_id uuid, p_action text, p_method text, p_verified_by text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_action = 'verify' then
    if p_method not in ('document_video_call', 'gov_br') or p_verified_by is null or char_length(btrim(p_verified_by)) not between 2 and 80 then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'method';
    end if;
    insert into public.identity_verifications (tenant_id, method, verified_by) values (p_tenant_id, p_method, btrim(p_verified_by))
    on conflict (tenant_id) do update set method = excluded.method, verified_by = excluded.verified_by, verified_at = clock_timestamp(), revoked_at = null;
    -- Recado #89: o pedido aberto do dono foi atendido.
    update public.identity_verification_requests q set status = 'done', closed_at = clock_timestamp()
    where q.tenant_id = p_tenant_id and q.status = 'open';
  elsif p_action = 'revoke' then
    update public.identity_verifications x set revoked_at = clock_timestamp() where x.tenant_id = p_tenant_id;
  else
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'action';
  end if;
  perform app.audit(p_tenant_id, 'identity.' || p_action, 'identity_verification', p_tenant_id, null, null, jsonb_build_object('method', p_method));
  return app.rep_summary(p_tenant_id);
end $$;
