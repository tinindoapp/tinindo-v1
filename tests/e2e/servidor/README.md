# Jornada do ciclo na tela, com gravação real (P59)

Fecha a lacuna 4 de `docs/qa/revisao-2026-11-10/25-testes.md`: o caminho **navegador → porta de servidor do frontend
(`src/features/*/serverPort.ts`) → handler de produção → Postgres** não tinha teste. O resto de `tests/e2e` roda
sobre a demonstração offline.

## Como rodar

```bash
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres
bash tests/e2e/servidor/run.sh                 # desktop e mobile
bash tests/e2e/servidor/run.sh --project=mobile
```

Precisa de um Postgres 16 com pgTAP (o mesmo de `npm run test:integration`) e do Chromium do Playwright. O `run.sh`:

1. cria um banco descartável (shim + migrations + seed), novo a cada execução;
2. faz o build do frontend com `VITE_SUPABASE_URL` apontando para o gateway, numa pasta temporária fora do repositório;
3. roda o Playwright com o config desta pasta, que sobe o gateway e o `vite preview` desse build;
4. apaga o banco e a pasta (`KEEP_DB=1` mantém o banco).

Portas: `E2E_SERVIDOR_PORT` (preview, 4373) e `E2E_GATEWAY_PORT` (gateway, 54390). O `npx playwright test` da raiz
ignora esta pasta (`testIgnore`).

## Peças

- `gateway.ts`: servidor Node que responde como um projeto Supabase e reutiliza `handlers`, `rpc` e `pool` de
  `tests/integration/harness.ts` (a montagem das funções não é duplicada).
  - `/auth/v1/token` (senha e renovação), `/auth/v1/user`, `/auth/v1/logout`: login dos usuários do seed, com a senha
    conferida no banco e um JWT HS256 de teste cujo `sub` é o id do usuário.
  - `/rest/v1/tenant_memberships`, `/rest/v1/tenants` e `/rest/v1/rpc/my_is_operator`: só o que a jornada chama,
    executado com o papel `authenticated` e os claims do usuário (RLS de verdade). Qualquer outro caminho responde
    **501**, e a jornada reprova se receber erro do gateway.
  - `/functions/v1/<módulo>/<op>`: o pedido segue para o handler de produção; o `sub` do JWT conferido vira o token
    que o harness espera.
- `iniciar-gateway.ts`: carrega o gateway pelo Vite (SSR), que resolve o alias `@contracts`. Não há dependência nova.
- `jornada-ciclo.spec.ts`: entrar → expediente dos sete dias → agendar (cliente novo) → atender → receber → Caixa →
  Retorno → recarregar e conferir → conferir no banco. Desktop usa a Barbearia Exemplo A; mobile, o Personal Exemplo B.
- `banco.ts`: SQL direto, só para o preparo e para a conferência final.

## O único preparo por SQL

A tela só agenda no futuro, e o banco só conclui depois do início (`scheduling_booking_complete`) e só conta "não
volta" depois de 30 dias. O teste agenda pela tela para amanhã ao meio-dia e então `moveBookingToPast` leva esse
agendamento para 35 dias atrás. Daí em diante tudo é pela tela.

## Relógio

O banco usa o relógio real e a jornada não depende do dia nem da hora: expediente nos sete dias, agendamento sempre
para amanhã ao meio-dia, visita movida para o meio-dia local de 35 dias atrás e totais conferidos por mês. Resta uma
janela de segundos por mês: virar o mês entre o toque em "Recebi" e a leitura do Caixa.

## O que esta jornada não prova

- **Auth real**: o login é simulado (sem GoTrue, sem confirmação de e-mail, sem expiração e rotação reais de token).
- **Runtime Deno**: os handlers rodam em Node, sem o `index.ts` de cada função, sem variáveis e segredos do ambiente.
- **CORS real**: quem libera a origem é o gateway; a lista de origens das funções em produção não é exercitada.
- **PostgREST real**: as três leituras de `/rest/v1` são SQL equivalente escrito à mão, com a mesma RLS.
- **Worker e canal**: nenhum cron roda; "Lembretes a mandar" fica vazio e nenhuma mensagem é enviada.
- **Stack Supabase**: o banco é Postgres com o shim de `scripts/db-local`, como na integração.
