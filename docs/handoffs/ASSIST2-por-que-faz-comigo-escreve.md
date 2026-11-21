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

## Item 2 · "Por quê?" nas sugestões, com cache por versão (T3)

- **Banco.** Migration `*_assist_insight_explanations.sql` e pgTAP 44.
  - Tabela `insight_explanations`: PK `(tenant_id, insight_id, version)`, FK composta para `insights`, texto de 1 a 240 caracteres, RLS só para o dono.
  - RPC `insight_explanation_get`: título, estado, versão, evidência e o texto da versão atual.
  - RPC `insight_explanation_save`: trava o insight, recusa versão que não é a atual (`STALE_VERSION`) e não sobrescreve (`on conflict do nothing`).
- **Servidor.** Rota `insight.explain` na função `growth-advice`, fora do registro de contratos (schemas em `_shared/domain/agent/insight-explain.ts`).
  - A explicação é gerada só quando o dono abre a sugestão, nunca no `insight.list` da Home.
  - Com texto já guardado para a versão: devolve sem modelo e sem débito.
  - Com `none`: frase fixa.
  - Com provedor: portão `agent_run_start` com chave `explain-<id>-v<versão>`, só o dono. Para o modelo vão só o título da regra e os números da evidência. O texto é gravado.
  - Franquia esgotada, modelo fora ou número inventado: frase fixa, com 200.
  - `index.ts` lê `llmFromEnv`.
- **Frases fixas** em `_shared/domain/agent/explain-fixed.ts`: uma por regra (as 9) e os 12 motivos de dado insuficiente ("Ainda não dá para saber X: Y. Isso não quer dizer zero.").
- **Tela Metas e sugestões.**
  - "Por quê?" em cada sugestão aberta, com `aria-expanded`, `aria-live` e uma chamada por versão.
  - Selo "escrito pelo assistente" só quando o texto veio do modelo.
  - Em "O que a conta olhou", a regra com dado insuficiente mostra a frase do que falta.
  - A demonstração usa a frase fixa.
- **Porta.** `explain` é opcional na `GrowthAdvicePort`; o servidor usa `createServerExplain`. Pôr na `createServerPort` quebraria o teste de porta contra o registro. Por isso a Home não mostra "Por quê?": o "Ver" leva a Metas, onde ele aparece.
- **`docs/02_DICIONARIO.md` regenerado** (`bash .github/workflows/db-dictionary.sh`): o CI confere o dicionário contra o banco. Só a tabela nova entrou.
- **Pontos em aberto (decisão do Felipe):**
  - `app.gi_run` sobe a versão do insight a cada rodada diária em que a regra dispara, mesmo com a mesma evidência. Por isso a frase pode ser gerada de novo e debitar uma pergunta quase todo dia em que o dono abre. Alternativa: guardar a frase pelo `sha256` da evidência (migration nova). Ficou por versão, como o pedido diz.
  - "Hoje são N" no motivo de insuficiente só aparece na demonstração: o motor do P45 grava só o motivo, sem o número.
- **Testes.**
  - pgTAP 44: 22 asserções.
  - Handler (cache, versão nova, `none`, número inventado, franquia esgotada).
  - Frases fixas: as 9 regras e o insuficiente.
  - Tela: `InsightsWhy.test.tsx`.
  - e2e: `tests/e2e/growth-advice/por-que.spec.ts` (desktop, celular e 375 px). É um spec novo em `tests/e2e/growth-advice/`; a jornada do módulo tinha de ser coberta.

## Item 4 · Custo por negócio, teto de tokens (T11) e CEP e endereço na redação (T12)

- **Redação.** `redactPii` troca CEP por `[cep]` (`01310-100`, `01310100`, `01.310-100`), antes da regra de telefone. Logradouro com nome, número e complemento curto vira `[endereço]`.
  - Ficam como estão: o prefixo de zona de 5 dígitos, horários, datas, valores, durações e bairros sem logradouro.
  - Cerca de 80 casos em `redact.test.ts`.
- **Uso por negócio.** Migration `*_assist_llm_usage.sql` e pgTAP 45.
  - Tabela `agent_llm_usage`: negócio, mês no fuso do negócio, tarefa, chamadas, tokens de entrada e de saída, `cost_usd` (só chamadas com preço) e `unpriced_calls`. Só o dono lê.
  - Coluna `agent_quotas.llm_monthly_tokens`, padrão **400.000 tokens por mês**. Com Haiku 5.5: cerca de US$ 0,06 na mistura típica e no máximo US$ 0,20. As 200 perguntas da franquia usam uns 160 mil.
  - RPCs `agent_llm_record` e `agent_llm_allowance`.
  - O log `fn:"llm"` continua sem tenant.
- **Camada de linguagem.** `onUsage` no pedido e `withUsage(llm, sink)` em `_shared/llm/usage.ts`. Com `none`, nenhuma RPC de uso roda.
- **Onde o teto vale.** `agent.ask` (quando o modelo seria chamado), `agent.draft`, `assist.form_draft` (item 1) e `insight.explain` (item 2).
  - Acima do teto, ou se a consulta falhar, o assistente segue como `none`: sem débito, sem modelo e sem erro para o usuário.
  - Cada tentativa ao modelo é gravada; falha ao gravar só aparece como contagem no log técnico.
- **Fora da área:**
  - `setup.describe` (função `setup`): o código pronto vai no recado.
  - O parágrafo de `release/LLM.md`, também no recado.
  - A tabela nova entra na exportação de privacidade do P57, porque não está em `app.privacy_hidden_table`. São só números; o recado pergunta se deve ficar de fora.
- **Decisões do subagente, mantidas:**
  - a equipe também grava o uso e consulta o teto (o assistente responde à equipe), mas não lê a tabela;
  - `allowed = usado < teto`;
  - o mês do teto usa o fuso do negócio, enquanto a franquia de perguntas continua em UTC.
