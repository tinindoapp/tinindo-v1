# 25 · Estratégia e saúde dos testes

Auditoria de 10/11/2026 sobre a `main` em `8e113c4`. Medições feitas na máquina compartilhada (4 CPUs, carga entre 1 e 3).

## Resumo

- **Veredito: misto.** A base (banco, contratos, handlers) está forte e no tamanho certo. O topo (tela e e2e) é largo, mas testa a demonstração offline, não o caminho que o profissional do piloto vai usar.
- **Tudo passou, sem instabilidade:** 8 suítes, 0 falhas, 0 teste instável. Ciclo local completo em cerca de 9,2 minutos em sequência.
- **O CI roda quase tudo em todo PR** (lint, tipos, unit, contratos, build, deno check, pgTAP, concorrência, integração, restore, e2e, segredos). Só ficam à mão o smoke de homologação e a avaliação com provedor real.
- **O buraco central:** o caminho navegador → porta de servidor → função → banco não tem teste automático. 25 dos 26 adaptadores de servidor do frontend não rodam em teste nenhum, e 14 passos dos roteiros UAT estão em `test.fixme` porque a demonstração não grava.
- **Os três defeitos de 04/11 escaparam por três medidas que não existem:** ninguém confere se a chave de idempotência sobrevive ao erro (131 chamadas geram chave no envio), ninguém roda a porta de servidor contra o contrato, ninguém mede contraste.
- **Não há teste sem asserção** nas suítes que rodam: os 19 casos de integração sem `expect` falham pelos helpers `ok()` e `fails()`.
- **Desperdício localizado e barato de tirar:** jsdom para 80 arquivos que não usam DOM (29,5 s contra 10,0 s) e 27 migrações do zero na suíte de concorrência (173 s).
- **Recomendação em uma frase:** não cortar a base; gastar o próximo esforço de teste em três travas (porta de servidor contra handler, chave no retry, contraste) antes de escrever mais e2e de demonstração.

## 1. Números medidos

| Suíte | Comando | Arquivos | Casos | Resultado | Tempo |
|---|---|---|---|---|---|
| Lint | `npm run lint` | — | — | exit 0 | 20,0 s |
| Tipos | `npm run typecheck` | — | — | exit 0 | 19,8 s |
| Unit (jsdom) | `npm run test:unit` | 111 | 733 | 733 passaram | 55,0 s |
| Contratos | `npm run test:contracts` | 36 | 845 | 807 passaram, 38 pulados | 5,4 s |
| E2E demonstração | `npx playwright test --workers=2` | 52 | 308 execuções (154 casos × 2 projetos) | 275 passaram, 33 puladas, 0 falhas, 0 instáveis | 251 s |
| pgTAP | `npm run db:test:local` | 33 (+38 migrations) | 1.779 asserções | 0 `not ok` | 9,8 s |
| Integração com banco | `npm run test:integration` | 24 | 142 | 142 passaram | 18,6 s |
| Concorrência | `npm run db:test:concurrency` | 27 scripts | 267 verificações | exit 0 | 173,2 s |

Total em sequência: cerca de 553 s (9,2 min); e2e e concorrência respondem por 7,1 min.

Observações sobre as medidas:

- Lint, tipos, unit e contratos foram medidos pelo auditor anterior desta área (registros em `trabalho/testes/*.log`); conferi os totais contra os JSON do vitest. Playwright e as três suítes de banco foram medidos nesta retomada (`pw-run2.log`, `pw-run2.json`, `db-pgtap.log`, `db-integration.log`, `db-concurrency.log`).
- Nada falhou, então não houve segunda rodada. A primeira tentativa do Playwright (auditor anterior) falhou em 100% dos testes em 3 ms cada: o pacote do repositório pede o Chromium 1194 e a máquina tem o 1243. É ambiente, não produto. Rodei com um diretório de navegadores que aponta 1194 para o 1243.
- Os 38 pulados de contratos são um arquivo só: `tests/contracts/agent/evals-llm-live.test.ts:18` (`describe.skipIf(!LIVE)`), que exige provedor real.
- As 33 puladas do e2e: 28 são `test.fixme` (14 passos × 2 projetos) e 5 são `test.skip` por projeto (teste só de desktop ou só de celular), todas legítimas.
- O briefing falava em 23 arquivos de integração e 26 scripts de concorrência; há 24 e 27.

### Onde está o peso

| Nível | Casos | Linhas de teste | O que exercita |
|---|---|---|---|
| pgTAP + concorrência | 1.779 + 267 | 8.559 (SQL e shell) | regra no banco, RLS, corridas |
| Integração | 142 | 2.674 | handler de produção + banco real |
| Contratos | 807 | 2.997 | schemas, registro de 152 operações, avaliação do assistente (114 casos roteirizados) |
| Unit de funções | 257 | 3.241 | handlers com RPC falsa, domínio puro |
| Unit de frontend | 468 (384 em `src/features`), mais 8 do worker | 7.184 | telas e portas de demonstração |
| E2E | 154 casos, 308 execuções | 4.327 | telas sobre a demonstração offline |

