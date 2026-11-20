# Handoff · P50 Configuração com uma fonte só

Sessão: `claude-p50-a` · 2026-11-20 · branch `claude/gallant-shannon-drm4ff` → PR para `main`.
Base: `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md` (linha P50, decisão D5), `docs/qa/revisao-2026-11-04/01-jornada-profissional.md` (A1, A3, A4, A5, A7, A8, A9, A13) e `06-assistente-ia-por-fluxo.md` (T1, T2).
Área desta sessão: `src/features/setup/`, `src/features/agent/`, `supabase/functions/_shared/domain/setup/`, `supabase/functions/setup/` (mais o e2e do módulo em `tests/e2e/setup/`).

**Reserva:** `coord.py claim P50` responde "Tarefa inexistente: P50" (o pacote não está no quadro, como P48 e P49). Segui pela atribuição da sessão, sem reserva no quadro.
**Nada foi aplicado em homologação nem em produção. Nenhuma migration. Nenhuma chave criada.**

## Entregue

### 1 · Demonstração grava onde o ciclo central lê (D5 opção B)
- Estado único da configuração na demonstração: `supabase/functions/_shared/domain/setup/demo.ts`. A tela de Configuração, o cartão da Home e o "Me ajuda a configurar" do Assistente leem e gravam o mesmo estado (antes o Assistente refazia a conta e não via o que foi dispensado ou salvo).
- O que o dono confirma (expediente, serviços, profissão) é publicado por `publishDemoSetup`; a Agenda, os Serviços e o perfil de exemplo passam a ler ligando `readDemoSetup("hours" | "services" | "profession", fn)`.
- **Ligar os leitores fica fora da minha área** (Agenda em `src/features/scheduling`, catálogo em `src/features/crm`, perfil em `src/features/network`; o lugar natural da ponte é `src/lib/demo/`). Pedido na issue `para-felipe`. Enquanto nenhum leitor está ligado, a confirmação **não promete** que a Agenda muda: diz "na demonstração, fica só nesta tela: a Agenda de exemplo não muda" (`port.reach`). Com o leitor ligado, volta a dizer "substitui o atual da agenda principal" (teste cobre os dois casos).
- Rascunho da demonstração agora é tudo ou nada como no banco: a profissão não muda se um serviço é recusado (A8); blocos sobrepostos no mesmo dia são recusados; dois turnos no mesmo dia são aceitos.

### 2 · Frase do negócio (`describe.ts`)
- Negação: "não atendo domingo e segunda", "menos quinta", "exceto domingo", "folga na segunda", "domingo e segunda fechado", "não abro aos domingos". Só a negação → os outros dias, com aviso "Você disse que não atende … marquei …. Confira."
- Dois turnos ("das 6 às 12 e das 17 às 21") viram dois blocos por dia; "das 8 às 12 e das 2 às 6" lê o segundo turno à tarde e avisa.
- Dias com horários diferentes ("terça a sexta 10 às 20 e sábado 8 às 16"; "sábado até as 14h"; "…, sábado das 9 às 14" sobrescreve).
- Travessão e outros traços ("9h–19h"), "meio-dia", "entre 8 e 12".
- "pacote com N sessões" / "pacote de 10 sessões" vira `packages` (não é equipe nem "Sessão individual" para cabeleireira). "com 4 sessões", "3 cadeiras", "2 clientes" não viram equipe.
- "a domicílio", "domiciliar", "na casa do aluno" → `at_home`; a tela aponta para `/app/domicilio`.
- "ter" sozinho é verbo, não terça (só vale em lista ou intervalo).
- Serviços do rascunho com duração e faixa de preço do modelo da profissão (`templates.ts`, cópia de leitura da migration P44); preço só quando a frase diz ("corte 40 minutos por 50 reais"). Frase sem serviços sugere os modelos da profissão como botões "Adicionar Corte (30 min)".
- Recusa diz o campo: `notes[]` com `{field, level: refused|check, text}`; todo campo em `unknown` tem um motivo.
- Saída nova `BusinessDescription` = `SetupDescribeDraft` (contrato v1, intacto) + `windows`, `service_drafts`, `packages`, `at_home`, `notes`, `sources`.
- Testes com as frases reais da revisão de 04/11 para barbeiro, cabeleireira e personal (`describe.test.ts`, 32 casos).

