-- P28 · Equipes e recursos: vários profissionais, salas, cadeiras e equipamentos; reserva composta (profissional +
-- recursos) gravada de uma vez; turmas com vagas; comissão por profissional e por serviço.
-- Invariantes (docs/02, docs/17, tasks/P28, ADR-0031):
-- * Reserva composta é tudo ou nada: a reserva e TODAS as alocações entram na mesma transação; um recurso ocupado
--   desfaz a reserva inteira (nenhum recurso fica comprometido pela metade).
-- * A constraint de exclusão de team_allocations é a autoridade final sobre cada recurso (um uso por vez).
-- * Os recursos são travados em ordem de id (FOR UPDATE) e só depois a agenda individual vinculada: sem deadlock.
-- * O motor solo do piloto (P03, uma agenda por negócio) não muda. O profissional da equipe pode ser vinculado à
--   agenda individual do dono: as duas agendas se enxergam (alocação confere reservas/bloqueios da agenda; gatilhos em
--   bookings/availability_blocks recusam o que cruzar uma alocação da equipe).
-- * Comissão: percentual congelado na reserva/turma; lançamento único na conclusão; estorno é linha nova, uma vez.
-- * Concluir cria o recebível no Caixa (P07). Concluir não é receber.
-- Depende de: fundação, P02 (customers, provider_services), P03 (resources, bookings, agenda), P07 (receivables).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.team_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  kind text not null check (kind in ('professional', 'room', 'chair', 'equipment')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  -- Comissão padrão do profissional (basis points). Regra por serviço em team_commission_rules tem precedência.
  commission_bps integer check (commission_bps between 0 and 10000),
  -- Profissional que também tem a agenda individual (P03): as duas agendas se bloqueiam.
  agenda_resource_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint team_resources_commission_professional check (kind = 'professional' or commission_bps is null),
  constraint team_resources_agenda_professional check (kind = 'professional' or agenda_resource_id is null),
  constraint team_resources_agenda foreign key (tenant_id, agenda_resource_id) references public.resources (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.team_resources is 'Profissionais, salas, cadeiras e equipamentos da equipe. Escrita só por RPC.';
create unique index team_resources_one_agenda_link on public.team_resources (agenda_resource_id) where agenda_resource_id is not null;
create unique index team_resources_unique_name on public.team_resources (tenant_id, kind, lower(btrim(name))) where active;
create trigger team_resources_touch before update on public.team_resources for each row execute function app.touch_row();

create table public.team_commission_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  professional_id uuid not null,
  service_id uuid not null,
  bps integer not null check (bps between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint team_commission_rules_professional foreign key (tenant_id, professional_id) references public.team_resources (tenant_id, id) on delete restrict,
  constraint team_commission_rules_service foreign key (tenant_id, service_id) references public.provider_services (tenant_id, id) on delete restrict,
  unique (professional_id, service_id),
  unique (tenant_id, id)
);
comment on table public.team_commission_rules is 'Comissão do profissional para um serviço (sobrepõe a padrão). Vale para reservas novas.';
create trigger team_commission_rules_touch before update on public.team_commission_rules for each row execute function app.touch_row();

create table public.team_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  customer_id uuid,
  professional_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_range tstzrange not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'cancelled')),
  -- Preço e comissão congelados na reserva (mudar o serviço ou a regra depois não muda esta reserva).
  agreed_price_cents bigint not null check (agreed_price_cents between 0 and 9007199254740991),
  commission_bps integer not null check (commission_bps between 0 and 10000),
  receivable_id uuid,
  -- Motivo do cancelamento: texto do dono, fora de auditoria e eventos.
  status_reason text check (char_length(status_reason) <= 280),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint team_bookings_time check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  constraint team_bookings_occupied check (lower_inc(occupied_range) and not upper_inc(occupied_range)
    and occupied_range @> tstzrange(starts_at, ends_at, '[)')),
  constraint team_bookings_service foreign key (tenant_id, service_id) references public.provider_services (tenant_id, id) on delete restrict,
  constraint team_bookings_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint team_bookings_professional foreign key (tenant_id, professional_id) references public.team_resources (tenant_id, id) on delete restrict,
  constraint team_bookings_receivable foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.team_bookings is 'Reserva composta da equipe (profissional + recursos). As alocações estão em team_allocations.';
create index team_bookings_tenant_start on public.team_bookings (tenant_id, starts_at);
create trigger team_bookings_touch before update on public.team_bookings for each row execute function app.touch_row();

