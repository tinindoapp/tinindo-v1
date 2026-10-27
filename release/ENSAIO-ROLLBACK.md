# Ensaio de reversão e restore na homologação (P42)

Prova com o ambiente hospedado o que o `npm run db:restore:drill` já prova localmente (OPS-01) e a seção 5 do `CHECKLIST.md`.
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

1. Anotar o SHA servido: `curl -s <STAGING_URL>/version.json`.
2. Publicar no Worker de homologação a tag anterior (Cloudflare → Deployments → Rollback, ou redeploy da tag).
3. Conferir que `/version.json` mostra o SHA anterior e que o login e a Agenda abrem.
4. Funções: `git checkout <tag anterior> && npx supabase functions deploy`. Os contratos são aditivos, então o frontend anterior continua funcionando.
5. Voltar para o SHA atual (frontend e funções). Rodar de novo o e2e de `tests/e2e-staging`, que tem que passar.

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
| A.2 backup | | | | |
| A.3 restore no isolado | | | | |
| A.4 conferência | | | | |
| B.2 frontend anterior | | | | |
| B.4 funções anteriores | | | | |
| B.5 de volta + e2e | | | | |
