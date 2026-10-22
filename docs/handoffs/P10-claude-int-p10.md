# Handoff · P10 Integração e liberação (parte de código)

Sessão: `claude-int-p10` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-22
Branch: `claude/p10-integracao` → PR para `main`. Decisões em `docs/adr/0016-integracao-handler-banco-e-release.md`.

Este handoff cobre o que o P10 permite fazer **sem ambiente hospedado**. O quadro continua com P10 pendente: o que falta (abaixo) depende de projeto Supabase, testadores e aprovação humana.

## Resultado

- **Camada de integração handler ↔ banco** (`tests/integration`, `npm run test:integration`): 13 Edge Functions montadas com a lógica de produção, RPC chamada pelo `pg` com os papéis do Supabase, sem mock. 38 testes: matriz SEC-01/02/03 em todas as funções; UAT barbeiro (serviço, importação, agenda, link público, regra de preço aprovada, lista de espera com worker e aceite pelo link, conclusão e caixa, assistente com injeção); UAT cabeleireira (90 min não cabe em 60, duração nova só para reservas novas, reagendar atômico, preço combinado congelado); UAT personal (pacote pago uma vez, série de 8 com conflito e resolução, consumo por evento sem dupla baixa, cancelamento sem mexer no caixa, sem colunas de saúde); UAT cliente de dois profissionais (vínculo por código em A e B, RLS real); fase 2 (orçamento → reserva, assistente aprovar ≠ executar, plano e serviço assistido com acesso delegado e leitura auditada, indicadores com baseline); sonda de que toda operação v1 tem rota viva.
- **Ensaio de restore** (`npm run db:restore:drill`, OPS-01): dump 0,2 s, restore 0,9 s, 710 kB no banco sintético; contagens, RLS, políticas, FKs, comando real e idempotência conferidos.
- **CI**: os dois passos entraram no job de banco.
- **Release**: `release/CHECKLIST.md`, `release/RUNBOOK.md` (cinco incidentes), `release/RELEASES.md`.
- **docs/10**: tabela de evidência por ID da matriz (o que está provado onde, e o que fica pendente).
- **UATs e2e**: os 19 `fixme` continuam, com o motivo atualizado para apontar a prova na integração ou a lacuna de produto.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` (unit + contratos) | 627/627 |
| `npm run test:integration` | 38/38 |
| `npm run db:test:local` · `db:test:concurrency` | ok |
| `npm run db:restore:drill` | ok (tempos acima) |
| `npx playwright test` | 111 passaram, 31 fixme |

Bugs encontrados: nenhum no código de produção. Três expectativas minhas estavam erradas e o banco estava certo (aprovação com hash errado é `POLICY_REJECTED/payload_hash`; consumo repetido do mesmo evento devolve o mesmo saldo em vez de erro; reagendar usa a duração atual do serviço). Registrado nos testes.

## Lacunas de produto encontradas (não são de teste)

1. **Reservar pelo link público não existe.** `public.slots` mostra horários; não há `public.book`. O UAT barbeiro 4b e o docs/12 ("agendamento web compartilhado") dependem disso. Proposta: operação anônima `public.book` com hold + confirmação por código ao cliente, no P12 ou num pacote curto antes dele.
2. **Área da cliente** (ver as próprias reservas nos dois negócios) não existe na tela; o backend já permite (RLS + `my_customer_links`). Proposta: tela `/app/minhas-reservas` pequena.

## O que o P10 ainda exige e eu não posso fazer

- Projeto Supabase de homologação, SMTP, segredos, cron do `jobs`, deploy das funções (gate ADR-0006).
- `tests/e2e/qa` contra o staging (Playwright com `VITE_SUPABASE_URL`) e iPhone Safari real.
- 3 UATs por arquétipo com pessoas, cronômetro de onboarding e registro de suporte.
- Restore do backup hospedado em projeto isolado.
- Aprovação humana e `finish P10` no quadro.

## Próximo passo

PR 2 da onda: P12 (canal) com provedor simulado atrás de flag. As duas lacunas acima entram no planejamento do P12/P13.
