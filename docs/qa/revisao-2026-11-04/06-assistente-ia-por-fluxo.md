# 06 · O assistente de IA em cada fluxo do Tinindo

Revisão de produto sobre `main` @ `b7b58fc` (P45 mesclado). Nada no repositório foi alterado.
Base: `docs/05_AGENTE.md`, ADR-0012, ADR-0035 (camada de linguagem e configuração guiada), ADR-0036, o plano `docs/plano-assistente-configuracao-e-insights.md`, os handoffs P08/P44/P45/P46, o código em `supabase/functions/_shared/llm/`, `supabase/functions/agent/`, `_shared/domain/agent/`, `_shared/domain/setup/`, `src/features/agent|setup|growth-advice/`, os contratos de todos os módulos (`_shared/contracts/*.ts`) e as telas da demonstração (build servido na porta 4306, Playwright a 390 px; capturas em `review/a6/`).

Convenções: **(novo)** marca o que não existe no código. "Aprovação" no sentido forte (proposta → aprovar → executar, com hash e versão) só existe hoje para o Assistente (P08) e para preço, campanha, orçamento e site. No resto do app, gravar é o dono tocar em "Salvar" num formulário que ele conferiu.

---

## Resumo em uma página

**A tese.** O assistente que deixa o Tinindo refinado não é um chat que faz tudo. São três gestos que aparecem dentro de cada tela, no momento em que o profissional precisa deles, e todos terminam no formulário ou na confirmação que já existe:

1. **"Por quê?"**: explicar um número, um passo ou um erro com os dados já calculados (tarefa `EXPLAIN`). Sem provedor, aparece o texto fixo que já está lá.
2. **"Faz comigo"**: o profissional fala do jeito dele ("lembrete no dia anterior e duas horas antes"), o modelo devolve um **rascunho tipado pelo contrato da operação de destino** (`SETUP`), a tela de sempre abre preenchida com selo "preenchido pelo assistente" em cada campo, e quem grava é o botão de sempre. O modelo nunca chama a operação.
3. **"Escreve pra mim"**: redigir mensagem, apresentação, campanha, resposta de avaliação, recado de orçamento a partir do rascunho do dono (`DRAFT`), e devolver o texto para o campo de onde veio, não só para a área de transferência.

O chat do `/app/assistente` (`INTENT`) continua como atalho para quem prefere perguntar, e deve passar a saber dizer "isso se configura em Lembretes, quer que eu preencha?" em vez de "Não entendi o pedido".

**O que o código entrega hoje:** a camada `llm.extract` está boa e segura (saída estruturada nos três provedores, zod na volta, PII redigida em toda chamada, nomes rotulados, registro sem conteúdo, `none` por padrão). Mas, das quatro tarefas, **só `INTENT` (no "não entendi") e `DRAFT` estão ligadas**. `SETUP` (`readBusinessPhrase`) e `EXPLAIN` (`explainInsight`) não são chamadas por ninguém. E o "Me ajuda a configurar" **não funciona no servidor**: o schema local do guia não bate com o contrato publicado pelo P44, a leitura falha na validação e a tela mostra "A configuração guiada ainda não está disponível neste ambiente" para todo mundo (detalhe em §1.2).

**As 5 recomendações principais** estão no fim (§5.2).

---

## 1. O que P44, P45 e P46 entregam de fato e o que falta

### 1.1 Inventário pelo código

| Peça | Onde | Estado real em `main` |
|---|---|---|
| `llm.extract({task, system, input, schema})` | `_shared/llm/client.ts` | Pronta. Redige PII (`redactPii`) dentro do `extract`, corta a entrada em 4.000 caracteres, valida com zod, devolve `null` em qualquer falha, tenta a reserva uma vez. |
| Adaptadores Anthropic / OpenAI / Gemini / none | `_shared/llm/adapters/` | Prontos, testados contra servidor falso (28 casos). **Nunca rodaram com chave real** (`evals-llm-live.test.ts` não rodado). |
| Configuração por segredo | `_shared/llm/config.ts` | Pronta. `LLM_PROVIDER` ausente = `none`. Modelo por tarefa (`LLM_MODEL_INTENT` etc.). Timeout entre 0,5 e 30 s, padrão 8 s. |
| Tabela de preço | `_shared/llm/prices.ts` | Só Anthropic (Haiku 5.5: US$ 0,10/0,50 por Mtok; Sonnet 5.5: 2/10; Opus 5.5: 4/20). OpenAI/Gemini registram `cost_usd: null`. |
| Registro por chamada | `client.ts` → `console.log` | Sem conteúdo e **sem tenant**. Custo por negócio não é somável (o próprio handoff propõe `agent_llm_usage`, não aplicada). |
| Tarefa `INTENT` | `tasks/intent.ts` + `agent/understand.ts` | **Ligada**, mas só quando o motor devolve `unknown`. 18 intenções úteis + 6 de recusa + `other`. A leitura vira frase canônica e o motor roda de novo; família diferente = descarta. |
| Tarefa `DRAFT` | `tasks/draft.ts` + `agent.draft` | **Ligada**. Três tipos (`message`, `bio`, `campaign`), três tons. Descarta sugestão com número, link ou marcador novo. Debita uma pergunta da franquia. |
| Tarefa `SETUP` | `tasks/setup.ts` (`readBusinessPhrase`) | **Não ligada.** O "Descreva seu negócio em uma frase" do P44 roda o analisador por regras no navegador (`_shared/domain/setup/describe.ts`) e não existe operação de servidor que possa chamar o modelo. |
| Tarefa `EXPLAIN` | `tasks/explain.ts` (`explainInsight`) | **Não ligada.** (O `explainInsight` de `src/features/growth-advice/labels.ts` tem o mesmo nome mas é tradução de erro, não a tarefa.) O P45 avisa que ligar pede cache por versão do insight. |
| "Me ajuda a configurar" | `src/features/agent/AssistPanels.tsx` + `setupGuide.ts` | **Quebrado no servidor** (ver 1.2). Na demonstração funciona, com um progresso de exemplo diferente do resto do app. |
| "Redigir um texto" | idem | Funciona. Entradas a partir de Relacionamento (passo manual), Site e Google (apresentação) e Campanhas, pelo estado da navegação. A volta é só "Copiar texto". |
| Cartão "Deixe seu negócio pronto · N de 8" | `src/features/setup/SetupCard.tsx` na Home | Pronto, determinístico, estado calculado no servidor (`app.setup_state`). |
| `/app/configurar` | `SetupPage.tsx` | Pronto: os 8 passos, frase do negócio por regras, modelos de serviço por profissão com faixa, confirmação, `setup.draft_apply` / `setup.services_apply`. |
| `SetupHint` nas telas vazias | Agenda, Serviços, Clientes, Caixa, Mensagens | Pronto. Frase fixa e um botão. |
| Motor de insights | `app.gi_*`, worker `jobs` | Pronto. 9 regras, `fire/quiet/insufficient`, evidência obrigatória (período, numerador, denominador), "Agora não" 30 dias, "Preparar" reavalia e cria proposta. |
| "Para você esta semana" + Metas e sugestões | Home, `/app/metas` | Pronto. Até 3 na Home, "O que a conta olhou" com o motivo de insuficiente. |
| Resumo semanal | `app.gi_digest`, topo de Mensagens | Pronto, modelo fixo. |
| `ui_context` no `agent.ask` | contrato `AgentAskInput` | Existe no contrato, **o motor ignora**. |

### 1.2 Achados que o plano não mostra

