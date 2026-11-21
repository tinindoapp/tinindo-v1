# Ensaio de reversão e restore na homologação (P42)

Prova com o ambiente hospedado o que o CI já prova localmente: `npm run db:restore:drill` (OPS-01), `npm run ensaio:restore` (backup e restore do banco do ambiente, com o smoke no restaurado) e `npm run test:release` (reversão e travas). Complementa a seção B do `CHECKLIST.md`.
Roda só na **homologação**, nunca em produção. Anotar cada tempo na tabela do fim e anexar ao PR do P42.

## A · Backup e restore do banco (Felipe)

1. Gravar um dado de referência com a conta técnica pela tela: um agendamento "Ensaio restore" para amanhã às 10:00 e um recebimento de R$ 50,00. Anotar o horário.
2. Fazer o backup:
   - pelo painel do Supabase (Database → Backups) quando o plano tiver backup diário;
   - senão, com `npx supabase db dump --linked -f ensaio.sql` e `npx supabase db dump --linked --data-only -f ensaio-dados.sql`.
   - Guardar fora do repositório: o arquivo tem dado do ambiente.
3. Restaurar num **projeto isolado** (um segundo projeto vazio, nunca o mesmo) e depois rodar `psql "<url do isolado>" -f ensaio.sql -f ensaio-dados.sql`.
4. Conferir no isolado:
   - contagem de `bookings`, `customers`, `receivables` e `payments` igual à da homologação;
   - `select relname from pg_class where relrowsecurity = false and relnamespace = 'public'::regnamespace and relkind = 'r'` volta vazio;
   - o agendamento "Ensaio restore" e o recebimento de R$ 50,00 estão lá.
5. Apagar o projeto isolado e o arquivo do backup local.

## B · Reverter o frontend e as funções (Felipe)

1. Anote o SHA servido: `curl -s <STAGING_URL>/version.json`. O mesmo SHA está em "Versão publicada", no painel Saúde da operação.
2. Rode `npm run reverter -- homolog <sha anterior> --conferir` e confira o plano. Depois, rode sem `--conferir`. O script publica o frontend e as funções do commit anterior, anota a reversão e roda o smoke. No fim, mostra o tempo total.
3. Confira três coisas:
   - `/version.json` mostra o SHA anterior;
   - as funções respondem `X-Tinindo-Build` com ele (o smoke confere);
   - o login e a Agenda abrem.
4. Volte para o SHA atual: `npm run publicar -- homolog`. Depois, rode de novo o e2e de `tests/e2e-staging`, que tem de passar.

## C · Banco nunca volta (regra)

Não existe `down migration` em produção. O ensaio só confirma que a correção é para frente: uma migration nova, ou o restore em projeto isolado seguido de reconciliação manual (`RUNBOOK.md`).

## Gatilhos de reversão no piloto

- dupla reserva;
- dado de um negócio visível em outro;
- outbox parado por mais de 15 min;
- 5xx acima de 2% por 10 min;
- tela que diz que deu certo quando não deu.

Quem decide é o Felipe. Se ele não responder em 15 minutos, o Gabriel pode reverter o frontend (B.2) e avisar no grupo.

## Registro

| Passo | Quem | Data e hora | Tempo | Resultado |
|---|---|---|---|---|
| Local (CI), `ensaio:restore` | sessão P58 | 21/11/2026 | backup 0,3 s · restore 1,9 s · app de volta em 3,4 s | ok (banco do publicar local, 56 migrations) |
| Local (CI), `reverter.sh local` | sessão P58 | 21/11/2026 | 2 s (conferências, registro e smoke) | ok |
| A.2 backup | | | | |
| A.3 restore no isolado | | | | |
| A.4 conferência | | | | |
| B.2 reverter (frontend e funções) | | | | |
| B.4 de volta + e2e | | | | |
