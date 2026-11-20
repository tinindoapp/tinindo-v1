# Checklist de liberação

Duas listas: o que é **obrigatório agora**, para o UAT com o cabeleireiro e o personal na homologação, e o que fica **para produção** (antes de dado real fora de teste). Cada linha marcada por quem fez, com data e evidência (SHA, saída do comando, print sem dado pessoal). Como publicar: `PUBLICAR.md`.

## A · Obrigatório para o UAT (homologação)

### Antes de publicar

- [ ] `main` verde no CI, nos cinco checks obrigatórios (`docs/09`, "Checks obrigatórios do CI").
- [ ] `npm run publicar -- homolog --conferir` sem parada.
- [ ] `PAYMENTS_SIM_PAY` ausente no ambiente das funções (D22: o link não paga cobrança simulada fora da demonstração; `on` só de propósito).

### Publicar e conferir

- [ ] `npm run publicar -- homolog` terminou com "Smoke ok". SHA: ________
- [ ] Linha nova em `RELEASES.md` (o script imprime).
- [ ] `npm run test:staging` com `STAGING_REQUIRED=1` e `STAGING_WRITE=1` passando (`tests/e2e-staging/README.md`). Pulados: nenhum.
- [ ] E-mail do Auth pelo Resend, "Confirm email" religado e modelos em português colados; cadastro, confirmação e "Esqueci minha senha" testados com um e-mail novo, fora do spam (`EMAIL-RESEND.md`).
- [ ] Se alguém do UAT usa iPhone: uma abertura no Safari conforme `docs/qa/IPHONE-SAFARI.md`.

### Dia do UAT (`docs/qa/UAT-PILOTO.md`)

- [ ] Convite com as cinco regras: ambiente de teste com dados apagados ao fim; nenhuma mensagem sai sozinha; não mandar link de Pix a cliente; o código da reserva pelo link é ditado por quem conduz; clientes só com o primeiro nome ou fictícios.
- [ ] Depois que as duas pessoas criaram as contas: `npm run preparar:uat -- homolog --cabeleireiro <id> --personal <id>`.
- [ ] Número simulado conectado em Mensagens, nos dois negócios.
- [ ] Ao fim: `npm run preparar:uat -- homolog --cabeleireiro <id> --personal <id> --desligar`.
- [ ] Registro das duas sessões no handoff do P42.

### Gatilhos para parar o UAT

Dupla reserva, dado de outro negócio visível, smoke reprovado depois de publicar, ou mensagem que saiu sem a pessoa mandar. Parar, anotar a hora e avisar o Felipe.

## B · Só para produção (não bloqueia o UAT)

- [ ] Projeto Supabase de produção em plano com backup diário, na organização da empresa (D36), com `release/ambientes/producao.env` próprio.
- [ ] Repositório privado (D37) antes de contrato com provedor e de dado real.
- [ ] Ensaio de reversão e restore com tempos (`ENSAIO-ROLLBACK.md`; `npm run db:restore:drill` no CI cobre o banco local).
- [ ] Tag `vAAAA.MM.DD-N` do SHA aprovado; migrations desde a última tag todas aditivas (sem `drop` sem plano de expansão e contração).
- [ ] Termos, política, CNPJ, encarregado e canal (D27, issue #87); prazos de retenção (D25); exportar e eliminar por negócio (D26).
- [ ] Limite de abuso da reserva pública (D30) e cabeçalhos de segurança.
- [ ] Provedores reais: nenhum `WHATSAPP_*`, `PSP_*` ou `FISCAL_PROVIDER_*` sem contrato e decisão por escrito. P16: nenhum negócio com `production_enabled` sem caso homologado.
- [ ] Módulos guardados (P51) só voltam por negócio, quando o portão de cada um for cumprido: diretório com moderação (P23), avaliações com fila de denúncias e verificação de identidade (P24), site com a rota pública revisada (P17).
- [ ] Logs das funções sem PII (amostra de 20 linhas: só `fn`, `route`, `request_id`, `status`, `ms`).
- [ ] Monitorar 30 minutos depois de publicar: 5xx por função, `pending` mais antigo do outbox, dead-letter, `job_ticks` com falhas.
- [ ] Aprovação por escrito do responsável (nome, data, SHA).

## Reversão

- Frontend e funções: `git checkout <sha anterior> && EXIGE_MAIN=0 npm run publicar -- homolog`. Não desfaz dados.
- Banco: nunca `down migration`. Correção para frente com migration nova; dado corrompido: restore em banco isolado e reconciliação manual (`RUNBOOK.md`).
- Gatilhos: dupla reserva, vazamento entre negócios, outbox parado há mais de 15 minutos, 5xx acima de 2% por 10 minutos.
