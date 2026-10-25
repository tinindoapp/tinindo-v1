# Auditoria independente da demonstração · 25/10/2026

Reprodução e correção dos achados da auditoria de 25/10 (navegador desktop, demonstração offline com dados fictícios).
Base conferida: `main` em `f5008e0` (merge do #38), sem mudanças depois disso.

## 1. Os dois endereços servem versões diferentes

**Achado confirmado. A causa está na configuração da Cloudflare, não no código nem no merge.**

- No `main` atual, `ModulePlaceholder` ("Em construção. Esta área ainda não guarda nem altera dados") não é usado por
  nenhum módulo. O Caixa deixou de usá-lo no P07 (`1da258a`), que entrou no `main` em 18/10 pelo merge `de452d2`
  (18:28 UTC). Logo, o endereço principal serve um build **anterior a 18/10 18:28 UTC**.
- Os checks `Workers Builds: tinindo-v1` dos commits do `main` mostram como cada push é publicado. Desde o PR #11
  (`b7719a7`, 18/10 17:30 UTC), todo build do `main` sai como **prévia da branch `main`**
  (`…/production/previews/main/builds/…`). Isso inclui `de452d2` (P07) e `f5008e0` (#38). Nenhum deles é deploy de
  produção.
  - O build do `47c0a4a` (PR #10, o primeiro com `wrangler.jsonc`) também informa "Preview URL" e
    "Preview Alias URL: main-tinindo-v1…".
- Portanto, o `main` é tratado como branch de prévia no Workers Builds. O endereço principal
  (`tinindo-v1.falleiros.workers.dev`) continua na última versão promovida a produção, de antes do P07. As prévias de
  PR (`<branch>-tinindo-v1…`) e a prévia do `main` (`main-tinindo-v1.falleiros.workers.dev`) estão atualizadas.
- **Não identificado daqui:** o commit exato da versão de produção atual. O GitHub só recebe o link do build, e a
  rede desta sessão não alcança `workers.dev` nem o painel. O painel mostra essa versão em Workers → tinindo-v1 →
  Deployments.

**Hipóteses descartadas:**
- "O PR não foi incorporado": a árvore do `main` contém o Caixa completo e o build do `main` passou.
- "Build do `main` falhando": todos os checks do `main` estão verdes.
- "Código diferente entre os endereços": é o mesmo repositório; o que muda é o tipo de deploy de cada build.

**Correção proposta (precisa de aprovação, porque mexe em produção):**
1. No painel da Cloudflare, abrir Workers → tinindo-v1 → Settings → Build → Branch control.
2. Definir a branch de produção como `main`, com comando de deploy `npx wrangler deploy`.
3. Manter os builds das outras branches como prévia (`npx wrangler versions upload` ou o atual).
4. Refazer o build do último commit do `main`.

Até lá, o endereço `main-tinindo-v1.falleiros.workers.dev` mostra o `main` atual.

**Como saber a versão exibida (feito neste PR):**
- O banner "Demonstração" mostra `versão <commit curto> · <branch>`.
- `/version.json` traz o commit completo, a branch e a hora do build.
- No Workers Builds esses dados vêm de `WORKERS_CI_COMMIT_SHA` e `WORKERS_CI_BRANCH`; localmente, do git
  (`vite.config.ts`).

## 2. O mesmo atendimento não atravessava os módulos

**Achado confirmado.** Cada módulo da demonstração tinha sua própria emulação com exemplos fixos. A Agenda concluía o
atendimento, mas o Caixa listava apenas os dois atendimentos de exemplo dele (um dos quais nem existia na Agenda).

**Correção:**
- `src/lib/demo/journey.ts` é uma ponte só da demonstração.
  - A conclusão na Agenda publica o atendimento (id, cliente, serviço, preço combinado e evento de conclusão).
  - O Caixa passa a listá-lo em "Atendimentos concluídos sem cobrança".
- Concluir **não** cria cobrança nem recebimento. Cobrar, receber e usar crédito de pacote continuam sendo ações do
  dono, com as mesmas regras de antes:
  - não receber mais do que o saldo;
  - cada atendimento é cobrado uma vez só;
  - o crédito de pacote é debitado uma vez por evento e bloqueia a cobrança;
  - o preço é o combinado na reserva.
- Os exemplos do Caixa agora existem também na Agenda: o corte da Ana e a barba do Bruno, na segunda 19/10.
- O detalhe do atendimento concluído ganhou o link "Cobrar no Caixa".
- Repetir a conclusão (clique duplo ou nova tentativa) não duplica: há idempotência na Agenda e deduplicação por
  atendimento na ponte e no Caixa.

## 3. Jornada do cliente e escopo do piloto

| Ponto | Situação | O que foi feito |
|---|---|---|
| Avaliação só por `/avaliar` digitado | Estava desconectada | O perfil público mostra "N avaliações de clientes", que leva a `/avaliacoes/:slug`, e "Já foi atendido aqui? Avaliar meu atendimento", que leva a `/avaliar`. |
| Elegibilidade na avaliação | Estava correta | Na demonstração, `/avaliar` mostra os exemplos e os atendimentos da Cliente Exemplo Ana concluídos na Agenda, dentro de 30 dias. Atendimentos de outro cliente não aparecem nem são aceitos. A data aparece em cada item. |
| Perfil "sem avaliações" com lista de 2 avaliações | Estava desconectado | Na demonstração, o perfil e a lista usam o mesmo resumo. A lista aceita o endereço que o dono publicou. |
| Escolher horário no perfil público | **Lacuna conhecida, não intencional** | Não existe `public.book` (registrado no handoff do P10). A mensagem agora diz que nada foi reservado e que a reserva on-line ainda não existe, nos dois modos. Antes, o modo com servidor pedia "entre com seu e-mail", um passo que não existe. |
| Minhas reservas | **Lacuna conhecida** (handoff do P10) | Não implementado: é expansão de escopo e depende de decisão. |

**Menor solução coerente com o piloto, para decidir:**
- **Reserva pelo link:** operação anônima `public.book` que cria um *hold* curto no motor do P03 e confirma por
  código enviado ao cliente pelo canal do P12.
  - Exige contrato, migration, limite contra abuso e mensagem real.
  - Na demonstração, criaria a reserva de verdade na Agenda da aba. Não seria uma simulação de sucesso.
- **Minhas reservas:** tela `/app/minhas-reservas` só de leitura, para o cliente com login, sobre `my_customer_links`
  (o backend já filtra por RLS). Cancelar ou reagendar pelo cliente ficaria para depois.

## 4. Comportamentos intencionais preservados

- O relógio fixo continua em 20/10 às 09:00. A reserva das 13:00, no futuro, não pode ser concluída; a da Ana, às
  09:00, pode.
- Recarregar a página zera a demonstração. Não há persistência nova.

## 5. Testes

- **Novos, unitários:** `src/lib/demo/journey.test.ts`.
  - Agenda → Caixa → cobrança → recebimento → saldo → avaliação, com o mesmo id.
  - Crédito de pacote no mesmo atendimento.
  - Atendimento futuro não conclui; outro cliente não avalia.
- **Novos, e2e:** `tests/e2e/qa/jornada-integrada.spec.ts`, em desktop e emulação de celular (Pixel 7).
  - A jornada integrada, com clique duplo em concluir, receber e publicar.
  - Atendimento futuro.
  - Perfil público → avaliações → avaliar, com reserva honesta.
  - Versão no banner e em `/version.json`.
  - Regressões: agendamento com clique duplo, voltar sem confirmar, painel de concluir com "Voltar" e recebimento
    zero.
- **Mantidos:**
  - nota obrigatória (`tests/e2e/reputation`);
  - avaliação repetida recusada;
  - pagamento único (UAT barbeiro 9b);
  - conclusão do atendimento elegível (UAT barbeiro 8).
  - Os testes que esperavam o texto antigo do perfil e do horário foram atualizados.
- **Limitação:** emulação de celular no Chromium não é aparelho real. Safari no iPhone continua pendente (gate do
  P10).

## Roteiro para o testador (dados fictícios, sem recarregar a página)

Antes de começar, confira no banner a versão que o endereço está servindo.

1. **Agenda:** abra Agenda → atendimento das 09:00, "Corte · Cliente Exemplo Ana" (terça 20/10).
2. Toque em "Concluir atendimento" e depois em "Confirmar conclusão". A mensagem deve dizer que o pagamento não foi
   registrado.
3. **Caixa:** toque em "Cobrar no Caixa". Em "Atendimentos concluídos sem cobrança" aparecem 3 itens, entre eles
   "Ana · 20/10/2026 · R$ 60,00". O valor "Recebido" continua em R$ 260,00.
4. No item de 20/10, toque em "Marcar como recebido". O item sai da lista, aparece em "Recebimentos no mês" e
   "Recebido" passa a R$ 320,00. Alternativas: "Cobrar depois" deixa o valor em "A receber"; "Usar crédito do pacote"
   debita uma sessão sem somar ao caixa.
5. **Perfil público:** em Perfil, publique um endereço (por exemplo `barbearia-teste`) e toque em "Abrir perfil
   público". Escolha um horário: a mensagem diz que nada foi reservado.
6. **Avaliações:** toque em "2 avaliações de clientes" e depois em "Voltar ao perfil".
7. Toque em "Avaliar meu atendimento". Aparece "Corte · Barbearia Exemplo A · 20/10". Dê a nota 5 e publique. Uma
   nova tentativa no mesmo atendimento é recusada.
8. **Atendimento futuro:** o atendimento das 15:00 (ou uma reserva nova das 13:00) não oferece "Concluir" e não
   aparece no Caixa.