create table public.team_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  service_id uuid not null,
  professional_id uuid not null,
  room_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_range tstzrange not null,
  capacity integer not null check (capacity between 1 and 200),
  seat_price_cents bigint not null check (seat_price_cents between 0 and 9007199254740991),
  commission_bps integer not null check (commission_bps between 0 and 10000),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint team_classes_time check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  constraint team_classes_occupied check (lower_inc(occupied_range) and not upper_inc(occupied_range)
    and occupied_range @> tstzrange(starts_at, ends_at, '[)')),
  constraint team_classes_service foreign key (tenant_id, service_id) references public.provider_services (tenant_id, id) on delete restrict,
  constraint team_classes_professional foreign key (tenant_id, professional_id) references public.team_resources (tenant_id, id) on delete restrict,
  constraint team_classes_room foreign key (tenant_id, room_id) references public.team_resources (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.team_classes is 'Turma: um horário com profissional (+ sala) e vagas. Vagas em team_class_seats.';
create index team_classes_tenant_start on public.team_classes (tenant_id, starts_at);
create trigger team_classes_touch before update on public.team_classes for each row execute function app.touch_row();

create table public.team_class_seats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  class_id uuid not null,
  customer_id uuid not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'attended', 'no_show')),
  receivable_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint team_class_seats_class foreign key (tenant_id, class_id) references public.team_classes (tenant_id, id) on delete restrict,
  constraint team_class_seats_customer foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint team_class_seats_receivable foreign key (tenant_id, receivable_id) references public.receivables (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.team_class_seats is 'Vaga de uma cliente numa turma. Lotação conferida sob lock da turma.';
create unique index team_class_seats_one_per_customer on public.team_class_seats (class_id, customer_id) where status <> 'cancelled';
create trigger team_class_seats_touch before update on public.team_class_seats for each row execute function app.touch_row();

create table public.team_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  resource_id uuid not null,
  booking_id uuid,
  class_id uuid,
  occupied_range tstzrange not null,
  -- Só as RPCs mudam: falso quando a reserva/turma é cancelada.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint team_allocations_owner check ((booking_id is null) <> (class_id is null)),
  constraint team_allocations_range check (lower_inc(occupied_range) and not upper_inc(occupied_range) and not isempty(occupied_range)),
  constraint team_allocations_resource foreign key (tenant_id, resource_id) references public.team_resources (tenant_id, id) on delete restrict,
  constraint team_allocations_booking foreign key (tenant_id, booking_id) references public.team_bookings (tenant_id, id) on delete restrict,
  constraint team_allocations_class foreign key (tenant_id, class_id) references public.team_classes (tenant_id, id) on delete restrict,
  constraint team_allocations_no_overlap exclude using gist (tenant_id with =, resource_id with =, occupied_range with &&) where (active),
  unique (booking_id, resource_id),
  unique (class_id, resource_id),
  unique (tenant_id, id)
);
comment on table public.team_allocations is 'Uso de um recurso por uma reserva/turma. team_allocations_no_overlap é a autoridade final.';
create trigger team_allocations_touch before update on public.team_allocations for each row execute function app.touch_row();

create table public.team_commission_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  professional_id uuid not null,
  booking_id uuid,
  class_id uuid,
  kind text not null check (kind in ('accrual', 'reversal')),
  base_cents bigint not null check (base_cents between 0 and 9007199254740991),
  bps integer not null check (bps between 0 and 10000),
  amount_cents bigint not null,
  reversal_of uuid references public.team_commission_entries (id) on delete restrict,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint team_commission_entries_origin check ((booking_id is null) <> (class_id is null)),
  constraint team_commission_entries_shape check (
    (kind = 'accrual' and amount_cents >= 0 and reversal_of is null)
    or (kind = 'reversal' and amount_cents <= 0 and reversal_of is not null)),
  constraint team_commission_entries_professional foreign key (tenant_id, professional_id) references public.team_resources (tenant_id, id) on delete restrict,
  constraint team_commission_entries_booking foreign key (tenant_id, booking_id) references public.team_bookings (tenant_id, id) on delete restrict,
  constraint team_commission_entries_class foreign key (tenant_id, class_id) references public.team_classes (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.team_commission_entries is 'Comissões lançadas (append-only). Uma por conclusão; estorno é linha nova, uma vez.';
create unique index team_commission_one_per_booking on public.team_commission_entries (booking_id) where kind = 'accrual' and booking_id is not null;
create unique index team_commission_one_per_class on public.team_commission_entries (class_id) where kind = 'accrual' and class_id is not null;
create unique index team_commission_one_reversal on public.team_commission_entries (reversal_of) where reversal_of is not null;
create index team_commission_period on public.team_commission_entries (tenant_id, created_at);
create trigger team_commission_entries_append_only before update or delete on public.team_commission_entries
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.tm_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

/** Agenda principal do negócio (P03): o expediente dela é o horário de funcionamento da equipe. */
create function app.tm_business_agenda(p_tenant_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.resources r where r.tenant_id = p_tenant_id and r.active order by r.created_at, r.id limit 1
$$;

create function app.tm_resource_json(t public.team_resources) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'kind', t.kind, 'name', t.name, 'active', t.active, 'commission_bps', t.commission_bps,
    'agenda_linked', t.agenda_resource_id is not null, 'version', t.version)
$$;

/** Percentual vigente: regra do serviço > padrão do profissional > 0. */
create function app.tm_commission_bps(p_tenant_id uuid, p_professional_id uuid, p_service_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.bps from public.team_commission_rules r where r.tenant_id = p_tenant_id and r.professional_id = p_professional_id and r.service_id = p_service_id),
    (select t.commission_bps from public.team_resources t where t.tenant_id = p_tenant_id and t.id = p_professional_id),
    0)
$$;

/** Comissão em centavos, arredondada para o centavo mais próximo (metade para cima). */
create function app.tm_commission_cents(p_base bigint, p_bps integer) returns bigint
language sql immutable set search_path = '' as $$ select (p_base * p_bps + 5000) / 10000 $$;

create function app.tm_alloc_json(p_booking_id uuid, p_class_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'name', t.name) order by t.kind, t.name), '[]'::jsonb)
  from public.team_allocations a join public.team_resources t on t.id = a.resource_id
  where (p_booking_id is not null and a.booking_id = p_booking_id) or (p_class_id is not null and a.class_id = p_class_id)
$$;

create function app.tm_booking_json(b public.team_bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'service_id', b.service_id,
    'service_name', (select s.name from public.provider_services s where s.id = b.service_id),
    'customer_id', b.customer_id, 'customer_name', (select c.name from public.customers c where c.id = b.customer_id),
    'professional_id', b.professional_id, 'professional_name', (select t.name from public.team_resources t where t.id = b.professional_id),
    'resources', app.tm_alloc_json(b.id, null), 'starts_at', app.sched_ts(b.starts_at), 'ends_at', app.sched_ts(b.ends_at),
    'status', b.status, 'agreed_price_cents', b.agreed_price_cents, 'commission_bps', b.commission_bps,
    'commission_cents', (select coalesce(sum(e.amount_cents), 0) from public.team_commission_entries e where e.booking_id = b.id),
    'receivable_id', b.receivable_id, 'version', b.version)
