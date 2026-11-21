-- Assistente parte 2, item 2 (revisão de 04/11, T3 da §5.1 e item 5 da §5.3) · "Por quê?" nos insights do P45.
-- A frase que explica um insight é escrita pelo modelo de linguagem do P46 (tarefa EXPLAIN) SÓ quando o dono abre a
-- sugestão, nunca a cada leitura da Home, e fica guardada por VERSÃO do insight: abrir de novo a mesma versão não
-- chama o modelo. O motor diário (`app.gi_run`) sobe a versão quando recalcula o insight; a versão nova ganha frase nova.
-- Sem provedor (LLM_PROVIDER=none), modelo fora, franquia esgotada ou frase com número que não está na evidência, a
-- Edge Function `growth-advice` devolve a frase fixa por regra (_shared/domain/agent/explain-fixed.ts) e nada é gravado.
--
-- Invariantes:
-- * Uma frase por (negócio, insight, versão), PK; a FK composta (tenant_id, insight_id) impede apontar para insight de
--   outro negócio.
-- * Só grava se a versão pedida é a versão atual do insight (senão STALE_VERSION) e nunca sobrescreve: `on conflict do
--   nothing` devolve a frase que já estava.
-- * Escrita só por RPC SECURITY DEFINER (dono do negócio, módulo ligado: app.ga_owner); leitura pela RLS para o dono,
--   no padrão das tabelas do P45.
-- * O texto é a frase do modelo, já conferida na função (só números da evidência); nunca nome de cliente.

create table public.insight_explanations (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  insight_id uuid not null,
  version integer not null check (version >= 1),
  text text not null check (char_length(text) between 1 and 240),
  created_at timestamptz not null default now(),
  primary key (tenant_id, insight_id, version),
  constraint insight_explanations_insight foreign key (tenant_id, insight_id) references public.insights (tenant_id, id) on delete cascade
);
comment on table public.insight_explanations is
  'Frase "Por quê?" de um insight (P45), escrita pelo modelo (P46, tarefa EXPLAIN) quando o dono abre a sugestão. Uma por versão; só a RPC grava.';

/**
 * Leitura do insight para a explicação: título da regra, evidência, versão atual e a frase já guardada para essa versão
 * (ou null). Só o dono, com o módulo ligado. O payload da ação (ids internos) não sai.
 */
create function public.insight_explanation_get(p_tenant_id uuid, p_insight_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  i public.insights;
begin
  perform app.ga_owner(p_tenant_id);
  select * into i from public.insights x where x.tenant_id = p_tenant_id and x.id = p_insight_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'insight_id';
  end if;
  return jsonb_build_object(
    'insight_id', i.id, 'rule_code', i.rule_code, 'rule_title', (select r.title from public.insight_rules r where r.code = i.rule_code),
    'state', i.state, 'version', i.version, 'evidence', i.evidence,
    'text', (select e.text from public.insight_explanations e where e.tenant_id = i.tenant_id and e.insight_id = i.id and e.version = i.version));
end $$;

/**
 * Guarda a frase da versão atual. Versão diferente da atual → STALE_VERSION (nada gravado). Já existe frase para a
 * versão → não sobrescreve e devolve a que estava (`saved = false`).
 */
create function public.insight_explanation_save(p_tenant_id uuid, p_insight_id uuid, p_version integer, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_current integer;
  v_n integer;
  v_text text := btrim(coalesce(p_text, ''));
begin
  perform app.ga_owner(p_tenant_id);
  if char_length(v_text) not between 1 and 240 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'text';
  end if;
  -- Trava a linha do insight: o motor não sobe a versão entre a conferência e a gravação.
  select x.version into v_current from public.insights x where x.tenant_id = p_tenant_id and x.id = p_insight_id for share;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'insight_id';
  end if;
  if p_version is distinct from v_current then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION', hint = 'version';
  end if;
  insert into public.insight_explanations (tenant_id, insight_id, version, text)
  values (p_tenant_id, p_insight_id, p_version, v_text)
  on conflict (tenant_id, insight_id, version) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('insight_id', p_insight_id, 'version', p_version, 'saved', v_n = 1,
    'text', (select e.text from public.insight_explanations e where e.tenant_id = p_tenant_id and e.insight_id = p_insight_id and e.version = p_version));
end $$;

revoke all on function public.insight_explanation_get(uuid, uuid) from public, anon;
revoke all on function public.insight_explanation_save(uuid, uuid, integer, text) from public, anon;
grant execute on function public.insight_explanation_get(uuid, uuid) to authenticated;
grant execute on function public.insight_explanation_save(uuid, uuid, integer, text) to authenticated;

alter table public.insight_explanations enable row level security;
grant select on public.insight_explanations to authenticated;
create policy insight_explanations_owner_select on public.insight_explanations for select to authenticated
  using (app.is_member(tenant_id, array['owner']));
