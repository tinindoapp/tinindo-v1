# e2e contra a homologação (P42)

Roda o smoke do `release/CHECKLIST.md` (seção 2) no ambiente hospedado, em três telas: desktop, iPhone (WebKit) e
Android, e, com `STAGING_WRITE=1`, a jornada do piloto que **grava** no negócio da conta técnica sintética
(`docs/qa/UAT-PILOTO.md`).
Não roda no CI de PR, porque precisa da homologação no ar.

| Arquivo | O que faz | Grava? |
|---|---|---|
| `smoke.spec.ts` | build publicado (bundle, `/version.json`, chave secreta, SPA), funções (CORS), entrar com a conta técnica, Agenda e Clientes, configuração guiada (linha "Deixe seu negócio pronto · N de M" na Hoje e `/app/configurar`), aba Retorno, link público | Não: só lê e entra. Não dispensa passo da configuração |
| `jornada.spec.ts` | Atendido › "Recebi R$ X no Pix" e o valor em "Hoje" no Caixa; "Repetir toda semana" (prévia e confirmação); reserva pelo link público com o código do canal simulado | Sim, só com `STAGING_WRITE=1`, só no negócio da conta técnica, uma vez (projeto desktop) |
| `ambiente.ts` | variáveis e a regra de pular/falhar, comum aos dois | — |
| `local.sh`, `local-preparo.sql` | rodar tudo contra um ambiente local que imita a homologação (abaixo) | Só no banco descartável |

## Variáveis

| Variável | Obrigatória | O que é |
|---|---|---|
| `STAGING_URL` | sempre | Endereço do frontend de homologação. Sem ela a suíte nem começa |
| `STAGING_REQUIRED` | não | `1` torna obrigatórias todas as variáveis abaixo (ver "Modo obrigatório") |
| `STAGING_EXPECTED_SHA` | com `STAGING_REQUIRED=1` | Começo do SHA aprovado; confere `/version.json` |
| `STAGING_SUPABASE_URL` | com `STAGING_REQUIRED=1` | URL do projeto Supabase de homologação; liga a checagem das funções e do bundle (e, na jornada, a de respostas 5xx) |
| `STAGING_SUPABASE_PUBLISHABLE_KEY` | com `STAGING_REQUIRED=1` | Chave pública (publishable) do mesmo projeto |
| `STAGING_TECH_EMAIL` / `STAGING_TECH_PASSWORD` | com `STAGING_REQUIRED=1` | Conta técnica sintética (nunca conta de pessoa real) |
| `STAGING_PUBLIC_SLUG` | com `STAGING_REQUIRED=1` | Perfil publicado da conta técnica, para o link público |
| `STAGING_WRITE` | com `STAGING_REQUIRED=1` (valor `1`) | Liga a jornada que grava (`jornada.spec.ts`). Sem ela, a jornada pula e diz por quê |
| `STAGING_TIMEZONE` | não | Fuso do negócio técnico (padrão `America/Sao_Paulo`): o navegador da jornada usa esse fuso e a espera do "Atendido" é calculada nele |

A senha da conta técnica fica só no terminal de quem roda (ou no secret do CI). Não entra em arquivo versionado.

## Rodar

```bash
npx playwright install chromium webkit
STAGING_URL=https://homolog.exemplo npx playwright test -c tests/e2e-staging/playwright.config.ts
```

## A jornada que grava (`STAGING_WRITE=1`)

Roda uma vez, no projeto desktop, sem nova tentativa (repetir gravaria tudo de novo). Quatro testes, nesta ordem:

1. **Atendido (preparo):** no Novo agendamento, cadastra `Cliente Teste UAT <carimbo>` com WhatsApp `(11) 90000-NNNN`
   e agenda para hoje no **primeiro horário livre** (os horários andam de 15 em 15 minutos).
2. **Repetir toda semana:** cliente `Cliente Teste UAT <carimbo> semanal`, daqui a dois dias, no último horário livre,
   dia da semana dessa data, **2 semanas**. Confere a prévia das duas datas (a primeira livre; a segunda pode ficar de
   fora se outra execução ocupou) e que "Confirmar repetição" cria o número de livres; o cliente aparece na Agenda.
3. **Reserva pelo link:** confere que Mensagens está ligado e o número simulado conectado (se não estiver conectado,
   conecta pela tela: Mensagens › Conectar número, provedor simulado, número `+55 11 90009-NNNN`, código lido no
   Simulador). Numa aba anônima, `Cliente Teste UAT <carimbo> link` (`(11) 90001-NNNN`) pede o último horário livre
   do primeiro dia com vaga a partir de amanhã; o teste lê o código em Mensagens › Simulador digitando esse telefone,
   volta à aba pública, confirma e confere o pedido na Agenda.
4. **Atendido › Recebi no Pix:** espera o horário do passo 1 começar (relê a tela a cada 15 s), toca "Atendido",
   escolhe "Recebi R$ X no Pix" e confere que "Hoje" no Caixa subiu exatamente X. Se no passo 1 não havia horário
   livre hoje, usa um atendimento de hoje que já começou (Agenda de hoje com "Atendido").