$$;

create function app.tm_seat_json(s public.team_class_seats) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'customer_id', s.customer_id, 'customer_name', (select c.name from public.customers c where c.id = s.customer_id),
    'status', s.status, 'receivable_id', s.receivable_id, 'version', s.version)
$$;

create function app.tm_class_json(c public.team_classes) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'service_id', c.service_id,
    'service_name', (select s.name from public.provider_services s where s.id = c.service_id),
    'professional_id', c.professional_id, 'professional_name', (select t.name from public.team_resources t where t.id = c.professional_id),
    'room_id', c.room_id, 'room_name', (select t.name from public.team_resources t where t.id = c.room_id),
    'starts_at', app.sched_ts(c.starts_at), 'ends_at', app.sched_ts(c.ends_at), 'capacity', c.capacity,
    'booked', (select count(*) from public.team_class_seats s where s.class_id = c.id and s.status <> 'cancelled'),
    'seat_price_cents', c.seat_price_cents, 'commission_bps', c.commission_bps,
    'commission_cents', (select coalesce(sum(e.amount_cents), 0) from public.team_commission_entries e where e.class_id = c.id),
    'status', c.status,
    'seats', coalesce((select jsonb_agg(app.tm_seat_json(s) order by s.created_at) from public.team_class_seats s where s.class_id = c.id), '[]'::jsonb),
    'version', c.version)
$$;

/**
 * Trava os recursos pedidos em ordem de id e confere: existem, estão ativos e cada um tem o tipo certo.
 * p_professional_id é obrigatório (tipo profissional); p_others não podem ser profissionais nem repetir.
 */
create function app.tm_lock_resources(p_tenant_id uuid, p_professional_id uuid, p_others uuid[]) returns public.team_resources
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := array[p_professional_id] || coalesce(p_others, '{}');
  v_prof public.team_resources;
  t public.team_resources;
  v_found integer := 0;
begin
  if p_professional_id is null or cardinality(v_ids) > 5
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) or array_position(v_ids, null) is not null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'resource_ids';
  end if;
  for t in select * from public.team_resources r where r.tenant_id = p_tenant_id and r.id = any (v_ids) order by r.id for update loop
    v_found := v_found + 1;
    if not t.active then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'resource_ids', detail = 'recurso inativo';
    end if;
    if t.id = p_professional_id then
      if t.kind <> 'professional' then
        raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'professional_id';
      end if;
      v_prof := t;
    elsif t.kind = 'professional' then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'resource_ids', detail = 'um profissional por reserva';
    end if;
  end loop;
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_ids';
  end if;
  return v_prof;
end $$;

/** Ocupação dos recursos (alocações ativas) + agenda individual vinculada ao profissional (reservas e bloqueios). */
create function app.tm_busy(p_tenant_id uuid, p_ids uuid[], p_agenda uuid, p_from timestamptz, p_to timestamptz) returns tstzmultirange
language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(x.r), '{}'::tstzmultirange) from (
    select a.occupied_range as r from public.team_allocations a
    where a.tenant_id = p_tenant_id and a.active and a.resource_id = any (p_ids) and a.occupied_range && tstzrange(p_from, p_to, '[)')
    union all
    select unnest(app.sched_busy(p_tenant_id, p_agenda, p_from, p_to)) where p_agenda is not null
  ) x
$$;

/**
 * Grava as alocações de uma reserva ou turma. Chamada com os recursos já travados. Qualquer conflito levanta
 * SLOT_CONFLICT e a transação inteira (reserva + alocações anteriores) é desfeita: nada fica pela metade.
 */
