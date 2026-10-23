# ADR-0021 · Indicação de colegas com benefício por uso real (P21)

Status: aceita · 2026-10-23 · integrador (onda 2, PR 6; plano em `docs/plano-onda-2.md`)

## Contexto

O P09 já tem o convite de colega (`professional_invites_peer`): link pessoal, enviado pelo próprio profissional, sem mensagem da Tinindo e sem avaliação. O P21 fecha o ciclo: quando o negócio indicado passa a usar a Tinindo de verdade, quem indicou ganha algo. O risco é virar "programa de pontos" (nota, ranking, posição) ou render por simples cadastro (fraude por autoindicação ou duplicidade). `docs/00` e `docs/17`: o benefício nunca é avaliação; o backend mede, não o usuário declara.

## Decisões

1. **Adesão elegível é medida, nunca declarada.** `referral_activations` (uma por convite aceito) nasce `awaiting_activity` e só vira `eligible` quando `app.ref_activity` mede no negócio indicado: ≥ 3 clientes e ≥ 2 atendimentos concluídos (`app.ref_rules()`: 3/2/60 dias/50 perguntas/10 por mês). As contagens ficam em `checks` (números, nunca nomes). Passados 60 dias do aceite sem uso real, `blocked/window_expired`.
2. **Um benefício por negócio indicado; autoindicação e duplicidade bloqueadas.** Índice único parcial em `invitee_tenant_id` para `eligible/rewarded`: dois convites aceitos pelo mesmo negócio rendem no máximo um (o primeiro aceito), o outro fica `blocked/duplicate`. Convite aceito pelo próprio negócio que convidou → `blocked/same_tenant` (o P09 já bloqueia o mesmo usuário; aqui vale o tenant).
3. **O benefício é crédito de franquia do assistente, só no mês.** `referral_rewards` (append-only, `kind = 'agent_questions'`, 50) soma em `agent_quotas.bonus` com `bonus_period_start`; `public.agent_run_start` (substituído por `create or replace`, aditivo: a franquia devolve `bonus`) considera o bônus só se for do mês corrente. Nada de dinheiro, desconto ou posição. Teto de 10 benefícios por negócio convidante por mês: o excedente fica `eligible` e entra na rodada seguinte do mês seguinte.
4. **O worker decide, de forma idempotente.** `app.ref_tick` roda em `public.jobs_run` (substituído de novo, como P13/P20): registra convites aceitos, avalia, concede sob `for update skip locked` + índice único; concorrência provada em `tests/db-concurrency/17_referrals.sh`. Cada benefício emite `referral.rewarded.v1` (aditivo em `EventType`); auditoria `referral.reward` guarda ids e quantidade, nunca nomes.
5. **Painel do dono, sem dados do negócio indicado.** `referral_dashboard` mostra os próprios convites com estado da adesão (contagens) e benefício; `referral_rewards_list` os créditos. `referral_activations` não tem política RLS (só o backend e a RPC leem); `referral_rewards` só o dono convidante. O convite continua sendo gerado no Perfil (P09): a tela `/app/indicacoes` linka para lá.

## Consequências

- `jobs_run` devolve também `referrals` (registered, eligible, rewarded, blocked, capped). Quatro responsabilidades por rodada: vale separar em crons quando houver volume.
- Os limiares (3/2/60/50/10) são constantes em `app.ref_rules()`; mudar é migration nova (`create or replace`), e a tela lê as regras do painel, não as repete.
- O P08 passa a devolver `bonus` na franquia; clientes antigos ignoram o campo (aditivo).
