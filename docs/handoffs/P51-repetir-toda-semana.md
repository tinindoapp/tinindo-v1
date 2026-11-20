# Handoff · "Repetir toda semana" no Novo agendamento (D8 a)

Sessão: `claude-p51` (Felipe) · 2026-11-20
Branch: `claude/kind-allen-m9zju9`, segundo PR da sessão (o primeiro foi o P51, escopo visível do piloto).
Decisão aplicada: D8 (a), registrada em `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md`, seção 6. Fecha a linha Q da seção 4 (a agenda semanal do personal existia no servidor e nenhuma tela chamava).

**Sem migration e sem mudança de contrato.** Usa `booking.create_series` como está. Nada aplicado na homologação.

## Entregue

- **Formulário** (`src/features/scheduling/BookingSeries.tsx`, ligado em `BookingFlowPage.tsx`): caixa "Repetir toda semana" no Novo agendamento. Dias da semana (chips de 44 px), horário e até quando: "Quantas semanas" (2 a 12) ou "Até uma data". Disponível para todas as profissões.
- **Prévia antes de confirmar**: todas as datas, em ordem, cada uma marcada "Livre" ou "Indisponível: fica de fora", com o total ("16 datas: 16 livres."). A disponibilidade vem das mesmas leituras da agenda. **Nada é criado até "Confirmar repetição".**
- **Gravação** (`series.ts`, `planSeries`): o servidor repete UM horário por 2 a 12 semanas. Vários dias viram uma chamada por dia da semana, com `all_or_nothing: false` (o servidor cria as livres e devolve as que ficaram de fora). "Até uma data" vira número de semanas por dia. A primeira data de cada dia é a primeira cujo horário ainda não passou, no fuso do negócio (o servidor recusa a série com a primeira data no passado).
- **Chave**: uma chave por envio (`src/lib/idempotency.ts`), e cada chamada usa uma chave derivada (`<chave>-d<dia>`). Nova tentativa depois de falha de rede manda as mesmas chaves: a chamada que já tinha dado certo devolve o mesmo resultado e não duplica.
- **Depois de confirmar**: "N agendamentos criados", período, e a lista das datas que ficaram de fora; "Ver na agenda".
- **Agenda e detalhe**: "Repete toda semana · 3 de 16" no cartão e no detalhe do atendimento, com "Abrir o próximo". No detalhe, o botão vira "Cancelar só este", com o aviso de que os outros continuam marcados.
- **Demonstração** (`fixturePort.ts`): emula `create_series` com a mesma regra (2 a 12 semanas, conflito fica de fora, nenhuma criada = 409).

## O que o servidor suporta e o que não

| Pedido | Situação |
|---|---|
| Criar a série com conflitos marcados | Sim: `scheduling_booking_create_series` (`supabase/migrations/20261018130000_p03_scheduling.sql:482`), `all_or_nothing` false devolve `conflicts` |
| Vários dias da semana numa chamada | Não: uma chamada por dia (resolvido na tela) |
| Mais de 12 semanas | Não: o contrato limita a 12 (`BookingCreateSeriesInput.weeks`); a tela explica o limite |
| Vínculo da série na leitura do atendimento | **Não**: o banco grava `bookings.series_id`, mas `Booking` (contrato) não devolve. Com servidor, a tela só conhece as séries criadas **neste aparelho** (guardadas em `localStorage`, por negócio, até 60). Em outro aparelho, o indicador "Repete toda semana" não aparece; nada mais muda |
| "Cancelar só este" | Sim (`booking.cancel` de sempre) |
| "Cancelar os próximos" | **Não existe** operação. Não foi oferecido na tela |

## Pendências

1. Contrato: devolver `series_id` em `Booking` (`booking.get` e `booking.list`) e trocar a memória do aparelho pela leitura do servidor.
2. Operação nova `booking.cancel_series_from` (cancelar este e os próximos, numa transação, idempotente, com motivo) e o botão "Cancelar os próximos".
3. Uma chamada com vários dias da semana, para a série ter um `series_id` só (hoje terça e quinta viram duas séries).

## Testes

- `series.test.ts` (planejamento: fuso, primeira data no passado, até a data, limites), `BookingSeries.test.tsx` (prévia com conflito, nada criado sem confirmar, nova tentativa com a mesma chave), `fixturePort.test.ts` e `serverPort.test.ts` (chamada no formato do contrato).
- e2e `tests/e2e/scheduling/serie.spec.ts`, desktop e celular: o personal com aluno fixo terça e quinta às 7h por 8 semanas (16 atendimentos, prévia, confirmação, Agenda e detalhe), num navegador em outro fuso; e, em 375 px, prévia com conflito marcado, alvos de 44 px e sem rolagem lateral.
- Rodados nesta máquina sobre a `main` com o P55 (`2526abe`): lint e typecheck ok; unit 1005; contratos 842 (2 falhas esperadas, 38 pulados); pgTAP todos; integração 151; dicionário do banco igual; e2e completo 316 passaram, 0 falharam, 34 pulados (`fixme` antigos); jornada com servidor do P59, 2 passaram.
- O trabalho começou num subagente que parou no limite de uso da conta; a sessão principal revisou, juntou com a `main` e terminou.