1. **O guia "Me ajuda a configurar" nunca carrega com servidor.** `setupGuide.ts` espera `{ steps: [{ code, title, done, optional, why: string, href }] }`. O contrato do P44 (`_shared/contracts/setup.ts`) devolve `{ steps: [{ step, required, title, why: string|null, link, done, done_at, dismissed }], next, done_count, ready, … }`. A chamada `serverPort.setupProgress()` faz `call("/setup/setup.progress", SetupProgress, …)` com o schema local, a validação falha, o `catch` devolve `null` e o painel diz que não está disponível. O teste `AssistPanels.test.tsx` cobre exatamente esse caminho ("sem setup.progress no servidor: avisa"), então o CI fica verde.
2. **Duas verdades na demonstração.** A Home mostra "5 de 8" com a antecedência de cancelamento feita; o guia do Assistente mostra "4 de 8" e manda definir a política de cancelamento (`DEMO_SETUP`, com códigos `services`, `cancellation`, `public_profile`, `cash` que não existem no catálogo, e com primeiro cliente e caixa marcados como obrigatórios). Capturas `review/a6/home.png` e `assistente-configurar.png`.
3. **"Pular por agora" no guia é estado da tela**, não chama `setup.dismiss`. Recarregou, o passo volta. A Home e `/app/configurar` usam o dispensar de verdade.
4. **`BusinessDraft` (P46) não é `SetupDescribeDraft` (P44).** O do P46 tem expediente por dia (`hours[] {weekday,start,end}`) e serviços com `duration_min` e `price_cents`; o do P44 tem `weekdays[]` + `start`/`end` + `pause` e serviços só com nome ("preço é do dono"). Antes de ligar, alinhar ao do P44 (ou estender o do P44 de forma aditiva) e decidir se preço dito na frase vira sugestão.
5. **O modelo só entra quando o motor desiste, e o motor desiste pouco.** Na demonstração:
   - "por que tenho tanta falta na quarta?" → "Amanhã (quarta-feira, 21 de outubro) você não tem nenhum atendimento marcado." (resposta errada com confiança; o insight de faltas concentradas na quarta está na Home ao mesmo tempo);
   - "me ajuda a configurar meus horários" → "Não entendi o pedido." (não há intenção de configuração no `INTENT`; com provedor cairia em `other` e continuaria "não entendi");
   - "sou barbeiro e quero saber se tô cobrando pouco no corte" → "Não entendi o pedido." (com provedor viraria `margin`, que existe).
   O handoff do P46 já registra dois casos parecidos ("marcado" e "crédito por lá").
6. **Recusa fiscal desatualizada.** O motor responde "Ainda não emito nota fiscal: essa função está indisponível na Tinindo", mas o módulo Notas fiscais (P16, ADR-0026) existe para MEI com NFS-e nacional. Deveria levar a `/app/notas`.
7. **A volta da redação não existe.** Relacionamento, Site e Campanhas mandam o texto para o Assistente; a sugestão só pode ser copiada. Além disso o tipo `bio` aceita 500 caracteres, mas a frase de apresentação do Site (`SiteSaveInput.headline`) tem limite de 90.
8. **"Assistente atende" em Mensagens é só um rótulo.** `channel_contacts.handling` tem `assistant` como padrão, mas nenhum código responde à cliente automaticamente. Com LLM ligado a expectativa vai subir; o rótulo precisa dizer o que acontece de fato.
9. **O tom não fica salvo.** Cada redação pede o tom de novo.
10. **CEP passa pela redação.** `redactPii` pega telefone, e-mail, CPF, CNPJ e sequências de 9+ dígitos; CEP (8 dígitos, `01310-100`) e endereço não são tocados. Importa para Domicílio.
11. **O assistente só lê três coisas** (`agent_agenda_read`, `agent_directory`, `agent_finance_read`) e só propõe quatro (`booking.create/reschedule/cancel`, `pricing.propose_rule`). Ele não lê `setup.progress`, insights, lembretes, lista de espera (só a contagem), orçamentos, materiais, equipe ou domicílio. Para explicar e configurar "cada coisa", faltam leituras.

### 1.3 O que falta, em uma frase cada

- Consertar o guia e usar o contrato do P44.
- Uma operação de servidor para a frase do negócio que chame `readBusinessPhrase` quando o analisador por regras devolver `unknown`.
- Ligar `EXPLAIN` com cache por versão do insight.
- Um padrão único de "rascunho de formulário" para levar o assistente às outras telas, com volta do texto ou dos campos para a tela de origem.
- Custo por negócio (`agent_llm_usage`) e teto de tokens, além da contagem de perguntas.
- Rodar a avaliação com chave real e registrar.

---

## 2. Como o assistente trabalha (o fluxo comum a todas as telas)

### 2.1 Os quatro lugares onde ele aparece

| Lugar | Já existe? | Para quê |
|---|---|---|
| Cartões da Home ("Deixe seu negócio pronto", "Para você esta semana") | sim | Dizer qual é a próxima coisa e por quê. Até 3 sugestões. |
| Dica no estado vazio (`SetupHint`) | sim, em 5 telas | Primeira vez numa tela sem dado. Hoje: frase e botão. |
| **Faixa "Assistente" dentro da tela (`AssistHint`)** | **(novo)** componente | "Por quê?", "Faz comigo", "Escreve pra mim", contextual àquela tela. Um toque abre uma folha embaixo, não troca de tela. |
| Chat `/app/assistente` | sim | Pergunta livre, propostas de agendamento e preço, os dois painéis. |

### 2.2 O ciclo "Faz comigo" (rascunho de formulário)

```
gatilho determinístico (dado vazio, passo pendente, insight, primeira vez)
   → faixa AssistHint com a frase fixa da tela          [sem LLM]
   → o dono escreve ou fala do jeito dele               [opcional]
   → SETUP: modelo devolve rascunho no schema do Input da operação de destino,
     sem versão, sem ids, com enums fechados          [LLM, ou analisador por regras]
   → servidor valida o rascunho pelo contrato e por limites de negócio (faixas do P44, piso de preço do P05)
   → a tela de sempre abre preenchida; cada campo do rascunho com selo "preenchido pelo assistente"
   → o dono confere e toca no botão de sempre ("Salvar lembretes", "Criar serviços", "Aprovar e publicar")
   → a operação de sempre grava (idempotência, versão, RLS, tudo igual)
   → evento de medição sem conteúdo (novo: assist.applied.v1)
```

Regras do ciclo:
- O modelo nunca produz `expected_version`, `id`, `tenant_id` nem hash. Quem preenche isso é a tela, com o que ela leu.
- Valor monetário só entra no rascunho se o dono disse o valor na frase, ou se vem de faixa por migration (P44). Nunca "média de mercado".
- Ao abrir o formulário preenchido, a tela mostra o que mudaria ("Hoje: lembrete 24 h antes. Vai ficar: 24 h e 2 h antes.").
- Sem provedor, a faixa mostra só a dica fixa e o botão para a tela. Nada some.

### 2.3 Momento certo: regras de frequência (novo)

- No máximo **uma faixa proativa por tela por dia**, e nenhuma enquanto existe erro na tela.
- Primeira visita a uma tela vazia: dica fixa (sempre). Faixa "Faz comigo" só se o passo correspondente do P44 estiver pendente ou se a tela não tiver nenhum dado.
- Depois do primeiro uso real (primeiro lembrete enviado, primeira oferta aceita, primeira nota), uma única explicação de "o que aconteceu" e nunca mais.
- "Agora não" na faixa silencia aquela faixa por 30 dias, como os insights.
- Faixa só sobre o que o papel pode ver: equipe não recebe faixa de caixa nem de lista de espera (mesma regra do P08).

