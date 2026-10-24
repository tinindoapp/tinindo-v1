# Handoff · P24 Avaliações e verificação

Sessão: `claude-int-p24` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-24
Branch: `claude/p24-avaliacoes` → PR para `main`. Decisões em `docs/adr/0028-avaliacoes-e-verificacao.md`. Onda 3, PR 5 de 5.

## Resultado

- **Banco** (`20261024150000_p24_reputation.sql`): `reviews`, `review_reports`, `identity_verifications`; `app.rep_*` (regras, projeção pública sem autor, selos); RPCs do cliente, do dono, de moderação/identidade (service_role) e pública; `app.network_profile_json` passa a mostrar identidade verificada e avaliações (aditivo); evento `review.published.v1`.
- **Edge Function `reputation`**: 2 rotas do dono, 4 do cliente (sem negócio, com chave), 1 pública.
- **Contratos** (`_shared/contracts/reputation.ts`), registro v1, `EventType`, docs/01, docs/03, docs/10 (REP-01), release/CHECKLIST (25 funções).
- **Telas**: `/app/avaliacoes` (Clientes → Avaliações: selos, recebidas, responder, denunciar); `/avaliar` (cliente com login avalia); `/avaliacoes/:slug` (lista pública).

## Aceite do pacote (tasks/P24.md)

| Critério | Evidência |
|---|---|
| Experiências com vínculo verificável | pgTAP 23: só os 2 concluídos recentes do cliente vinculado; fora da janela, não concluído, nota inválida, repetido → recusados; terceiros e o próprio profissional → 404; int `40_p24` passo 1; conc `23_reputation` |
| Resposta | pgTAP/int: resposta publicada, nota intacta, versão; contrato: RPC só toca a resposta |
| Denúncia | pgTAP/int: denunciar não esconde; moderação com motivo; procedente oculta, improcedente mantém |
| Verificação de escopo; indicação, identidade e competência não se confundem | pgTAP: identidade só pela equipe; competência = falso (contrato só aceita falso); média só com 3+; perfil P09 reflete identidade e avaliações; indicações do P09 não entram |
| Autor protegido | pgTAP/int/handler: nenhuma leitura com o autor; contrato sem campos de autor |
| Autorização entre tenants | pgTAP e int SEC |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `tsc -b` · `build` | ok |
| `npx vitest run` | 917 ok |
| `npm run test:integration` | 97 ok (novo `40_p24_avaliacoes`) |
| `npm run db:test:local` | ok (P24: 40 asserções) |
| `npm run db:test:concurrency` | ok (`23_reputation`) |
| `deno check --frozen reputation/index.ts` | ok |
| `npx playwright test` | 143 ok (novo `tests/e2e/reputation`) |
| gitleaks | sem achados |

## Pendências

Nenhuma do pacote no código. Gates: moderação e verificação de identidade operadas por pessoas, política de avaliação publicada, P39 para competência.
