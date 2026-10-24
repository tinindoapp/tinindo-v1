# Handoff · P23 Diretório e busca local

Sessão: `claude-int-p23` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-24
Branch: `claude/p23-diretorio` → PR para `main`. Decisões em `docs/adr/0027-diretorio-e-busca-local.md`. Onda 3, PR 4 de 5.

## Resultado

- **Banco** (`20261024140000_p23_discovery.sql`): `discovery_listings` (opt-in, cidade, mostrar dias, status e suspensão); `app.dsc_*` (critérios, endereço de cidade, cartão autorizado, ordem); RPCs do dono, de moderação (service_role) e públicas (busca e índice de cidades).
- **Correção** (`20261024141000_fix_first_save_race.sql`): primeiro salvamento em paralelo de `presence_site_save` (P17) e `fiscal_profile_save` (P16) agora devolve 409 em vez de vazar chave duplicada.
- **Edge Function `discovery`**: 2 operações do dono, 2 públicas e a página HTML indexável.
- **Contratos** (`_shared/contracts/discovery.ts`), registro v1, docs/03, docs/10 (DIR-01), release/CHECKLIST (24 funções).
- **Tela** `/app/diretorio` (Negócio → Diretório) e páginas públicas `/diretorio`, `/diretorio/:uf/:cidade/:categoria?`.

## Aceite do pacote (tasks/P23.md)

| Critério | Evidência |
|---|---|
| Só dados autorizados aparecem | pgTAP 22: sem nome público vale a área; nome privado, contatos e preços nunca saem; dias só com a opção; site só publicado; contrato: cartão sem contato/preço/nota; handler remove campo extra |
| Resultados refletem critérios documentados | pgTAP: ordem alfabética conferida; filtros por profissão, bairro e dia; UF diferente não mistura; critérios na resposta e na página; int `39_p23`; e2e |
| Opt-in e escopo do P09 | pgTAP/int: sem perfil publicado → 422; perfil retirado sai da busca |
| Moderação | pgTAP/int: backend suspende; dono não desfaz |
| Páginas indexáveis | handler e int: título, canônico, ItemList, sem nota |
| Concorrência | conc `22_discovery` (e P16/P17 corrigidos) |
| Autorização entre tenants | pgTAP e int SEC |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `tsc -b` · `build` | ok |
| `npx vitest run` | 892 ok |
| `npm run test:integration` | 93 ok (novo `39_p23_diretorio`) |
| `npm run db:test:local` | ok (P23: 31 asserções) |
| `npm run db:test:concurrency` | ok (`22_discovery`) |
| `deno check --frozen discovery/index.ts` | ok |
| `npx playwright test` | 141 ok (novo `tests/e2e/discovery`) |
| gitleaks | sem achados |

## Pendências

Nenhuma do pacote no código. Gates: moderação e contestação definidas, oferta local, roteamento das páginas no ambiente hospedado.