### 2.4 O que vai e o que nunca vai para o modelo (regra geral)

| Pode ir | Nunca vai |
|---|---|
| Texto que o dono escreveu naquela hora (já redigido por `redactPii`) | Telefone, e-mail, CPF, CNPJ, CEP, endereço (CEP e endereço: reforçar `redactPii`, novo) |
| Nomes de serviço, durações, preços do próprio catálogo | Nome de cliente sem rótulo ("cliente N"), recado da lista de espera, texto de avaliação de cliente na tarefa INTENT |
| Números já calculados pelas regras (evidência do insight, prévia de preço, resumo do caixa) | Lançamentos individuais, saldo bruto do ledger, dados de outro negócio |
| Profissão, fuso, dia da semana de hoje | Chaves, segredos, `tenant_id`, token, conteúdo de mensagens recebidas pelo canal (exceto na redação de resposta, rotulado como dado) |

### 2.5 Tom de voz dos textos de exemplo

Segunda pessoa, frase curta, verbo no começo, um número só quando ele explica algo, sem promessa de resultado, sem exclamação em série, sem "IA" no texto. Sempre fecha com o que o dono pode fazer. Os exemplos abaixo seguem os textos que já estão nas telas ("Nada é criado antes de você confirmar", "A faixa é um ponto de partida, não uma média de mercado").

---

## 3. Fluxo por fluxo

Formato de cada bloco: **Gatilho**, **Explica** (texto de exemplo), **Configura junto** (operações e campos; o que exige aprovação), **Dados** (vai / nunca vai), **Tarefa P46**, **Medir**.

### 3.1 Primeiro acesso e configuração guiada (P01 + P44)

- **Gatilho:** negócio criado (`business.create`), Home com "0 de 8"; ou dono abre `/app/configurar`; ou o analisador por regras devolve `unknown` não vazio.
- **Explica:** "Me conta em uma frase como você trabalha, tipo: 'sou barbeiro, sozinho, de terça a sábado das 9 às 19, almoço de 12 às 13'. Eu monto os horários e os serviços, e você confere cada um antes de salvar."
  Depois do rascunho: "Entendi terça a sábado, 9h às 19h, pausa de 12h às 13h, e os serviços Corte e Barba. Não entendi se você atende no domingo: deixei sem."
- **Configura junto:** `setup.draft_apply` (`profession`, `hours: WeeklyWindow[]`, `services[] {name, duration_min, base_price_cents}`) e `setup.services_apply`. Preço vem da faixa do modelo do P44 (`setup.templates`), marcado "faixa, confira". Grava só depois da confirmação que já existe (resumo do que vai ser gravado). Tudo ou nada.
- **Dados:** vai a frase (até 500 caracteres, redigida). Não vai nada do cadastro (negócio novo não tem).
- **Tarefa:** `SETUP` (`readBusinessPhrase`, adaptado para `SetupDescribeDraft`). Precisa de operação de servidor **(novo: `setup.describe`)**, mesmo portão e franquia do `agent.ask`, que roda `describe.ts` primeiro e só chama o modelo quando sobra `unknown`.
- **Medir:** `setup_ready_24h` (P18, já existe) comparado entre negócios com e sem provedor; taxa de campos do rascunho alterados antes de salvar (novo, sem conteúdo: só contagem por campo); tempo até o perfil publicado (meta do P44: < 10 min).

### 3.2 Agenda e horários (P03, `/app/agenda`, `/app/agenda/horarios`)

- **Gatilho:** dia sem expediente na Agenda (já tem `SetupHint`); passo `hours` pendente; dono cria bloqueio pela terceira vez no mesmo dia da semana (novo gatilho, contagem de `schedule.block_create`).
- **Explica:** "Seu expediente é o que aparece no link para o cliente escolher. Se você tem horário diferente no sábado, dá pra pôr: cada dia tem o seu."
  Bloqueios repetidos: "Você bloqueou a quinta de manhã nas últimas 3 semanas. Quer tirar a quinta de manhã do expediente? Os horários já marcados ficam como estão."
- **Configura junto:** `schedule.rules_save` (janelas `weekday`, `local_start`, `local_end`; intervalos de serviço continuam no serviço). Tela Horários abre preenchida, dono salva. Remarcar ou cancelar pelo chat continua com proposta + aprovação + execução (P08).
- **Dados:** vai a frase e as janelas atuais (dia e hora, sem reservas). Nunca vão reservas com nome.
- **Tarefa:** `SETUP` (janelas) e `INTENT` (pedidos do chat).
- **Medir:** bloqueios recorrentes que viraram mudança de expediente; reservas pelo link nas faixas abertas (P18 `occupancy`).

### 3.3 Serviços (P02, `/app/clientes/servicos`)

- **Gatilho:** catálogo vazio (já tem `SetupHint`); serviço sem intervalo e com reservas encostadas; dono digita nome de serviço que não está nos modelos.
- **Explica:** "A duração vira o tamanho do horário na agenda. Se você precisa de 10 minutos para limpar a cadeira, ponha como intervalo depois: o cliente não vê, mas a agenda respeita."
- **Configura junto:** `service.save` (`name`, `duration_min`, `buffer_before_min`, `buffer_after_min`, `base_price_cents`, `min_price_cents`) e `setup.services_apply` para modelos. Dono confirma.
- **Dados:** vai a frase ("progressiva 2 horas e meia, 280") e os nomes dos serviços existentes (para não duplicar). Nunca vão clientes.
- **Tarefa:** `SETUP` (serviço a partir de frase), `EXPLAIN` (por que o intervalo).
- **Medir:** serviços criados com intervalo; queda de remarcações por atraso (não há métrica direta; usar `booking.reschedule` nas primeiras 4 semanas, observação, não efeito).

### 3.4 Preços e regras de preço (P05, `/app/precos`)

- **Gatilho:** insight `idle_slot` ("Preparar" já cria a proposta inativa); dono pergunta no chat sobre desconto; proposta de preço aberta há mais de 12 h sem decisão (expira em 24 h).
- **Explica:** a prévia já calcula `example_base_cents`, `example_final_cents`, `floor_cents` e `reason`. O assistente traduz: "Com 10% no sábado das 9h às 14h, o Corte sai de R$ 60,00 por R$ 54,00. Fica acima do seu piso de R$ 48,00. A regra só vale depois que você tocar em Aprovar e publicar."
  Sem piso: "Este serviço não tem piso definido, então a conta não sabe até onde pode baixar. Quer definir um preço mínimo antes?"
- **Configura junto:** `pricing.propose_rule` (`service_id`, `windows`, `discount_bps`, `max_discount_bps`, `valid`, `target_margin_bps`) pela proposta do P08 ou pelo "Preparar" do P45; **publicar exige aprovação** (`pricing.publish_rule` com o hash do que foi visto). O assistente nunca publica.
- **Dados:** vão os números da prévia e o nome do serviço. Nunca vão clientes nem histórico de cobranças.
- **Tarefa:** `INTENT` (pedido de desconto), `EXPLAIN` (prévia e motivo `reason`).
- **Medir:** propostas publicadas ÷ propostas criadas; ocupação da faixa 30 dias depois pelo `advice_decisions` (já mede, variação observada).

### 3.5 Clientes e importação (P02, `/app/clientes`, `/importar`)

