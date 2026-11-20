# Handoff · Agenda do personal completa

Sessão: Claude Code na nuvem, para @fffalleiros · 2026-11-20
Branch: `claude/public-client-journey-a4g596` → PR para `main`.
Fecha as pendências 1 a 3 de `docs/handoffs/P51-repetir-toda-semana.md`, a pendência do botão "Mandar link da reserva"
de `P55-claude-cliente-final.md`, a observação do aviso depois de reagendar (`P56-P59-claude-banco-testes.md`) e o
primeiro passo da trava de módulo no servidor (`P51-claude-p51.md`, Pendências).

## Entregue

### Servidor

Migration `supabase/migrations/20261120124000_agenda_personal_series.sql`. É append-only e não foi aplicada na homologação.

- **`series_id` em `Booking`.** Aparece em `booking.get`, `booking.list`, `booking.list_by_customer` e em toda resposta que usa `app.sched_booking_json`. No contrato é opcional, para tolerar servidor antigo. Índice novo: `bookings_series`.
- **`booking.create_series` com vários dias da semana.**
  - O parâmetro opcional `weekdays` (0 = domingo a 6 = sábado, no fuso do negócio) faz terça e quinta saírem numa série só, com um `series_id`.
  - Cada dia começa na primeira data a partir do primeiro horário, na mesma hora local, e repete `weeks` semanas.
  - Sem `weekdays`, vale o comportamento antigo.
  - O limite de saída subiu de 12 para 84 atendimentos (`MAX_SERIES_BOOKINGS`).
- **`booking.series` (nova, leitura).** Devolve os atendimentos da série em ordem, usados para "3 de 16" e "Abrir o próximo".
- **`booking.cancel_series_from` (nova, comando).**
  - Cancela este atendimento e os seguintes da mesma série que ainda estão marcados, numa transação e com o mesmo motivo.
  - É idempotente pela chave. A versão é conferida só no atendimento indicado; os outros ficam travados pelo recurso.
  - Passados, concluídos e faltas ficam como estão; o campo `kept` conta quantos são.
  - Gera um evento `booking.cancelled.v1` por atendimento, com `series_id`, e uma auditoria por atendimento.
  - Atendimento fora de série é recusado com 422 `series`.
- **Trava de módulo (comum).** `app.module_guard` recusa operação de módulo desligado com 403 e hint `module_disabled`; `app.authorize` confere papel e módulo. Na Agenda, a trava vale:
  - em todos os comandos, pela trava do recurso;
  - nas leituras `booking.list` e `booking.get`;
  - nas operações novas.

  A Agenda é do piloto e está sempre ligada. Os outros módulos estão no recado com a etiqueta `para-felipe`.
- **Contratos:** `scheduling.ts`, `operations.ts` e `docs/03` atualizados; `docs/02_DICIONARIO.md` regenerado.

### Tela

- **Série lida do servidor.** Saiu a memória do aparelho (`localStorage`), e a porta perdeu `seriesGroups` e `rememberSeries`.
  - A Agenda lê cada série do dia uma vez para mostrar "Repete toda semana · 3 de 16".
  - Se a leitura da série falhar, o cartão diz só "Repete toda semana".
  - O detalhe usa `booking.series`. "Abrir o próximo" pula os cancelados.
- **Terça e quinta como uma série só.**
  - Com o mesmo número de semanas em todos os dias, o formulário manda uma chamada com `weekdays`.
  - "Até uma data" que cai no meio da semana deixa os dias com números de semanas diferentes. Nesse caso sai uma chamada por dia, cada uma com o seu `series_id`, como antes.
- **"Cancelar os próximos".** O botão aparece no detalhe de um atendimento de série que ainda tem 2 ou mais marcados a partir dele.
  - Pede confirmação com o número ("Cancelar este e os próximos 13?") e o motivo, que é obrigatório.
  - Diz que os que já aconteceram continuam como estão.
  - Depois, mostra o bloco "Atendimento cancelado" de sempre.
- **"Mandar link da reserva".** Aparece no detalhe de atendimento confirmado ou concluído.
  - Chama `network/booking_link.issue` (P55) e abre o WhatsApp do cliente com o texto pronto: o horário e o link, ou, depois do atendimento, o convite para avaliar.
  - Na demonstração, o link é de exemplo, e a tela diz isso.
  - A janela do WhatsApp é aberta no toque, para o navegador não bloquear.
- **"Avise o cliente" depois de reagendar (item 4: confirmado e corrigido).**
  - A causa: o texto pronto ia no estado da navegação com a data da criação. Se o horário mudasse depois (outro aparelho, ou voltar e recarregar), o bloco mostrava a data antiga.
  - Agora o estado leva só quem e o quê; o dia e a hora saem do atendimento como ele está.
  - Reagendar também oferece o aviso, com o texto "foi remarcado para …".
- **Camada comum (item 5).**
  - `agenda.ts` usa `formatCents` de `src/lib/money.ts`.
  - `port.ts` reexporta `newIdempotencyKey` de `src/lib/idempotency.ts`.
  - `attendance.tsx`, `collect.ts` e `serverPort.ts` usam `now()` de `src/lib/time.ts`.
  - O telefone já vinha de `src/lib/phone.ts`.
  - A Agenda saiu das três listas de legado do `eslint.config.js` (só remoção de linhas).

## Decisões tomadas aqui

- A versão conferida em "cancelar os próximos" é só a do atendimento que a pessoa está vendo. Os outros podem ter mudado (reagendado num outro dia, por exemplo); continuam na série e são cancelados se ainda estiverem marcados.
- "Cancelar os próximos" só aparece com 2 ou mais marcados; com 1, é o mesmo que "Cancelar só este".
- Item 6 aplicado na Agenda pela trava do recurso, que todos os comandos usam (inclusive o pedido pelo link). Ainda sem trava: `schedule.settings`, `schedule.day_plans` e `availability.list` (Agenda sempre ligada), anotadas no recado.
- Mexi fora da área em dois arquivos de teste e configuração:
  - `eslint.config.js`: só tirei as 3 linhas da Agenda, que o item 5 pede;
  - `tests/contracts/scheduling/scheduling-contracts.test.ts`: passa a ler a migration nova e a definição mais recente de cada RPC.

## Testes e resultados (local, sobre a `main` de 20/11, com o #136)

| Comando | Resultado |
|---|---|
| `npm run lint` / `typecheck` | ok |
| `npm run test:unit` | 1012/1012 |
| `npm run test:contracts` | 846 ok, 38 pulados (iguais à main) |
| `npm run db:test:local` | todos; novo `41_agenda_personal_series.test.sql` (34) |
| `npm run db:test:concurrency` | todos; novo `32_agenda_series.sh` (mesma chave, disputa de horário, cancelar ao mesmo tempo, cancelar × concluir) |
| `npm run test:integration` | 155/155; novo `50_agenda_personal.test.ts` |
| `npm run check:functions` | ok |
| `npm run build` | ok |
| `npx playwright test` (desktop e Pixel 7) | 318 ok; `serie.spec.ts` cobre cancelar os próximos, o link da reserva e 375 px |
| `db-dictionary.sh --check` e `check-migrations.mjs` | ok |

## Pendências

- Trava de módulo nos outros módulos: recado `para-felipe` (lista de 6 módulos por ativação e 11 guardados).
- "Até uma data" no meio da semana ainda gera uma série por dia. Para juntar, o servidor precisaria de um parâmetro `until` em `booking.create_series`.
- Mais de 12 semanas continua fora (limite do contrato).
