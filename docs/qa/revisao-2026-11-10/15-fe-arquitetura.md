# 15 · Arquitetura do frontend

Auditoria de 10/11/2026 sobre `main` em `8e113c4`. Somente leitura. Scripts, medidas e a captura ficam em
`auditoria-local/trabalho/fe-arquitetura/`.

## Resumo

**Veredito: misto.** O esqueleto está no tamanho certo; o meio está simples demais; a demonstração está exagerada.

- **Certo e para manter:** sessão em 127 linhas, cliente de API em 89 linhas com validação zod, registro central de módulos, zero import entre módulos, kit de formulário usado em 240 campos, 0 divergência entre as 226 rotas chamadas e o registro de contratos.
- **Simples demais:** `src/lib` tem três utilitários. Sem camada comum, cada um dos 27 módulos copiou o seu kit: 12 leitores de dinheiro com 5 comportamentos, 18 `formatCents`, 24 geradores de chave, 42 `createApiClient`, 15 buscas a `/context`. Não há cache, revalidação nem divisão do pacote (1,59 MB num arquivo).
- **Exagerado:** a demonstração offline são 6.007 linhas (19% do código) que reescrevem as regras do servidor no navegador. Ela vai para o pacote de produção (13,9%) e é o único alvo dos 52 arquivos e2e; só 1 dos 24 `serverPort` tem teste.
- **Defeito novo, confirmado na tela:** digitar `10.50` em Contas a pagar grava R$ 1.050,00; no Caixa, o mesmo texto vale R$ 10,50.
- **Ordem recomendada:** rede de proteção, dinheiro, chave de idempotência, ponto único de API e contexto do negócio, camada de dados, manifesto de módulo com carregamento por rota. Migrar só os módulos que sobrarem da decisão de escopo.
- **Decisão dos donos:** o que fazer com a emulação da demonstração (recomendo congelar e reduzir ao ciclo central).

## 1. O padrão de porta, módulo por módulo

Medido com `ls` e `wc -l` por pasta (linhas sem teste).

| Formato | Módulos | Observação |
|---|---|---|
| Trio `port.ts` + `serverPort.ts` + `demoPort.ts` + `module.tsx` | agent, analytics, campaigns, discovery, field-service, finance, finance-advanced, fiscal, growth-advice, lifecycle, materials, messaging, payments, presence, pricing, recurrence, referrals, reputation, resources, sales, service-ops, setup, waitlist (23) | Padrão dominante. `port.ts` de 13 a 58 linhas, `serverPort.ts` de 19 a 91, `demoPort.ts` de 66 a 357 |
| `port.ts` + `serverPort.ts` + `fixturePort.ts` | scheduling | `fixturePort.ts` com 545 linhas, mais `demoData.ts` e `demoCustomerBookings.ts`; contexto e hook próprios em `SchedulingLayout.tsx`; único com `serverPort.test.ts` |
| `api.ts` único | crm (247 linhas), network (451 linhas, mais `useNetworkApi.ts` e `demo-slots.ts`) | Interface, servidor e demonstração no mesmo arquivo. No CRM a demonstração é só leitura (`api.ts:158-165`) |
| `services.tsx` com supabase-js direto | identity | Tabelas, RPC e autenticação sem passar por `client.ts` |

Desvios dentro do trio:

- `finance/module.tsx:18` e `scheduling/SchedulingLayout.tsx:29` exportam `getDemoPort` para a tela Hoje.
- payments, sales e waitlist têm uma segunda porta para o link público.
- payments, lifecycle e messaging buscam `/context` no `module.tsx`; os outros, no `serverPort`.
- growth-advice tem `demoInsights.ts`; setup exporta `useSetupPort` e `SetupCard`; messaging exporta `unread.ts` e `InboxExtraProvider` para o shell.

Os quatro módulos fora do padrão são os mais antigos e os do núcleo do piloto (conta, clientes, agenda, perfil). Nenhum ADR descreve o padrão; só 0008, 0009 e 0010 citam "emulação".

## 2. A demonstração: quanto custa e quanto vai para produção

