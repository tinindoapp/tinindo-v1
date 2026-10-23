# Handoff · P13 Relacionamento (réguas)

Sessão: `claude-int-p13` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-22
Branch: `claude/p13-relacionamento` → PR para `main`. Decisões em `docs/adr/0019-relacionamento-reguas.md`. Onda 2, PR 4 (`docs/plano-onda-2.md`).

## Resultado

- **Banco** (`20261022140000_p13_lifecycle.sql`): `lifecycle_settings`, `lifecycle_consents`, `lifecycle_campaigns`, `lifecycle_steps` (dedupe por régua/agregado/chave), `lifecycle_processed_events`; régua reage ao outbox (`app.lc_on_event`), varre prazos e despacha (`app.lc_tick`/`app.lc_dispatch`); gatilho `booking.rescheduled.v1`; `jobs_run`/`jobs_handle` substituídos para chamar a régua; `app.an_metrics` com o indicador de lembretes medido; 3 modelos novos.
- **Edge Function `lifecycle`**: 9 operações do dono pelo `rpc-handler` (configuração, fila, compartilhar/cancelar passo, consentimento, público, campanha).
- **Contratos** (`_shared/contracts/lifecycle.ts`), registro v1 (módulo `lifecycle`), `EventType` + `booking.rescheduled.v1`, docs/01, docs/03, docs/10 (REL-01).
- **Tela** `/app/relacionamento`: fila com estado por palavra e contagens, texto pronto para compartilhar (copiar + marcar), réguas (ligar, confirmação, horas dos lembretes, prazos, teto), reativação com público visto, revogação de consentimento e aprovação com teto, campanhas. Demonstração com agenda de exemplo e "Rodar a régua".
- **P18**: indicador de lembretes deixa de ser "indisponível" (demo, pgTAP, e2e e integração atualizados).

## Aceite do pacote (tasks/P13.md)

| Critério | Evidência |
|---|---|
| Parar régua por aceite/pagamento/opt-out | pgTAP 15: aceite pelo link cancela o acompanhamento (`accepted`); pagamento cancela o lembrete de cobrança (`paid`); SAIR no canal cancela tudo da cliente (`opted_out`); cancelamento/remarcação do atendimento (`cancelled`/`rescheduled`); int `32_p13` passos 2–5 |
| Aprovação de público e teto de gasto | pgTAP 15 e int passo 6: público só com consentimento de marketing; hash do público visto obrigatório (`STALE_VERSION` se mudou); teto da campanha; teto diário adia (`deferred`, pgTAP 15 e conc `15_lifecycle` sob 3 workers) |
| Dedupe de envio | pgTAP 15: evento reprocessado não duplica; rodada seguinte não duplica follow-up; conc: mesmo evento em 3 workers → 1 conjunto; 5 passos vencidos em 3 workers → uma mensagem por passo; 2 aprovações paralelas → 1 passo |
| Autorização entre tenants | pgTAP 15 e int SEC: dono B 403 em fila, configuração, consentimento, campanha; RLS 0 linhas |
| Falha externa, replay, recuperação | sem canal → manual (nunca perde); teto → adiado; passo cuja base mudou (atendimento não confirmado, orçamento decidido, cobrança encerrada) é cancelado no despacho; worker com lease e retry do P06 |
| Sandbox vs real | só o canal simulado do P12 existe; modelos novos aprovados só no simulado |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` | ver PR |
| `npm run test:integration` | ver PR (novo `32_p13_relacionamento`, 8 passos) |
| `npm run db:test:local` | ok (P13: 61 asserções; P18 atualizado) |
| `npm run db:test:concurrency` | ok (`15_lifecycle`) |
| `npm run db:restore:drill` | ok |
| `deno check --frozen` | ok |
| `npx playwright test` | ver PR (novo `tests/e2e/lifecycle`; `analytics` atualizado) |
| gitleaks | sem achados |

## Decisões tomadas sem consulta

- Mensagens transacionais sobre o que a própria cliente pediu (atendimento, orçamento, cobrança) saem sem consentimento explícito, salvo oposição (SAIR ou revogação registrada). Marketing exige consentimento registrado e campanha aprovada. Registrado na ADR-0019.
- Remarcação passou a emitir `booking.rescheduled.v1` por gatilho (alteração aditiva no domínio do P03), porque a RPC não emitia evento e a régua precisa trocar os lembretes.
- `jobs_run`/`jobs_handle` substituídos por `create or replace` (funções, não dados): o cron existente cobre a régua.
- Teto diário conta envios ao canal; passos manuais não gastam. Adiado = amanhã 09:00 no fuso do negócio.
- Reativação: sem visita há N dias (padrão 60), sem atendimento futuro, sem reativação nos últimos 90 dias.
- Texto livre nunca sai pela régua: só modelos. Os três modelos novos precisarão de aprovação da Meta no provedor real.
- O P13 não estava no manifesto (mesmo caso dos pacotes anteriores); o quadro não foi alterado.

## Limitações e próximos passos

- Horário do passo manual: ele aparece na fila no vencimento, mas depende do dono abrir a tela; sem canal não há notificação ao dono (P16/P17 ou um aviso no shell ficam para a onda seguinte).
- Sem régua de "retorno" (ex.: 30 dias depois do atendimento) além da reativação por campanha.
- A remarcação de um atendimento com confirmação já compartilhada não reenvia confirmação manual já marcada como compartilhada (correto), mas cria uma nova confirmação para a nova versão.
- Staging: rodar `tests/e2e/lifecycle` e a integração contra o projeto hospedado com o canal simulado antes de qualquer provedor real.
