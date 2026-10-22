# ADR-0016 · Camada de integração handler ↔ banco e ritual de release (P10, parte de código)

Status: aceita · 2026-10-22 · integrador (onda 2, PR 1)

## Contexto

Até aqui os testes provavam a Edge Function com RPC mockada e o banco com pgTAP, separadamente. A costura (nomes de argumentos, serialização de JSON e arrays, mapeamento de erros `PTxxx` → envelope, idempotência com hash do corpo) só era conferida por testes de contrato textuais. O stack Supabase completo (PostgREST, GoTrue, Deno) não roda no ambiente de desenvolvimento sem Docker, então não havia e2e com servidor.

## Decisões

1. **Harness `tests/integration`.** Cada handler é montado com a mesma lógica de `index.ts`, trocando só o transporte: `rpc(actor, fn, args)` chama a função pelo `pg`, numa transação por chamada, com `request.jwt.claims` e `set local role` (`anon`, `authenticated`, `service_role`) como o PostgREST faria. Argumentos vão nomeados e com cast pelo tipo declarado em `pg_proc` (jsonb serializado, arrays nativos); argumento desconhecido falha. Erros voltam como `{code, message, hint}` e passam por `mapDbError`. O "JWT" é o id do usuário.
2. **O que a camada prova.** Os quatro roteiros UAT do docs/10 (barbeiro, cabeleireira, personal, cliente de dois profissionais), a matriz SEC-01/02/03 em todas as funções, a jornada da fase 2 (P11 → P08 → P15 → P18) e uma sonda que garante que toda operação do registro v1 tem rota viva no handler certo. Roda no job de banco do CI, no Postgres do runner, depois da concorrência.
3. **Ensaio de restore (OPS-01).** `scripts/db-restore-drill.sh`: banco migrado + dados por RPC → `pg_dump` custom → `pg_restore` em banco novo → contagens, RLS, políticas e FKs → comando real → idempotência preservada, com tempo impresso. Roda no CI. Em produção o mesmo roteiro vale para o backup do Supabase restaurado em projeto isolado.
4. **Release como documento, não como automação.** `release/CHECKLIST.md` (docs/09: migrations antes do código, uma pessoa publica, reversão), `release/RUNBOOK.md` (cinco incidentes) e `release/RELEASES.md` (tabela de tags/SHAs). Nenhum deploy automático até existir o projeto hospedado.
5. **UATs `fixme` continuam `fixme`, com o motivo certo.** A demonstração offline não grava por decisão (ADR-0006); os passos que ela não cobre estão provados na camada de integração, e o `fixme` aponta o arquivo. Dois passos revelaram **lacunas de produto**, não de teste: reservar pelo link público (o link só mostra horários) e a área da cliente com as próprias reservas. Ficam registradas no handoff para a onda.
6. **`pg` só como dependência de desenvolvimento.** O app e as funções continuam sem driver direto; o harness vive em `tests/`.

## Consequências

- A regra de lint que proíbe `service_role` no código ganhou uma exceção explícita, só no harness.
- Um teste de integração que quebre indica costura errada entre função e banco, mesmo com contratos e pgTAP verdes: é o sinal que faltava.
- Quando o staging existir, os mesmos roteiros UAT rodam pela tela (Playwright com `VITE_SUPABASE_URL`); a camada de integração não substitui isso, antecipa.