| Medida | Valor | Como medi |
|---|---|---|
| Arquivos dedicados | 30 | `demoPort.ts` (23), `fixturePort.ts`, `demoData.ts`, `demoCustomerBookings.ts`, `demo-slots.ts`, `demoInsights.ts`, `lib/demo/dataset.ts`, `lib/demo/journey.ts` |
| Linhas dedicadas | 6.007 de 31.585 (19,0%) | `wc -l`; não conta os trechos dentro de `crm/api.ts:145-217`, `network/api.ts:179-451` e `identity/services.tsx` |
| Testes da emulação | 1.537 linhas em 25 arquivos (21% dos testes de `src`) | `demoPort.test.ts`, `fixturePort.test.ts`, `lib/demo/*.test.ts` |
| `serverPort.ts` | 1.407 linhas em 24 arquivos, 1 com teste | `ls src/features/*/serverPort.test.ts` |
| No pacote | 185.066 bytes (11,6%) | sourcemap do `dist` (`bundle-attr.cjs`) |
| Motor do assistente, só por causa da demonstração | 36.541 bytes (2,3%) | `agent/demoPort.ts:7-10` importa `runAgent` |
| Total só de demonstração no pacote | 221.607 bytes (13,9%) | soma |

Fatos:

- O ADR-0006, linha 19, decidiu que sem Supabase "o app roda offline com fixtures e não grava nada". Só Clientes e Conta seguem isso (`crm/api.ts:158-165`, `identity/services.tsx:37`). Os 23 `demoPort`, o `fixturePort` da Agenda e `network/api.ts` têm estado mutável e emulam gravação e regra.
- Em produção o código é morto: `env.ts:27-29` exige Supabase, e cada `module.tsx` só cria a porta de demonstração sem Supabase. O import é estático e a condição é de tempo de execução, então o empacotador não descarta (inferência; não gerei build de produção).
- `playwright.config.ts:18-19` serve o `dist` sem variáveis: todo e2e roda em demonstração.
- O primeiro passo do ciclo central (cadastrar cliente) fica desabilitado na demonstração (`CustomersPage.tsx:120-236`), enquanto fiscal, materiais e domicílio gravam.

Vale o custo? Como está, não. Cada operação nova é escrita duas vezes, e o teste protege a cópia. Formas mais baratas, em ordem de esforço:

