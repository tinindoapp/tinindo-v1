# Handoff · P53 Camada comum do front, parte 2

Sessão: `claude/nifty-clarke-921fl8` (uma das cinco em paralelo de 20/11, para @fffalleiros) · 2026-11-20
Branch: `claude/nifty-clarke-921fl8` → PR para `main`. Base: `docs/handoffs/P52-parte1-camada-comum.md` ("Para a parte 2") e `docs/qa/revisao-2026-11-10/15-fe-arquitetura.md` (R4, R5, R8).
Área: `src/app/` (menos `pages/`), `src/main.tsx`, `src/lib/`, os módulos network, presence, reputation, setup, identity, payments, discovery e os `module.tsx`. Fora: scheduling, agent, finance, crm, lifecycle, `src/components/ui`, `src/styles`.

**Nada foi aplicado na homologação.** Nenhum contrato, migration ou flag mudou.

## Entregue

### 1. Os sete módulos na `src/lib` e as listas de legado do lint

- network, presence, reputation, setup, identity, payments e discovery usam a lib para dinheiro (`formatCents`), chave (`useCommand` / `useIdempotencyKey`), datas e relógio (`now`, `today`, formatos de `time.ts`), telefone (`phoneToE164`) e link público (`takeLinkToken`, `forgetLinkToken` em `src/lib/public-link.ts`).
- Formatos novos em `src/lib/time.ts`, cada um com teste: `formatFullDateTime`, `formatWeekdayDayMonth` e `deviceTimeZone`.
- Teste novo de "falhou, tocar de novo manda a mesma chave" em: Confirmar código (Perfil), Publicar (Site), Publicar avaliação, "Agora não" (Configuração), Gerar cobrança e Salvar (Diretório).
- **Listas de legado:** saíram todas as entradas da área, mais `analytics/module.tsx` (relógio). Ficaram só as de fora da área:
  - `scheduling/agenda.ts` (dinheiro);
  - `agent/port.ts` e `scheduling/port.ts` (chave);
  - `scheduling/attendance.tsx` (relógio).

### 2. Um cliente de API por sessão e o contexto do negócio na sessão (R4, R5)

- **Um cliente só.** `session.tsx` cria o cliente uma vez (`createSessionClient`, em `src/lib/api/session-client.ts`).
  - Ele guarda a leitura de `/context` por negócio: a primeira vai ao servidor, as outras reaproveitam a mesma promessa.
  - Falha não fica guardada, e trocar de login limpa o que foi guardado.
  - Com isso, as portas que ainda pedem `/context` sozinhas (15 `serverPort` de outras áreas) param de repetir a ida ao servidor, sem precisar mudar.
- **Contexto do negócio na sessão.** `useSession().business` traz `tenantId`, nome, papel, fuso e moeda. `useSession().timezone` dá o fuso direto, e `reloadBusiness()` relê.
- **`src/app/api.tsx`**, o que os módulos usam:
  - `useApi()` e `usePort({ demo, server })`, mais `useSessionPort` para porta sem negócio;
  - `useBusiness()`: o contexto mais a profissão do escopo;
  - `useBusinessTimezone()` e `<BusinessPending>`;
  - `publicCall()`: o cliente anônimo das páginas públicas.
- **Telas que começavam com o fuso da fixture.** Pagamentos e Mensagens agora esperam o fuso de verdade. A busca própria a `/context` delas saiu. Relacionamento ficou de fora (área proibida).
- **`createApiClient` em `src/features`:** saiu de 15 `module.tsx`, de `network/useNetworkApi.ts`, `identity/services.tsx`, `payments/owner-slug.ts`, `scope.tsx` e dos kits públicos.
  - O lint agora barra importar `createApiClient` como valor em `src/features`; o tipo continua permitido.
  - `LEGACY_CLIENT` lista o que ficou, todo fora da área: `agent/module.tsx`, `crm/module.tsx`, `finance/module.tsx`, `lifecycle/module.tsx`, `messaging/unread.ts`, `sales/owner-slug.ts`, `sales/public-kit.tsx` e `scheduling/SchedulingLayout.tsx`.
  - Fora de `features`, `src/app/pages/Home.tsx` também ainda cria o seu.

### 3. Rotas sob demanda e fronteira de erro por módulo (R8)

- **Manifesto e telas separados.** O `module.tsx` virou manifesto (id, caminho, rótulo, nível, CSS). As telas foram para `routes.tsx` e carregam pelo `lazy` da rota (`screen()` em `src/app/lazy-route.ts`). A forma das rotas continua a que `tests/e2e/foundation/rotas.ts` lê.
  - Convertidos: os 7 da área e mais 15 (messaging, finance-advanced, fiscal, recurrence, referrals, campaigns, growth-advice, sales, analytics, pricing, waitlist, service-ops, resources, materials, field-service).
  - O que a casca importa dos manifestos continua saindo deles: `InboxExtraProvider`, `useGrowthAdvicePort`, `useSetupPort` e `SetupCard`. Os ganchos foram para arquivos pequenos à parte (`inbox-extra.ts`, `use-port.ts`).
- **Ficaram no pacote inicial:**
  - **scheduling, agent, finance, crm e lifecycle**: o pedido manda não tocar nesses módulos. O modo automático negou converter até o `module.tsx` deles.
  - **Pagamentos**, por um teste. `tests/e2e/qa/totais.spec.ts` lê a lista "Quem está devendo" logo depois do `goto`, sem esperar. Com a tela sob demanda o teste lê antes e dá R$ 0,00 (na tela a lista aparece certa em 65 ms; conferido no navegador). O teste é de fora da área e só roda na `main`. Recado aberto; com a espera no teste, é uma linha em `payments/module.tsx` (está comentada lá).