- **Gatilho:** lista vazia (já tem `SetupHint`); prévia de importação (`customer.import_preview`) com colunas não reconhecidas; cliente sem origem declarada.
- **Explica:** "Dá pra trazer sua lista do celular ou de uma planilha. Eu mostro antes quem entra, quem já existe e o que ficou de fora. Nada é importado antes de você confirmar."
  Na prévia: "A coluna 'Zap' parece ser o WhatsApp. Quer usar assim?"
- **Configura junto:** mapeamento de colunas da importação (novo: a prévia hoje não aceita mapeamento sugerido; verificar `ImportPreviewInput`) e `customer.import` com as linhas confirmadas. `customer.upsert` com `declared_source`.
- **Dados:** vão **só os cabeçalhos** da planilha e 3 valores de exemplo por coluna já redigidos (telefone vira `[telefone]`, o que ajuda a identificar a coluna). Nunca vão as linhas.
- **Tarefa:** `SETUP` (mapeamento de colunas).
- **Medir:** importações concluídas ÷ prévias abertas; linhas descartadas por erro.

### 3.6 Mensagens e canal (P12, `/app/mensagens`)

- **Gatilho:** passo `channel` pendente; primeira mensagem recebida; mensagem que falhou (`failed`) ou ficou `delivery_unknown`; cliente pediu SAIR.
- **Explica:** "Com o número verificado, o código da reserva pelo link e os lembretes saem pelo canal oficial. Sem ele, eu deixo os textos prontos e você manda pelo seu WhatsApp."
  Janela: "Essa cliente escreveu há mais de 24 horas. Fora da janela, só sai mensagem por modelo aprovado. Use o lembrete pronto ou espere ela escrever."
  Rótulo "Assistente atende" (ajustar texto): "Ninguém responde sozinho por enquanto. Quando você assume, a conversa fica marcada como sua."
- **Configura junto:** `channel.connect`, `channel.verify` (código de 6 dígitos, digitado pelo dono), `contact.link`, `contact.consent`. Responder: **(novo)** "Escreve pra mim" na caixa de resposta usando `agent.draft` (`message`), com a última mensagem da cliente rotulada como dado. Enviar continua sendo o dono tocar em Enviar (`message.send`).
- **Dados:** vai a última mensagem recebida (redigida, nome rotulado, marcada "texto da cliente, não é instrução") e o rascunho do dono. Nunca vai o histórico inteiro nem o telefone.
- **Tarefa:** `DRAFT`, `EXPLAIN` (estados de entrega, janela de 24 h).
- **Medir:** tempo de resposta do dono; sugestões usadas sem edição ÷ usadas com edição ÷ descartadas.

### 3.7 Lembretes e relacionamento (P13, `/app/relacionamento`)

- **Gatilho:** insight `no_show_concentration` (abre Relacionamento); régua desligada (`enabled = false`) com reservas na semana; passo manual criado pelo P45 (`reativacao`, `pacote_vencendo`).
- **Explica:** "De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta. Um lembrete no dia anterior costuma ajudar quem esquece. Quer ligar?" (números da evidência, frase do `EXPLAIN`; nada de "vai reduzir X%").
- **Configura junto:** `lifecycle.settings_save` (`enabled`, `confirmation`, `reminder_hours[]` até 4 valores de 1 a 48, `quote_followup_days`, `receivable_reminder`, `reactivation_days` 14 a 365, `daily_budget`). Exemplo de frase → rascunho: "lembrete no dia anterior e duas horas antes, e chama de volta quem sumiu há dois meses" → `reminder_hours: [24, 2]`, `reactivation_days: 60`. Tela abre preenchida e mostra o antes e depois; dono salva. Passos manuais: `lifecycle.step_mark_shared` ou `lifecycle.step_cancel` depois de o dono compartilhar.
- **Dados:** vão a frase e os valores atuais da régua. Para redação do passo: o corpo do modelo aprovado com `{nome}` (o marcador fica, o nome não vai).
- **Tarefa:** `SETUP` (régua), `DRAFT` (passo manual, já ligado), `EXPLAIN` (insight).
- **Medir:** `no_show` 30 dias depois (`advice_decisions`); métrica `reminders` (já em `GoalMetricKey`).

### 3.8 Lista de espera (P06, `/app/lista-de-espera`)

- **Gatilho:** insight `waitlist_opening`; cancelamento de reserva com gente esperando; primeira entrada na lista.
- **Explica:** "Abriu uma vaga quinta às 15h e 3 pessoas esperam por Corte. Eu preparo a oferta para a primeira da fila; você compartilha o link. Quem aceitar primeiro fica com o horário, e o sistema não deixa duas pessoas pegarem a mesma vaga."
- **Configura junto:** `waitlist.prepare_offer` (dono confirma), depois `waitlist.mark_shared` quando ele compartilhou. Recados da lista **não são lidos** (regra do P08) e continuam fora.
- **Dados:** vão contagens e o serviço. Nunca vão nomes nem recados.
- **Tarefa:** `EXPLAIN`; `INTENT` ganha leitura (novo: `agent_waitlist_read` com ofertas abertas, sem recados) para "tem alguém pra quinta?".
- **Medir:** `waitlist_acceptance` (já em `GoalMetricKey`); vagas canceladas preenchidas.

### 3.9 Caixa (P07, `/app/caixa`)

- **Gatilho:** insight `uncharged_bookings`; atendimento concluído sem cobrança há mais de 1 dia; primeiro registro (passo `first_cash`); `month_closing`.
- **Explica:** "Dos 18 atendimentos concluídos nos últimos 30 dias, 4 ainda não têm recebimento registrado. Registrar não cobra a cliente: só deixa o Caixa certo." e, no fim do mês, a frase do motor do P08 com cobertura: "Você registrou R$ 1.740,00 neste mês em 29 lançamentos. Não inclui o que ainda não foi registrado."
- **Configura junto:** `finance.charge_booking` e `finance.record_payment` (`method`, valor sugerido = preço cotado do atendimento, não do modelo); dono confirma cada um. "Quanto posso retirar?" continua cenário com faltantes. Mover dinheiro: recusa fixa.
- **Dados:** vão totais e contagens já calculados. Nunca vão lançamentos individuais com nome.
- **Tarefa:** `EXPLAIN`, `INTENT` (consultas já existentes).
- **Medir:** `charge_coverage` (P18) antes e depois.

### 3.10 Financeiro ampliado: contas, categorias, conciliação (P31, `/app/contas`)

- **Gatilho:** primeira despesa sem categoria; conta a pagar recorrente digitada duas vezes; dia com diferença na conciliação.
- **Explica:** "Você lançou 'aluguel cadeira' duas vezes este mês com o mesmo valor. Quer transformar em conta fixa todo dia 5? Dá pra mudar ou parar depois."
  Conciliação: "No dia 14 o Pix registrado soma R$ 40,00 a menos que o extrato que você informou. Pode ser um recebimento que não foi lançado."
- **Configura junto:** `accounts.category_save`, `accounts.classify` (sugestão de categoria pela descrição), `accounts.payable_save` (série), `accounts.reconcile_save`. Pagar conta (`accounts.payable_pay`) só pelo dono, nunca sugerido como ação automática.
- **Dados:** vai a descrição que o dono escreveu e a lista de categorias. Nunca vão dados bancários.
- **Tarefa:** `SETUP` (categoria e série), `EXPLAIN` (diferença).
- **Medir:** despesas sem categoria no fim do mês.

### 3.11 Pagamentos conectados (P10/P18, `/app/pagamentos`)

