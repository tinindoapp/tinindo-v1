# Handoff · P06 Lista de espera e jobs

Sessão: `claude-int-p06` (integrador contínuo, para @fffalleiros) · 2026-10-18
Branch: `claude/p06-lista-espera` → PR para `main`. Decisões em `docs/adr/0011-lista-de-espera-e-jobs.md`.

## Resultado

- **Banco** (`20261018160000_p06_waitlist_jobs.sql`): consentimentos, entradas, candidatos e ofertas (token só em hash, CHECK de "manual nunca entregue"); RPCs do dono, do link (anônimas) e o worker `jobs_run` (expirações + dispatcher do outbox com lease, retry, dead-letter).
- **Edge Functions**: `waitlist` (rotas do dono + link anônimo) e `jobs` (worker com segredo e chave de serviço).
- **Telas**: Lista de espera (vagas para oferecer na ordem da fila, ofertas, entradas, adicionar com consentimento, card de compartilhamento) e página pública `/oferta` (ver, aceitar, recusar).

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Cancelamento→oferta→aceite real | pgTAP: cancelar → `jobs_run` → candidatos → oferta (hold+cotação) → aceite confirma com preço congelado |
| Clique duplicado confirma uma vez | pgTAP (mesma resposta) e concorrência (5 aceites → 1 reserva) |
| Expiração libera | pgTAP e concorrência: oferta vencida → hold liberado, 1 evento, aceite tardio 422 |
| Worker reinicia sem duplicação | reprocessar evento não duplica candidatos; lease vencido é retomado; 3 workers em paralelo sem erro |
| Manual share não vira delivered | CHECK no banco (23514) e tela "a entrega não é confirmada" |
| Retry e dead-letter | pgTAP: falha → pending com backoff e erro registrado → dead ao esgotar tentativas |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npm test` | unit 257/257 · contratos 189/189 |
| `npm run build` | ok |
| `npm run test:e2e` | 88 passaram, 32 fixme (UAT 7 do barbeiro saiu do fixme) |
| `deno check --frozen` | ok (10 funções) |
| `npm run db:test:local` | tudo ok (P06: 47 asserções) |
| `npm run db:test:concurrency` | P01, P03, P05, P06, P07 ok |

## Gates de ambiente (precisam de pessoa)

- Definir `JOBS_SECRET` e `SUPABASE_SERVICE_ROLE_KEY` na função `jobs` e agendar Supabase Cron (POST a cada minuto). Sem isso, candidatos e expirações só acontecem quando alguém dispara o worker.

## Pendências

- A demonstração offline traz uma vaga de exemplo (sem worker); candidatos reais dependem do servidor.
- Não há "oferecer este horário livre" direto da agenda (gancho `SchedulingExtensionsProvider` pronto para isso).
- Sem lembrete automático nem envio por provedor (fora do escopo; exige autorização).

## Próximo passo

P08 (assistente web com ferramentas e aprovações) sobre P03/P05/P07.
