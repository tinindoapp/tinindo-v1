# Handoff · Assistente, parte 2 · "Por quê?", "Faz comigo" e "Escreve pra mim"

Sessão: `claude/nifty-clarke-921fl8` (uma das cinco em paralelo, para @fffalleiros) · 2026-11-21
Base: `docs/qa/revisao-2026-11-04/06-assistente-ia-por-fluxo.md` (seções 3, 5.1 e 5.3), `docs/plano-assistente-configuracao-e-insights.md`, `docs/05_AGENTE.md`, handoffs do P46 e do P50.
Área: `src/features/agent/`, `src/features/growth-advice/`, `supabase/functions/agent/`, `supabase/functions/growth-advice/`, `supabase/functions/_shared/llm/`, `supabase/functions/_shared/domain/agent/`, `tests/agent-evals/`, migrations novas e o arquivo novo `src/components/ui/assist.tsx`.

**Nada foi aplicado na homologação. Nenhuma chave foi configurada.** Tudo funciona igual com `LLM_PROVIDER=none` (padrão).

O pacote não está no quadro do `coord.py` (o quadro vai até P46); não houve `claim`.

## Item 1 · `assist.form_draft` e `AssistHint` (T4 a T7)

### Servidor
- `_shared/domain/agent/forms.ts`: catálogo fechado com 4 formulários (`lifecycle.settings`, `schedule.rules`, `service`, `recurrence.plan`), a tela de cada um (`FORM_SCREEN`), a instrução fixa por formulário, o schema que o modelo preenche e o schema do rascunho.
  - **Schema do modelo:** campos anuláveis e estrito. Uma chave a mais invalida a leitura inteira; isso é o sinal de que o modelo obedeceu ao texto.
  - **Schema do rascunho:** derivado do Input da operação de destino, com os mesmos limites, sem ids e sem versão, e estrito.
  - **Travas** (`buildFormDraft`):
    - limites do destino, campo a campo, com uma observação para o dono;
    - dinheiro só entra se o número está no texto (`moneyInText`), nunca "média de mercado";
    - texto com link ou com marcador de dado redigido fica de fora;
    - janelas que terminam antes de começar saem; janelas sobrepostas recusam o rascunho.
  - **Plano de assinatura:** o serviço vem pelo nome (`service_name`) e a tela resolve no catálogo. O modelo nunca gera `service_id`.
- `_shared/llm/tasks/form.ts` (`readFormDraft`): usa a tarefa `setup`, e o dinheiro é conferido contra o texto já redigido.
- `agent/handler.ts`: rota `assist.form_draft`.
  - `FormDraftInput` é `{ form, text }`, com o texto de 3 a 500 caracteres. `FormDraftOutput` é `{ available, form, draft, filled[], notes[] }`.
  - Sem provedor: `available: false`, sem portão e sem débito.
  - Com provedor: o mesmo portão e franquia do `agent.draft` (`agent_run_start`), e só o dono. Modelo fora do ar: `available: true` sem rascunho, com 200.
  - A rota fica **fora do registro de contratos**, como o `setup.describe` do P50. Os schemas estão no domínio e `AGENT_ASSIST_ROUTES` lista a rota. O registro em `OPERATIONS` foi pedido no recado.

### Tela
- `src/components/ui/assist.tsx`:
  - `AssistHint`: a dica fixa aparece sempre. "Faz comigo" abre o campo, "Preencher para eu conferir" pede o rascunho, a faixa mostra o resumo e as observações, e "Preencher o formulário" chama `onApply`. "Agora não" e os eventos sem conteúdo (`onEvent`) também estão nele.
  - `AssistBadge`: o selo "preenchido pelo assistente".
  - `useAssistFields`: marca os campos preenchidos; mexer no campo à mão tira o selo.
  - `UseTextButton`: o "Usar este texto", que respeita o limite do destino.
  - Sem CSS novo: usa `tn-setup-hint` e `tn-badge`.
- `/app/assistente` ganhou o painel "Faz comigo" (`FormAssist.tsx`). O dono escolhe o formulário, escreve e confere o rascunho em palavras. Depois abre a tela de destino com `state.assistDraft = { form, draft, filled }`.
- "Redigir um texto" (T5/T6): quando a entrada traz `returnTo`, `field` e `max`, aparece "Usar este texto". Ele volta para `returnTo` com `state.assistText = { field, text }` e respeita o limite (a frase do Site tem 90).
- Demonstração: `formDraft` responde `available: false`, como o servidor sem provedor.

### Fora da área (recado)
- As telas de destino (Relacionamento, Horários, Serviços e Assinaturas) precisam ler `assistDraft`, preencher com `useAssistFields` e `AssistBadge` e mostrar a `AssistHint` dentro delas. Código pronto no recado.
- As origens do "Escreve pra mim" precisam mandar `returnTo`, `field` e `max` e ler `assistText`: Site (frase de apresentação, 90), Relacionamento (passo manual) e Campanhas.
- Registrar `assist.form_draft` em `OPERATIONS` e no doc03.
- **T7 (tom salvo, `tenants.voice`) não entrou:** a tabela `tenants` e o cadastro são de identidade. O recado propõe a migration.

### Testes
- `forms.test.ts` (22 casos): catálogo; nenhum rascunho aceita id ou versão; régua; horários (dois turnos, dia fechado, sobreposição); serviço (preço dito e não dito, injeção no nome); plano; dinheiro no texto.
- `handler-form.test.ts` (8 casos): sem provedor; régua; telefone, e-mail e CEP não vão ao modelo; preço não dito; injeção com chave extra; modelo fora do ar; equipe recebe 403; formulário fora do catálogo.
- `FormAssist.test.tsx` (10 casos): demonstração; rascunho até a navegação; formulário escolhido; "Usar este texto" com limite; `AssistHint` com selo, falha de rede e eventos sem conteúdo.