- **Gatilho:** primeira cobrança por link; reembolso pedido; conciliação com divergência.
- **Explica:** "O link de pagamento cobra o valor do recebível. Quando a cliente paga, o recebimento entra no Caixa sozinho. Se ela pagar por fora, cancele o link para não cobrar duas vezes."
- **Configura junto:** `payment.charge_create` (dono escolhe o recebível), `payment.refund` (motivo escrito pelo dono; **(novo)** "Escreve pra mim" o motivo). Nada é cobrado nem estornado pelo assistente.
- **Dados:** valores e estados. Nunca dados de cartão ou chave Pix.
- **Tarefa:** `EXPLAIN`.
- **Medir:** links cancelados por pagamento em duplicidade.

### 3.12 Notas fiscais (P16, `/app/notas`)

- **Gatilho:** perfil fiscal incompleto (motivos de `app.fsc_eligibility`: `profile_missing`, `regime_not_eligible`, `cnpj_invalid`, `representation_missing`, `credential_invalid`); pergunta "emite nota?" no chat.
- **Explica:** substituir a recusa atual por: "A Tinindo emite NFS-e para MEI com o padrão nacional. Para o seu caso falta autorizar a emissão em seu nome e conferir a credencial no provedor. Abra Notas fiscais para ver o passo." Fora do caso elegível: "Seu regime não está no caso que a Tinindo atende hoje. Emita pelo sistema da prefeitura ou do seu contador."
- **Configura junto:** `fiscal.profile_save` (campos do perfil fiscal; o modelo não sugere CNPJ nem código de serviço além de 06.01/06.04 pela profissão), `fiscal.representation` (aceite do texto com hash, só o dono), `fiscal.emit` sempre pelo botão do dono.
- **Dados:** só os códigos de motivo. Nunca CNPJ, CPF, certificado.
- **Tarefa:** `EXPLAIN`; `INTENT` passa a levar `refuse_fiscal` para a tela (mudar o texto fixo, sem ferramenta nova).
- **Medir:** perfis fiscais que chegaram a elegível.

### 3.13 Orçamentos (P11, `/app/orcamentos`)

- **Gatilho:** cabeleireira com serviço longo ou "sob consulta"; orçamento enviado sem resposta há `quote_followup_days`; orçamento recusado.
- **Explica:** "Orçamento serve para o que não tem preço fixo, como mechas ou noiva. A cliente vê pelo link, aceita ou recusa, e o aceite fica registrado com a versão que ela viu."
- **Configura junto:** `quote.create` / `quote.revise` (itens `SalesQuoteItemInput`: serviço, quantidade, preço; o assistente monta os itens a partir da frase "mechas com tonalização, uns 380, e hidratação 90"); **enviar exige o dono** (`quote.send`). Recado de acompanhamento pelo `DRAFT`.
- **Dados:** a frase e o catálogo de serviços. Cliente vai como "cliente 1".
- **Tarefa:** `SETUP` (itens), `DRAFT` (recado; novo tipo `quote_note`).
- **Medir:** `quote_acceptance` (já em `GoalMetricKey`).

### 3.14 Pacotes e assinaturas (P07 pacotes, P20 recorrência, `/app/assinaturas`)

- **Gatilho:** personal com modelo "Pacote de 10 sessões" (P44 mostra como informação); insight `package_expiring`; cliente com 4+ atendimentos no mesmo serviço em 2 meses (novo gatilho).
- **Explica:** "Pacote é crédito pago antes: a cliente usa as sessões e o Caixa desconta. Assinatura é cobrança todo ciclo, com sessões por ciclo. Para quem treina toda semana, assinatura costuma dar menos trabalho."
  Vencendo: "3 pacotes vencem nos próximos 15 dias com sessões sobrando. Preparei os avisos; você revisa e compartilha."
- **Configura junto:** `recurrence.plan_save` (`service_id`, `name`, `sessions_per_cycle`, `cycle_days`, `price_cents`) a partir de "plano de 8 treinos por mês a 640"; `package.sell` no Caixa (dono confirma valor e sessões); `booking.create_series` para a série semanal (novo no assistente: hoje o P08 só cria uma reserva). Assinar cliente (`recurrence.subscribe`) é sempre o dono.
- **Dados:** frase, serviço, contagens. Nunca cliente sem rótulo.
- **Tarefa:** `SETUP` (plano), `EXPLAIN` (pacote x assinatura), `DRAFT` (aviso, já pelo P45).
- **Medir:** planos criados; ciclos pagos (P20).

### 3.15 Perfil público e link (P09, `/app/perfil`)

- **Gatilho:** passo `profile` (obrigatório) ou `photo_whatsapp` pendente; insight `profile_incomplete`.
- **Explica:** "O link público é onde o cliente escolhe o horário sozinho. Escolha um endereço curto, tipo tinindo.app/p/barbearia-do-joao, e o bairro onde você atende."
- **Configura junto:** `profile.publish` (`slug` sugerido a partir do nome, `category` pela profissão, `area`, `public_fields`); bio pelo `DRAFT`. Publicar é o botão do dono.
- **Dados:** nome do negócio, profissão, bairro digitado. Nunca o telefone (o campo WhatsApp é preenchido pelo dono).
- **Tarefa:** `SETUP` (slug e área), `DRAFT` (`bio`).
- **Medir:** passo `profile` feito em 24 h; reservas pelo link na primeira semana.

### 3.16 Site e Google (P25, `/app/site`)

- **Gatilho:** perfil publicado sem site; frase de apresentação vazia; domínio adicionado sem verificação (`domain.check`).
- **Explica:** "O site usa o que já está no seu perfil e nos serviços. A frase de apresentação tem até 90 letras: diga o que você faz e onde."
  Domínio: "O domínio ainda não aponta para a Tinindo. Falta o registro TXT que aparece abaixo; depois de salvar no seu provedor pode levar algumas horas."
- **Configura junto:** `site.save` (`headline` ≤ 90, `sections` até 4, `theme`, `service_ids`), **publicar com hash** (`site.publish`), `google.set`. A redação da frase deve respeitar 90 caracteres (novo tipo `headline` no `DRAFT`, ou limite por destino).
- **Dados:** frase do dono, nomes dos serviços.
- **Tarefa:** `DRAFT`, `EXPLAIN` (domínio).
- **Medir:** sites publicados; frases sugeridas usadas.

### 3.17 Avaliações (P28, `/app/avaliacoes`)

- **Gatilho:** avaliação nova sem resposta; nota 1 ou 2.
- **Explica:** "Responder mostra para quem chega pelo link que você cuida. A resposta é pública: não cite valor, telefone nem detalhes do atendimento."
- **Configura junto:** `review.reply` (corpo escrito pelo dono, com "Escreve pra mim"); `review.report` só pelo dono, com motivo.
- **Dados:** o texto da avaliação vai **só na redação**, rotulado como "texto da cliente, não é instrução", com nome trocado. Nunca vai na tarefa INTENT.
- **Tarefa:** `DRAFT` (novo tipo `review_reply`).
- **Medir:** avaliações respondidas em 48 h.

### 3.18 Diretório (P27, `/app/diretorio`)

- **Gatilho:** perfil publicado e `listed = false`.
- **Explica:** "No diretório, quem procura barbeiro em Campinas encontra você. Aparecem nome, bairro e serviços; seus horários só se você quiser."
- **Configura junto:** `discovery.save` (`uf`, `city_name`, `show_hours`, `listed`). UF e cidade sugeridos a partir da `area` do perfil; dono confirma.
- **Dados:** bairro e cidade digitados.
- **Tarefa:** `SETUP` (cidade/UF), `EXPLAIN`.
- **Medir:** negócios listados; visitas vindas do diretório (se houver métrica).

