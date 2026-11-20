-- P56 · Rotinas periódicas isoladas (revisão de 10/11, be-banco-03 e linha P).
-- Até aqui `public.jobs_run` chamava as rotinas de oito módulos na mesma transação, sem bloco de exceção: um erro em
-- qualquer uma (insights, campanhas, indicações…) abortava a rodada inteira e parava a fila de eventos, os lembretes e
-- as expirações, a cada minuto. Agora cada rotina é uma linha em `public.job_ticks` e roda em bloco próprio
-- (savepoint): a que falha desfaz só o que ela mesma escreveu, e as outras seguem.
-- Pacote novo passa a INSERIR uma linha aqui em vez de reescrever `jobs_run` (que já foi reescrita 7 vezes).
-- Desligar a rotina de um módulo escondido no piloto: `update public.job_ticks set enabled = false` em migration.

create table public.job_ticks (
  name text primary key check (name ~ '^[a-z_]+$'),
  -- Só funções dos schemas do app, sem argumento livre: o nome entra num `execute format`.
  fn text not null check (fn ~ '^(app|public)\.[a-z_]+$'),
  takes_batch boolean not null default true,
  batch integer not null default 100 check (batch between 1 and 1000),
  phase text not null check (phase in ('before_outbox', 'after_outbox')),
  position integer not null,
  enabled boolean not null default true,
  -- Operação: última falha e quantas rodadas seguidas falharam (zera quando a rotina volta a passar).
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error text,
  last_failed_at timestamptz,
  unique (phase, position)
);
comment on table public.job_ticks is 'Registro das rotinas periódicas do worker (jobs_run). Uma linha por rotina; cada uma roda isolada.';
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

-- Roda as rotinas ligadas de uma fase, na ordem. Devolve {results: {nome: retorno}, errors: {nome: mensagem}}.
-- A rotina que falha fica com resultado null e a mensagem em `errors`; o que ela escreveu é desfeito pelo savepoint.
create function app.jobs_run_ticks(p_phase text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.job_ticks;
  v jsonb;
  v_out jsonb := '{}'::jsonb;
  v_err jsonb := '{}'::jsonb;
begin
  for t in select * from public.job_ticks j where j.phase = p_phase and j.enabled order by j.position loop
    begin
      if t.takes_batch then
        execute format('select to_jsonb(%s($1))', t.fn) into v using t.batch;
      else
        execute format('select to_jsonb(%s())', t.fn) into v;
      end if;
      v_out := v_out || jsonb_build_object(t.name, v);
      if t.consecutive_failures > 0 then
        update public.job_ticks j set consecutive_failures = 0
        where j.name = (select x.name from public.job_ticks x where x.name = t.name for update skip locked);
      end if;
    exception when others then
      v_out := v_out || jsonb_build_object(t.name, null);
      v_err := v_err || jsonb_build_object(t.name, left(sqlerrm, 300));
      -- `skip locked`: dois workers em paralelo não esperam um pelo outro só para anotar a falha (a espera manteria
      -- os bloqueios das rotinas anteriores e abriria espaço para deadlock). O contador é por rodada que anotou.
      update public.job_ticks j
      set consecutive_failures = j.consecutive_failures + 1, last_error = left(sqlerrm, 1000), last_failed_at = clock_timestamp()
      where j.name = (select x.name from public.job_ticks x where x.name = t.name for update skip locked);
    end;
  end loop;
  return jsonb_build_object('results', v_out, 'errors', v_err);
end $$;
revoke all on function app.jobs_run_ticks(text) from public, anon, authenticated;

-- substitui 20261103150000_p45_insights.sql:1024; muda: as oito chamadas diretas viram o registro (job_ticks), cada
-- uma isolada; o retorno mantém as mesmas chaves e ganha `tick_errors` ({} quando nada falhou).
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
  -- Depois do outbox: a régua e o motor de insights leem o estado já atualizado.
  v_after := app.jobs_run_ticks('after_outbox');
  return jsonb_build_object('done', v_done, 'retried', v_failed, 'dead', v_dead)
    || (v_before -> 'results') || (v_after -> 'results')
    || jsonb_build_object('tick_errors', (v_before -> 'errors') || (v_after -> 'errors'));
end $$;
