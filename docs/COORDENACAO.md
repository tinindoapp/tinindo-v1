# Coordenação para trabalho em paralelo

Complementa `AGENTS.md`. Vale para qualquer pessoa ou sessão que escreva no repositório ao mesmo tempo que outra.

## Estado do quadro (31/10/2026)

- Fase atual: `expansao-1`. A fase `pilot` (P00–P10) está concluída no quadro. A parte de código do P10 é o PR #25; os gates externos do P10 viraram o **P42**.
- Os pacotes P11–P24 foram entregues em PRs fora do quadro, de 18/10 a 24/10. Foram registrados como concluídos, com o PR e o commit de merge de cada um (ação `reconcile` no histórico do quadro).
- Pacotes liberados nesta fase:
  - **P42**: liberação do piloto. É só do coordenador: exige Docker, contas e decisões do dono.
  - **P43**: reserva pelo link público. Disponível para reserva.
- **P43** concluído (PR #42).
- **P28** (equipes e recursos, PR #60) e **P30** (materiais e custos, PR #61) foram entregues a pedido do dono antes de entrarem no quadro. Em 31/10 o integrador os registrou como concluídos, com PR e commit de merge (ação `reconcile`).
- Os demais pacotes entre P25 e P41 continuam planejados e não ativados. Cada um entra no quadro quando o integrador liberar.

## Antes de escrever

1. `git fetch origin --prune` e `python3 scripts/coord.py --repo tinindoapp/tinindo-v1 status`.
2. Reserve: `python3 scripts/coord.py --repo tinindoapp/tinindo-v1 claim P43 --session <id-unico>`. Sem reserva, não escreva.
3. Trabalhe só na branch devolvida pela reserva (`task/p43/<id>`), criada a partir de `origin/main`.
4. Rode `assert` antes de editar e antes de commit ou push. Mande `heartbeat` a cada 30 min.
5. Abra o PR para `main` e rode `review P43 --session <id> --pr <n>`. Quem marca como concluído é o integrador, com `finish`.

Em sessões na nuvem, o proxy recusa a escrita pela API de conteúdo do GitHub (HTTP 403). Nesse caso, o `coord.py` grava o quadro com git, usando um commit no branch `coordination` em cima da versão lida. Se o quadro mudou no meio, a escrita vira conflito e o script relê o quadro e tenta de novo. Nunca há force-push.

Trabalho que não é um pacote do quadro (correção pequena, auditoria, documentação) pode ir direto em PR. Antes, olhe os PRs abertos para não tocar nos mesmos arquivos.

## Arquivos compartilhados (dono: integrador)

Duas sessões editando estes arquivos ao mesmo tempo geram conflito quase certo. O pacote **propõe** a mudança, e o integrador aplica ou aprova no PR:

| Arquivo | O que entra |
|---|---|
| `supabase/functions/_shared/contracts/operations.ts`, `index.ts`, `events.ts` | Registro de operações e eventos |
| `src/app/modules.ts`, `router.tsx`, `navigation.ts` | Uma linha por módulo ou rota |
| `tests/integration/harness.ts` | Montagem dos handlers no teste com banco |
| `docs/01_ARQUITETURA.md`, `docs/03_CONTRATOS.md` | Lista de eventos e de operações (testes conferem) |
| `release/CHECKLIST.md` | Funções e passos de liberação |
| `src/lib/demo/journey.ts` | Ponte da demonstração entre módulos |

**Migrations:**
- Nome com o horário real da criação (`AAAAMMDDHHMMSS_pXX_assunto.sql`), para não colidir.
- Nunca editar uma migration que já entrou no `main`; corrigir com uma nova.
- Nenhuma sessão aplica migration em banco compartilhado.

## Antes do PR

Rode a mesma sequência do CI:
- `npm run lint`;
- `npx tsc -b --noEmit`;
- `npx vitest run`;
- `deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts`;
- pgTAP (`scripts/db-test-local.sh`) e concorrência (`scripts/db-concurrency.sh`);
- `npm run test:integration`;
- `npx playwright test`;
- gitleaks.

No PR, siga o modelo de `.github/pull_request_template.md`.

## Publicação

- Cada push de branch gera uma prévia em `https://<branch>-tinindo-v1.falleiros.workers.dev`. O banner mostra a versão (commit e branch), e `/version.json` também.
- O merge no `main` publica no endereço principal (`tinindo-v1.falleiros.workers.dev`).
- Merge só com o ok do dono.
