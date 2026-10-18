# Handoff · P09 Cliente, perfil e convites

Sessão: `claude-p09-a` (Claude Code na nuvem, reserva de @fffalleiros) · 2026-10-18
Branch: `task/p09/claude-p09-a` → PR https://github.com/tinindoapp/tinindo-v1/pull/5 (base `main`, sem merge).

## Resultado

- **Edge Function `network`** (`supabase/functions/network/`): handler puro testado + entrada Deno. Rotas: `profile.publish`, `profile.unpublish`, `profile.get`, `public.profile` (anônima, GET por slug), `public.slots` (porta da agenda, 503 até o P03), `referral.create`, `referral.inspect` (anônima, POST), `referral.claim` e `referral.list`. Comandos só por POST com `Idempotency-Key`; token do convite no corpo e no fragmento do link (`/convite#t=…`), nunca na query; log sem token, tenant, nome ou corpo.
- **Proposta de banco** (`db/proposals/P09/`): `public_profiles` e `referrals` com RLS, whitelist por `CHECK`, token de 256 bits guardado só em sha256, inspeção que não muda estado, claim com contato confirmado, uso único e sem autoconvite, cota de 20 convites/24h, auditoria. Decisões a revisar em `NOTAS.md`.
- **Frontend** (`src/features/network/`): tela do dono com onboarding progressivo, editor de perfil opt-in, prévia, tirar do ar e convite de colega; páginas públicas de perfil (com horários), convite e indicação do cliente, exportadas em `networkPublicRoutes`. Demonstração offline rotulada quando não há Supabase.

## Atualização · rotas públicas montadas (a pedido do integrador)

- `src/app/router.tsx` monta `...networkPublicRoutes` ao lado de `/entrar`: `/p/:slug`, `/convite` e `/indicar` ficam fora do shell autenticado.
- `DemoBanner` saiu de `AppShell.tsx` para `src/app/DemoBanner.tsx` (o shell reexporta). Sem isso havia ciclo router → módulo network → AppShell → modules.ts → módulo network, e o app não renderizava (o smoke e2e da fundação detectou).
- Tela do dono ganhou o link "Abrir perfil público".
- Novo `tests/e2e/network/public.spec.ts` (5 cenários × desktop/mobile): perfil público fora do shell e sem ID do tenant, perfil inexistente, convite que só aceita por ação explícita e tira o token da URL, convite desconhecido, indicação sem telefone.
- Resultados: lint e typecheck ok, unit 50/50, contratos 26/26, build ok, e2e 20/20, `test:coord` ok, `deno check` ok.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` | ok |
| `npm run typecheck` | ok |
| `npm test` | unit 50/50, contratos 26/26 |
| `npm run build` | ok (aviso de chunk > 500 kB, já conhecido) |
| `npm run test:e2e` | 10/10 (desktop + mobile) |
| `npm run test:coord` | ok |
| `deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts` | ok (Deno 2.9.6) |
| pgTAP local, Postgres 16 + shim (proposta copiada temporariamente, não comitada) | fundação 33/33, P09 48/48 |
| Mutações (sem filtro `published_at`; sem checagem de contato) | testes 48 e 38 falham, como esperado |

Não executado aqui: stack Supabase real (`supabase db start/test db/db lint`) e gitleaks; rodam no CI, mas a proposta só entra no banco do CI quando o integrador a incluir em `supabase/migrations/`.

## Fixtures, mocks e conexões pendentes

- Horários do link público: demonstração calcula a partir de `bookingsA` (fixtures); servidor responde 503 até o P03 expor `availability.list`. Ligar em `supabase/functions/network/index.ts` (`listPublicSlots`).
- Serviços públicos: sem fonte até P02 + contrato; o cliente HTTP devolve lista vazia (não inventa).
- Reserva pelo link: a tela só seleciona o horário; `booking.create` é do P03.
- Canal de correção/remoção de perfil: texto pede contato com a equipe; não há canal operacional definido (gate de operação).

## Contratos e migrations (propostas ao integrador)

1. ~~Montar `...networkPublicRoutes` em `src/app/router.tsx`~~ feito neste PR.
2. Formalizar no registro as rotas extras do módulo (schemas locais em `supabase/functions/network/schemas.ts`).
3. Campo opcional de valores (`bio`, `services_summary`) em `ProfilePublishInput`.
4. Eventos `referral.*`/`profile.*` se P10 precisar.
5. Numerar e incluir `db/proposals/P09/001_network.sql` e o teste pgTAP.
6. Configurar `PUBLIC_APP_URL` nas Edge Functions de cada ambiente.

## Flags

Nenhuma. Banner de demonstração segue `VITE_APP_ENV`.

## Limitações

- E2E das rotas públicas roda em demonstração offline; com banco real fica para o P10.
- Atribuição do claim só registra `claimed_tenant_id` quando quem aceita é dono de exatamente um negócio.
- Sem rate limit por IP na inspeção anônima (o token de 256 bits torna enumeração inviável).

## Próximo passo preciso

Integrador: revisar o PR #5, aplicar a proposta 5, e depois do P03 ligar `listPublicSlots` + adicionar e2e das rotas públicas com banco real (P10).
