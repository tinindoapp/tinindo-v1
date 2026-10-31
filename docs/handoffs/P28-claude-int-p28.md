# Handoff · P28 Equipes e recursos

Sessão: `claude-int-p28` (Claude Code na nuvem, para @fffalleiros) · 2026-10-27
Branch: `claude/pensive-allen-kdu6np` → PR para `main`. Decisões em `docs/adr/0031-equipes-e-recursos.md`.

## Resultado

- **Banco** (`20261027220500_p28_team_resources.sql`, aditiva): `team_resources`, `team_commission_rules`, `team_bookings`, `team_classes`, `team_class_seats`, `team_allocations` (exclusão por recurso), `team_commission_entries` (append-only). 15 RPCs do dono. Gatilhos em `bookings` e `availability_blocks` protegem a agenda individual vinculada. Nenhuma função existente foi substituída.
- **Edge Function `resources`** (15 rotas) sobre o `rpc-handler`.
- **Contratos** aditivos em `_shared/contracts/resources.ts`, registro v1 (`ModuleId` `resources`), docs/03, docs/10 (TEAM-01), release/CHECKLIST (25 funções).
- **Tela** `/app/equipe` (Negócio → Equipe): agenda da equipe (concluir, cancelar), nova reserva composta (profissional + recursos, horários livres combinados), turmas (criar, inscrever, liberar vaga, presença, concluir, cancelar), equipe e recursos (cadastro, comissão padrão, vínculo com a agenda, comissão por serviço) e comissões do mês (estorno). Modo demonstração rotulado com as mesmas regras (`demoPort.ts`). Ícone `equipe` novo, no padrão da ADR-0024.

## Aceite do pacote (tasks/P28.md)

| Critério | Evidência |
|---|---|
| Reserva composta não deixa recursos parcialmente comprometidos | pgTAP 26: cadeira ocupada → `SLOT_CONFLICT/chair`, nenhuma reserva parcial, zero alocações do profissional livre; conc `25_team_resources`: 10 reservas simultâneas com a mesma cadeira → 1 reserva, 9 conflitos, só 2 alocações ativas; mesmos recursos em ordens diferentes → 1 reserva, sem deadlock; int `42_p28_equipe` passo 1; e2e `resources` |
| Vários profissionais, salas, cadeiras | pgTAP/int: cadastro, nome único por tipo, um vínculo com a agenda, comissão só de profissional; disponibilidade combinada |
| Turmas | pgTAP/int/conc: lotação sob lock (10 inscrições em 3 vagas → 3), uma vaga por cliente, presença gera recebível, falta não |
| Comissões | pgTAP/int: regra do serviço > padrão; congelada na reserva; 1 lançamento na conclusão (conc: 5 conclusões simultâneas → 1), estorno uma vez, relatório lançado/estornado/líquido |
| Agenda individual (P03) | pgTAP/int/conc: equipe não reserva por cima da agenda individual, a agenda individual não reserva nem bloqueia por cima da equipe; 5 corridas → sempre uma só |
| Caixa (P07) | pgTAP/int: concluir cria recebível em aberto pelo preço combinado; int registra o pagamento pelo `finance.record_payment` |
| Isolamento | pgTAP/int: dono B → 403 e RLS 0 linhas; cliente com login → 403/0 linhas; profissional de A no negócio B → 404; anon sem execução; auditoria sem nomes nem motivo |
| Idempotência | pgTAP: replay igual, conteúdo diferente → 409; conc: 10× a mesma chave → 1 reserva, respostas idênticas |

## Comandos e resultados (local, Postgres 16 + pgTAP)

| Comando | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` · `npm run build` | ok |
| `npm test` | unit 446 · contratos 564 (novo `tests/contracts/resources`, 35) |
| `npm run db:test:local` | tudo ok (P28: 64 asserções) |
| `npm run db:test:concurrency` | tudo ok (novo `25_team_resources`, 20 verificações) |
| `npm run test:integration` | 19 arquivos, 112 testes (novo `42_p28_equipe`) |
| `deno check --frozen` (25 funções) | ok |
| `npx playwright test` | 182 passaram, 32 fixme preexistentes (novo `tests/e2e/resources`, desktop + Pixel 7) |
| Mutação: sem a exclusão e sem o `FOR UPDATE` | o teste de concorrência falha (5 reservas com a mesma cadeira, 10 alocações) |

Não executado aqui: `supabase test db` e `supabase db lint` no PG 17 (sem Docker). Rodam no CI.
O teste de concorrência usa uma largada por advisory lock: sem ela, o tempo de abrir cada conexão serializava as transações e a mutação passava.

## Decisões tomadas sem consulta (pedido do dono: "decida pelos docs")

- Subsistema aditivo em vez de vários recursos no P03 (ADR-0031 §1): o piloto de 28/10 usa o motor solo.
- Horário de funcionamento = expediente da agenda principal; sem expediente por profissional.
- Preço base do serviço na reserva da equipe (sem cotação do P05); comissão congelada na reserva.
- Só o dono opera; login de profissional (`staff`) fica para depois.
- Sem eventos novos; reservas da equipe não têm lembretes (P13) nem entram em "concluídos sem cobrança" (o recebível nasce na conclusão).
- Menu: Negócio → Equipe (fora das abas principais do piloto).

## Quadro (coord.py)

O P28 não estava no quadro (`P25–P41 continuam planejados e não ativados`). A liberação no branch `coordination` foi recusada pelo controle de permissões desta sessão, e o `advance` exige a fase toda concluída (o P42 está em andamento com o Gabriel). A entrega segue o precedente do `reconcile` (P10–P24): o integrador registra P28 no quadro com o PR e o SHA de merge.

Registrado no quadro em 31/10 pelo integrador (ação `reconcile`, autorização do dono): P28 `done` com PR #60 e merge `27316a7`; P30 `done` com PR #61 e merge `7e032ff`.

## Mocks e pendências

- Demonstração offline com dados de exemplo (Bia, Caio vinculado, sala, duas cadeiras, um atendimento de ontem), rotulada.
- Nenhuma migration aplicada em banco compartilhado. A homologação (piloto 28/10) não foi tocada.
- Próximos: expediente por profissional, login `staff`, cotação (P05) na reserva da equipe, lembretes via evento próprio, unificação com o P03 (ADR-0031, consequências), pagamento de comissão no P31.

## Recuperação

Migration aditiva. Para desligar: tirar a linha do módulo em `src/app/modules.ts`/`navigation.ts`. Os gatilhos em `bookings`/`availability_blocks` só agem com alocação ativa de profissional vinculado; para removê-los, uma migration nova com `drop trigger`.
