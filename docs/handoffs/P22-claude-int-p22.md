# Handoff · P22 Metas e conteúdo

Sessão: `claude-int-p22` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-23
Branch: `claude/p22-metas` → PR para `main`. Decisões em `docs/adr/0023-metas-e-conteudo.md`. Onda 2, PR 8 de 8 (`docs/plano-onda-2.md`).

## Resultado

- **Banco** (`20261022180000_p22_growth_advice.sql`): `goals` (meta mensal por indicador do P18; uma ativa por indicador e mês), `advice_decisions` (decisão por regra e mês, indicador congelado, acompanhamento em 30 dias), `content_templates` (9 textos aprovados por profissão, só por migration), `profile_contents` (apresentação publicada, um por negócio); `app.ga_*` (mês, indicador, progresso, regras, acompanhamento, render); `app.network_profile_json` ganha fonte para `bio` (P09, aditivo); `jobs_run` substituído; evento `content.published.v1`.
- **Edge Function `growth-advice`**: 8 operações do dono pelo `rpc-handler` (meta salvar/arquivar/listar; sugestões listar/decidir; conteúdo listar/publicar/despublicar).
- **Contratos** (`_shared/contracts/growth-advice.ts`), registro v1, `EventType`, docs/01, docs/03, docs/10 (GOL-01), release/CHECKLIST (21 funções).
- **Tela** `/app/metas`: metas com progresso (indicador, numerador/denominador, % do caminho, barra), sugestões com evidência e decisão ("Vou fazer"/"Agora não") e acompanhamento, conteúdo aprovado com prévia e publicação no perfil (bloqueio explicado quando fora do escopo). Demonstração com "Avançar 30 dias".

## Aceite do pacote (tasks/P22.md)

| Critério | Evidência |
|---|---|
| Recomendação se apoia em dado existente | pgTAP 19: sem atendimentos → nenhuma sugestão; com 10 atendimentos (3 faltas, 0 cobranças) → exatamente `charge_coverage,no_show_reminders,occupancy_campaign`, cada uma com denominador na evidência; contratos: migration sem provedor externo; int `36_p22` passo 2 |
| Progresso com denominador, insuficiente ≠ zero | pgTAP: faltas 3/10 = 0,30 com denominador 10; cobrança 0/7 = 0 com status `ok`; sem dado → `insufficient` e sem percentual |
| Aprendizado por resultado sem causalidade | pgTAP: decisão congela 0,30; 30 dias depois o worker mede de novo → `unchanged`; vocabulário dos vereditos sem "causa/efeito" (contratos, e2e) |
| Publicação pelo escopo autorizado (P09) | pgTAP: sem perfil → 422 `scope`; perfil sem `bio` → 422; outra profissão → 422; post → 422; com `bio` → publica e `network_public_profile` mostra; tirar o campo esconde; int passo 3 (projeção pública real) |
| Conteúdo pré-aprovado | só por migration (`authenticated` sem insert); 9 textos; prévia preenchida com dados públicos |
| Concorrência | conc `19_growth_advice`: duas metas iguais em paralelo → uma (recusa como regra); duas publicações → uma linha, versão 2; 3 workers → um acompanhamento |
| Autorização entre tenants | pgTAP 19 e int SEC: dono B 403; RLS 0 linhas |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` | ok |
| `npm run test:integration` | ok (novo `36_p22_metas`, 4 passos) |
| `npm run db:test:local` | ok (P22: 54 asserções) |
| `npm run db:test:concurrency` | ok (`19_growth_advice`) |
| `deno check --frozen` | ok |
| `npx playwright test` | ok (novo `tests/e2e/growth-advice`) |
| gitleaks | sem achados |

## Decisões tomadas sem consulta

- Metas só mensais (fuso do negócio) e só sobre nove indicadores do P18; `human_minutes` fora.
- Cinco regras fixas com limiares no SQL; mudar é migration. Nenhuma ação automática.
- Acompanhamento em 30 dias com tolerância de 2 pontos para "igual"; rótulo sempre "variação observada".
- Conteúdo publicado só como `bio` do perfil (fecha a lacuna do P09); posts são para copiar. Nada é postado em rede social.
- Textos aprovados por mim como integrador, neutros e sem promessa; revisão humana antes de dado real (release/CHECKLIST).

## Pendências

- Nenhuma do pacote. Onda 2 completa (P10-código, P12, P14, P13, P20, P21, P19, P22); gates externos continuam os do plano (Meta/BSP, PSP, projeto hospedado).
