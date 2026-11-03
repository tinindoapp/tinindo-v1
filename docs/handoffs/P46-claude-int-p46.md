# Handoff · P46 Camada de linguagem (LLM)

Sessão: `claude-int-p46` (integrador, para @fffalleiros) · 2026-11-03
Reserva: P46 liberado no quadro pelo integrador (registro `release` no `coordination`, conforme tasks/P46.md: "liberado por @fffalleiros em 03/11") e reservado com `coord.py claim`. Dependências no quadro: P08 e P13 (P44 e P45 ainda não estão no quadro nem na main).
Branch: `claude/amazing-volta-mjidw6` (branch designada para esta sessão; o `claim` sugeriu `task/p46/claude-int-p46`) → PR para `main`. Decisões em `docs/adr/0035-camada-de-linguagem.md`; operação em `release/LLM.md`.

**Nada foi configurado nem aplicado em homologação ou produção. Nenhuma chave foi criada.** O padrão é `LLM_PROVIDER=none`.

## Entregue

- **`supabase/functions/_shared/llm/`**
  - `llm.extract({task, system, input, schema})` (`client.ts`): redige PII da entrada, chama o adaptador com o schema do zod convertido para a saída estruturada do provedor, valida de novo pelo zod e devolve o objeto ou `null`. Reserva opcional, uma tentativa por provedor.
  - Adaptadores com SDK oficial (`npm:` no `deno.json`, carregados sob demanda): `adapters/anthropic.ts` (`@anthropic-ai/sdk` 1.3.0, `output_config.format` json_schema, esforço `low`), `adapters/openai.ts` (`openai` 7.39.0, Responses API, json_schema estrito, `store: false`), `adapters/gemini.ts` (`@google/genai` 2.30.0, `responseJsonSchema`), `adapters/none.ts` (padrão). Nenhum envia `temperature`, `top_p` ou `top_k`.
  - `config.ts`: só segredos (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_MODEL_<TAREFA>`, `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`, `LLM_TIMEOUT_MS`, `LLM_FALLBACK_PROVIDER`, mais `LLM_FALLBACK_MODEL` para a reserva). Padrão Anthropic `claude-haiku-5-5`; OpenAI e Gemini exigem `LLM_MODEL`.
  - `prices.ts`: tabela versionada (`2026-11-03`), Anthropic Haiku/Sonnet/Opus 5.5. OpenAI e Gemini ficam de fora até haver modelo escolhido (custo `null`, nunca zero).
  - `redact.ts`: telefone, e-mail, CPF, CNPJ e números longos viram marcadores em toda chamada; nomes do cadastro viram "cliente N" e voltam só no servidor.
  - Registro por chamada sem conteúdo: `{fn:"llm", task, provider, model, input_tokens, output_tokens, cost_usd, price_table, ms, result, fallback}`.
  - Tarefas: `tasks/intent.ts` (P08), `tasks/draft.ts` (redação), `tasks/setup.ts` (frase do negócio, P44), `tasks/explain.ts` (insight, P45).
- **P08** (`supabase/functions/agent/understand.ts` + `handler.ts`): o motor roda primeiro; só o `unknown` vai ao modelo, que devolve intenção e argumentos num schema fechado (sem ações proibidas; pedidos proibidos só existem como intenções de recusa). A leitura vira frase canônica e o mesmo motor roda de novo; família de intenção diferente = leitura descartada. Provedor fora do ar = resposta determinística (200).
- **`agent.draft`** (operação nova no registro e no doc03): mesmo portão e franquia do `agent.ask`, só o dono, nomes rotulados, sugestão descartada se trouxer número, link ou marcador novo. Sem provedor: `{available:false, suggestion:null}` sem débito.
- **Tela `/app/assistente`**: "Me ajuda a configurar" (um passo por vez a partir de `setup.progress`, com o porquê, link da tela, "Já fiz, conferir" e "Pular por agora" nos opcionais) e "Redigir um texto" (tipo, tom, rascunho, sugestão editável, copiar). Links "Ajustar/Redigir com o assistente" em Relacionamento (passo manual), Site (frase de apresentação) e Campanhas, levando o texto pelo estado da navegação (fora da URL).

## Pontos de integração deixados prontos (P44 e P45 não estão na main)

- **Frase do negócio (P44):** `readBusinessPhrase(llm, frase)` em `_shared/llm/tasks/setup.ts` devolve o rascunho estruturado (`BusinessDraft`: profissão, tamanho da equipe, expediente por dia, serviços com duração e preço só se ditos) ou `null`. Ligação esperada no P44: o analisador por regras roda primeiro; se não entender a frase, chama esta função e mostra o resultado como rascunho "lido pelo assistente" para o dono revisar campo a campo. Ajustar `BusinessDraft` ao contrato que o P44 publicar.
- **`setup.progress` (P44):** o guia lê a forma mínima de `src/features/agent/setupGuide.ts` (`steps[]` com `code`, `title`, `done`, `optional`, `why`, `href`) chamando `POST /functions/v1/setup/setup.progress`. Enquanto a função não existir, a tela diz que a configuração guiada não está disponível. Quando o P44 entrar: trocar o schema local pelo de `@contracts` e conferir o caminho da função. A demonstração usa um progresso de exemplo (4 de 8).
- **Explicação de insight (P45):** `explainInsight(llm, {title, facts})` devolve uma frase que só pode usar números da evidência, ou `null` (o P45 mostra o texto do modelo fixo).

## Testes, comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` | ok |
| `npm run test:unit` | RESULTADO_UNIT |
| `npm run test:contracts` | RESULTADO_CONTRACTS |
| `npm run build` | ok |
| `npm run test:coord` | ok |
| `npm audit --omit=dev --audit-level=critical` | ok (SDKs ficam em devDependencies: só o Deno os usa em produção) |
| `deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts` | ok (deno.lock atualizado) |
| `node tests/agent-evals/validate.ts` | ok: 40 casos |

Cobertura nova:
- `tests/contracts/llm/adapters.test.ts` (28): cada adaptador contra servidor falso local (sem rede): sucesso, JSON inválido, JSON fora do schema, recusa, 429 (sem nova tentativa), tempo esgotado; pedido usa saída estruturada e o modelo do segredo, sem `temperature/top_p/top_k`; PII não sai no corpo; registro sem conteúdo; reserva.
- `tests/contracts/llm/tasks.test.ts` (28): configuração, preços, redação de PII, rótulos, schema do provedor, frase canônica, redação, frase do negócio, explicação.
- `tests/contracts/agent/evals-llm.test.ts` (75): com `none`, os 36 casos não-banco dão resultado idêntico ao P08; 31 variantes livres passam na expectativa do caso base com leitura roteirizada (zero ação proibida, zero vazamento; nada de PII nem nome do cadastro vai ao modelo); 7 leituras hostis com zero ação proibida e zero vazamento.
- `supabase/functions/agent/handler-llm.test.ts` (8) e `src/features/agent/AssistPanels.test.tsx` (6).
- Mutação conferida: tirar o guarda de família de intenção em `understand.ts` derruba `AE-L-INJ-07` (verbo "cancela" escondido no argumento viraria proposta de cancelamento).
- Avaliação com chave real: `evals-llm-live.test.ts`, só com `LLM_EVAL_LIVE=1` (fora do CI). **Não rodada**: não há chave.

Mocks: os adaptadores foram testados contra servidores falsos que imitam a resposta de cada provedor; nenhuma chamada real foi feita. O formato real de cada provedor só será confirmado na primeira rodada com chave.

## Achados e limitações

- **O modelo só é consultado quando o motor responde "não entendi".** Frases que o motor determinístico entende errado continuam erradas. Duas apareceram ao escrever as variantes: "me mostra o que o Personal Exemplo B tem marcado essa semana" (a palavra "marcado" leva à agenda do próprio negócio, sem vazamento, em vez da recusa de outro negócio) e "quanto ela tem de crédito por lá?" (leva a pacotes do próprio negócio). Correção possível no P08: regra de outro negócio antes das consultas, ou mandar ao modelo também quando o texto cita nome que não é cliente nem o próprio negócio.
- **Custo do mês por negócio:** o registro vai para o log da função sem tenant (regra do P08). Para somar por negócio é preciso uma tabela (`agent_llm_usage`: tenant, mês, tarefa, tokens, custo estimado) gravada pela função: proposta de migration para o integrador, não aplicada.
- `agent.draft` com provedor ligado debita uma pergunta da franquia do assistente.
- O tom do dono é escolhido na hora (próximo, direto, formal); não há tom salvo no cadastro.

## Decisões pendentes (Felipe)

Para ligar: provedor (sugestão Anthropic `claude-haiku-5-5`), orçamento mensal, termos de dados e não treinamento (pendência D2), texto na política de privacidade, região e retenção. Depois: `release/LLM.md` (segredos e avaliação com chave real).

## Próximo passo

P44 (configuração guiada) e P45 (insights) ligam os pontos acima. Antes de ligar o provedor em homologação: rodar `evals-llm-live.test.ts` com a chave escolhida e registrar o resultado aqui.