São cerca de 29 mil linhas de teste para 44,5 mil linhas de TypeScript de produção (31.585 em `src`, 12.881 em `supabase/functions`) e 21 mil de SQL. Em número de casos a pirâmide tem base larga, o que é certo. O problema não é a forma, é o que cada andar olha: do meio para cima, quase tudo olha a demonstração.

### O que o CI roda e o que só roda à mão

`.github/workflows/ci-app.yml`, em todo PR para a `main` e em push na `main`:

- `app-quality`: lint, typecheck, unit, contratos, build, `test:coord`, `npm audit` crítico.
- `functions`: `deno check --frozen` das 28 funções.
- `database`: Supabase local, migrations do zero, seed, pgTAP, lint de schema, concorrência, integração, ensaio de restore.
- `e2e`: build e Playwright (desktop e Pixel 7).
- `secrets`: gitleaks.

Só à mão: `tests/e2e-staging/smoke.spec.ts` (homologação hospedada) e a avaliação do assistente com provedor real. Não confirmei se os checks são obrigatórios na proteção de branch.

## 2. Por que os testes não pegaram os defeitos de 04/11

### 2.1 Nova tentativa que duplica (item 1 de 04/11)

A regra de idempotência está provada no banco e no handler, mas sempre com o teste repetindo a mesma chave (`tests/integration/12_uat_personal.test.ts:80`, pgTAP 05, concorrência `05_finance`). O defeito está um andar acima: a tela gera uma chave nova a cada envio.

- 131 chamadas passam `newKey()` direto como argumento em 27 arquivos de tela (`grep -rnE "newKey\(\)\)" src`, sem testes). Exemplos: `src/features/finance-advanced/AccountsPage.tsx:41`, `src/features/recurrence/RecurrencePage.tsx:39`.
- 7 lugares trocam a chave dentro do `catch`: `materials/MaterialsPage.tsx:110-111`, `recurrence/RecurrencePage.tsx:95-96`, `payments/PaymentsPage.tsx:48-49`, `messaging/InboxPage.tsx:32-33` e `:105-106`, `campaigns/CampaignsPage.tsx:64-65`, `resources/ResourcesPage.tsx:136-137`.
- Só dois testes de tela conferem "mesma chave na nova tentativa": `src/features/identity/identity.test.tsx:127` e `src/features/agent/AgentPage.test.tsx:49-61`. `src/features/finance/useKeyFor.test.tsx:6` cobre dois toques seguidos, não erro seguido de nova tentativa.
- A demonstração e o e2e não simulam "o servidor gravou, a resposta se perdeu".

Nenhum nível tinha como falhar. Ver testes-02.

### 2.2 Schema do guia diferente do contrato (item 3 de 04/11)

`src/features/agent/setupGuide.ts:9-23` declara um `SetupProgress` próprio (com `code`, `title`, `why`, `href`), escrito antes de o P44 existir. `src/features/agent/serverPort.ts:5` importa esse schema e a linha 29 valida a resposta de `/setup/setup.progress` com ele; o contrato oficial está em `supabase/functions/_shared/contracts/setup.ts:49`. O `catch` devolve `null` e a tela diz "ainda não está disponível".

- O teste de tela usa a porta de demonstração (que devolve o formato local) e, para o servidor, só o caso `setupProgress: async () => null` (`src/features/agent/AssistPanels.test.tsx:46`).
- A integração prova `setup.progress` pelo handler com o schema do contrato (`tests/integration/46_p44_configuracao.test.ts:24`), mas não passa pela porta do frontend.
- É o único `z.object` de dados em `src` fora dos contratos (o outro é `src/app/env.ts`).

O defeito mora exatamente na costura que nenhum teste atravessa. Ver testes-01.

### 2.3 Contraste 1:1 (item 2 de 04/11)

Não há medida de contraste no repositório: nem `axe`, nem cálculo próprio. `tests/e2e/foundation/padroes.spec.ts:15-43` confere rolagem lateral, fonte mínima, nome de botão e tamanho de botão de ícone. A matriz `docs/10_TESTES_E_ACEITE.md:25` pede "foco/contraste legíveis" e a linha 66 dá UX-01 como provado. Ver testes-03.

### 2.4 Outros defeitos de 04/11 e o teste que faltava