1. **Tirar do pacote de produção** com `import()` dinâmico da porta de demonstração (meio dia, sem decisão).
2. **Congelar e reduzir** (recomendada): gravação emulada só no ciclo central; nos demais, leitura de exemplo validada pelo contrato e gravação desabilitada, como o CRM já faz. Nenhum `demoPort` novo. Ordem de grandeza: 3 mil linhas a menos.
3. **Negócio de exemplo no backend real**, recriado por semente, quando a homologação (issue #74) estiver em dia. A emulação offline fica só como leitura. Ordem de grandeza: 5 mil linhas a menos.

Um adaptador único de contrato com dados de exemplo (uma função `call` falsa que responde por nome de operação) serve bem para leitura: os dados passam pelo schema de saída de `OPERATIONS`. Para gravação com regra ele não economiza nada, porque a regra continua tendo de ser reescrita.

## 3. Carregamento de dados

Medido em `src`, sem testes:

| Item | Valor |
|---|---|
| `useEffect` em `src/features` | 90 |
| `useState` em `src/features` | 676 (0 `useReducer`) |
| Guardas manuais `let alive / cancelled` | 64 |
| Estados `nonce` para recarregar | 29 |
| `AbortController` | 0 |
| `visibilitychange`, `focus`, `online`, `setInterval` | 0 |
| Cache entre telas | nenhum |

Três jeitos de carregar convivem:

- efeito com guarda (`referrals/ReferralsPage.tsx:27-36`), a maioria;
- `useEffect(load, [load])` sem guarda (`field-service/FieldPage.tsx:105-109` e `315`, `setup/SetupPage.tsx:202` e `274`);
- `setTimeout(load, 0)` (`crm/ServicesPage.tsx:95-98`).

Só a Agenda tem hook próprio: `useAsync(chave, carregar, manterEnquantoRecarrega)` em `scheduling/SchedulingLayout.tsx:95-116`, com guarda de corrida e `reload`. É o desenho certo e já está testado pelo uso.

Dados de referência são baixados de novo por módulo:

- laço de paginação de clientes (até 10 páginas de 100) em `scheduling/serverPort.ts:54-60`, `sales/serverPort.ts:36`, `finance/serverPort.ts:36-43`, `recurrence/serverPort.ts:32`, `waitlist/serverPort.ts:38`, `resources/serverPort.ts:36`, além do CRM;
- lista de serviços em 9 `serverPort`;
- `/context` em 15 pontos;
- em `finance/serverPort.ts:32-43`, contexto, serviços e clientes são pedidos em série antes de o Caixa aparecer;
- o selo de não lidas baixa a caixa de entrada inteira a cada troca de rota (`messaging/unread.ts:27-37`).

Corrida real encontrada: `FieldPage.tsx:105-109` (roteiro do Domicílio por dia, sem guarda).

**Camada única: vale.** Custo e benefício das duas opções:

| | Própria e pequena | TanStack Query |
|---|---|---|
| Código novo | cerca de 150 linhas (`useResource` a partir do `useAsync` existente, mais um provedor de dados do negócio) | dependência nova, cerca de 13 KB em gzip |
| Corrida, recarregar, manter dado ao recarregar | sim | sim |
| Cache de contexto, serviços e clientes | sim, no provedor | sim |
| Revalidar ao voltar para a aba | acrescentar (10 linhas) | pronto |
| Invalidação fina entre telas | manual, por evento | pronto |
| Encaixe com portas e testes atuais | direto (porta continua igual) | precisa de provedor nos testes e um idioma novo |

Recomendo a própria. O app tem poucas leituras por tela, as portas já devolvem promessa e os testes injetam porta. Biblioteca só se, depois disso, ainda faltar invalidação entre telas.

## 4. Estado global, erro, rotas, tipos, formulários, datas, dinheiro, idempotência

**Sessão e negócio escolhido.** `session.tsx` (127 linhas, Context) está no tamanho certo. Falta o contexto do negócio: fuso, papel e profissão não estão na sessão. `/context` já devolve `role`, `tenant_name`, `timezone` e `currency` (`contracts/context.ts:32-39`), mas a sessão lê `tenant_memberships` direto (`session.tsx:40-53`). Três `module.tsx` começam com `tenantA.timezone`, uma fixture, e engolem a falha (`payments/module.tsx:21,32`, `lifecycle/module.tsx:19,30`, `messaging/module.tsx:21,32`).

**Fronteira de erro.** Uma só, na raiz (`router.tsx:23`). Exceção de tela troca a página inteira por "Algo deu errado. Recarregue" (`Fallbacks.tsx:17-29`), sem o menu. Na demonstração, recarregar apaga o estado.

**Roteamento.** `modules.ts` e `router.tsx` importam os 27 `module.tsx` de forma estática. Resultado: `index-BAq6pvoJ.js` com 1.589.139 bytes (447.216 em gzip). Divisão por origem:

| Origem | Bytes | Parte |
|---|---|---|
| `src/features` | 788.812 | 49,6% |
| react-dom | 207.546 | 13,1% |
| supabase-js e dependências | 214.671 | 13,5% |
| zod | 94.644 | 6,0% |
| react-router | 92.849 | 5,8% |
| contratos | 64.623 | 4,1% |
| `src/app`, `src/components`, `src/lib` | 57.153 | 3,6% |

As rotas públicas (`/pagar`, `/oferta`, `/orcamento`, `/p/:slug`, `/s/:slug`, `/avaliar`, `/diretorio`) usam o mesmo arquivo. O realtime do Supabase (56 KB) entra sem uso (`.channel(` não aparece em `src`).

**Módulo não importa módulo.** Respeitada: 0 import cruzado. A regra do lint cobre só `src/features`; `src/app` importa o interior dos módulos (`Home.tsx:11-25` puxa 13 arquivos de 4 módulos; `AppShell.tsx:6,10`). Onde a regra gerou cópia, por falta de camada comum:

| Cópia | Quantidade |
|---|---|
| `formatCents` | 18 definições |
| Leitores de dinheiro | 12, com 5 comportamentos |
| `formatDate` / `formatDateTime` | 9 / 7 |
| `Intl.DateTimeFormat` | 76 instâncias em 35 arquivos |
| Tradução de erro (`explain`, `errorMessage`) | 26 arquivos |
| Texto "Tentar de novo é seguro" | 23 arquivos |
| Geradores de chave | 24 (22 `newKey`, 2 `newIdempotencyKey`) |
| `createApiClient(` | 42 |
| Mensagem "Selecione um negócio" | 25 |
| Leitura do token do link público | 3 cópias de 21 linhas |

jscpd 4.x: 121 clones, 107 entre módulos (928 linhas, 2,96%). Com mínimo de 30 tokens: 405 clones, 6,94%. Por tipo: 39 entre `demoPort`, 34 entre `module.tsx`, 28 entre telas, 11 entre `labels`/`format`, 6 entre `serverPort`.

**Fronteira de tipos com o servidor.** Boa. `@contracts` é uma fonte só, e a resposta é validada em tempo de execução. O que falta: o cliente não usa o registro `OPERATIONS` (`operations.ts:62-71`). Rota, corpo e saída são reescritos à mão em 226 pontos, com `body: unknown` (`client.ts:39`) e chave opcional (`client.ts:41`). Há ainda quatro leituras diretas por supabase-js sem contrato (`session.tsx:41-52`, `identity/services.tsx:132-170`, `crm/module.tsx:34`, `network/useNetworkApi.ts:29`). E quatro arquivos importam domínio do servidor por caminho relativo (`agent/demoPort.ts:7-10`, `setup/SetupPage.tsx:10`, `pricing/demoPort.ts:19`, `pricing/PricingPage.tsx:6`).

**Formulários.** Há padrão e ele é bom: `Field`, `useFormErrors` e `focusFirstInvalid` em `components/ui/form.tsx`. 240 `<Field>` contra 25 `<input>` soltos; 68 formulários com `noValidate` e erro por campo. Manter.

**Datas e fuso.** As funções recebem `timeZone` explícito (160 referências), o que está certo. O problema é só a cópia (16 formatadores) e a origem do fuso (acima).

**Dinheiro.** Centavos inteiros no transporte, certo. A leitura do que a pessoa digita é o defeito principal desta área. Saída das funções reais (`money-parse.mjs`):

| Leitor | `10,50` | `10.50` | `1.234` | `R$ 60,00` | vazio |
|---|---|---|---|---|---|
| `finance/money.ts`, `crm/format.ts` | 1050 | 1050 | inválido | 6000 | null |
| `sales/rules.ts` | 1050 | null | 123400 | 6000 | null |
| `setup/labels.ts` | 1050 | 105000 | 123400 | 6000 | null |
| `materials/labels.ts` | 1050 | 105000 | 123400 | NaN | NaN |
| `finance-advanced/labels.ts` e 4 telas | 1050 | 105000 | 123400 | NaN | 0 |

Confirmado na interface (`money-ui.cjs`, saída em `money-ui.out.txt`, recorte em `money-contas-linha.png`): em `/app/contas`, "Valor (R$)" = `10.50` cria a linha "Teste auditoria vence 20/10/2026 · Outras despesas R$ 1.050,00". Oito leitores usam `Math.round(Number(...) * 100)`, contra o ADR-0004 ("nunca float"). O `setup` lê os preços dos serviços na configuração inicial.

**Idempotência.** Já apontada no consolidado de 04/11 (item 1). A causa é de arquitetura: 24 geradores de chave, três implementações de chave por conteúdo (`finance/FinancePage.tsx:84`, `crm/api.ts:234`, `identity/idempotency.ts:5`) e 159 de 165 chamadas gerando a chave no clique.

## 5. Desenho alvo (uma página)

```
src/
  main.tsx
  app/                      casca: sessão, rotas, navegação
    session.tsx             login + negócio escolhido + contexto do negócio (fuso, papel, profissão) via /context
    api.tsx                 ApiProvider: UM cliente; useApi() → { modo, call, op, tenantId }; usePort(fábricas); ModuleGate
    tenant-data.tsx         serviços e clientes do negócio: uma busca, reaproveitada, invalidada por evento
    modules.ts              lista de manifestos (id, path, navLabel, lazy, publicRoutes, widgets, badge)
    router.tsx              rotas por lazy(); errorElement por módulo
    navigation.ts, AppShell.tsx, pages/Home.tsx (só consome widgets do manifesto)
  lib/                      núcleo comum, sem React de tela e sem conhecer módulo
    api/client.ts           call (atual) + op(nome, entrada, {key}) tipado por OPERATIONS
    data/useResource.ts     estado, corrida, reload, revalidar no foco (vem do useAsync da Agenda)
    idempotency.ts          useCommandKey, useCommand
    money.ts  dates.ts  errors.ts  public-link.ts  text/plural.ts
  components/ui/            kit visual e de formulário (como está)
  features/<módulo>/
    module.ts               manifesto, sem importar tela
    routes.tsx              telas, carregadas por rota
    port.ts                 interface da porta (tipos de @contracts)
    serverPort.ts           implementa a porta com op()
    demoPort.ts             carregado por import() dinâmico; só onde a decisão da demonstração mantiver
    labels.ts               só rótulos do domínio
    *Page.tsx
supabase/functions/_shared/contracts   → @contracts
supabase/functions/_shared/domain      → @domain (funções puras permitidas)
```

Regras (todas verificáveis por lint ou teste):

1. `features/x` não importa `features/y` (já existe).
2. `app` só importa `features/*/module.ts`.
3. `lib` não importa `app` nem `features`.
4. `crypto.randomUUID` e `createApiClient` não aparecem em `features`.
5. Dinheiro, data, erro e chave só por `lib`.
6. Código do servidor só por `@contracts` e `@domain`; caminho relativo para `supabase/` é proibido.
7. Toda leitura de tela passa por `useResource`; toda gravação, por `useCommand`.
8. `demoPort` nunca é import estático.
9. Teto de tamanho para o pedaço inicial, conferido no CI.

## 6. Refatorações em ordem de dependência

| # | O que | Arquivos | Risco | Teste que protege | Depende de |
|---|---|---|---|---|---|
| R0 | Rede de proteção: teste genérico de `serverPort` contra `OPERATIONS`; um e2e do ciclo central contra o Supabase local; teto de pacote | `tests/contracts`, `tests/e2e`, `playwright.config.ts` | baixo | os próprios | nada |
| R1 | `lib/money.ts` único e correção do defeito | 12 leitores e 18 `formatCents` listados no achado 01 | baixo | `money.test.ts` movido, mais a tabela de entradas | nada |
| R2 | `lib/idempotency.ts` (`useCommandKey`, `useCommand`), troca das 159 chamadas, lint | `features/*/port.ts`, telas, `eslint.config.js` | médio | `useKeyFor.test.tsx` movido, caso "erro e novo toque", scripts de concorrência existentes | nada |
| R3 | `lib/dates.ts`, `lib/errors.ts`, `lib/public-link.ts` | `features/*/labels.ts`, `format.ts`, 3 páginas de link | baixo | testes unitários de labels/format movidos | nada |
| R4 | `app/api.tsx`: um cliente, `useApi`, `usePort`, `ModuleGate` | 25 `module.tsx`, `Home.tsx`, `unread.ts` | médio | `AppShell.test.tsx`, testes de módulo, e2e | R0 |
| R5 | Contexto do negócio na sessão; remover 15 buscas a `/context` e a fixture de fuso | `session.tsx`, `serverPort.ts`, 3 `module.tsx` | médio | teste de `session.tsx`, R0 | R4 |
| R6 | `op()` tipado por `OPERATIONS` | `lib/api/client.ts`, `serverPort.ts` | baixo | `client.test.ts`, R0 | R0 |
| R7 | `lib/data/useResource.ts` e `app/tenant-data.tsx`; migrar Agenda, Clientes e Caixa primeiro | `SchedulingLayout.tsx`, telas | médio | unitário do hook, e2e por módulo | R4, R5 |
| R8 | Manifesto de módulo, `lazy` por rota, `import()` da demonstração, `errorElement` por módulo | `module-types.ts`, `modules.ts`, `router.tsx`, `module.tsx` | médio | teto de pacote, e2e de navegação (`tests/e2e/qa`), unitário da fronteira de erro | R4 |
| R9 | Convergir formato de crm, network e scheduling; ADR do padrão | `crm/api.ts`, `network/api.ts`, `fixturePort.ts` | baixo | `ficha.test.tsx`, `network.test.tsx`, `fixturePort.test.ts` | R4, R7 |
| R10 | Reduzir a emulação conforme a decisão dos donos | `demoPort.ts`, `lib/demo`, e2e | médio | R0 (o e2e contra servidor passa a ser a referência) | decisão, R0, R8 |

R1, R2, R3 e a fronteira de erro por módulo (parte de R8, uma linha em `router.tsx:49`) são independentes e podem sair primeiro.

## 7. O que não mexer

- A regra de não importar módulo e o registro central de módulos.
- A porta como interface entre tela e transporte.
- `lib/api/client.ts` (validação do envelope, `ApiError` com código, cabeçalhos).
- `@contracts` como fonte única e a validação de resposta em tempo de execução.
- `session.tsx` como Context simples; nada de biblioteca de estado global.
- O kit de formulário (`Field`, `useFormErrors`, `focusFirstInvalid`).
- `useAsync` e os contextos da Agenda: promover, não reescrever.
- Datas com `timeZone` explícito e dinheiro em centavos inteiros.
- TypeScript estrito e as travas de chave secreta (`env.ts:24`, lint).
- `createKeyRing` e `useIdempotencyKey`: é a semântica que o hook único deve ter.
- `navigation.ts` e `RouteFocus.tsx` (título e foco por rota).
- CSS próprio com tokens; nada de biblioteca de componentes.

## 8. Achados fora do JSON (excedente)

- **Telas grandes demais.** `finance/FinancePage.tsx` tem 883 linhas e 8 usos de `useKeyFor`; `network/PublicProfileView.tsx` 691; `scheduling/BookingFlowPage.tsx` 526; `sales/QuotesPage.tsx` 512; `messaging/InboxPage.tsx` 511. Dividir por folha ou aba quando R2 e R7 passarem por elas, não antes.
- **Barrel de contratos.** `@contracts` é importado pelo índice, então os schemas das 244 operações (64 KB) ficam no pedaço inicial mesmo com `lazy`. Depois de R8, medir e, se pesar, importar por arquivo (`@contracts/<módulo>.ts`).
- **Realtime sem uso.** `supabase-js` traz realtime e phoenix (56 KB). Só vale trocar por `auth-js` e `storage-js` avulsos se o teto de pacote apertar.
- **Selo de não lidas.** Baixa a caixa inteira a cada rota. O PR #92 propõe `inbox.unread_count`; usar quando entrar.
- **Sessão engole erro.** `session.tsx:47` devolve lista vazia em qualquer erro e o app mostra "sem negócio".

## O que não foi coberto

- Não rodei o app contra servidor real: contagem de requisições por tela e ganho de cache são inferência pela leitura dos `serverPort`.
- Não gerei build de produção (regra da auditoria). A afirmação sobre código de demonstração em produção vem dos imports e do sourcemap do `dist` de demonstração.
- Li por inteiro referrals, payments e lifecycle, e partes de finance, scheduling, crm, network, messaging e field-service. O resto foi coberto por busca estrutural.
- `docs/01_ARQUITETURA.md` e os ADRs 0004, 0006 e 0024 foram lidos por busca de termos. ADR-0002, 0003 e 0005 não foram abertos.
- CSS, acessibilidade e o worker de prévia de link são de outras áreas.
- Não medi tempo de carregamento em rede lenta.
- A estimativa de linhas removidas nas opções da demonstração é ordem de grandeza.