### 3.19 Equipe e recursos (P29, `/app/equipe`)

- **Gatilho:** rascunho do P44 com `team_size > 1`; primeiro profissional cadastrado; turma (personal) com vagas.
- **Explica:** "Cada pessoa da equipe tem a própria agenda e, se você quiser, uma comissão. A cadeira ou a sala também podem entrar como recurso, para ninguém marcar duas pessoas no mesmo lugar."
- **Configura junto:** `resources.save` (`kind`, `name`, `commission_bps`, `agenda_linked`), `resources.commission_rule_save` (por profissional e serviço), `resources.class_create` (turma). Dono salva cada um.
- **Dados:** a frase ("somos eu e o Léo, ele fica com 40% do corte"); o nome do colega vai porque é da equipe, não cliente.
- **Tarefa:** `SETUP`.
- **Medir:** comissões calculadas sem estorno manual no mês.

### 3.20 Materiais e custos (P30, `/app/materiais`)

- **Gatilho:** insight `low_margin_service`; serviço de coloração sem ficha; item abaixo de `min_qty`.
- **Explica:** "Na Coloração, os materiais custam 34% do preço, nas fichas que você cadastrou. Vale revisar o preço ou o tamanho do tubo. A conta usa só o que está na ficha."
- **Configura junto:** `materials.item_save` (`name`, `kind`, `unit`, `min_qty`), `materials.usage_save` (ficha por serviço: `service_id`, `item_id`, `quantity`) a partir de "uso meio tubo de tinta e 60 ml de oxidante"; `materials.purchase` com valores digitados.
- **Dados:** nomes de itens e quantidades.
- **Tarefa:** `SETUP` (ficha), `EXPLAIN` (margem, via `materials.margin`).
- **Medir:** serviços com ficha; margem observada 30 dias depois.

### 3.21 Domicílio (P34, `/app/domicilio`)

- **Gatilho:** personal ou cabeleireira que atende em casa ou condomínio (`declared_source = condominium` ou frase "atendo em casa"); primeira visita.
- **Explica:** "Com o domicílio ligado, a agenda soma o tempo de deslocamento entre um atendimento e outro. Você divide sua área em zonas por CEP e diz quanto tempo leva de uma para outra."
- **Configura junto:** `field.settings_save` (`default_travel_min`, `same_zone_travel_min`, `arrival_window_min`, `max_km`), `field.zone_save` (`name`, `cep_prefixes`, `distance_km`, `travel_from_base_min`), `field.travel_save`. Frase → rascunho: "atendo Moema e Vila Mariana, uns 20 minutos entre elas, janela de 15 minutos".
- **Dados:** nomes de bairro e prefixos de CEP de **zona** (5 dígitos) que o dono digitou. Nunca CEP ou endereço de cliente (reforçar redação, §1.2 item 10).
- **Tarefa:** `SETUP`.
- **Medir:** visitas com atraso registrado (se houver) e remarcações por deslocamento.

### 3.22 Campanhas (P19, `/app/campanhas`)

- **Gatilho:** sugestão `occupancy_campaign` (P22); dono abre Campanhas pela primeira vez.
- **Explica:** "Campanha vai só para quem autorizou receber novidades. Eu separo 20% das pessoas como grupo de comparação: assim, no fim, dá pra saber se a campanha fez diferença ou se foi acaso."
- **Configura junto:** `campaign.preview` (segmento `inactive_days`, `credit_remaining`, `marketing_all`) e **`campaign.approve` com `audience_hash`** (aprovação forte: `name`, `control_pct`, `max_sends`, `spend_cap_cents`, `window_days`, `offer`). O rascunho sugere segmento e parâmetros; texto pelo `DRAFT` (já ligado).
- **Dados:** contagens da audiência, nunca a lista de nomes.
- **Tarefa:** `SETUP` (parâmetros), `DRAFT`, `EXPLAIN` (veredito: `difference_detected`, `inconclusive`, `observation_only`).
- **Medir:** campanhas com controle ÷ total; leitura correta do veredito (nenhum texto afirma efeito em `observation_only`).

### 3.23 Indicações (P21, `/app/indicacoes`)

- **Gatilho:** depois do primeiro valor (docs/12: "após primeiro valor, não a cada login"), por exemplo a 5ª reserva pelo link.
- **Explica:** "Conhece outro profissional que ia gostar? Você manda o seu link de convite; ninguém recebe mensagem automática."
- **Configura junto:** `referral.create`. Texto do convite pelo `DRAFT` (`message`).
- **Dados:** nenhum dado de cliente.
- **Tarefa:** `DRAFT`.
- **Medir:** convites resgatados (`referral.claim`).

### 3.24 Metas e sugestões (P22/P45, `/app/metas`)

- **Gatilho:** sem meta no mês; insight aberto; "O que a conta olhou" com regra `insufficient`.
- **Explica:** a frase de cada insight via `EXPLAIN`, com cache. Para insuficiente: "Ainda não dá para saber se seus clientes estão voltando: preciso de pelo menos 5 clientes com 2 atendimentos. Hoje são 4. Isso não quer dizer zero."
  Meta: "Ocupação de 62% no mês passado. Quer pôr 70% como meta deste mês? É uma meta, não uma previsão."
- **Configura junto:** `goal.save` (`metric_key`, `target`, `period_start`, `note`), `insight.act` / `insight.snooze`, `advice.decide`, `content.publish` (modelos `bio_*` do P22).
- **Dados:** evidência (`period_start`, `period_end`, `numerator`, `denominator`) e título da regra.
- **Tarefa:** `EXPLAIN`, `SETUP` (meta a partir da frase).
- **Medir:** "Ver" ÷ mostrados; `advice_decisions` `improved` em 30 dias.

### 3.25 Chat do assistente (P08, `/app/assistente`)

- **Gatilho:** "Perguntar ao assistente" na Home; pergunta livre.
- **Explica:** quando a pergunta é sobre configurar, em vez de "Não entendi o pedido": "Isso se ajusta em Lembretes. Quer que eu preencha com 'dia anterior e 2 horas antes' para você conferir?" (abre a tela com rascunho).
- **Configura junto:** propostas atuais (agendar, remarcar, cancelar, regra de preço) com aprovação forte; novo roteamento para os rascunhos de formulário das outras telas.
- **Dados:** pedido com nomes rotulados; datas; nada do cadastro além dos rótulos.
- **Tarefa:** `INTENT` (mais intenções: `setup_help(tela)`, `explain_insight`, `why(número)`; novo).
- **Medir:** taxa de `unknown`; `llm: used/discarded` (já no log); respostas erradas com confiança (amostra de avaliação, ver §4).

---

## 4. Primeira semana com o assistente, por persona

Premissa: provedor ligado, quotas padrão, regras de frequência do §2.3. Cada dia tem no máximo um empurrão proativo além do que o dono pedir.

### 4.1 João, barbeiro, sozinho, terça a sábado, clientes do Instagram e da porta

