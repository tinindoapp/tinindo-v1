# Handoff · P17 Presença digital (site, domínio e Google)

Sessão: `claude-int-p17` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-24
Branch: `claude/p17-presenca` → PR para `main`. Decisões em `docs/adr/0025-presenca-digital.md`. Onda 3, PR 2 de 5 (`docs/plano-onda-3.md`).

## Resultado

- **Banco** (`20261024120000_p17_presence.sql`): `presence_sites` (rascunho e estado), `presence_site_services` (serviços marcados), `presence_site_versions` (aprovações com hash, append-only), `presence_domains` + `presence_domain_checks` (domínio do cliente e cada consulta DNS, append-only), `presence_google_access` (gerente concedido/revogado), `presence_deliveries` (entregas com evidência, append-only); `app.prs_*`; RPCs do dono, a de backend (`presence_domain_record_check`, só service_role), a do operador (`presence_delivery_record`) e a pública (`presence_public_site`); eventos `presence.site.published.v1` e `presence.domain.verified.v1`.
- **Edge Function `presence`**: 9 operações pelo `rpc-handler`; `domain.check` (dono autoriza → DNS pela porta → backend decide); `presence.public_site` (anon) e `GET page` (HTML indexável).
- **Contratos** (`_shared/contracts/presence.ts`), registro v1 (11 operações), `EventType`, docs/01, docs/03, docs/10 (PRS-01), release/CHECKLIST (22 funções).
- **Tela** `/app/site` (Negócio → Site e Google): conteúdo, prévia, publicar/tirar do ar/voltar versão; domínio com o registro TXT e verificação (DNS simulado na demonstração); acesso ao Google; entregas. Página pública `/s/:slug`.

## Aceite do pacote (tasks/P17.md)

| Critério | Evidência |
|---|---|
| Publicação aprovada | pgTAP 20: hash diferente → 409, nada publicado; publicado = hash visto; repetir chave não cria versão; mesmo conteúdo com outra chave → 200 sem versão nova; int `37_p17` passo 1 |
| Publicação reversível | pgTAP: tirar do ar → leitura pública 404; voltar versão 1 → público vê a versão 1 como aprovada; perfil retirado derruba o site; int passo 2; e2e |
| Domínio do cliente | pgTAP: TXT errado → `not_found`; intervalo entre consultas (429); TXT certo → verificado e o nome abre o site; nome verificado por outro negócio recusado; corrida → um verificado, outro `taken`; domínio da Tinindo recusado; int passo 3 (DNS simulado no harness); conc `20_presence` |
| Evidência de entrega | pgTAP: entregas do site com versão/hash, do domínio com o registro observado; operador registra com link https; e2e lista |
| Sem garantia de ranking | contratos: nenhum campo/tipo com posição, nota ou ranking; HTML sem `aggregateRating`; faixa "Sem promessa de posição" na tela |
| Google por acesso delegado | pgTAP/int: sem acesso → 422; concedido → entrega do operador; não operador → 403; revogado → 422 |
| Só dados públicos | pgTAP e contratos: prévia sem piso, custo, clientes ou contatos; `app.prs_snapshot` não lê `customers`, `bookings`, `min_price_cents`, `estimated_cost_cents` |
| Autorização entre tenants | pgTAP e int SEC: dono B 403; RLS 0 linhas; anon sem painel |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `tsc -b` · `build` | ok |
| `npx vitest run` | 75 arquivos ok |
| `npm run test:integration` | ok (novo `37_p17_presenca`, 5 passos) |
| `npm run db:test:local` | ok (P17: 71 asserções) |
| `npm run db:test:concurrency` | ok (`20_presence`) |
| `deno check --frozen presence/index.ts` | ok |
| `npx playwright test` | 135 ok (novo `tests/e2e/presence`) |
| gitleaks | sem achados |

## Integração real vs. sandbox

- DNS: produção usa `Deno.resolveDns` (consulta real, sem credencial); testes e demonstração usam DNS simulado.
- Google: sem API conectada; operação manual da equipe registrada com evidência.
- Hospedagem por domínio do cliente (roteamento por host, TLS) não existe no repositório: pendência do dono (ADR-0025).

## Pendências

- Nenhuma do pacote no código. Gates externos: domínio de sites e roteamento por host, `PRESENCE_CNAME_TARGET`, conta da equipe no Google, revisão dos textos.