| Item | Por que passou | Achado |
|---|---|---|
| 4 · frase do negócio salva errado | `describe.test.ts` tem 6 casos, nenhum com negação nem número que não é equipe | testes-10 |
| 5, 6, 7 · reserva pelo link | concorrência `24_public_booking.sh:101-106` confirma o bloqueio após 5 erros; não há caso de pedir código novo; nenhum teste de tela lê `delivery` | testes-11 |
| 9 · Home rola em 320 px | `a11y.spec.ts:52` cobre 4 rotas, sem a Home; em 375 px só se mede `scrollWidth` | testes-06 |
| 10 · configuração da demonstração não muda o app | não há teste de paridade nem de efeito cruzado entre portas de demonstração | testes-05 |

## 3. Achados

Os 14 achados estão em `achados/testes.json`, com evidência e mudança recomendada. Resumo por ordem de impacto:

1. **testes-01 (alta)** · caminho navegador → porta de servidor → função sem teste; 25 de 26 adaptadores (≈1.950 linhas) nunca rodam.
2. **testes-02 (alta)** · nada garante a mesma chave na nova tentativa; 131 chamadas com chave gerada no envio, 7 trocas no erro.
3. **testes-03 (alta)** · contraste não é medido.
4. **testes-04 (alta, decisão)** · 14 passos UAT em fixme; nenhuma jornada com servidor na tela.
5. **testes-05 (média)** · demonstração é segunda implementação (5.687 linhas) sem paridade com o servidor.
6. **testes-06 (média)** · 320 px cobre 4 rotas; conteúdo cortado não é visto.
7. **testes-07 (média)** · jsdom para 80 arquivos sem DOM: 29,5 s contra 10,0 s.
8. **testes-08 (média)** · concorrência migra do zero 27 vezes: 173 s.
9. **testes-09 (média)** · smoke de homologação pula em silêncio.
10. **testes-10 (média)** · frase do negócio sem casos de negação.
11. **testes-11 (média)** · reserva pelo link sem caso de novo código nem de estado de envio.
12. **testes-12 (média)** · mesma regra em até cinco níveis, sem dono por nível.
13. **testes-13 (baixa, decisão)** · e2e dos 27 módulos em todo PR, com laço de tema em fluxos funcionais.
14. **testes-14 (baixa)** · sem comando único para o ciclo local.

### Testes que não conseguem falhar

- **Casos sem asserção:** varredura estática (`trabalho/testes/tools/sem-assert.cjs`) em 223 arquivos. Em `src`, `supabase/functions`, `worker` e contratos: zero. No e2e: um, e é fixme (`uat-cabeleireira.spec.ts:76`). Na integração: 19 casos sem `expect`, todos com `ok()` ou `fails()`, que lançam erro quando a resposta não bate com o schema ou com o código esperado (`tests/integration/harness.ts:219-234`). Conclusão: não há teste decorativo nas suítes que rodam.
- **Verdes que não provam:** o smoke de homologação sem variáveis (testes-09); os 14 fixme (testes-04); o caso de servidor do guia, que só testa a falha (seção 2.2); todo o e2e, que não tem como acusar defeito de servidor.

### Fixtures contra seed

Está certo e deve ficar: `tests/contracts/foundation/registry-and-fixtures.test.ts:89` exige que `supabase/seed.sql` (59 linhas) contenha os IDs e o nome do negócio das fixtures do contrato (`supabase/functions/_shared/contracts/fixtures.ts`, 130 linhas). O risco está depois das fixtures: as portas de demonstração acrescentam regra própria por cima (testes-05).

### Mesma regra em vários níveis

`SLOT_CONFLICT` aparece em 31 arquivos de teste (9 em `src`, 4 em funções, 1 em contratos, 6 em integração, 6 em pgTAP, 5 em concorrência); `FORBIDDEN` em 12 de funções, 20 de integração e 32 de pgTAP. O piso de preço aparece em 3 arquivos de `src`, 1 de funções, 5 de contratos, 1 de integração, 5 de pgTAP e 4 de e2e. Em tempo isso custa pouco; em manutenção, uma mudança de regra pede edição em oito lugares (testes-12).

## 4. As 10 lacunas de maior risco e o teste que falta