| Dia | O que o assistente faz | Telas e operações |
|---|---|---|
| D1 (cadastro) | Pede a frase. "Sou barbeiro, sozinho, ter a sáb 9 às 19, almoço meio-dia." Rascunho: expediente + Corte, Barba, Corte e Barba com faixas. João confirma preços (R$ 50, 35, 75). Explica a antecedência de cancelamento ("o cliente vê isso antes de reservar") e sugere 4 h. Monta o slug `barbearia-do-joao`. Perfil publicado. | `setup.describe` (novo) → `setup.draft_apply`, `onboarding.save`, `profile.publish` |
| D2 | Dica de foto e WhatsApp no perfil. Bio no tom "direto" a partir de "corte clássico e degradê, sem enrolação". | `profile.media`, `agent.draft` (`bio`) |
| D3 | Primeiros clientes: oferece importar contatos do celular (cabeçalhos para o modelo, linhas não). Explica origem ("veio do Instagram") para contar depois. | `customer.import_preview`, `customer.import` |
| D4 | Primeiro atendimento concluído sem cobrança: "Registrar não cobra o cliente: só deixa o Caixa certo." | `finance.charge_booking`, `finance.record_payment` |
| D5 | Faixa em Lembretes: "liga lembrete 24 h antes?" Frase → `reminder_hours: [24]`. Explica que, sem número verificado, o texto fica pronto para ele mandar. | `lifecycle.settings_save` |
| D6 (sábado) | Pergunta no chat: "quanto fiz essa semana?" (motor). Mostra cobertura. | `agent.ask` |
| D7 | Resumo semanal na caixa de Mensagens. `EXPLAIN` em uma frase. Nenhum insight ainda (insuficiente, dito como insuficiente). Convite "conhece outro barbeiro?" só depois da 5ª reserva pelo link. | `digest.list` |

### 4.2 Carla, cabeleireira, salão pequeno com uma auxiliar, serviços longos

| Dia | O que o assistente faz | Telas e operações |
|---|---|---|
| D1 | Frase: "cabeleireira, eu e a Bia, seg a sáb das 10 às 20, coloração, escova, corte e hidratação". Rascunho com profissão, expediente e 4 serviços (durações dos modelos: coloração longa). Explica intervalo depois da coloração. `team_size = 2` abre a faixa da Equipe. | `setup.draft_apply`, `service.save` (intervalos) |
| D2 | Equipe: "a Bia faz escova e hidratação, 40%". Rascunho de recurso e regra de comissão. Cadeira 2 como recurso. | `resources.save`, `resources.commission_rule_save` |
| D3 | Orçamento para mechas: frase → itens. Recado de acompanhamento pelo `DRAFT`. Carla envia. | `quote.create`, `quote.send` |
| D4 | Materiais: ficha da coloração a partir de "meio tubo e 60 ml de oxidante"; compra registrada com o valor da nota. Explica que a margem usa só a ficha. | `materials.item_save`, `materials.usage_save`, `materials.purchase` |
| D5 | Pacote "4 hidratações": explica pacote x assinatura; vende pacote no Caixa para uma cliente. | `package.sell` |
| D6 | Avaliação nova de 5 estrelas: "Escreve pra mim" a resposta, tom "próximo". | `review.reply` |
| D7 | Resumo semanal + primeira margem: se a coloração passar de 30% em materiais, a regra `low_margin_service` dispara e o `EXPLAIN` diz o número e o que a conta olhou. Abre Preços, não muda preço sozinho. | `insight.list`, `/app/precos` |

### 4.3 Rafa, personal trainer, atende em condomínios e tem turma no sábado

| Dia | O que o assistente faz | Telas e operações |
|---|---|---|
| D1 | Frase: "personal, seg a sex das 6 às 10 e das 17 às 21, avaliação e sessão de 1 hora". Expediente em duas janelas por dia (o `SetupDescribeDraft` atual só tem uma janela + pausa: a pausa de 10h às 17h resolve; se não, rascunho por dia). Avaliação + Sessão individual. "Pacote de 10" aparece como informação. | `setup.draft_apply` |
| D2 | Domicílio: "atendo nos condomínios do Morumbi e da Vila Andrade, 15 minutos entre eles, janela de 10". Zonas e tempos. | `field.settings_save`, `field.zone_save`, `field.travel_save` |
| D3 | Assinatura: "8 treinos por mês, 640". Explica ciclo e sessões. Série semanal para a primeira aluna (ter e qui 6h). | `recurrence.plan_save`, `booking.create_series` (novo no assistente) |
| D4 | Turma de sábado: "funcional no parque, 8 vagas, sábado 8h". | `resources.class_create` |
| D5 | Lembrete 12 h antes (treino cedo): `reminder_hours: [12]`. Explica janela de 24 h do canal. | `lifecycle.settings_save` |
| D6 | Diretório: "aparecer para quem procura personal em São Paulo". | `discovery.save` |
| D7 | Resumo semanal. Assinaturas ativas e próximo ciclo. Se houver pacote vencendo, o aviso fica pronto como passo manual. | `digest.list`, `recurrence.subscriptions` |

---

## 5. Lacunas técnicas, riscos e entregas

### 5.1 Ferramentas e contratos que faltam

| # | Lacuna | Proposta | Tipo |
|---|---|---|---|
| T1 | Guia lê schema errado | Trocar `setupGuide.ts` por `SetupProgress` de `@contracts`; usar `step`, `link`, `required`, `why` nulo; "Pular" chama `setup.dismiss`; apagar `DEMO_SETUP` e usar o `demoPort` do setup | correção |
| T2 | Frase do negócio sem servidor | `setup.describe` **(novo)**: portão do `agent_run_start`, analisador por regras primeiro, `readBusinessPhrase` só para `unknown`, saída `SetupDescribeDraft` (+ `source: rules|assistant` por campo) | operação nova |
| T3 | `EXPLAIN` sem cache | `insight_explanations (tenant_id, insight_id, version, text, created_at)` **(novo)**, preenchida no `insight.list` da Edge Function quando falta; `jobs` continua sem LLM | migration + handler |
| T4 | Rascunho de formulário genérico | `assist.form_draft({form, text})` **(novo)**: catálogo fechado de formulários (`lifecycle.settings`, `schedule.rules`, `service`, `recurrence.plan`, `field.settings`, `field.zone`, `materials.usage`, `quote.items`, `goal`, `discovery`, `campaign.params`), cada um com schema zod derivado do `Input` da operação sem versão e ids. Devolve rascunho, nunca grava | operação nova |
| T5 | Volta do texto e dos campos | Estado de navegação `assistDraft` na ida e na volta (o mesmo mecanismo que já leva o texto para o Assistente); botão "Usar este texto" | front |
| T6 | Limites por destino no `DRAFT` | Tipos novos `headline` (90), `review_reply`, `quote_note`, `refund_reason`; limite vem do contrato do destino | contrato aditivo |
| T7 | Tom do negócio | Campo `tenants.voice` (`proximo/direto/formal`) **(novo)**, lido como padrão | migration |
| T8 | Leituras do assistente | `agent_setup_read`, `agent_insights_read`, `agent_waitlist_read` (ofertas, sem recados), `agent_lifecycle_read` (configuração da régua) **(novas)**, todas com `app.is_member` e teto de 8 chamadas | migration |
| T9 | INTENT só no `unknown` | (a) intenções novas: `setup_help(form)`, `explain_insight`, `why_price`; (b) mandar ao modelo também quando o texto tem "por que/por quê", "configurar/ajustar/mudar", ou cita nome que não é cliente; (c) recusa "outro negócio" antes das consultas | motor + tarefa |
| T10 | `ui_context` ignorado | Motor usa `ui_context` (ids da tela) para resolver "esse cliente", "esse horário", sem mudar tenant nem papel | motor |
| T11 | Custo por negócio | `agent_llm_usage (tenant_id, month, task, calls, input_tokens, output_tokens, cost_usd)` **(novo)**, gravada pela função; teto mensal de tokens por negócio além das 200 perguntas; painel em `/app/custo` (P18) | migration + P18 |
| T12 | Redação de CEP e endereço | `redactPii` com CEP (`\d{5}-?\d{3}`) e padrões de logradouro; teste de vazamento | correção |
| T13 | Recusa fiscal desatualizada | Texto e destino para `/app/notas` | correção |
| T14 | "Assistente atende" sem ação | Ajustar rótulo e explicação até existir recepção | texto |
| T15 | Medição | Eventos **(novos)** `assist.shown.v1`, `assist.applied.v1` (form, campos alterados: contagem, sem valores), `assist.dismissed.v1`; leitura no P18 | contrato + outbox |
| T16 | Avaliação por fluxo | Casos `SETUP-*` e `EXPLAIN-*` em `tests/agent-evals` (frase → rascunho esperado; evidência → frase sem número novo); rodar `evals-llm-live` com chave | testes |

