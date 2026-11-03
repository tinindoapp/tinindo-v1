# Handoff · P45 Insights proativos

Sessão: `claude-int-p45` (Claude Code na nuvem, para @fffalleiros) · 2026-11-03
Reserva: `coord.py claim P45 --session claude-int-p45` · branch `task/p45/claude-int-p45` → PR para `main`. Decisões em `docs/adr/0036-insights-proativos.md`. Plano em `docs/plano-assistente-configuracao-e-insights.md` §3.

## Resultado

- **Banco** (`20261103150000_p45_insights.sql`, append-only):
  - `insight_rules` (catálogo das nove regras, só por migration), `insight_runs` (uma rodada por negócio e dia local, backend-only), `insights` (um por negócio, regra e assunto) e `insight_digests` (um resumo por negócio e semana).
  - Nove funções de regra `app.gi_<código>(tenant, now)`, cada uma com `fire`/`quiet`/`insufficient` e motivo; `app.gi_run`, `app.gi_tick` (worker) e `app.gi_digest` (resumo por modelo fixo).
  - RPCs do dono: `insight_list`, `insight_snooze`, `insight_act`, `digest_list`.
  - Substituições documentadas: `public.jobs_run` (chama o motor), `app.ga_rules` (a regra de cobrança passa para o motor) e `app.ga_tick` (mede decisões do P45 pela própria regra).
  - P13, aditivo: régua `package_expiry` (agregado `package`) e modelo `pacote_vencendo`.
