# Handoff · P16 Fiscal seletivo (NFS-e num caso elegível)

Sessão: `claude-int-p16` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-24
Branch: `claude/p16-fiscal` → PR para `main`. Decisões em `docs/adr/0026-fiscal-seletivo.md`. Onda 3, PR 3 de 5 (`docs/plano-onda-3.md`).

## Resultado

- **Banco** (`20261024130000_p16_fiscal.sql`): `fiscal_profiles`, `fiscal_representations`, `fiscal_credentials`, `fiscal_documents`, `fiscal_document_events` (append-only); `app.fsc_*` (termos e hash, CNPJ/CPF, ambiente, elegibilidade); RPCs do dono, de backend (credencial, resultado da emissão e do cancelamento, consulta) e pasta do contador; evento `fiscal.document.authorized.v1`.
- **Edge Function `fiscal`**: 7 operações + `fiscal.sync` (cron); porta do provedor (`_shared/domain/fiscal/providers.ts`: simulado em homologação, REST desligado sem env).
- **Contratos** (`_shared/contracts/fiscal.ts`), registro v1, `EventType`, docs/01, docs/03, docs/10 (FSC-01), release/CHECKLIST (23 funções).
- **Tela** `/app/notas` (Dinheiro → Notas fiscais): passo a passo até elegível, lista primeiro com "Nova nota", cancelamento com motivo, pasta do contador com CSV.
- **Teste instável corrigido** (fora do pacote, mínimo): `08_agent` comparava `clock_timestamp()+15min` com `now()+15min` e falhava quando a transação passava de um segundo.

## Aceite do pacote (tasks/P16.md)

| Critério | Evidência |
|---|---|
| Validar elegibilidade | pgTAP 21: motivos explícitos; CNPJ por dígitos; Simples fora; credencial vencida → não elegível; int `38_p16` passo 1 |
| Validar representação | pgTAP/int: termos diferentes → 409; validade > 1 ano → 400; ativa só com o hash atual |
| Homologar um caso | pgTAP: sem caso homologado → homologação; homologado sem liberação → homologação; liberado pelo backend → produção (e exige credencial de produção); contrato: nenhuma RPC liga produção |
| Protocolo | pgTAP/int: autorizada exige número e protocolo; linha do tempo `submitting,unknown,authorized`; incerto consultado pela referência sem reenviar (int passo 3: 1 envio só) |
| Não dar baixa financeira | pgTAP: recebível `open:0` e nenhum recebimento após emitir e autorizar; contrato: migration não escreve em recebível/recebimento/caixa; conc `21_fiscal` |
| Autorização entre tenants | pgTAP e int SEC: dono B 403; RLS 0 linhas |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `tsc -b` · `build` | ok |
| `npx vitest run` | 877 ok |
| `npm run test:integration` | ok (novo `38_p16_fiscal`, 5 passos) |
| `npm run db:test:local` | ok (P16: 53 asserções) |
| `npm run db:test:concurrency` | ok (`21_fiscal`) |
| `deno check --frozen fiscal/index.ts` | ok |
| `npx playwright test` | 137 ok (novo `tests/e2e/fiscal`) |
| gitleaks | sem achados |

## Integração real vs. sandbox

- Provedor fiscal: só o simulado (homologação). Produção depende de provedor contratado (`FISCAL_PROVIDER_URL`/`FISCAL_PROVIDER_KEY`) e da liberação por negócio feita pelo backend.
- Dados de teste: CNPJ 11.222.333/0001-81 e CPF 123.456.789-09 (números de exemplo, sintéticos).

## Pendências

- Nenhuma do pacote no código. Gates externos: provedor fiscal, revisão dos termos, cron do `fiscal.sync`, decisão de produção.
