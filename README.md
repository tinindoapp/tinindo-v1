# Tinindo

Aplicativo de operação para profissionais de serviço: agenda, clientes, preço, retorno e recebimentos. Piloto web para cabeleireiros, barbeiros e personal trainers.

- **Comece por** [`COMECE_AQUI.md`](COMECE_AQUI.md) (plano) e [`AGENTS.md`](AGENTS.md) (protocolo de qualquer sessão).
- Decisões da fundação: [`docs/adr/`](docs/adr/). Estado do P00: [`docs/handoffs/P00-SESSAO.md`](docs/handoffs/P00-SESSAO.md).
- Marca: [`brand/BRAND.md`](brand/BRAND.md). Use só os tokens e ativos originais.

## Rodar em outra máquina

Pré-requisitos: Node 22 (`.nvmrc`), Python 3.10+ e Git. Para banco local, Docker. Para as Edge Functions, Deno 2.9. Para o quadro de tarefas, GitHub CLI `gh` autenticado.

```bash
git clone https://github.com/fffalleiros/tinindo && cd tinindo
npm ci
npm run dev            # http://localhost:5173 — sem .env, abre em demonstração offline
```

Com banco local (Docker):

```bash
npx supabase start     # aplica migrations + seed sintético
npx supabase status    # copie API URL e Publishable key para .env.local (ver .env.example)
npm run dev            # entre com dono.a@exemplo.test / tinindo-local-123
npx supabase functions serve   # Edge Function `context` em /functions/v1/context
```

## Verificações (as mesmas do CI)

| Comando | O que prova |
|---|---|
| `npm run lint` | ESLint, inclusive módulo importando módulo e literal de chave secreta |
| `npm run typecheck` | TypeScript estrito (app, contratos, testes) |
| `npm run test:unit` | Shell, cliente de API, ambiente, handler `context` |
| `npm run test:contracts` | Contratos v1, registro × doc03, fixtures × seed |
| `npm run build` | Build de produção do frontend |
| `npm run test:e2e` | Smoke desktop + mobile no build (`vite preview`) |
| `npm run check:functions` | `deno check` das Edge Functions |
| `npx supabase test db` | pgTAP: RLS, autorização, idempotência (precisa de `supabase start`) |
| `npm run db:test:local` | Mesmo pgTAP num Postgres comum, sem Docker (ver o script) |
| `npm run test:coord` | Ferramenta de coordenação |

## Assumir um pacote (ex.: P01)

```bash
git fetch origin --prune
python3 scripts/coord.py --repo fffalleiros/tinindo status
python3 scripts/coord.py --repo fffalleiros/tinindo claim P01 --session <seu-login>-p01-a
git worktree add ../tinindo-p01-a -b task/p01/<seu-login>-p01-a origin/main
```

Depois siga `tasks/P01.md`, escreva só nos caminhos do pacote e abra PR para `main`. Detalhes: `docs/08_DESENVOLVIMENTO_PARALELO.md`.
