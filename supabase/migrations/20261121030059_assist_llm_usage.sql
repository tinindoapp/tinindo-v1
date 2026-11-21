-- Assistente parte 2 · T11: custo da camada de linguagem por negócio e teto mensal de tokens.
--
-- * `agent_llm_usage`: um contador por negócio, mês (no fuso do negócio) e tarefa do modelo. Só números: chamadas,
--   tokens e custo estimado em US$. Nada de texto, usuário ou conteúdo (o registro técnico `fn: "llm"` continua sem
--   tenant; quem soma por negócio é a função, depois da chamada, por esta RPC).
-- * `cost_usd` soma só as chamadas com preço na tabela (`prices.ts`); as sem preço contam em `unpriced_calls` e nunca
--   zeram nem viram zero na soma.
-- * Teto mensal de tokens (entrada + saída) por negócio em `agent_quotas.llm_monthly_tokens`, padrão 400.000.
--   Conta (Haiku 5.5, US$ 0,10 por milhão de entrada e US$ 0,50 de saída): uma pergunta INTENT usa ~700 + ~100 tokens,
--   então as 200 perguntas da franquia dão ~160 mil tokens; 400 mil deixam folga para redação (DRAFT) e reserva.
--   Custo no teto: ~US$ 0,06 na mistura típica (7 de entrada para 1 de saída), no máximo US$ 0,20 (tudo saída).
--   Com Sonnet 5.5 (20x) o mesmo teto fica em ~US$ 1,20 (máx. US$ 4). Acima do teto, a função não chama o modelo e
--   o assistente segue determinístico, como com `LLM_PROVIDER=none`.
-- * Escrita só pelas RPCs (security definer, search_path vazio). Leitura direta da tabela: só o dono (RLS).
-- Depende de: fundação (tenants.timezone, app.is_member), P08 (agent_quotas).

alter table public.agent_quotas
  add column llm_monthly_tokens bigint not null default 400000 check (llm_monthly_tokens between 0 and 100000000);
comment on column public.agent_quotas.llm_monthly_tokens is
  'T11: teto mensal de tokens (entrada + saída) da camada de linguagem por negócio. Acima dele o assistente segue sem modelo.';

create table public.agent_llm_usage (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  task text not null check (task in ('intent', 'setup', 'draft', 'explain')),
  calls integer not null default 0 check (calls >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  unpriced_calls integer not null default 0 check (unpriced_calls >= 0 and unpriced_calls <= calls),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, month, task)
);
comment on table public.agent_llm_usage is
  'T11: uso da camada de linguagem por negócio, mês (fuso do negócio) e tarefa. Só números; sem texto, usuário ou conteúdo.';
comment on column public.agent_llm_usage.cost_usd is
  'Soma do custo estimado (US$) só das chamadas com preço na tabela; as sem preço contam em unpriced_calls.';

/** Primeiro dia do mês, no fuso do negócio, de um instante. */
create function app.agent_llm_month(p_tenant_id uuid, p_at timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('month', p_at at time zone coalesce(
    (select t.timezone from public.tenants t where t.id = p_tenant_id), 'America/Sao_Paulo'))::date
$$;

/** Teto do negócio (padrão da coluna quando ainda não há linha de franquia). */
create function app.agent_llm_limit(p_tenant_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce((select q.llm_monthly_tokens from public.agent_quotas q where q.tenant_id = p_tenant_id), 400000)
$$;

/** Tokens usados no mês corrente do negócio, todas as tarefas. */
create function app.agent_llm_used(p_tenant_id uuid, p_month date) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint
  from public.agent_llm_usage u where u.tenant_id = p_tenant_id and u.month = p_month
$$;

/**
 * Antes de chamar o modelo: o negócio ainda está abaixo do teto do mês? Qualquer membro (o assistente atende dono e
 * equipe); sem vínculo, recusado. `allowed = used < limit`: a chamada que cruza o teto passa, a seguinte não.
 */
create function public.agent_llm_allowance(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_used bigint;
  v_limit bigint;
begin
  if auth.uid() is null or not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_used := app.agent_llm_used(p_tenant_id, app.agent_llm_month(p_tenant_id, clock_timestamp()));
  v_limit := app.agent_llm_limit(p_tenant_id);
  return jsonb_build_object('allowed', v_used < v_limit, 'used_tokens', v_used, 'limit_tokens', v_limit);
end $$;

/**
 * Depois de cada tentativa ao modelo (inclusive a reserva): soma no contador do mês do negócio. Só números.
 * Custo null = modelo sem preço na tabela: conta a chamada em unpriced_calls e não mexe na soma de custo.
 */
create function public.agent_llm_record(p_tenant_id uuid, p_task text, p_input_tokens bigint, p_output_tokens bigint,
  p_cost_usd numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_month date;
  v_row public.agent_llm_usage;
begin
  if auth.uid() is null or not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_task is null or p_task not in ('intent', 'setup', 'draft', 'explain') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'task';
  end if;
  if p_input_tokens is null or p_input_tokens not between 0 and 1000000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'input_tokens';
  end if;
  if p_output_tokens is null or p_output_tokens not between 0 and 1000000 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'output_tokens';
  end if;
  if p_cost_usd is not null and p_cost_usd not between 0 and 100 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cost_usd';
  end if;
  v_month := app.agent_llm_month(p_tenant_id, clock_timestamp());
  insert into public.agent_llm_usage as u (tenant_id, month, task, calls, input_tokens, output_tokens, cost_usd,
    unpriced_calls)
  values (p_tenant_id, v_month, p_task, 1, p_input_tokens, p_output_tokens, coalesce(p_cost_usd, 0),
    case when p_cost_usd is null then 1 else 0 end)
  on conflict (tenant_id, month, task) do update set
    calls = u.calls + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cost_usd = u.cost_usd + excluded.cost_usd,
    unpriced_calls = u.unpriced_calls + excluded.unpriced_calls,
    updated_at = now()
  returning * into v_row;
  return jsonb_build_object('month', v_row.month, 'task', v_row.task, 'calls', v_row.calls,
    'input_tokens', v_row.input_tokens, 'output_tokens', v_row.output_tokens, 'cost_usd', v_row.cost_usd,
    'unpriced_calls', v_row.unpriced_calls);
end $$;

revoke all on function app.agent_llm_month(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.agent_llm_limit(uuid) from public, anon, authenticated;
revoke all on function app.agent_llm_used(uuid, date) from public, anon, authenticated;
revoke all on function public.agent_llm_allowance(uuid) from public, anon;
revoke all on function public.agent_llm_record(uuid, text, bigint, bigint, numeric) from public, anon;
grant execute on function public.agent_llm_allowance(uuid) to authenticated;
grant execute on function public.agent_llm_record(uuid, text, bigint, bigint, numeric) to authenticated;

alter table public.agent_llm_usage enable row level security;
revoke all on public.agent_llm_usage from anon, authenticated;
grant select on public.agent_llm_usage to authenticated;
grant select, insert, update on public.agent_llm_usage to service_role;
create policy agent_llm_usage_select_owner on public.agent_llm_usage
  for select to authenticated using (app.is_member(tenant_id, array['owner']));