### 3 · `setup.describe` no servidor (T2)
- Rota em `supabase/functions/setup/handler.ts`: confere vínculo (`setup_templates`) → regras → só se sobrar campo em `unknown`, e com provedor ligado e `Idempotency-Key`, portão `agent_run_start` (dono e franquia) e `readBusinessPhrase` do P46 → `mergeAssistantDraft` completa **só** o que as regras não leram. Duração/preço/equipe do modelo só entram se o número está na frase.
- `LLM_PROVIDER=none` (padrão): devolve o rascunho das regras, sem portão nem débito. Franquia esgotada, não dono, modelo sem resposta ou rede fora: rascunho das regras com 200 (o motivo vai ao log técnico, sem frase).
- Selo por campo: `sources.{profession,team_size,weekdays,hours,services} = rules | assistant | null`; a tela mostra "preenchido pelo assistente" no campo e um aviso geral quando `assistant = true`.
- `index.ts` lê a camada de linguagem dos segredos (`llmFromEnv`), como a função `agent`.
- A porta do front chama `/setup/setup.describe`; se a rota falhar (função antiga, rede), roda as mesmas regras na aba.

### 4 · Guia do assistente
- Progresso igual ao da Home: na demonstração, mesmo estado (`demo.ts`); com servidor, `setup.progress` (já era).
- "Pular por agora" grava por `setup.dismiss` (`AgentPort.setupDismiss`); reabrir o painel, a Home e a Configuração mostram o passo dispensado. Falha ao gravar: aviso e o passo continua.
- Âncoras `#descrever` e `#modelos`: rolam e focam só depois que os passos e os modelos carregaram (antes o título de Modelos nem existia na hora do efeito).
- **Depois de criar o negócio, levar para a Home:** a navegação está em `src/features/identity/CreateBusinessPage.tsx:54` (`navigate("/app/conta?novo=1")`), fora da minha área. Pedido na issue `para-felipe` (trocar por `navigate("/app", { replace: true })`; o cartão da Home já mostra o próximo passo e o atalho da frase).

### 5 · Política de cancelamento
- Texto do passo trocado (tela de Configuração, cartão da Home e guia do Assistente): "Você define até quantas horas antes o cliente cancela sem custo. É a regra que o link público mostra a quem vai reservar." O passo continua obrigatório porque a sessão 3 faz o link mostrar a regra.
- O texto antigo continua em `src/lib/setup/steps.ts` (catálogo comum, fora da área) e no `why` da migration P44 (`app.setup_steps()`): a tela sobrepõe pelo código do passo. Pedido na issue trocar nos dois lugares quando conveniente (a migration exige migration nova; não fiz).

## Fora da área (issue `para-felipe`)
1. Ligar `readDemoSetup` na Agenda (`hours` → expediente da agenda principal), no catálogo de Serviços (`services`) e no perfil (`profession`); mover `demo.ts` para `src/lib/demo/` se preferir.
2. `CreateBusinessPage.tsx:54` → Home.
3. Registrar `setup.describe` em `OPERATIONS` (`_shared/contracts/operations.ts`) e no doc03, com `SetupDescribeInput/Output` de `_shared/domain/setup/describe.ts` (ou movê-los para `contracts/setup.ts`). A rota existe e tem testes; ficou fora do registro para não mexer em contrato do integrador. O teste `tests/contracts/setup` exige que `SETUP_ROUTES` bata com o registro, por isso `setup.describe` é tratado à parte no handler.
4. Texto novo do porquê da política em `src/lib/setup/steps.ts` e numa migration futura.
5. Ajustar `tasks/` / quadro com o P50.

## Testes, comandos e resultados (nesta máquina, depois do merge da `main` em `b752d60`)

| Comando | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` | ok |
| `npm run test:unit` | 911/911 (123 arquivos) |
| `npm run test:contracts` | 832 ok, 2 falhas esperadas (CRM, do P52), 38 pulados |
| `npm run build` | ok |
| `deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts` | ok (deno 2.9.6) |
| `npm run db:test:local` (Postgres 16 local + pgTAP) | todos passaram |
| `npm run test:integration` | 142/142 (24 arquivos) |
| `npx playwright test` (desktop + mobile, com o Chromium da máquina) | 287/287 |

Testes novos: `describe.test.ts` (frases reais e junção com o assistente), `setup/handler.test.ts` (8 de `setup.describe`: `none`, regras bastam, portão + modelo, indisponibilidades, acesso, entrada), `demoPort.test.ts` (tudo ou nada, publicação para leitores, estado único), `SetupPage.test.tsx` (dois turnos, grupos de dias, serviço já no catálogo, selo, âncoras), `AssistPanels.test.tsx` ("Pular" persiste, falha ao pular, porta do servidor), `tests/e2e/setup/configuracao-p50.spec.ts` (375 px e desktop).

Mocks: o modelo de linguagem é simulado nos testes do handler (nenhuma chamada real). A ponte da demonstração foi testada com leitores de teste; os leitores reais não estão ligados (item 1 acima).

## Próximo passo
Integrador: itens 1 a 4 acima. Depois deles, a confirmação da demonstração volta a dizer "substitui o atual da agenda principal" sem mudar nada aqui.