- **Fronteira de erro por módulo** (`src/app/ModuleError.tsx`): cada módulo ganhou `errorElement` em `router.tsx`.
  - O erro de uma tela fica no lugar dela, dentro do shell, com o menu: "Não foi possível abrir X", "Recarregar a página" e "Voltar para Hoje".
  - Pedaço que não baixou (versão nova ou rede) tem aviso próprio.
  - O root ganhou `hydrateFallbackElement`.
- **`/criar-conta` e `/recuperar-senha`** viraram `identityPublicRoutes`, sob demanda. O `router.tsx` não importa mais telas de módulo.
- **JS inicial:** de 1.569.597 bytes (448.639 em gzip) para 1.245.866 (365.587 em gzip), 21% a menos, em 39 pedaços. O resto do peso está nos cinco módulos que ficaram de fora e no que `pages/Home.tsx` importa direto.

### 4. Kit público único

- `src/components/public/public-kit.tsx` e `.css`. network, payments e reputation importam de lá, e as cópias saíram.
- **sales** é de outra área e manteve a cópia. O teste de sincronia (`src/components/public/public-kit.sync.test.ts`) compara a cópia de sales com o kit e aceita só as diferenças conhecidas.
- O par `owner-slug.ts` saiu da sincronia: pagamentos usa o cliente da sessão e sales ainda não.
- `usePublicBusiness(slug, own?)` aceita uma leitura própria com cache à parte. Assim a leitura do Perfil na demonstração não vaza para Pagamento e Avaliações (há teste).

## Testes, comandos e resultados (branch mesclado com a `main` em `afb8caf`)

| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 139 arquivos, 1.028 passaram |
| `npm run test:contracts` | 842 passaram, 38 pulados (provedor real) |
| `npm run test:integration` | 26 arquivos, 151 passaram |
| `npm run db:test:local` (pgTAP) | todos passaram |
| `npm run build` | ok |
| `npx playwright test` (desktop, Pixel 7, recursos e guardados; `padroes` inclui 375 px) | 316 passaram, 34 pulados, 0 falhas |
| `bash tests/e2e/servidor/run.sh` (jornada com servidor: sessão, `/context` e cliente únicos de verdade) | 2 passaram (desktop e celular) |

**Testes novos de casca:**

- `src/lib/api/session-client.test.ts`: uma leitura de `/context` por negócio, simultâneas incluídas; falha não guardada; `forget`.
- `src/app/api.test.tsx`: fuso e papel por negócio, troca e volta; uma ida ao servidor por negócio; um cliente na sessão; falha sem fuso inventado; porta usando o mesmo cliente.
- `src/app/demo-session.test.tsx`: na demonstração, sem cliente e com o fuso da fixture.
- `src/app/ModuleError.test.tsx`: erro dentro do shell; pedaço que não baixou.

## Decisões tomadas pelos docs

- **Lugar do cliente.** O cliente e o contexto ficam em `session.tsx` (o doc 15 põe o contexto na sessão), e `api.tsx` só lê da sessão. Com isso o `main.tsx` não mudou, e não houve conflito com o recado #119, que mexe nele.
- **Item 6 do #119.** O kit público ficou com o P53, como combinado no próprio #119.
- **R7 (`useResource` e `tenant-data`) não entrou.** Não estava na lista de entregas. A chave perdida quando a lista recarrega (apontada no handoff do P52) continua.

## Defeitos encontrados (não corrigidos)

1. `network/PublicProfileView.tsx` `whatsappLink` é cópia do `whatsappHref` de `components/ui/share.tsx`, e as duas diferem para E.164 curto (o contrato aceita 8 dígitos).
2. `identity/AccountPage.tsx`: a chave de `revokeLink` é montada à mão (`revoke-<id>-v<versão>`).
3. O `formatCents` da lib usa espaço inseparável e a Configuração usava espaço comum. A Configuração continua com o comum, para o texto não mudar.
4. `payments/labels.ts` `formatDay`: uma data inválida (2026-02-31) antes "rolava" e agora volta como veio. Não acontece na tela.
5. Chave diferente de antes. Nos formulários do Perfil (detalhes) e de avaliar pelo link, a chave agora troca quando o corpo muda (antes ficava igual). Gerar cobrança mantém a chave no erro (antes trocava).

## Recados

- **e2e lê o DOM antes de a tela carregar** (`tests/e2e/qa/totais.spec.ts`): esperar a lista em `pagamentos()`. Depois, Pagamentos vira sob demanda. O #119 achou o mesmo padrão em `a11y`, `smoke` e `padroes`.
- **Cliente único e telas sob demanda nos módulos fora da área:** scheduling (`SchedulingLayout.tsx`), crm (`module.tsx`, `api.ts` com `/context`), finance (`module.tsx`, `serverPort.ts`), agent (`module.tsx`), lifecycle (`module.tsx` com fuso da fixture e `/context`, mais `retorno.ts`), sales (`owner-slug.ts`, cópia do kit), messaging (`unread.ts`) e `src/app/pages/Home.tsx`.

## Coordenação

P53 não está no quadro do `coord.py` (que vai até P46), então não houve `claim`. Merge pela sessão com o CI verde, autorizado pelo Felipe no pedido.