- **Edge Function `growth-advice`**: quatro rotas novas pelo `rpc-handler` (`insight.list`, `insight.snooze`, `insight.act`, `digest.list`).
- **Contratos** aditivos em `_shared/contracts/growth-advice.ts` (`Insight`, `InsightEvidence` com período, número e denominador obrigatórios, `InsightAction`, `InsightActResult`, `WeeklyDigest`), registro v1 (owner P45), `LifecycleRule` + `package_expiry`, docs/03, docs/10 (INS-01), release/CHECKLIST.
- **Telas**:
  - **Home**: cartão "Para você esta semana" com até 3 sugestões por prioridade, cada uma com a frase de evidência (período, número e denominador), **Ver** e **Agora não**. Fica logo abaixo do cartão "Deixe seu negócio pronto" do P44 (rebase sobre o #95). A linha antiga "N sugestões com base nos seus números" saiu das Pendências.
  - **Metas e sugestões** (`/app/metas`, renomeada; menu Crescer): "Sugestões para você" com as abertas (corpo, evidência, onde acontece, **Preparar**/**Ver** e **Agora não**), as decididas com o acompanhamento, e "O que a conta olhou" com o status de cada regra e o motivo do insuficiente. `?insight=<id>` destaca e foca a sugestão. Depois vêm Metas, Sugestões do mês (P22), Conteúdo e Resumo da semana.
  - **Mensagens**: o resumo semanal da Tinindo aparece no topo da caixa do dono. O app injeta o cartão (`src/app/OwnerDigest.tsx` + `InboxExtraProvider`), porque um módulo não importa outro.
  - **Demonstração** rotulada: o motor é emulado sobre a base de exemplo única (`demoInsights.ts`): faltas concentradas na quarta (5 de 12), sábado vazio das 9h às 14h (5 de 5 semanas), perfil 3 de 4; clientes sem retorno como insuficiente (só 4 clientes de retorno).

## Aceite do pacote (tasks/P45.md)

| Critério | Evidência |
|---|---|
| Nenhuma regra dispara sem dado suficiente (`insufficient` ≠ zero) | **pgTAP 32:** cada uma das nove regras com caso INSUFICIENTE (motivo), NEGATIVO e POSITIVO. **Integração:** `waitlist_opening` = `insufficient/no_waitlist`. **e2e:** "ainda sem dado suficiente (não é zero)" com o motivo |
| Nenhuma ação executa sem aprovação | **pgTAP 32:** Preparar (P05) → 1 proposta `proposed` e 0 regras ativas; Preparar (P13) → passos `manual`, 0 mensagens no canal; sem consentimento de marketing → pulado. **Contrato:** a migration não chama publicação de preço, envio, aprovação de campanha nem despacho da régua. **Integração** passo 2 |
| Todo insight mostra período e denominador | CHECK `evidence ?& array['period_start','period_end','numerator','denominator']`; contrato exige (handler devolve 500 sem denominador); pgTAP, integração e e2e conferem a frase |
| Duas rodadas do job não duplicam insight | **Concorrência `30_insights`:** 3 `jobs_run` simultâneos → 1 rodada por negócio, 1 insight por (regra, assunto), nenhum erro; 2 `gi_run` em paralelo → 1 insight; 2 "Preparar" simultâneos → 1 proposta (o outro `STALE_VERSION`). **pgTAP:** segunda rodada no dia avalia 0; `gi_run` repetido mantém 1. **Integração:** `insights.tenants` = 0 na segunda chamada |
| "Agora não" silencia por 30 dias | pgTAP (não volta no dia seguinte; passado o prazo e ainda disparando, volta), integração (`quiet_until` > 29 dias), e2e |
| Acompanhamento em 30 dias pelo `advice_decisions` | pgTAP: decisão `accepted`/`dismissed` com o número congelado; `ga_tick` mede a regra de novo → `improved` |
| Resumo semanal por modelo fixo | pgTAP (um por semana), integração (`digest.list`), e2e (Mensagens e Metas e sugestões) |
| Isolamento | pgTAP e integração: dono B → 403; RLS 0 linhas |

## Comandos e resultados (local, Postgres 16 + pgTAP)

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npm test` | unit 733 · contratos 807 (+38 opcionais do P46 pulados), com a main de 03/11 (P44 e P46) |
| `npm run db:test:local` | 31 arquivos ok (P45: 91 asserções; P22 atualizado: a regra de cobrança saiu de lá) |
| `npm run db:test:concurrency` | todos ok (novo `30_insights`, 11 verificações) |
| `npm run test:integration` | 24 arquivos, 142 testes (novo `47_p45_insights`, 5 passos) |
| `npx playwright test` | 267 passaram + `avisos.spec` corrigido (título novo) e reexecutado ok; 33 fixme preexistentes. Novo `growth-advice/insights.spec.ts` (desktop e celular) |
| **Regressão pega e corrigida** | o CHECK recriado de `lifecycle_steps.rule` tinha perdido `campaign` (P19); o pgTAP 18 e a concorrência do P19 acusaram; agora o pgTAP 32 guarda os valores anteriores |

Não executado aqui: `supabase test db` e `db lint` no PG 17 (sem Docker); rodam no CI.

## Decisões tomadas sem consulta (pedido do dono: "não pare para perguntar")

- **Quadro:** o P45 não estava no quadro; foi liberado pelo integrador no branch `coordination` (ação `release`, como P29/P31) e reservado pelo `coord.py`. Dependências registradas: P05, P06, P07, P13, P18, P22, P30, P31 (P44 ainda não está no quadro: o passo "perfil incompleto" abre a tela que resolve, e o cartão do P44 entra acima do de insights quando chegar).
- **Limiares** na tabela da ADR-0036 §2 (mudar é migration).
- **"Ver"** em sugestão de tela (Caixa, Lista de espera, Relacionamento, perfil) abre a tela e registra a decisão para o acompanhamento; em sugestão de proposta, abre a sugestão em Metas e sugestões, onde **Preparar** cria a proposta.
- **Preparar** reavalia a regra com o dado de agora e recusa se mudou (`stale`), em vez de propor com o número da madrugada.
- **Silêncio por regra**, não por assunto: "Agora não" numa faixa ociosa não traz outra faixa no dia seguinte.
- **Convites de retorno** exigem consentimento de marketing (é reativação, P13). **Aviso de pacote** é transacional (sobre algo que a cliente comprou), salvo oposição registrada.
- **Resumo semanal** só na caixa de Mensagens e em Metas e sugestões. O e-mail opcional fica para quando o envio por e-mail estiver ligado (recado #75); nenhum envio externo foi criado.

## Pendências e próximos passos

- P44 já está na main: o cartão de insights fica logo abaixo do "Deixe seu negócio pronto". Falta trocar a rota do passo "perfil incompleto" pela tela `/app/configurar` do P44, se o produto preferir.
- P46: frase de explicação do insight pelo modelo, a partir da evidência calculada (os números continuam do motor).
- E-mail opcional do resumo semanal quando o SMTP estiver ligado.
- P46 (já na main): `explainInsight` (`_shared/llm/tasks/explain.ts`) está pronto, mas não foi ligado. Ligar pede cache por versão do insight (senão a Home chamaria o modelo a cada abertura); com `LLM_PROVIDER=none` nada muda.
- Observado, fora do escopo: `tests/integration/44_p31_contas.test.ts` passo 1 é intermitente (repete o pagamento com `paid_at: new Date()`; se o segundo vira, o hash muda e dá `IDEMPOTENCY_MISMATCH`). Falhou 1 vez em 4 rodadas locais; fixar o `paid_at` resolve.
- Observado, fora do escopo: o contrato `LifecycleRule` não tem `campaign` (valor do P19 no banco); a lista de passos do P13 com passo de campanha falharia no contrato. Vale um ajuste aditivo no P13/P19.
- Homologação: nada aplicado. O projeto `kitdsdyydgutnbiwjblw` não foi tocado.

## Recuperação

A migration é aditiva, salvo três `create or replace` documentados (`jobs_run`, `ga_rules`, `ga_tick`). Para desligar o motor sem migration: o worker continua chamando `app.gi_tick`, mas a Home some sem quebrar se a leitura falhar; para tirar da tela, remover `<InsightsCard>` do `Home.tsx` e o `InboxExtraProvider` do `AppShell.tsx`.
