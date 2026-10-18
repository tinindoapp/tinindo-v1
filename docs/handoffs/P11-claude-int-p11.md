# Handoff · P11 Orçamentos e aceite

Sessão: `claude-int-p11` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-18
Branch: `claude/p11-orcamentos` → PR para `main`. Decisões em `docs/adr/0013-orcamentos-e-aceite.md`.

## Resultado

- **Banco** (`20261018180000_p11_sales.sql`): `sales_quotes`, `sales_quote_versions` (append-only, hash do snapshot) e `sales_quote_decisions` (append-only, uma por orçamento). RLS só do dono; o hash do token fica fora da leitura. RPCs do dono (criar, revisar, gerar link, cancelar, listar, detalhar) e do link (ver, aceitar, recusar). Origem de reserva `quote`.
- **Edge Function `sales`**: rotas do dono pelo handler genérico; rotas do link anônimas, com o token no corpo e versão + hash obrigatórios no aceite e na recusa.
- **Contratos** (`_shared/contracts/sales.ts`): 9 operações e os eventos `sales.quote.accepted.v1` e `sales.quote.declined.v1`.
- **Tela** `/app/orcamentos`: rascunho com itens do catálogo ou livres, total recalculado no servidor, validade, horário proposto opcional, gerar/regerar link, revisar (nova versão), cancelar, histórico de versões e decisão. Página pública `/orcamento#t=…`: ver ≠ aceitar; aceitar ou recusar a versão vista; se o dono revisou, a versão nova aparece antes. A demonstração offline usa as mesmas regras e é rotulada.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Snapshot versionado | pgTAP: versão imutável (update → FORBIDDEN), revisão cria v2 com novo hash, revisão de versão velha → 409 |
| Aceite idempotente | pgTAP (repetição = mesma decisão e reserva) + concorrência: 5 aceites simultâneos → 1 decisão, 1 reserva, mesma resposta |
| Revalidar disponibilidade | pgTAP: horário ocupado depois do envio → SLOT_CONFLICT, orçamento segue aberto sem decisão; concorrência: dois orçamentos no mesmo horário → 1 aceito |
| Aceito não marca pagamento | pgTAP: 0 recebíveis/recebimentos após o aceite; teste de contrato proíbe escrita no caixa no aceite |
| Vinculado a versão/validade | pgTAP: hash errado/versão antiga → STALE_VERSION; vencido → 422; concorrência aceite × revisão (10 rodadas): nunca os dois |
| Entre tenants | pgTAP: dono B → 403/404, RLS 0 linhas, cliente com login → 403; cliente/serviço de B recusados em A |
| Replay e recuperação | chave igual → mesma resposta; payload diferente → IDEMPOTENCY_MISMATCH; token só na primeira resposta; novo link invalida o anterior |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npx vitest run` | 560/560 (novos: regras, demonstração, função `sales`, contratos) |
| `npm run build` | ok |
| `npx playwright test` | 105 passaram, 31 fixme (novo: `tests/e2e/sales`, desktop + mobile) |
| `deno check --frozen` | ok |
| `npm run db:test:local` (PG 16 + shim) | tudo ok (P11: 71 asserções) |
| `npm run db:test:concurrency` | P01, P03, P05, P06, P07, P08, P11 ok |

Dados: só os sintéticos do seed e das fixtures. Integração externa: nenhuma; o link é compartilhado manualmente.

## Decisões tomadas sem consulta (pedido do dono: "decida pelos docs")

- O P11 não estava no manifesto: o quadro só tem P00–P10, o P10 está pendente e `advance` exige a onda concluída. Não alterei o quadro; implementei por pedido direto do dono e registro aqui.
- Preço combinado da reserva = total do orçamento aceito (vários itens viram uma reserva do serviço do horário). Nenhuma regra do P05 é reaplicada no aceite.
- Validade máxima de 90 dias; expiração derivada, sem job.
- Só o dono gerencia orçamentos (staff não), como no caixa.

## Limitações e próximos passos

- Aceite é pelo link; aceite autenticado do cliente vinculado (P01) fica para depois.
- Sem envio automático (P12), follow-up (P13) ou sinal (P14). Os eventos de aceite e recusa já vão ao outbox, sem consumidor (o worker os conclui sem efeito).
- Staging: executar a jornada no projeto hospedado quando o gate de ambiente (ADR-0006) estiver pronto.
- Rollback: a migration é aditiva; reverter = tirar o módulo do front e as funções (as tabelas podem ficar).
