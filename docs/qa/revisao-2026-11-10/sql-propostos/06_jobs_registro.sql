-- Migration nova (ex.: 2026111x_jobs_registro_de_rotinas.sql)
-- Cada pacote novo passa a INSERIR uma linha aqui em vez de reescrever public.jobs_run inteira.
create table public.job_ticks (
  name text primary key check (name ~ '^[a-z_]+$'),
  fn text not null check (fn ~ '^(app|public)\.[a-z_]+$'),
  takes_batch boolean not null default true,
  batch integer not null default 100 check (batch between 1 and 1000),
  phase text not null check (phase in ('before_outbox', 'after_outbox')),
  position integer not null,
  enabled boolean not null default true,
  unique (phase, position)
);
alter table public.job_ticks enable row level security;
revoke all on public.job_ticks from public, anon, authenticated;
insert into public.job_ticks (name, fn, takes_batch, batch, phase, position) values
  ('expired_offers', 'app.wl_expire_offers', false, 100, 'before_outbox', 10),
  ('expired_holds', 'public.scheduling_expire_holds', false, 100, 'before_outbox', 20),
  ('recurrence', 'app.rc_tick', true, 100, 'before_outbox', 30),
  ('referrals', 'app.ref_tick', true, 100, 'before_outbox', 40),
  ('campaigns', 'app.cp_tick', true, 100, 'before_outbox', 50),
  ('advice', 'app.ga_tick', true, 100, 'before_outbox', 60),
  ('lifecycle', 'app.lc_tick', true, 100, 'after_outbox', 10),
  ('insights', 'app.gi_tick', true, 20, 'after_outbox', 20);

create function app.jobs_run_ticks(p_phase text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.job_ticks;
  v jsonb;
  v_out jsonb := '{}'::jsonb;
  v_err jsonb := '{}'::jsonb;
begin
  for t in select * from public.job_ticks j where j.phase = p_phase and j.enabled order by j.position loop
    begin -- bloco com savepoint: a falha de uma rotina não desfaz as outras
      if t.takes_batch then
        execute format('select to_jsonb(%s($1))', t.fn) into v using t.batch;
      else
        execute format('select to_jsonb(%s())', t.fn) into v;
      end if;
      v_out := v_out || jsonb_build_object(t.name, v);
    exception when others then
      v_out := v_out || jsonb_build_object(t.name, null);
      v_err := v_err || jsonb_build_object(t.name, left(sqlerrm, 300));
    end;
  end loop;
  return jsonb_build_object('results', v_out, 'errors', v_err);
end $$;
revoke all on function app.jobs_run_ticks(text) from public, anon, authenticated;

create or replace function public.jobs_run(p_batch integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_done integer := 0;
  v_failed integer := 0;
  v_dead integer := 0;
  e public.outbox_events;
begin
  v_before := app.jobs_run_ticks('before_outbox');
  for e in
    update public.outbox_events o
    set status = 'processing', leased_until = clock_timestamp() + interval '2 minutes', attempts = o.attempts + 1
    where o.event_id in (
      select x.event_id from public.outbox_events x
      where (x.status = 'pending' and x.next_run_at <= clock_timestamp())
         or (x.status = 'processing' and x.leased_until < clock_timestamp())
      order by x.next_run_at, x.occurred_at
      limit least(greatest(coalesce(p_batch, 50), 1), 500)
      for update skip locked)
    returning o.*
  loop
    begin
      perform app.jobs_handle(e);
      update public.outbox_events o set status = 'done', leased_until = null, last_error = null where o.event_id = e.event_id;
      v_done := v_done + 1;
    exception when others then
      update public.outbox_events o
      set status = case when e.attempts >= e.max_attempts then 'dead' else 'pending' end,
          leased_until = null,
          next_run_at = clock_timestamp() + make_interval(secs => least(3600, 15 * power(2, e.attempts - 1)::integer)),
          last_error = left(sqlerrm, 1000)
      where o.event_id = e.event_id;
      if e.attempts >= e.max_attempts then v_dead := v_dead + 1; else v_failed := v_failed + 1; end if;
    end;
  end loop;
  v_after := app.jobs_run_ticks('after_outbox');
  -- mesmas chaves de hoje (done, retried, dead, expired_holds, expired_offers, lifecycle, ...) + tick_errors
  return jsonb_build_object('done', v_done, 'retried', v_failed, 'dead', v_dead)
    || (v_before -> 'results') || (v_after -> 'results')
    || jsonb_build_object('tick_errors', (v_before -> 'errors') || (v_after -> 'errors'));
end $$;
