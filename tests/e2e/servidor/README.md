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
  - `/auth/v1/token` (senha e renovação), `/auth/v1/user`, `/auth/v1/logout`: login, com a senha conferida no banco
    e um JWT HS256 de teste cujo `sub` é o id do usuário. E-mail não confirmado: 400 `email_not_confirmed`.
  - `/auth/v1/signup` e `/auth/v1/verify`: cadastro de conta nova em `auth.users`. Com a confirmação de e-mail
    **desligada** (padrão, o caso da homologação hoje) já devolve a sessão; **ligada**, devolve só o usuário e põe o
    link de confirmação numa caixa simulada. O link (`/verify`) confirma e volta ao app com os tokens no fragmento,
    como o GoTrue no fluxo implícito.
  - `/__teste/confirmacao` (POST `{ "ligada": true|false }`) e `/__teste/correio?para=<e-mail>`: controles que só a
    spec usa, para trocar o modo do cadastro e ler o link enviado. Não existem num Supabase de verdade.
  - `/rest/v1/tenant_memberships`, `/rest/v1/tenants`, `/rest/v1/tenant_onboarding`, as contagens (HEAD) de
    `provider_services`, `availability_rules` e `public_profiles` da Conta e as RPCs `my_is_operator`,
    `my_customer_links` e `my_bookings`: só o que as jornadas chamam, executado com o papel `authenticated` e os
    claims do usuário (RLS de verdade). Qualquer outro caminho responde **501**, e a jornada reprova se receber erro do
    gateway.
  - Despacho do canal (`E2E_GATEWAY_DESPACHO_MS`, 2000 ms no `playwright.config.ts` desta pasta): imita o cron do
    `messaging/channel.dispatch`, para o código do número e o da reserva pelo link chegarem ao Simulador.
  - `/functions/v1/<módulo>/<op>`: o pedido segue para o handler de produção; o `sub` do JWT conferido vira o token
    que o harness espera.
- `iniciar-gateway.ts`: carrega o gateway pelo Vite (SSR), que resolve o alias `@contracts`. Não há dependência nova.
- `jornada-ciclo.spec.ts`: entrar → expediente dos sete dias → agendar (cliente novo) → atender → receber → Caixa →
  Retorno → recarregar e conferir → conferir no banco. Desktop usa a Barbearia Exemplo A; mobile, o Personal Exemplo B.
- `jornada-primeiro-acesso.spec.ts`: negócio que nasce do zero. Criar conta (`/criar-conta`, confirmação desligada) →
  criar o negócio → Home com "Deixe seu negócio pronto · 0 de 7" → horários e serviço pelo cartão da Home,
  antecedência e perfil pela lista de `/app/configurar` → Mensagens ligado pelo operador e número simulado conectado
  pela tela → reserva pelo link `/p/<slug>` numa aba anônima com o código lido em Mensagens › Simulador → Atendido ›
  Recebi no Pix → Caixa → Retorno → conferir no banco (inclusive que nada nasceu em outro negócio). Desktop =
  cabeleireira; mobile (375 px) = personal trainer. Mais um teste curto, só no desktop, com a confirmação de e-mail
  ligada: a tela pede o link, entrar não passa, o link do e-mail abre o "Criar meu negócio".
  Respostas de erro já conhecidas ficam anotadas no relatório, não reprovam (lista `CONHECIDAS` na spec).
- `banco.ts`: SQL direto, só para o preparo e para a conferência final.

## Os preparos por SQL

Primeiro acesso: Mensagens é guardado no piloto (P51), e quem opera liga para o negócio com
`app.module_admin_set(<id>, 'messaging', true)`, como `release/preparar-uat.sh`; e a reserva pelo link (amanhã ao
meio-dia) vai para ontem ao meio-dia com `moveBookingToPast`, para poder ser concluída.

Ciclo: a tela só agenda no futuro, e o banco só conclui depois do início (`scheduling_booking_complete`) e só conta "não
volta" depois de 30 dias. O teste agenda pela tela para amanhã ao meio-dia e então `moveBookingToPast` leva esse
agendamento para 35 dias atrás. Daí em diante tudo é pela tela.

## Relógio

O banco usa o relógio real e a jornada não depende do dia nem da hora: expediente nos sete dias, agendamento sempre
para amanhã ao meio-dia, visita movida para o meio-dia local de 35 dias atrás e totais conferidos por mês. Resta uma
janela de segundos por mês: virar o mês entre o toque em "Recebi" e a leitura do Caixa.

## O que esta jornada não prova

- **Auth real**: login e cadastro são simulados (sem GoTrue, sem envio de e-mail, sem expiração e rotação reais de
  token); a confirmação de e-mail é a imitação do gateway.
- **Runtime Deno**: os handlers rodam em Node, sem o `index.ts` de cada função, sem variáveis e segredos do ambiente.
- **CORS real**: quem libera a origem é o gateway; a lista de origens das funções em produção não é exercitada.
- **PostgREST real**: as leituras de `/rest/v1` são SQL equivalente escrito à mão, com a mesma RLS.
- **Worker e canal**: só o despacho do canal simulado roda (o "cron" do gateway); o worker de jobs não, e "Lembretes a
  mandar" fica vazio no ciclo. Nenhuma mensagem sai para fora.
- **Stack Supabase**: o banco é Postgres com o shim de `scripts/db-local`, como na integração.
