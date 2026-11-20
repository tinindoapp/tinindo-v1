# Handoff · Publicação em um comando e homologação testável

Sessão: `claude-p51` (Felipe) · 2026-11-20 · parte do P58 do replanejamento ("Ambientes e publicação": publicação por script único). Pedido do Felipe para destravar o recado #109 do Gabriel.
Branch: `claude/kind-allen-m9zju9`. PR 1: scripts, documentação e CI. PR 2: e2e-staging atualizado.
Reserva: o P58 não está no quadro do `coord.py`; sem reserva, como P48 a P51.

**Nada foi publicado nem aplicado na homologação.** Esta sessão não tem as contas do Gabriel. Os scripts foram testados com `--conferir` e contra um Postgres local.

## Entregue (PR 1)

- `release/publicar.sh <ambiente> [--conferir]` (`npm run publicar -- homolog`): conferências → migrations (`supabase db push`, só as que faltam) → segredos das funções (gerados no terminal, nunca impressos) → 29 funções → cron (4 agendamentos; as rotinas dos módulos rodam pelo `job_ticks` e são listadas) → Worker (build com a chave pública e `wrangler deploy`, conferindo o commit em `version.json`) → smoke. Para no primeiro erro dizendo o passo.
  - Conferências antes de mexer: árvore limpa e na ponta da `main` (`EXIGE_MAIN`), nomes das migrations (`check-migrations.mjs`), nenhuma migration no ambiente que falte no repositório, e as novas depois da última aplicada.
  - Recusa publicar com `WHATSAPP_*`, `PSP_*` ou `FISCAL_PROVIDER_*` no ambiente (piloto só com simulados).
  - `--conferir`: só mostra, sem login nem vínculo; lê o ambiente se o computador já estiver vinculado.
  - wrangler fixado em `4.165.0` via `npx` (não virou dependência do app).
- `release/smoke.sh <ambiente> [--sha] [--desde]` (`npm run smoke -- homolog`): só lê. Reprova se faltar segredo obrigatório das funções, se `version.json` não for o commit publicado, se o bundle não apontar para o Supabase do ambiente, se faltar migration (ou houver uma a mais), se o catálogo do P51 não tiver 27/10, se uma rotina do `job_ticks` tiver 3+ falhas seguidas, se uma função não subir ou recusar a origem (CORS), se o cron não rodar em até 2 minutos ou se as respostas ao cron não forem 200.
- `release/preparar-uat.sh <ambiente> --cabeleireiro <id> --personal <id> [--tecnico <id>] [--desligar] [--conferir]` (`npm run preparar:uat`): confere a profissão de cada negócio, recusa negócio com canal real, liga (ou desliga) Mensagens por `app.module_admin_set` (auditado). Só aceita o id do negócio (nunca e-mail ou telefone) e mostra só contagens. Não cria nem altera dado de ninguém. Decisão: os negócios do UAT são criados pelas próprias pessoas, no cadastro (roteiro do UAT); o script não cria negócio.
- `release/ambientes/homolog.env` e `local.env` (só dados públicos). `release/lib/comum.sh` com o que os três scripts compartilham.
- `release/homolog-setup.sh` agora só repassa para `publicar.sh homolog`.
- `release/PUBLICAR.md` (passo a passo do Gabriel e "quando o smoke reprova"), `release/CHECKLIST.md` enxuto (A: obrigatório para o UAT; B: só para produção), `release/EMAIL-RESEND.md` revisado (tempos, ordem, tabela de sintomas), `release/P42-LIBERACAO.md` apontando para o comando novo.
- `docs/09`: "Checks obrigatórios do CI" (os cinco jobs, com os nomes exatos para a regra da `main`) e "Publicação em um comando".
- CI (`ci-app.yml`, job `banco`): passo "Publicação no banco local" roda `publicar.sh local` duas vezes (a segunda tem de dizer "nada a aplicar") e `publicar.sh homolog --conferir`. Comentário no topo lembrando que os cinco jobs são os checks obrigatórios.
- `package.json` (só scripts): `test:staging`, `publicar`, `smoke`, `preparar:uat`.

## Testes, comandos e resultados

| Comando | Resultado |
|---|---|
| `publicar.sh local` num banco novo (shim) | 51 migrations aplicadas; smoke ok (migrations, catálogo 27/10, job_ticks) |
| `publicar.sh local` de novo | "nada a aplicar" |
| Migration com carimbo anterior à última aplicada | parou no passo 1: "anterior à última já aplicada" |
| Migration no ambiente que não está no repositório | parou no passo 1: "publicou de outro branch" |
| Migration com erro de SQL | parou no passo 2 com o erro do Postgres; nada depois |
| `publicar.sh homolog --conferir` (sem vínculo) | plano completo dos 7 passos, nada alterado |
| `smoke.sh local` com build no ar | `version.json` igual ao HEAD: ok; com `--sha` errado: reprovou |
| `smoke.sh local` com uma rotina com 3 falhas | reprovou citando a rotina e o `last_error` |
| `preparar-uat.sh local` (conferir, ligar, profissão errada, não-uuid, desligar) | como esperado; 2 `module.enable` e 2 `module.disable` em `audit_events` |
| Passo novo do CI, rodado localmente | ok |
| `npm run lint` (sem a pasta local `.claude/`) · `typecheck` · `test:unit` (1010) · `test:contracts` (842) · `test:coord` | ok |

Não testado (exige as contas): `supabase secrets`, `functions deploy`, `db query --linked` com o cron e o Vault, `projects api-keys`, `wrangler deploy`, e as checagens HTTP do smoke contra o Worker e as funções hospedadas. O código desses passos é o mesmo do `homolog-setup.sh` que rodou em 27/10, mais o Worker.

## Pendências

- Issue #135 (`para-felipe`): as funções não expõem o SHA; o smoke só prova o commit do frontend.
- `docs/qa/UAT-PILOTO.md` (fora da área) ainda manda rodar `app.module_admin_set` à mão; o `npm run preparar:uat` faz o mesmo com conferência. Atualizar o roteiro na próxima passada.
- Regra da `main` no GitHub (exigir os cinco checks): configuração do repositório, documentada em `docs/09`; não alterada por esta sessão.
- Produção: falta `release/ambientes/producao.env` quando o projeto existir (D36).
