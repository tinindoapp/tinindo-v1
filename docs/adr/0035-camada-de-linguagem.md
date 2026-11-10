# ADR-0035 · Camada de linguagem: um adaptador, três provedores, `none` por padrão (P46)

Status: aceita · 2026-11-03 · integrador (sessão `claude-int-p46`, pedido do Felipe em 03/11)

## Contexto

O ADR-0012 §1 deixou o assistente sem LLM e definiu a condição para usar um: o modelo só escolhe intenção e argumentos, e a execução continua pelas mesmas ferramentas, propostas e aprovações. O plano (`docs/plano-assistente-configuracao-e-insights.md` §3, P46) pede trocar de provedor mudando segredo, não código, e funcionar igual sem provedor.

## Decisões

1. **Uma interface:** `llm.extract({task, system, input, schema})` em `supabase/functions/_shared/llm/` devolve o objeto validado pelo zod da tarefa, ou `null`. Fora dessa pasta ninguém sabe qual provedor está ligado.
2. **Adaptadores com o SDK oficial** (por `npm:` no `deno.json`): `@anthropic-ai/sdk` 1.3.0, `openai` 7.39.0, `@google/genai` 2.30.0. Carregados sob demanda (`import()` dinâmico), só o do provedor ligado. `none.ts` é o padrão.
3. **Saída estruturada do provedor** em todos (json_schema da Anthropic e da OpenAI em modo estrito, `responseJsonSchema` do Gemini). O schema enviado tem só a forma (tipos, enums, objetos fechados, todos os campos obrigatórios; por isso as tarefas usam `.nullable()`); limites ficam no zod, que valida toda resposta. Inválida, recusada, cortada, 429, tempo esgotado ou erro: `null`.
4. **Configuração só por segredos** (`release/LLM.md`). Anthropic tem padrão `claude-haiku-5-5` com esforço `low`; OpenAI e Gemini exigem `LLM_MODEL`. Sem `temperature`, `top_p` ou `top_k`. Uma tentativa por provedor; reserva opcional (`LLM_FALLBACK_PROVIDER`).
5. **Privacidade por construção:** `extract` troca telefone, e-mail, CPF, CNPJ e números longos por marcadores em toda chamada. Nos pontos que leem o cadastro, nomes de clientes viram "cliente N" (`labelNames`) e voltam só no servidor.
6. **Registro por chamada sem conteúdo:** tarefa, provedor, modelo, tokens, custo estimado (tabela versionada `prices.ts`; modelo fora dela = `null`), tempo, resultado e se foi a reserva.
7. **P08:** o motor roda primeiro. Só quando ele responde "não entendi" o modelo lê o pedido; a leitura vira uma frase canônica e o mesmo motor roda de novo. Se o motor não cair na família de intenção esperada, a leitura é descartada. Pedidos proibidos (mensagem, dinheiro, nota, SQL, segredos, outro negócio) só existem como intenções de recusa, que levam às recusas fixas.
8. **Redação (`agent.draft`, operação nova do registro):** mesmo portão e franquia do `agent.ask`, só o dono. A sugestão não pode trazer número, link ou marcador que não estava no rascunho. Nada é salvo nem enviado.
9. **P44/P45:** `readBusinessPhrase` e `explainInsight` ficam prontos em `_shared/llm/tasks/`; o "Me ajuda a configurar" lê `setup.progress` (schema mínimo em `src/features/agent/setupGuide.ts` até o P44 publicar o contrato).

## Consequências

- Com `LLM_PROVIDER=none` o comportamento é idêntico ao P08 (teste compara os 40 casos).
- O modelo só melhora a cobertura de frases que o motor não entende. Frases que o motor entende errado (regex casando a palavra errada) continuam erradas; ver handoff.
- Custo por negócio no mês exige persistir o registro com o negócio: proposta de migration futura.