create function app.tm_allocate(p_tenant_id uuid, p_booking_id uuid, p_class_id uuid, p_prof public.team_resources,
  p_others uuid[], p_occ tstzrange, p_starts timestamptz, p_ends timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_agenda uuid := app.tm_business_agenda(p_tenant_id);
  t public.team_resources;
begin
  if p_starts < clock_timestamp() then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'starts_at', detail = 'horário no passado';
  end if;
  if v_agenda is null or not (tstzrange(p_starts, p_ends, '[)') <@ app.sched_open_hours(p_tenant_id, v_agenda, p_starts, p_ends)) then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'hours', detail = 'fora do horário de funcionamento';
  end if;
  -- Agenda individual vinculada: trava depois dos recursos da equipe (mesma ordem em todo comando) e confere.
  if p_prof.agenda_resource_id is not null then
    perform app.sched_lock_resource(p_tenant_id, p_prof.agenda_resource_id);
    if app.sched_busy(p_tenant_id, p_prof.agenda_resource_id, lower(p_occ), upper(p_occ)) && p_occ then
      raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'agenda', detail = 'agenda individual ocupada';
    end if;
  end if;
  -- Conferência amigável (diz qual tipo de recurso está ocupado); a constraint de exclusão é a barreira final.
  for t in select * from public.team_resources r where r.tenant_id = p_tenant_id and r.id = any (array[p_prof.id] || coalesce(p_others, '{}')) order by r.id loop
    if exists (select 1 from public.team_allocations a where a.tenant_id = p_tenant_id and a.resource_id = t.id and a.active and a.occupied_range && p_occ) then
      raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = t.kind;
    end if;
    begin
      insert into public.team_allocations (tenant_id, resource_id, booking_id, class_id, occupied_range)
      values (p_tenant_id, t.id, p_booking_id, p_class_id, p_occ);
    exception when exclusion_violation then
      raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = t.kind;
    end;
  end loop;
end $$;

/** Recebível no Caixa (P07) pelo valor combinado. Concluir não é receber. */
create function app.tm_receivable(p_tenant_id uuid, p_customer_id uuid, p_amount bigint, p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_amount is null or p_amount < 1 then return null; end if;
  insert into public.receivables (tenant_id, customer_id, description, amount_cents, due_at, created_by)
  values (p_tenant_id, p_customer_id, left(p_description, 120), p_amount, clock_timestamp(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Gatilhos de mão dupla com a agenda individual (P03): o que a equipe ocupou não pode ser reservado nem bloqueado lá.
create function app.tm_guard_agenda_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.blocks_capacity
     and (tg_op = 'INSERT' or not old.blocks_capacity or old.occupied_range is distinct from new.occupied_range or old.resource_id <> new.resource_id)
     and exists (select 1 from public.team_allocations a join public.team_resources t on t.id = a.resource_id
       where t.tenant_id = new.tenant_id and t.agenda_resource_id = new.resource_id and a.active and a.occupied_range && new.occupied_range) then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'team';
  end if;
  return new;
end $$;
create trigger bookings_team_guard before insert or update on public.bookings for each row execute function app.tm_guard_agenda_booking();

create function app.tm_guard_agenda_block() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.removed_at is null
     and (tg_op = 'INSERT' or old.removed_at is not null or old.period is distinct from new.period)
     and exists (select 1 from public.team_allocations a join public.team_resources t on t.id = a.resource_id
       where t.tenant_id = new.tenant_id and t.agenda_resource_id = new.resource_id and a.active and a.occupied_range && new.period) then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'team';
  end if;
  return new;
end $$;
create trigger availability_blocks_team_guard before insert or update on public.availability_blocks for each row execute function app.tm_guard_agenda_block();

-- ---------------------------------------------------------------------------
-- Dono: recursos e comissões
-- ---------------------------------------------------------------------------

create function public.resources_list(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tm_owner(p_tenant_id);
  return jsonb_build_object(
    'resources', coalesce((select jsonb_agg(app.tm_resource_json(t) order by t.active desc, t.kind, t.name)
      from public.team_resources t where t.tenant_id = p_tenant_id), '[]'::jsonb),
    'commission_rules', coalesce((select jsonb_agg(jsonb_build_object('professional_id', r.professional_id, 'service_id', r.service_id, 'bps', r.bps)
      order by r.created_at) from public.team_commission_rules r where r.tenant_id = p_tenant_id), '[]'::jsonb),
    'timezone', (select t.timezone from public.tenants t where t.id = p_tenant_id));
end $$;

/** Cria/edita um recurso. O tipo não muda. Desativar exige não ter uso futuro. Vincular liga o profissional à agenda individual. */
create function public.resources_save(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_expected_version integer,
  p_kind text,
  p_name text,
  p_active boolean,
  p_commission_bps integer,
  p_agenda_linked boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_t public.team_resources;
  v_agenda uuid;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_kind is null or p_kind not in ('professional', 'room', 'chair', 'equipment') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
  end if;
  if p_kind <> 'professional' and (p_commission_bps is not null or coalesce(p_agenda_linked, false)) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'commission_bps';
  end if;
  v_agenda := case when coalesce(p_agenda_linked, false) then app.tm_business_agenda(p_tenant_id) end;
  begin
    if p_resource_id is null then
      insert into public.team_resources (tenant_id, kind, name, active, commission_bps, agenda_resource_id, created_by)
      values (p_tenant_id, p_kind, btrim(p_name), coalesce(p_active, true), p_commission_bps, v_agenda, v_uid)
      returning * into v_t;
    else
      select * into v_t from public.team_resources t where t.tenant_id = p_tenant_id and t.id = p_resource_id for update;
      if not found then
        raise exception using errcode = 'PT404', message = 'NOT_FOUND';
      end if;
      if p_expected_version is null or v_t.version <> p_expected_version then
        raise exception using errcode = 'PT409', message = 'STALE_VERSION';
      end if;
      if v_t.kind <> p_kind then
        raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
      end if;
      if v_t.active and not coalesce(p_active, true) and exists (select 1 from public.team_allocations a
          where a.resource_id = v_t.id and a.active and upper(a.occupied_range) > clock_timestamp()) then
        raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'active', detail = 'há reservas ou turmas futuras';
      end if;
      update public.team_resources t set name = btrim(p_name), active = coalesce(p_active, t.active), commission_bps = p_commission_bps,
        agenda_resource_id = v_agenda
      where t.id = v_t.id returning * into v_t;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'name', detail = 'nome repetido ou agenda já vinculada';
    when check_violation then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'name';
  end;
  perform app.audit(p_tenant_id, 'resources.save', 'team_resource', v_t.id, p_request_id, null,
    jsonb_build_object('kind', v_t.kind, 'active', v_t.active, 'commission_bps', v_t.commission_bps, 'agenda_linked', v_t.agenda_resource_id is not null));
  v_body := jsonb_build_object('resource', app.tm_resource_json(v_t));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.save', p_idem_key, case when p_resource_id is null then 201 else 200 end, v_body);
  return jsonb_build_object('status_code', case when p_resource_id is null then 201 else 200 end, 'body', v_body);
end $$;

/** Comissão do profissional num serviço. p_bps null remove a regra. Vale para reservas e turmas novas. */
create function public.resources_commission_rule_save(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_bps integer,
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
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.commission_rule_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.team_resources t where t.tenant_id = p_tenant_id and t.id = p_professional_id and t.kind = 'professional';
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'professional_id';
  end if;
  perform 1 from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_bps is null then
    delete from public.team_commission_rules r where r.tenant_id = p_tenant_id and r.professional_id = p_professional_id and r.service_id = p_service_id;
  elsif p_bps not between 0 and 10000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'bps';
  else
    insert into public.team_commission_rules (tenant_id, professional_id, service_id, bps) values (p_tenant_id, p_professional_id, p_service_id, p_bps)
    on conflict (professional_id, service_id) do update set bps = excluded.bps;
  end if;
  perform app.audit(p_tenant_id, 'resources.commission_rule_save', 'team_resource', p_professional_id, p_request_id, null,
    jsonb_build_object('service_id', p_service_id, 'bps', p_bps));
  v_body := jsonb_build_object('commission_rules', coalesce((select jsonb_agg(jsonb_build_object('professional_id', r.professional_id, 'service_id', r.service_id, 'bps', r.bps)
    order by r.created_at) from public.team_commission_rules r where r.tenant_id = p_tenant_id), '[]'::jsonb));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.commission_rule_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: disponibilidade e reserva composta
-- ---------------------------------------------------------------------------

/** Horários em que o profissional e TODOS os recursos pedidos estão livres, dentro do horário de funcionamento. */
create function public.resources_availability(
  p_tenant_id uuid,
  p_service_id uuid,
  p_professional_id uuid,
  p_resource_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_svc public.provider_services;
  v_prof public.team_resources;
  v_ids uuid[] := array[p_professional_id] || coalesce(p_resource_ids, '{}');
  v_agenda uuid := app.tm_business_agenda(p_tenant_id);
  v_open tstzmultirange;
  v_busy tstzmultirange;
  v_comp tstzrange;
  v_start timestamptz;
  v_dur interval;
  v_before interval;
  v_after interval;
  v_floor timestamptz := greatest(p_from, clock_timestamp());
  v_slots jsonb[] := '{}';
begin
  perform app.tm_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '14 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window';
  end if;
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  select * into v_prof from public.team_resources t where t.tenant_id = p_tenant_id and t.id = p_professional_id and t.kind = 'professional' and t.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'professional_id';
  end if;
  if (select count(*) from public.team_resources t where t.tenant_id = p_tenant_id and t.id = any (v_ids) and t.active) <> cardinality(v_ids) then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_ids';
  end if;
  v_dur := make_interval(mins => v_svc.duration_min);
  v_before := make_interval(mins => v_svc.buffer_before_min);
  v_after := make_interval(mins => v_svc.buffer_after_min);
  v_open := case when v_agenda is null then '{}'::tstzmultirange else app.sched_open_hours(p_tenant_id, v_agenda, p_from, p_to) end;
  v_busy := app.tm_busy(p_tenant_id, v_ids, v_prof.agenda_resource_id, p_from - interval '1 day', p_to + interval '1 day');
  for v_comp in select unnest(v_open) loop
    v_start := lower(v_comp);
    while v_start + v_dur <= upper(v_comp) and cardinality(v_slots) < 500 loop
      if v_start >= v_floor and not (tstzrange(v_start - v_before, v_start + v_dur + v_after, '[)') && v_busy) then
        v_slots := v_slots || app.sched_range_json(tstzrange(v_start, v_start + v_dur, '[)'));
      end if;
      v_start := v_start + app.sched_slot_step();
    end loop;
  end loop;
  return jsonb_build_object('slots', to_jsonb(v_slots), 'timezone', (select t.timezone from public.tenants t where t.id = p_tenant_id));
end $$;

/**
 * Reserva composta: profissional + até 4 recursos (sala, cadeira, equipamento) no mesmo horário.
 * Tudo ou nada: um recurso ocupado desfaz a reserva inteira (SLOT_CONFLICT com o tipo do recurso em `field`).
 */
create function public.resources_booking_create(
  p_tenant_id uuid,
  p_service_id uuid,
  p_customer_id uuid,
  p_professional_id uuid,
  p_resource_ids uuid[],
  p_starts_at timestamptz,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_svc public.provider_services;
  v_prof public.team_resources;
  v_ends timestamptz;
  v_occ tstzrange;
  v_b public.team_bookings;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.booking_create', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_customer_id is not null then
    perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
    end if;
  end if;
  if p_starts_at is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'starts_at';
  end if;
  v_ends := p_starts_at + make_interval(mins => v_svc.duration_min);
  v_occ := tstzrange(p_starts_at - make_interval(mins => v_svc.buffer_before_min), v_ends + make_interval(mins => v_svc.buffer_after_min), '[)');
  v_prof := app.tm_lock_resources(p_tenant_id, p_professional_id, p_resource_ids);
  insert into public.team_bookings (tenant_id, service_id, customer_id, professional_id, starts_at, ends_at, occupied_range,
    agreed_price_cents, commission_bps, created_by)
  values (p_tenant_id, p_service_id, p_customer_id, v_prof.id, p_starts_at, v_ends, v_occ, v_svc.base_price_cents,
    app.tm_commission_bps(p_tenant_id, v_prof.id, p_service_id), v_uid)
  returning * into v_b;
  perform app.tm_allocate(p_tenant_id, v_b.id, null, v_prof, p_resource_ids, v_occ, p_starts_at, v_ends);
  perform app.audit(p_tenant_id, 'resources.booking_create', 'team_booking', v_b.id, p_request_id, null,
    jsonb_build_object('starts_at', app.sched_ts(v_b.starts_at), 'service_id', v_b.service_id, 'resources', cardinality(coalesce(p_resource_ids, '{}')) + 1,
      'agreed_price_cents', v_b.agreed_price_cents, 'commission_bps', v_b.commission_bps));
  v_body := jsonb_build_object('booking', app.tm_booking_json(v_b));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.booking_create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Cancela e libera TODOS os recursos da reserva de uma vez. */
create function public.resources_booking_cancel(
  p_tenant_id uuid,
  p_booking_id uuid,
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
  v_b public.team_bookings;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.booking_cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_b from public.team_bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_b.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_b.status <> 'confirmed' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.team_allocations a set active = false where a.booking_id = v_b.id and a.active;
  update public.team_bookings b set status = 'cancelled', status_reason = left(nullif(btrim(p_reason), ''), 280) where b.id = v_b.id returning * into v_b;
  perform app.audit(p_tenant_id, 'resources.booking_cancel', 'team_booking', v_b.id, p_request_id, null, jsonb_build_object('status', v_b.status));
  v_body := jsonb_build_object('booking', app.tm_booking_json(v_b));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.booking_cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Conclui: recebível no Caixa pelo preço combinado e comissão lançada uma única vez. */
create function public.resources_booking_complete(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_b public.team_bookings;
  v_rec uuid;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.booking_complete', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_b from public.team_bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_b.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_b.status <> 'confirmed' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if v_b.starts_at > clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'starts_at';
  end if;
  v_rec := app.tm_receivable(p_tenant_id, v_b.customer_id, v_b.agreed_price_cents,
    format('%s · %s', (select s.name from public.provider_services s where s.id = v_b.service_id), (select t.name from public.team_resources t where t.id = v_b.professional_id)));
  update public.team_bookings b set status = 'completed', receivable_id = v_rec where b.id = v_b.id returning * into v_b;
  insert into public.team_commission_entries (tenant_id, professional_id, booking_id, kind, base_cents, bps, amount_cents, created_by)
  values (p_tenant_id, v_b.professional_id, v_b.id, 'accrual', v_b.agreed_price_cents, v_b.commission_bps,
    app.tm_commission_cents(v_b.agreed_price_cents, v_b.commission_bps), v_uid);
  perform app.audit(p_tenant_id, 'resources.booking_complete', 'team_booking', v_b.id, p_request_id, null,
    jsonb_build_object('agreed_price_cents', v_b.agreed_price_cents, 'commission_cents', app.tm_commission_cents(v_b.agreed_price_cents, v_b.commission_bps)));
  v_body := jsonb_build_object('booking', app.tm_booking_json(v_b));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.booking_complete', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Reservas e turmas da equipe na janela (até 31 dias). */
create function public.resources_schedule(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tm_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window';
  end if;
  return jsonb_build_object(
    'bookings', coalesce((select jsonb_agg(app.tm_booking_json(b) order by b.starts_at, b.id) from (select * from public.team_bookings b
      where b.tenant_id = p_tenant_id and b.starts_at < p_to and b.ends_at > p_from order by b.starts_at limit 300) b), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(app.tm_class_json(c) order by c.starts_at, c.id) from (select * from public.team_classes c
      where c.tenant_id = p_tenant_id and c.starts_at < p_to and c.ends_at > p_from order by c.starts_at limit 100) c), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Dono: turmas
-- ---------------------------------------------------------------------------

create function public.resources_class_create(
  p_tenant_id uuid,
  p_service_id uuid,
  p_professional_id uuid,
  p_room_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_capacity integer,
  p_seat_price_cents bigint,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_svc public.provider_services;
  v_prof public.team_resources;
  v_others uuid[] := case when p_room_id is null then '{}'::uuid[] else array[p_room_id] end;
  v_ends timestamptz;
  v_occ tstzrange;
  v_c public.team_classes;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.class_create', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_room_id is not null then
    perform 1 from public.team_resources t where t.tenant_id = p_tenant_id and t.id = p_room_id and t.kind = 'room';
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'room_id';
    end if;
  end if;
  if p_starts_at is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'starts_at';
  end if;
  v_ends := p_starts_at + make_interval(mins => v_svc.duration_min);
  v_occ := tstzrange(p_starts_at - make_interval(mins => v_svc.buffer_before_min), v_ends + make_interval(mins => v_svc.buffer_after_min), '[)');
  v_prof := app.tm_lock_resources(p_tenant_id, p_professional_id, v_others);
  begin
    insert into public.team_classes (tenant_id, service_id, professional_id, room_id, title, starts_at, ends_at, occupied_range, capacity,
      seat_price_cents, commission_bps, created_by)
    values (p_tenant_id, p_service_id, v_prof.id, p_room_id, btrim(p_title), p_starts_at, v_ends, v_occ, p_capacity,
      coalesce(p_seat_price_cents, v_svc.base_price_cents), app.tm_commission_bps(p_tenant_id, v_prof.id, p_service_id), v_uid)
    returning * into v_c;
  exception when check_violation or not_null_violation then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'class';
  end;
  perform app.tm_allocate(p_tenant_id, null, v_c.id, v_prof, v_others, v_occ, p_starts_at, v_ends);
  perform app.audit(p_tenant_id, 'resources.class_create', 'team_class', v_c.id, p_request_id, null,
    jsonb_build_object('starts_at', app.sched_ts(v_c.starts_at), 'capacity', v_c.capacity, 'seat_price_cents', v_c.seat_price_cents));
  v_body := jsonb_build_object('class', app.tm_class_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.class_create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Vaga na turma: lotação conferida sob lock da turma; uma vaga por cliente. */
create function public.resources_class_enroll(
  p_tenant_id uuid,
  p_class_id uuid,
  p_customer_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.team_classes;
  v_s public.team_class_seats;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.class_enroll', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_c from public.team_classes c where c.tenant_id = p_tenant_id and c.id = p_class_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_c.status <> 'scheduled' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  perform 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
  end if;
  if (select count(*) from public.team_class_seats s where s.class_id = v_c.id and s.status <> 'cancelled') >= v_c.capacity then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'capacity', detail = 'turma lotada';
  end if;
  begin
    insert into public.team_class_seats (tenant_id, class_id, customer_id, created_by) values (p_tenant_id, v_c.id, p_customer_id, v_uid) returning * into v_s;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'seat', detail = 'a cliente já está na turma';
  end;
  perform app.audit(p_tenant_id, 'resources.class_enroll', 'team_class', v_c.id, p_request_id, null, jsonb_build_object('seat_id', v_s.id));
  v_body := jsonb_build_object('class', app.tm_class_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.class_enroll', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.resources_class_seat_cancel(
  p_tenant_id uuid,
  p_seat_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_class uuid;
  v_c public.team_classes;
  v_s public.team_class_seats;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.class_seat_cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select s.class_id into v_class from public.team_class_seats s where s.tenant_id = p_tenant_id and s.id = p_seat_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  -- Mesma ordem da inscrição: turma, depois vaga.
  select * into v_c from public.team_classes c where c.id = v_class for update;
  select * into v_s from public.team_class_seats s where s.id = p_seat_id for update;
  if p_expected_version is null or v_s.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_s.status <> 'booked' or v_c.status <> 'scheduled' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.team_class_seats s set status = 'cancelled' where s.id = v_s.id;
  perform app.audit(p_tenant_id, 'resources.class_seat_cancel', 'team_class', v_c.id, p_request_id, null, jsonb_build_object('seat_id', v_s.id));
  v_body := jsonb_build_object('class', app.tm_class_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.class_seat_cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Cancela a turma: libera profissional e sala de uma vez e cancela as vagas. */
create function public.resources_class_cancel(
  p_tenant_id uuid,
  p_class_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.team_classes;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.class_cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_c from public.team_classes c where c.tenant_id = p_tenant_id and c.id = p_class_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_c.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_c.status <> 'scheduled' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  update public.team_allocations a set active = false where a.class_id = v_c.id and a.active;
  update public.team_class_seats s set status = 'cancelled' where s.class_id = v_c.id and s.status = 'booked';
  update public.team_classes c set status = 'cancelled' where c.id = v_c.id returning * into v_c;
  perform app.audit(p_tenant_id, 'resources.class_cancel', 'team_class', v_c.id, p_request_id, null, jsonb_build_object('status', v_c.status));
  v_body := jsonb_build_object('class', app.tm_class_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.class_cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Conclui a turma: presentes geram recebível; ausentes viram falta; comissão sobre as presenças, uma vez. */
create function public.resources_class_complete(
  p_tenant_id uuid,
  p_class_id uuid,
  p_expected_version integer,
  p_attended_seat_ids uuid[],
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_c public.team_classes;
  v_s public.team_class_seats;
  v_attended integer := 0;
  v_base bigint;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.class_complete', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_c from public.team_classes c where c.tenant_id = p_tenant_id and c.id = p_class_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_c.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  if v_c.status <> 'scheduled' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if v_c.starts_at > clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'starts_at';
  end if;
  if exists (select 1 from unnest(coalesce(p_attended_seat_ids, '{}')) x
      where not exists (select 1 from public.team_class_seats s where s.id = x and s.class_id = v_c.id and s.status = 'booked')) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'attended_seat_ids';
  end if;
  for v_s in select * from public.team_class_seats s where s.class_id = v_c.id and s.status = 'booked' order by s.id for update loop
    if v_s.id = any (coalesce(p_attended_seat_ids, '{}')) then
      update public.team_class_seats s set status = 'attended',
        receivable_id = app.tm_receivable(p_tenant_id, v_s.customer_id, v_c.seat_price_cents, format('Turma %s', v_c.title))
      where s.id = v_s.id;
      v_attended := v_attended + 1;
    else
      update public.team_class_seats s set status = 'no_show' where s.id = v_s.id;
    end if;
  end loop;
  v_base := v_attended * v_c.seat_price_cents;
  update public.team_classes c set status = 'completed' where c.id = v_c.id returning * into v_c;
  insert into public.team_commission_entries (tenant_id, professional_id, class_id, kind, base_cents, bps, amount_cents, created_by)
  values (p_tenant_id, v_c.professional_id, v_c.id, 'accrual', v_base, v_c.commission_bps, app.tm_commission_cents(v_base, v_c.commission_bps), v_uid);
  perform app.audit(p_tenant_id, 'resources.class_complete', 'team_class', v_c.id, p_request_id, null,
    jsonb_build_object('attended', v_attended, 'base_cents', v_base));
  v_body := jsonb_build_object('class', app.tm_class_json(v_c));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.class_complete', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------
-- Dono: comissões
-- ---------------------------------------------------------------------------

create function app.tm_entry_json(e public.team_commission_entries) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'professional_id', e.professional_id,
    'professional_name', (select t.name from public.team_resources t where t.id = e.professional_id),
    'booking_id', e.booking_id, 'class_id', e.class_id, 'kind', e.kind, 'base_cents', e.base_cents, 'bps', e.bps,
    'amount_cents', e.amount_cents, 'reversal_of', e.reversal_of,
    'reversed', exists (select 1 from public.team_commission_entries x where x.reversal_of = e.id),
    'created_at', app.sched_ts(e.created_at))
$$;

/** Estorno de uma comissão lançada: linha nova com o valor negativo, uma única vez. */
create function public.resources_commission_reverse(
  p_tenant_id uuid,
  p_entry_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_e public.team_commission_entries;
  v_r public.team_commission_entries;
  v_body jsonb;
begin
  perform app.tm_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'resources.commission_reverse', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_e from public.team_commission_entries e where e.tenant_id = p_tenant_id and e.id = p_entry_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if v_e.kind <> 'accrual' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'kind';
  end if;
  begin
    insert into public.team_commission_entries (tenant_id, professional_id, booking_id, class_id, kind, base_cents, bps, amount_cents, reversal_of, created_by)
    values (p_tenant_id, v_e.professional_id, v_e.booking_id, v_e.class_id, 'reversal', v_e.base_cents, v_e.bps, -v_e.amount_cents, v_e.id, v_uid)
    returning * into v_r;
  exception when unique_violation then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'reversed', detail = 'comissão já estornada';
  end;
  perform app.audit(p_tenant_id, 'resources.commission_reverse', 'team_commission', v_e.id, p_request_id, null, jsonb_build_object('amount_cents', v_r.amount_cents));
  v_body := jsonb_build_object('entry', app.tm_entry_json(v_r));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'resources.commission_reverse', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** Comissões do período por profissional (lançado, estornado, líquido) e os lançamentos (até 200). */
create function public.resources_commissions(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tm_owner(p_tenant_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '93 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'period';
  end if;
  return jsonb_build_object(
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('professional_id', t.id, 'professional_name', t.name,
        'base_cents', x.base, 'accrued_cents', x.accrued, 'reversed_cents', x.reversed, 'net_cents', x.accrued + x.reversed, 'entries', x.n) order by t.name)
      from (select e.professional_id, coalesce(sum(e.base_cents) filter (where e.kind = 'accrual'), 0) as base,
              coalesce(sum(e.amount_cents) filter (where e.kind = 'accrual'), 0) as accrued,
              coalesce(sum(e.amount_cents) filter (where e.kind = 'reversal'), 0) as reversed, count(*) as n
            from public.team_commission_entries e where e.tenant_id = p_tenant_id and e.created_at >= p_from and e.created_at < p_to
            group by e.professional_id) x join public.team_resources t on t.id = x.professional_id), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(app.tm_entry_json(e) order by e.created_at desc, e.id) from (select * from public.team_commission_entries e
      where e.tenant_id = p_tenant_id and e.created_at >= p_from and e.created_at < p_to order by e.created_at desc limit 200) e), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.tm_owner(uuid), app.tm_business_agenda(uuid), app.tm_resource_json(public.team_resources),
  app.tm_commission_bps(uuid, uuid, uuid), app.tm_commission_cents(bigint, integer), app.tm_alloc_json(uuid, uuid),
  app.tm_booking_json(public.team_bookings), app.tm_seat_json(public.team_class_seats), app.tm_class_json(public.team_classes),
  app.tm_lock_resources(uuid, uuid, uuid[]), app.tm_busy(uuid, uuid[], uuid, timestamptz, timestamptz),
  app.tm_allocate(uuid, uuid, uuid, public.team_resources, uuid[], tstzrange, timestamptz, timestamptz),
  app.tm_receivable(uuid, uuid, bigint, text), app.tm_entry_json(public.team_commission_entries),
  app.tm_guard_agenda_booking(), app.tm_guard_agenda_block() from public, anon, authenticated;

revoke all on function public.resources_list(uuid) from public, anon;
revoke all on function public.resources_save(uuid, uuid, integer, text, text, boolean, integer, boolean, text, text, uuid) from public, anon;
revoke all on function public.resources_commission_rule_save(uuid, uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.resources_availability(uuid, uuid, uuid, uuid[], timestamptz, timestamptz) from public, anon;
revoke all on function public.resources_booking_create(uuid, uuid, uuid, uuid, uuid[], timestamptz, text, text, uuid) from public, anon;
revoke all on function public.resources_booking_cancel(uuid, uuid, integer, text, text, text, uuid) from public, anon;
revoke all on function public.resources_booking_complete(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.resources_schedule(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.resources_class_create(uuid, uuid, uuid, uuid, text, timestamptz, integer, bigint, text, text, uuid) from public, anon;
revoke all on function public.resources_class_enroll(uuid, uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.resources_class_seat_cancel(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.resources_class_cancel(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.resources_class_complete(uuid, uuid, integer, uuid[], text, text, uuid) from public, anon;
revoke all on function public.resources_commission_reverse(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.resources_commissions(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.resources_list(uuid) to authenticated;
grant execute on function public.resources_save(uuid, uuid, integer, text, text, boolean, integer, boolean, text, text, uuid) to authenticated;
grant execute on function public.resources_commission_rule_save(uuid, uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.resources_availability(uuid, uuid, uuid, uuid[], timestamptz, timestamptz) to authenticated;
grant execute on function public.resources_booking_create(uuid, uuid, uuid, uuid, uuid[], timestamptz, text, text, uuid) to authenticated;
grant execute on function public.resources_booking_cancel(uuid, uuid, integer, text, text, text, uuid) to authenticated;
grant execute on function public.resources_booking_complete(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.resources_schedule(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.resources_class_create(uuid, uuid, uuid, uuid, text, timestamptz, integer, bigint, text, text, uuid) to authenticated;
grant execute on function public.resources_class_enroll(uuid, uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.resources_class_seat_cancel(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.resources_class_cancel(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.resources_class_complete(uuid, uuid, integer, uuid[], text, text, uuid) to authenticated;
grant execute on function public.resources_commission_reverse(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.resources_commissions(uuid, timestamptz, timestamptz) to authenticated;

alter table public.team_resources enable row level security;
alter table public.team_commission_rules enable row level security;
alter table public.team_bookings enable row level security;
alter table public.team_classes enable row level security;
alter table public.team_class_seats enable row level security;
alter table public.team_allocations enable row level security;
alter table public.team_commission_entries enable row level security;
revoke all on public.team_resources, public.team_commission_rules, public.team_bookings, public.team_classes, public.team_class_seats,
  public.team_allocations, public.team_commission_entries from anon, authenticated;
grant select on public.team_resources, public.team_commission_rules, public.team_classes, public.team_class_seats,
  public.team_allocations, public.team_commission_entries to authenticated;
-- Motivo do cancelamento (texto livre do dono) fica fora da leitura direta.
grant select (id, tenant_id, service_id, customer_id, professional_id, starts_at, ends_at, occupied_range, status, agreed_price_cents,
  commission_bps, receivable_id, created_by, created_at, updated_at, version) on public.team_bookings to authenticated;
grant select, insert, update, delete on public.team_resources, public.team_commission_rules, public.team_bookings, public.team_classes,
  public.team_class_seats, public.team_allocations to service_role;
grant select, insert on public.team_commission_entries to service_role;
create policy team_resources_select_owner on public.team_resources for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy team_commission_rules_select_owner on public.team_commission_rules for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy team_bookings_select_owner on public.team_bookings for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy team_classes_select_owner on public.team_classes for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy team_class_seats_select_owner on public.team_class_seats for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy team_allocations_select_owner on public.team_allocations for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy team_commission_entries_select_owner on public.team_commission_entries for select to authenticated using (app.is_member(tenant_id, array['owner']));