| # | Lacuna | Nível | Esboço |
|---|---|---|---|
| 1 | Porta de servidor do frontend contra o handler real | integração | `tests/integration/50_portas_do_navegador.test.ts`: `createServerPort(createApiClient({ fetch: edgeFetch(U.ownerA) }), T.A)`; chamar cada leitura e uma escrita por porta; o cliente já valida o schema (`src/lib/api/client.ts:83`) |
| 2 | Mesma chave depois de erro | unit de tela + lint | helper em `src/test`: porta rejeita a 1ª chamada e aceita a 2ª; `expect(keys[0]).toBe(keys[1])`; mudar o conteúdo troca a chave. Regra de lint contra `newKey()` como argumento e `setKey(newKey())` em `catch` |
| 3 | Contraste nos dois temas | e2e (padrões) | na `audit()`: cor do texto contra o primeiro fundo opaco dos ancestrais; < 4,5:1 vira problema; incluir `/app/configurar` com passo `data-next` |
| 4 | Ciclo principal na tela com gravação real | e2e com servidor | projeto `servidor`: criar cliente e serviço, agendar, concluir, receber, conferir saldo e retorno, contra o stack local; depois recarregar e conferir que persistiu |
| 5 | Paridade demonstração × servidor no núcleo | unit + integração | cenário único como função que recebe a porta (conflito, piso, saldo após parcial e estorno, repetição com a mesma chave), rodado nas duas |
| 6 | Reserva pelo link: novo código após bloqueio; envio que falhou | pgTAP + unit de tela | pgTAP 25: novo pedido após 5 erros começa com `attempts = 0` e confirma; tela com `delivery` de falha mostra "Reenviar código" |
| 7 | Frase do negócio com negação | unit de domínio | `it.each` com frases reais; propriedade: dia negado nunca entra no expediente |
| 8 | 320 px em todas as rotas e texto cortado | e2e (a11y) | `appRoutes()` no A11Y-01; `getBoundingClientRect().right <= innerWidth` para texto |
| 9 | Efeito cruzado na demonstração (configuração guiada → Agenda, Serviços, link) | e2e | salvar horário e serviço em `/app/configurar`, navegar sem recarregar e conferir na Agenda e em Serviços |
| 10 | Cliente final alcança "Minhas reservas" e "Avaliar" (item 8 de 04/11) | integração + e2e | depois da correção de produto: `customer_link.issue` → resgate → `my bookings` pelo handler; e2e do link completo |

## 5. O que cortar ou fundir

- **Fundir a preparação do banco** dos três scripts em um banco modelo (`create database … template`), testes-08. Maior ganho de tempo do ciclo.
- **Dividir o projeto unit** em node e jsdom (testes-07). Cerca de 20 s a menos por execução.
- **Tirar os 14 fixme** de `tests/e2e/qa`: viram teste de verdade na jornada com servidor ou linha em `docs/10` (testes-04).
- **Laço de tema em fluxo funcional:** em `cadastro`, `reserva-etapas`, `confirmacao` e `modelo`, manter o fluxo em um tema; o segundo tema fica para asserção visual curta (testes-13).
- **Casos SEC repetidos em `handler.test.ts`:** remover quando o módulo for tocado, porque `00_seguranca.test.ts` e o pgTAP já provam com banco (testes-12). Não apagar em lote.
- **E2E de módulos fora do piloto:** só sair do PR se os donos esconderem os módulos (decisão da área de escopo).
- **Não cortar:** pgTAP, concorrência, integração, contratos, `padroes.spec.ts`, `css-system.test.ts`.

## 6. Conjunto mínimo de portões para merge

Obrigatórios em todo PR (todos já existem no CI, exceto os marcados "novo"):

1. `npm run lint` e `npm run typecheck`.
2. `npm run test:unit` e `npm run test:contracts`.
3. `deno check` das funções.
4. Banco: migrations do zero, seed, pgTAP, lint de schema.
5. Integração handler ↔ banco, incluindo o arquivo novo das portas do navegador (testes-01).
6. Concorrência.
7. E2E da demonstração em desktop e celular, com contraste e 320 px em todas as rotas (testes-03, testes-06).
8. Regra de lint da chave de idempotência (novo, testes-02).
9. gitleaks.

No push da `main` e à noite: ensaio de restore, `npm audit`, jornada e2e com servidor (se aprovada), e2e de módulos fora do núcleo (se separados).

Antes de liberar para o piloto: smoke de homologação com `STAGING_REQUIRED=1` (testes-09).

## 7. O que está certo e deve ficar

- pgTAP, concorrência e integração sem mock de RPC: é onde as invariantes do `AGENTS.md` são provadas.
- Contratos como fonte única e o elo fixtures ↔ seed.
- CI sem `|| true`, sem `--passWithNoTests`, sem credencial, com actions fixadas por SHA.
- `retries: 0` no Playwright.
- `padroes.spec.ts` percorrendo todas as rotas nos dois temas.
- `css-system.test.ts` travando as regras de CSS.

## O que não foi coberto

- Proteção de branch no GitHub (checks obrigatórios): não consultada.
- `npm run build`, `npm run test:coord`, `npm run check:functions` (sem deno na máquina) e `npm run db:restore:drill`: não rodados.
- `tests/e2e-staging` e avaliação com provedor real: sem credenciais.
- Cobertura por linha e teste de mutação: não medidos (sem dependência instalada).
- Segunda rodada para medir instabilidade: não feita, porque nada falhou; cada suíte rodou uma vez.
- Duração real dos jobs no GitHub Actions: não consultada.
- Leitura um a um dos 33 arquivos pgTAP e dos 27 scripts de concorrência: só por amostra.
