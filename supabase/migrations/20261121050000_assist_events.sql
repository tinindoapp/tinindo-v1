-- Assistente parte 2, item 5 (revisão 06/11, T15): medição do assistente dentro das telas, SEM conteúdo.
-- Uma linha por gesto: a faixa apareceu (shown), o rascunho foi aplicado ou o texto foi usado (applied), a faixa foi
-- dispensada (dismissed). Guarda só o evento, a superfície (formulário, redação ou explicação) e quantos campos o
-- assistente preencheu. Nunca o texto do dono, valores do formulário, nomes ou ids de registros.
-- Tabela própria (e não outbox): os tipos `assist.*.v1` ainda não estão no catálogo de eventos dos contratos; o recado
-- pede para registrar e ler no P18. Só acrescenta.

create table public.assist_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  event text not null check (event in ('assist.shown.v1', 'assist.applied.v1', 'assist.dismissed.v1')),
  surface text not null check (surface in ('form:lifecycle.settings', 'form:schedule.rules', 'form:service', 'form:recurrence.plan', 'draft', 'explain')),
  -- Campos preenchidos pelo assistente (só em applied de formulário). Contagem, nunca quais valores.
  filled integer check (filled between 0 and 20),
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table public.assist_events is 'Medição do assistente nas telas (T15): evento, superfície e contagem de campos. Sem conteúdo. Só acrescenta.';
create index assist_events_tenant_created on public.assist_events (tenant_id, created_at);
alter table public.assist_events enable row level security;
revoke all on public.assist_events from public, anon, authenticated;
grant select on public.assist_events to authenticated;
create policy assist_events_owner_select on public.assist_events for select to authenticated
  using (app.is_member(tenant_id, array['owner']));
create trigger assist_events_append_only before update or delete on public.assist_events
  for each row execute function app.forbid_mutation();

-- Grava um gesto. Membro do negócio (o assistente aparece também para a equipe). Teto por negócio e dia, para a
-- medição não virar caminho de escrita sem fim: acima dele, ignora (devolve recorded = false), sem erro.
create function public.assist_event_record(p_tenant_id uuid, p_event text, p_surface text, p_filled integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today integer;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_event is null or p_event not in ('assist.shown.v1', 'assist.applied.v1', 'assist.dismissed.v1') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'event';
  end if;
  if p_surface is null or p_surface not in ('form:lifecycle.settings', 'form:schedule.rules', 'form:service', 'form:recurrence.plan', 'draft', 'explain') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'surface';
  end if;
  if p_filled is not null and (p_filled < 0 or p_filled > 20) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'filled';
  end if;
  select count(*) into v_today from public.assist_events e
  where e.tenant_id = p_tenant_id and e.created_at >= date_trunc('day', clock_timestamp());
  if v_today >= 500 then
    return jsonb_build_object('recorded', false);
  end if;
  insert into public.assist_events (tenant_id, event, surface, filled)
  values (p_tenant_id, p_event, p_surface, case when p_event = 'assist.applied.v1' then p_filled end);
  return jsonb_build_object('recorded', true);
end $$;
revoke all on function public.assist_event_record(uuid, text, text, integer) from public, anon;
grant execute on function public.assist_event_record(uuid, text, text, integer) to authenticated;