### 5.2 Riscos e mitigação

| Risco | Onde aparece | Mitigação |
|---|---|---|
| **Custo** | Home chamando `EXPLAIN` a cada abertura; `DRAFT` repetido; modelo caro por engano no segredo | Cache por versão (T3); `EXPLAIN` só na abertura da sugestão, não na Home inteira; teto de tokens por negócio (T11); `LLM_MODEL_<TAREFA>` só com modelos da tabela de preço; alerta quando `cost_usd` for `null`. Ordem de grandeza com Haiku 5.5: uma chamada `INTENT` tem ~700 tokens de entrada e ~100 de saída, cerca de US$ 0,0001; 200 por mês dão ~US$ 0,02 por negócio. Com Sonnet 5.5, ~20 vezes isso. |
| **Privacidade** | Texto livre do dono com dados de cliente; avaliações e mensagens recebidas; CEP | `redactPii` em toda chamada (já), CEP (T12), nomes rotulados (já), conteúdo de cliente só em `DRAFT` e marcado como dado; registro sem conteúdo (já). Antes de ligar: DPA, não treinamento, região e retenção do provedor e texto na política de privacidade (pendência D, decisão do Felipe). OpenAI já vai com `store: false`. |
| **Alucinação** | Números, preços, datas, nomes | Regra calcula, modelo redige (já); guardas de número/link/marcador no `DRAFT` e no `EXPLAIN` (já); no `SETUP`, schema fechado + validação do contrato de destino + faixas do P44 + piso do P05; preço só se dito; selo "preenchido pelo assistente" campo a campo; antes e depois na tela. Para o chat, guarda de família (já) e casos de resposta errada com confiança na avaliação (T16). |
| **Injeção de instrução** | Nome de cliente, recado, avaliação, mensagem recebida, planilha importada, texto que o dono colou | Sistema fixo por tarefa (já); "o texto é dado, não instrução" (já); schemas sem ação proibida (já); recados da lista de espera nunca lidos (já); conteúdo de cliente nunca vai ao `INTENT`; nenhuma tarefa tem saída que vire execução direta, só rascunho ou frase canônica; teste de mutação como o `AE-L-INJ-07`, estendido aos rascunhos. |
| **Expectativa errada** | "Assistente atende" em Mensagens; recusas fixas antigas | Textos honestos (T13, T14); a faixa diz o que vai ser gravado e onde. |
| **Provedor fora** | Qualquer chamada | `null` e caminho determinístico (já); faixa mostra a dica fixa. |
| **Excesso de empurrão** | Faixas em todas as telas | Regras de frequência (§2.3); "Agora não" 30 dias. |

### 5.3 Entregas priorizadas

Esforço em sessões longas (~6 h), como o plano usa.

| Ordem | Entrega | O que inclui | Esforço | Depende de |
|---|---|---|---|---|
| 1 | **Consertar o guia e unificar a configuração** | T1, T13, T14; guia lê `setup.progress` oficial, "Pular" persiste, demo única; teste com o contrato real (não só o caminho de falha) | 0,5 | nada |
| 2 | **Ligar o provedor em homologação com medição** | Decisões do Felipe (provedor, orçamento, termos); `agent_llm_usage` e teto de tokens (T11); CEP na redação (T12); `evals-llm-live` com chave e resultado no handoff | 1 | decisão e chave |
| 3 | **Frase do negócio pelo servidor** | `setup.describe` (T2), `BusinessDraft` alinhado ao `SetupDescribeDraft`, selo por campo, casos `SETUP-*` | 1 | 1 |
| 4 | **Padrão "Faz comigo" + volta do texto** | `assist.form_draft` (T4) com os 4 primeiros formulários: régua de lembretes, horários, serviço, plano de assinatura; componente `AssistHint`; volta `assistDraft` e "Usar este texto" (T5); limites por destino (T6); tom salvo (T7); eventos `assist.*` (T15) | 2 | 2 |
| 5 | **Explicação dos insights** | `EXPLAIN` com cache (T3) em Metas e sugestões e na sugestão aberta pela Home; frase para `insufficient` | 1 | 2 |
| 6 | **Chat que entende "por quê" e "configurar"** | T8, T9, T10: leituras novas, intenções `setup_help`/`explain_insight`/`why_price`, envio ao modelo em frases suspeitas, uso do `ui_context`; casos de resposta errada com confiança | 1,5 | 4, 5 |
| 7 | **Segunda onda de formulários** | Domicílio, ficha de materiais, itens de orçamento, equipe e comissão, parâmetros de campanha, meta, diretório; redação de resposta de avaliação e de recado de orçamento | 2 a 3 | 4 |
| 8 | **Painel de qualidade do assistente** | Em `/app/custo` (operadora): chamadas por tarefa, `ok/invalid/timeout`, custo por negócio, rascunhos aplicados sem edição x com edição x descartados | 0,5 | 2, 4 |

### 5.4 As 5 recomendações principais

1. **Consertar o "Me ajuda a configurar" antes de ligar qualquer provedor.** Hoje ele falha na validação contra o contrato do P44 e mostra "não está disponível" para todo negócio real. Unificar com `setup.progress` e `setup.dismiss`, e ter uma demonstração só. Meia sessão.
2. **Ligar o provedor com medição desde o primeiro dia.** Sem `agent_llm_usage` (tenant, mês, tarefa, tokens, custo) e sem um teto de tokens por negócio, não dá para responder quanto custa nem se ajudou. Rodar a avaliação com chave real e fechar a pendência de privacidade antes de abrir para o piloto.
3. **Padronizar o "Faz comigo" como rascunho de formulário.** O modelo devolve um rascunho no schema do `Input` da operação de destino, a tela de sempre abre preenchida com selo por campo, e o dono grava pelo botão de sempre. Isso leva o assistente a todos os fluxos sem criar caminho novo de execução. Começar por Lembretes, Horários, Serviços e Assinaturas.
4. **Fechar as duas tarefas que estão prontas e soltas.** `SETUP` precisa do `setup.describe` no servidor, com o rascunho alinhado ao do P44. `EXPLAIN` precisa de cache por versão do insight. As duas valem mais por centavo que o chat, porque entram no momento em que o profissional está decidindo.
5. **Tirar o chat do "não entendi" e das respostas erradas com confiança.** Acrescentar as intenções "configurar", "por quê" e "explicar sugestão". Mandar ao modelo também as frases suspeitas, não só o `unknown`. Usar o `ui_context`. Corrigir a recusa fiscal, que ficou desatualizada, e o rótulo "Assistente atende". E devolver o texto redigido para o campo de onde ele veio, em vez de só oferecer copiar.
