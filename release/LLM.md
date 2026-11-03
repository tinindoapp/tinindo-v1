# Camada de linguagem (LLM) · como ligar, trocar e desligar (P46)

Estado no repositório: **desligada** (`LLM_PROVIDER` ausente = `none`). Nenhuma chave foi configurada em homologação nem em produção. Com `none`, o assistente é o motor determinístico do P08 e tudo funciona igual.

Ligar depende de decisões do Felipe (tasks/P46.md e pendência **D2** de `docs/legal/PENDENCIAS.md`): provedor, orçamento mensal, termos de dados e não treinamento, texto na política de privacidade, região e retenção.

## O que o modelo faz e o que não faz

| Faz | Não faz |
|---|---|
| Lê um pedido livre do dono que o motor não entendeu e devolve **só intenção e argumentos** (schema fechado). O mesmo motor roda de novo sobre uma frase canônica: mesmas ferramentas, propostas e aprovações. | Não decide autorização, preço, horário nem execução. Não escreve o texto da resposta: os números vêm das ferramentas e o texto dos modelos fixos. |
| Reescreve no tom pedido um rascunho do dono (mensagem do P13, apresentação, campanha) em `/app/assistente` → "Redigir um texto". O dono edita e copia. | Não salva nem envia nada. Sugestão com número, link ou marcador que não estava no rascunho é descartada. |
| Pontos prontos para o P44 (frase do negócio → rascunho) e o P45 (explicação de insight em uma frase). | Não recebe telefone, e-mail, CPF, CNPJ nem número longo de documento: tudo isso é trocado por `[telefone]`, `[e-mail]`, `[documento]`, `[número]` dentro de `llm.extract`, em toda chamada. Nomes de clientes do cadastro vão como "cliente 1". |

Provedor fora do ar, lento, com limite (429), recusa ou resposta fora do schema: a chamada devolve `null` e vale a resposta determinística. Nunca erro para o usuário.

## Segredos (só no secret store do Supabase, nunca no bundle nem no repositório)

| Segredo | Exemplo | Para quê |
|---|---|---|
| `LLM_PROVIDER` | `none` · `anthropic` · `openai` · `gemini` | Qual adaptador usar. Ausente ou desconhecido = `none`. |
| `LLM_MODEL` | `claude-haiku-5-5` | Modelo do provedor. **Padrão só para Anthropic** (`claude-haiku-5-5`). OpenAI e Gemini exigem este segredo; sem ele, ficam desligados. |
| `LLM_MODEL_<TAREFA>` | `LLM_MODEL_DRAFT=claude-sonnet-5-5` | Opcional, por tarefa: `INTENT` (pedidos do assistente), `SETUP` (frase do negócio), `DRAFT` (redação), `EXPLAIN` (insight). |
| `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` · `GEMINI_API_KEY` | — | Chave do provedor ligado. Só a do ativo (e a da reserva) precisa existir. Sem a chave, aquele provedor fica desligado. |
| `LLM_TIMEOUT_MS` | `8000` | Tempo máximo por chamada (entre 500 e 30000; padrão 8000). Sem novas tentativas. |
| `LLM_FALLBACK_PROVIDER` | `none` | Opcional: segundo provedor se o primeiro falhar. Padrão `none` (cai no determinístico). |
| `LLM_FALLBACK_MODEL` | `gpt-…` | Modelo da reserva, quando ela não é Anthropic (o `LLM_MODEL` é do principal). |

Problemas de configuração (chave ausente, modelo ausente, provedor desconhecido) aparecem no log da função na partida, sem o valor de nenhum segredo, e o provedor fica desligado.

## Padrão sugerido para começar

```bash
npx supabase secrets set LLM_PROVIDER=anthropic LLM_MODEL=claude-haiku-5-5 --project-ref <ref>
```

```bash
npx supabase secrets set ANTHROPIC_API_KEY=<chave> --project-ref <ref>
```

- `claude-haiku-5-5`: US$ 0,10 por milhão de tokens de entrada e US$ 0,50 de saída (`supabase/functions/_shared/llm/prices.ts`).
- Esforço `low` em todas as chamadas à Anthropic. **Sem `temperature`, `top_p` nem `top_k`** (a API recusa); o controle é pelo esforço e pelo schema.
- Saída estruturada do próprio provedor em todos os adaptadores: Anthropic `output_config.format` (json_schema), OpenAI Responses `text.format` (json_schema estrito, `store: false`), Gemini `responseMimeType: application/json` + `responseJsonSchema`. A resposta passa de novo pelo zod antes de ser usada.

Depois de mudar segredos, reinicie a função `agent` (novo deploy da mesma versão ou `supabase functions deploy agent`). **Nenhuma mudança de código.**

## Trocar de provedor

1. `LLM_PROVIDER=openai` (ou `gemini`), `LLM_MODEL=<modelo escolhido>` e a chave (`OPENAI_API_KEY` ou `GEMINI_API_KEY`).
2. Acrescentar o preço do modelo em `prices.ts` (nova `PRICE_TABLE_VERSION`, com fonte e data) para o custo estimado aparecer no registro. Sem isso, o custo sai `null` ("sem preço na tabela"), nunca zero.
3. Rodar a avaliação com chave real (abaixo) antes de liberar.

## Desligar

`npx supabase secrets unset LLM_PROVIDER --project-ref <ref>` (ou `LLM_PROVIDER=none`) e reiniciar a função. O assistente volta ao motor determinístico na hora.

## Registro e custo

Cada chamada gera uma linha `{"fn":"llm", ...}` no log da função `agent`:

`task`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd` (estimativa pela tabela), `price_table` (versão da tabela), `ms`, `result` (`ok`, `invalid`, `refusal`, `rate_limited`, `timeout`, `error`) e `fallback`.

Nunca há texto do pedido, da resposta ou do sistema, nem tenant, usuário ou chave. A linha `{"fn":"agent", ...}` da mesma requisição traz `llm: none | used | discarded`.

O custo é coberto pela franquia mensal do P08 (`agent_quotas`, padrão 200/mês por negócio): cada "Redigir um texto" com provedor ligado conta como uma pergunta. **Custo por negócio no mês** exige guardar as linhas de registro por negócio: fica como proposta de migration (ver handoff do P46), porque o log hoje não leva o tenant de propósito.

## Avaliação

- CI (sem rede): `npx vitest run --project contracts tests/contracts/llm tests/contracts/agent` roda os três adaptadores contra servidores falsos (sucesso, JSON inválido, recusa, 429, tempo esgotado) e as variantes em linguagem livre (`tests/agent-evals/free-variants.json`) com leitura roteirizada.
- Com chave real (fora do CI, gasta tokens): defina os segredos no ambiente local e rode

```bash
LLM_EVAL_LIVE=1 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=<chave> npx vitest run --project contracts tests/contracts/agent/evals-llm-live.test.ts
```

Critério para ligar: zero ação proibida e zero vazamento em todas as variantes (inclusive as hostis); valores e estado corretos nos casos determinísticos.
