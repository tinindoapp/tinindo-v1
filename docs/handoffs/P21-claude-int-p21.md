# Handoff · P21 Indicação de colegas

Sessão: `claude-int-p21` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-23
Branch: `claude/p21-indicacao` → PR para `main`. Decisões em `docs/adr/0021-indicacao-de-colegas.md`. Onda 2, PR 6 (`docs/plano-onda-2.md`).

## Resultado

- **Banco** (`20261022160000_p21_referrals.sql`): `referral_activations` (adesão medida: awaiting_activity → eligible → rewarded; blocked com motivo), `referral_rewards` (append-only, crédito de franquia); `agent_quotas.bonus` + `bonus_period_start`; `app.ref_rules/ref_activity/ref_reward/ref_tick`; `jobs_run` e `agent_run_start` substituídos (aditivos); evento `referral.rewarded.v1`.
- **Edge Function `referrals`**: 2 leituras do dono pelo `rpc-handler` (painel e benefícios). O convite continua no `network` (P09); a avaliação e o benefício são do worker `jobs`.
- **Contratos** (`_shared/contracts/referrals.ts`), registro v1, `EventType`, docs/01, docs/03, docs/10 (REF-01), release/CHECKLIST (19 funções).
- **Tela** `/app/indicacoes`: regras do programa (lidas do painel), aviso "o benefício não é avaliação", resumo (convites, aceitos, benefícios, crédito do mês com franquia), convites com estado da adesão (contagens medidas) e benefícios. Link para gerar convites no Perfil. Demonstração com "Simular uso real do indicado".

## Aceite do pacote (tasks/P21.md)

| Critério | Evidência |
|---|---|
| Benefício só após adesão elegível (uso real medido) | pgTAP 17: aceite registra e não concede; 3 clientes + 2 concluídos → concede; int `34_p21` passos 1–2 |
| Fraude bloqueada (autoindicação, duplicidade, janela) | pgTAP 17: `same_tenant`, `duplicate` (primeiro aceito vence), `window_expired`; conc `17_referrals` (3 workers, dois convites do mesmo negócio → um benefício) |
| Um benefício por negócio indicado, idempotente | índice único parcial + `referral_id unique`; pgTAP (rodar de novo não concede); conc (rodadas repetidas) |
| Benefício só no mês; teto mensal | pgTAP: `agent_run_start` limite 200 + 50 no mês, 200 se o bônus é de mês passado; 10 no mês → elegível espera (`capped`) |
| Nunca avaliação | contratos: sem rating/score/ranking no SQL; tela e ADR; `checks` só contagens; painel sem nomes de clientes (pgTAP e int) |
| Autorização entre tenants | pgTAP 17 e int SEC: dono B 403; outsider 403; RLS 0 linhas |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` | ok |
| `npm run test:integration` | ok (novo `34_p21_indicacao`, 3 passos) |
| `npm run db:test:local` | ok (P21: 42 asserções) |
| `npm run db:test:concurrency` | ok (`17_referrals`) |
| `deno check --frozen` | ok |
| `npx playwright test` | ok (novo `tests/e2e/referrals`) |
| gitleaks | sem achados |

## Decisões tomadas sem consulta

- Limiares 3 clientes / 2 atendimentos concluídos / 60 dias / 50 perguntas / 10 por mês em `app.ref_rules()` (constantes; mudar é migration).
- Benefício só em crédito de franquia do assistente (P08), nunca dinheiro ou desconto: não mexe em Caixa nem em preço.
- Duplicidade: o primeiro convite aceito pelo negócio indicado vence; os demais ficam bloqueados com motivo visível ao convidante.
- Teto mensal não descarta: a adesão fica elegível e concede no mês seguinte.
- `referral_activations` sem política RLS (nem o dono lê direto): o painel expõe só o necessário.

## Pendências

- Nenhuma do pacote. Observação: a pgTAP `08_agent` tem uma asserção de tempo ("aprovação vale 15 minutos") que compara `clock_timestamp()` com `now()`; falhou uma vez numa rodada lenta e passou nas três repetições. Não foi alterada (fora do escopo); vale endurecer o teste num PR de manutenção.
