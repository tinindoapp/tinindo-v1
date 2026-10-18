# Handoff · P02 Clientes e catálogo

Sessão: `claude-p02-a` (Claude Code na nuvem, para @fffalleiros) · 2026-10-18
Branch: `task/p02/claude-p02-a` → PR [tinindoapp/tinindo-v1#7](https://github.com/tinindoapp/tinindo-v1/pull/7) para `main`. Implementação em `024cad1`.

## Resultado

- **Clientes:** criar, editar com `expected_version`, buscar (nome, e-mail, dígitos do telefone), arquivar e desarquivar, lista paginada por cursor (50 por padrão, máximo 100). Possível duplicado no mesmo negócio é avisado e **nunca mesclado**. Telefone de outro negócio nunca conta.
- **Origem do contato** como dado declarado (`declared_source`: indicação, Instagram, WhatsApp, Google, passou no local, condomínio, já era cliente, outro).
- **Serviços:** duração (5–1440 min), intervalos antes e depois (0–240), base, piso ≤ base, custo estimado e taxa em bps, tudo em centavos inteiros. Arquivar = `active=false`. Nome único entre os ativos. Sem custo informado, a tela avisa que o piso é manual.
- **Importação CSV mínima:** parse no navegador (`,` ou `;`, BOM, aspas), cabeçalhos em português, até 500 linhas e 1 MB. A prévia mostra problemas e cadastros parecidos (telefone, e-mail ou nome). A pessoa escolhe "Pular" (padrão) ou "Criar mesmo assim" em cada linha. O servidor revalida tudo e devolve `created`, `skipped` e `rejected`, com linha, campo e motivo.
- **Por profissão:** "alunos" para personal trainer. Há modelos de serviço com duração e intervalos (sem sugerir preço) e uma dica de intervalo para deslocamento.
- **Edge Function `crm`:** valida no contrato, exige `Idempotency-Key` nos comandos, gera hash canônico da entrada, chama uma RPC com o JWT do usuário, devolve erros neutros e não grava PII no log.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Criar/editar/arquivar e listar | pgTAP de criação, edição com versão, arquivamento, listagem e cursor; telas em `pages.test.tsx` |
| Duração inválida negada | pgTAP (0, 1441 e check direto); handler 400 (0, 4, 1441, 30.5); tela |
| Contato de outro tenant negado | pgTAP: 403 ao criar em B, 404 neutro ao editar/arquivar cliente de B, RLS, cliente final sem acesso |
| Importação relata rejeitadas sem duplicar em silêncio | pgTAP de importação: rejeitadas com motivo, duplicado pulado e relatado, replay idempotente |

## Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm ci` | ok |
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `npm test` | unit 109/109 · contratos 53/53 |
| `npm run build` | ok (aviso de chunk já existente) |
| `npm run test:e2e` | 6/6 |
| `deno check --frozen …/*/index.ts` (deno 2.9.6 via npx) | ok |
| `npm run test:coord` · `npm audit --omit=dev` | ok · 0 vulnerabilidades |
| `db:test:local` com a proposta numa **cópia descartável** (Postgres 16 + shim + pgTAP) | 33 + 57 ok |
| Mutação: RLS de `customers` → `using (true)` | 4 asserções falharam |
| Mutação: upsert sem filtro de `tenant_id` | "404 neutro" falhou |
| Telas em Pixel 7 e desktop | sem rolagem horizontal (corrigido na importação) |

**Não executado:** `supabase test db` e `supabase db lint` (sem Docker aqui). O CI do PR **não** cobre o SQL do P02 até o integrador incluí-lo em `supabase/migrations/`.

## Contratos e migrations

- `_shared/contracts` intocado. Extensão aditiva em `supabase/functions/crm/contract.ts`, com proposta de promoção e lista de consumidores em `db/proposals/P02/NOTAS.md`.
- Proposta DB: `db/proposals/P02/001_crm.sql`, `tests/001_crm.test.sql` e `seed.sql`. A ordem e o destino estão em `NOTAS.md`.
- Sem eventos de outbox: o contrato não tem evento de CRM.

## Mocks, fixtures e conexões pendentes

- Sem Supabase, o módulo lê fixtures (clientes `FX.customers` e serviços de A) em **modo só leitura**, com banner e formulários bloqueados.
- Com Supabase, a profissão vem de `tenants.profession` pela Data API (RLS). Se a leitura falhar, usa o vocabulário genérico.
- Conexão real depende da migration incluída e da função `crm` publicada no projeto de homologação, que ainda não existe (gate do P00).

## Flags

Nenhuma.

## Limitações

- Nome normalizado gera falso positivo de duplicado (homônimos). Ele só sugere.
- Escrita só para `owner`. `staff` lê (fase 2 decide).
- Sem notas privadas de cliente nem exclusão definitiva: arquivar preserva o histórico.
- A busca usa `strpos`, sem índice trigram. Basta para centenas de clientes por negócio.
- Safari/iOS não testados.

## Próximo passo preciso

1. Integrador: revisar e incluir `001_crm.sql` como migration, anexar `seed.sql`, mover o teste para `supabase/tests/database/` e rodar `supabase db reset` + `test db` + `db lint`.
2. Decidir sobre a promoção do contrato (`declared_source` + rotas) para `_shared/contracts` e o doc03.
3. P03: FK composta `(tenant_id, service_id) → provider_services`. P01: `customer_links → customers (tenant_id, id)`.
