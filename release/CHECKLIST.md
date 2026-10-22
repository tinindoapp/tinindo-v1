# Checklist de liberação (P10)

Fluxo (docs/09): PR revisado → `main` → homologação → smoke → aprovação do responsável → release/tag → produção. Uma pessoa publica por vez. Nada aqui é automático: cada linha é marcada por quem executou, com evidência.

## 1 · Antes de abrir a janela

- [ ] `main` verde no CI (lint, typecheck, unit, contratos, build, deno, banco do zero + seed + pgTAP + lint de schema, concorrência, integração handler ↔ banco, ensaio de restore, e2e, gitleaks).
- [ ] Tag criada a partir do SHA aprovado (`vAAAA.MM.DD-N`); SHA do frontend e das funções anotados em `release/RELEASES.md`.
- [ ] Migrations novas desde a última tag listadas; todas aditivas (append-only). Nenhuma `drop`/`alter ... drop` sem plano de expansão → contração em releases separadas.
- [ ] Flags e valores padrão conferidos (`PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, `JOBS_SECRET` ≥ 32 caracteres; provedores externos desligados por padrão).
- [ ] Backup do ambiente alvo feito e restaurável (OPS-01 rodou neste release: tempo anotado).

## 2 · Homologação

- [ ] `supabase db push` no projeto de homologação; `supabase functions deploy` das 14 funções; cron do `jobs` ativo (1 min).
- [ ] Smoke manual com a conta técnica sintética: entrar → agenda → novo agendamento → caixa → orçamento pelo link → pergunta ao assistente. Nenhum dado real.
- [ ] `tests/e2e/qa` com `VITE_SUPABASE_URL` apontando para homologação (os roteiros UAT com servidor; hoje só a demonstração roda no CI).
- [ ] Logs das funções sem PII (amostra de 20 linhas): só `fn`, `route`, `request_id`, `status`, `ms`.

## 3 · Aprovação

- [ ] Responsável do release aprovou por escrito (nome, data, SHA).
- [ ] Limitações conhecidas comunicadas aos testadores (ver handoffs: sem reserva pelo link público, sem área da cliente, cobrança da Tinindo manual, lembretes ausentes).

## 4 · Produção

- [ ] Migrations aplicadas ANTES do deploy das funções e do frontend (docs/09).
- [ ] Deploy das funções; deploy do frontend; `release/RELEASES.md` atualizado.
- [ ] Smoke de produção com a conta técnica sintética (sem marketing ativo).
- [ ] Monitorar por 30 min: erros 5xx por função, backlog do outbox (`pending` mais antigo), dead-letter, 409 esperados vs falhas.

## 5 · Reversão

- Frontend: redeploy da tag anterior (não desfaz dados).
- Funções: redeploy da tag anterior; o backend tolera o frontend anterior (contratos aditivos).
- Banco: nunca `down migration` em produção. Correção para frente com nova migration; para dado corrompido, restore do backup em banco isolado e reconciliação manual (ver `RUNBOOK.md`).
- Gatilhos de reversão: dupla reserva, vazamento entre negócios, outbox parado > 15 min, taxa de 5xx > 2% por 10 min.