O que fica gravado a cada execução, no negócio técnico: 3 clientes fictícios, 1 atendimento concluído com um
recebimento no Pix, 1 ou 2 agendamentos semanais e 1 reserva pelo link confirmada (e, na primeira vez, a conexão do
número simulado). Nomes e telefones levam o carimbo da execução, então rodar de novo no mesmo ambiente não colide.

**Tempo esperado: de 5 a 18 min**, quase todo de espera. O passo 4 espera o horário do passo 1 começar (até 15 min,
conforme a hora em que roda; os passos 2 e 3 correm nesse meio-tempo) e o passo 3 espera o cron do despacho do canal
(1 min) entregar o código, uma ou duas vezes. No ambiente local, de 11 a 14 min. A resposta em 5 minutos sobre a
homologação vem do smoke do `npm run publicar` (`release/PUBLICAR.md`); esta suíte é a conferência completa antes do UAT.

Pré-condições no negócio técnico (a jornada falha dizendo qual falta):

- expediente que **cubra a hora em que a jornada roda** (o primeiro horário livre de hoje tem de começar em até
  16 min) e os próximos dias, com ao menos um serviço com preço;
- perfil publicado com o link de reserva (`STAGING_PUBLIC_SLUG`);
- **Mensagens ligado**: o P51 deixou Mensagens guardado, e quem opera liga no SQL do Supabase de homologação, com a
  chave de serviço, `select app.module_admin_set('<id do negócio>', 'messaging', true);` (e desliga depois com
  `false`, como em `docs/qa/UAT-PILOTO.md`). Sem isso, o teste 3 falha com essa instrução; os outros seguem;
- cron do `messaging/channel.dispatch` ativo (`release/CHECKLIST.md`): sem ele, nenhum código chega ao simulador.

## Modo obrigatório (`STAGING_REQUIRED=1`)

Sem `STAGING_REQUIRED`, o passo que depende de uma variável ausente **pula** e mostra o motivo. Serve para o dia a dia, com o ambiente pela metade, mas um resultado verde assim não prova o que foi pulado: leia a lista de pulados.

Com `STAGING_REQUIRED=1`, variável ausente **falha**, e a mensagem diz qual falta: um teste lista todas de uma vez e cada passo que dependia dela falha também (funções, conta técnica, link público, SHA de `/version.json`, bundle apontando para o Supabase de homologação e a jornada que grava). É o comando para usar antes de liberar para o piloto (`release/CHECKLIST.md`, seção 2):

```bash
STAGING_REQUIRED=1 STAGING_WRITE=1 STAGING_URL=https://homolog.exemplo STAGING_EXPECTED_SHA=… STAGING_SUPABASE_URL=… \
  STAGING_SUPABASE_PUBLISHABLE_KEY=… STAGING_TECH_EMAIL=… STAGING_TECH_PASSWORD=… STAGING_PUBLIC_SLUG=… \
  npx playwright test -c tests/e2e-staging/playwright.config.ts
```

Para ver a falha sem ter homologação, aponte para o preview local (`npm run build && npx vite preview --host 127.0.0.1 --port 4173`) só com `STAGING_URL` e `STAGING_REQUIRED=1`: o comando tem de terminar com erro citando as variáveis ausentes.

O relatório fica em `playwright-report/staging/`. Uma falha em "funções" quase sempre é segredo faltando ou função sem deploy.

## Rodar sem a homologação (`local.sh`)

```bash
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres
bash tests/e2e-staging/local.sh                    # os três projetos
bash tests/e2e-staging/local.sh --project=desktop  # só o desktop
```

Usa o ambiente do P59 (`tests/e2e/servidor`): `run.sh` cria o banco descartável (shim + migrations + seed), aplica
`local-preparo.sql` (o negócio técnico local é a Barbearia Exemplo A do seed: expediente dos sete dias das 00:00 às
23:59, perfil publicado `tecnico-uat-local` e Mensagens ligado com `app.module_admin_set`; o número simulado **não** é
conectado, para a jornada conectar pela tela), faz o build apontando para o gateway e chama `local.sh --dentro`, que
sobe o gateway (com o despacho do canal a cada 5 s, `E2E_GATEWAY_DESPACHO_MS`, no lugar do cron) e o `vite preview` e
roda esta suíte com `STAGING_REQUIRED=1 STAGING_WRITE=1` e as variáveis apontando para eles. No fim, o banco e o build
são apagados; os logs do gateway e do preview ficam numa pasta temporária (o caminho sai no fim).
Portas: `E2E_SERVIDOR_PORT` (preview, 4573) e `E2E_GATEWAY_PORT` (gateway, 54590).

Isso valida a suíte, não a homologação: o gateway não é o Supabase (login simulado, sem PostgREST, sem runtime Deno,
CORS do próprio gateway; ver `tests/e2e/servidor/README.md`). O teste de CORS das funções, por exemplo, passa contra o
gateway sem provar nada sobre a lista de origens real.
