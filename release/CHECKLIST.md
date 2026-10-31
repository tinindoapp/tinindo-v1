# Checklist de liberação (P10)

Plano de execução do piloto (quem faz o quê, em que ordem): `P42-LIBERACAO.md`.

Fluxo (docs/09): PR revisado → `main` → homologação → smoke → aprovação do responsável → release/tag → produção. Uma pessoa publica por vez. Nada aqui é automático: cada linha é marcada por quem executou, com evidência.

## 1 · Antes de abrir a janela

- [ ] `main` verde no CI (lint, typecheck, unit, contratos, build, deno, banco do zero + seed + pgTAP + lint de schema, concorrência, integração handler ↔ banco, ensaio de restore, e2e, gitleaks).
- [ ] Tag criada a partir do SHA aprovado (`vAAAA.MM.DD-N`); SHA do frontend e das funções anotados em `release/RELEASES.md`.
- [ ] Migrations novas desde a última tag listadas; todas aditivas (append-only). Nenhuma `drop`/`alter ... drop` sem plano de expansão → contração em releases separadas.
- [ ] Flags e valores padrão conferidos (`PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, `JOBS_SECRET`, `MESSAGING_DISPATCH_SECRET`, `PAYMENTS_SYNC_SECRET` e `FISCAL_SYNC_SECRET` ≥ 32 caracteres, `MESSAGING_SIM_SECRET`, `PAYMENTS_SIM_SECRET`; provedores externos desligados por padrão: sem `WHATSAPP_*` só o canal simulado existe, sem `PSP_*` só o PSP simulado existe; sem `FISCAL_PROVIDER_*` só o provedor fiscal simulado (homologação) existe e nenhuma nota de produção sai; `PRESENCE_CNAME_TARGET` só quando houver domínio de sites configurado no ambiente).
- [ ] Backup do ambiente alvo feito e restaurável (OPS-01 rodou neste release: tempo anotado).

## 2 · Homologação

- [ ] `supabase db push` no projeto de homologação; `supabase functions deploy` de todas as funções de `supabase/functions` (26 em 27/10, com `resources` do P28 e `materials` do P30); cron do `jobs` (`X-Tinindo-Jobs-Secret`) (worker + réguas do P13 + renovação do P20 + indicações do P21 + fechamento de campanhas do P19 + acompanhamento de sugestões do P22), do `channel.dispatch` (`X-Tinindo-Dispatch-Secret`), do `payment.sync` e do `fiscal.sync` (`X-Tinindo-Sync-Secret`) ativos (1 min).
- [ ] E-mail do Auth pelo SMTP próprio (Resend em `mail.tinindoapp.com.br`), "Confirm email" religado e modelos em português de `supabase/templates/` colados no painel; cadastro, confirmação e "Esqueci minha senha" testados com e-mail novo, fora do spam do Gmail (roteiro: `EMAIL-RESEND.md`).
- [ ] Smoke manual com a conta técnica sintética: entrar → agenda → novo agendamento → caixa → orçamento pelo link → pergunta ao assistente. Nenhum dado real.
- [ ] `tests/e2e-staging` (desktop, iPhone WebKit, Android) passando contra a homologação; relatório anexado (ver o README da pasta).
- [ ] iPhone real conforme `docs/qa/IPHONE-SAFARI.md`.
- [ ] Ensaio de reversão e restore conforme `ENSAIO-ROLLBACK.md`, com tempos.
- [ ] Três testes com pessoas conforme `docs/qa/UAT-PILOTO.md`.
- [ ] P16: nenhum negócio com `production_enabled` sem caso homologado e decisão por escrito do dono do projeto (provedor fiscal contratado, termos revisados por contador).
- [ ] P23: rota pública `GET /functions/v1/discovery/page` (páginas por cidade e profissão) e moderação do diretório definida (quem suspende e como o dono contesta) antes de abrir ao público.
- [ ] P24: fila de moderação de denúncias com responsável e prazo, e processo de verificação de identidade (quem verifica, por qual meio) definidos antes de abrir avaliações ao público.
- [ ] P17: rota pública `GET /functions/v1/presence/page` servindo o site publicado (e o domínio do cliente apontando para ela, quando houver); revisar os textos da tela Site e Google antes de dado real.
- [ ] Logs das funções sem PII (amostra de 20 linhas): só `fn`, `route`, `request_id`, `status`, `ms`.

## 3 · Aprovação

- [ ] Responsável do release aprovou por escrito (nome, data, SHA).
- [ ] Limitações conhecidas comunicadas aos testadores (ver handoffs: reserva pelo link confirma por código que, sem WhatsApp ligado, sai só no canal simulado; a cliente vê as reservas em "Minhas reservas" mas não remarca nem cancela; cobrança da Tinindo manual).

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
