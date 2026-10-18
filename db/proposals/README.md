# Propostas de banco por pacote

Cada pacote escreve SQL **aqui**, nunca em `supabase/migrations/` (ADR-0005):

```
db/proposals/P03/
  001_bookings.sql          # DDL + funções + RLS + grants, no padrão da ADR-0003
  tests/001_bookings.test.sql  # pgTAP: isolamento A/B, concorrência, idempotência
  NOTAS.md                  # dependências, ordem, impacto em dados existentes
```

Regras:

- Use as funções da fundação: `app.is_member`, `app.idempotency_claim/complete`, `app.emit_event` e `app.audit`.
- Tabela privada: `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)`, FKs compostas, RLS ligada e grants explícitos.
- Teste local sem Docker: copie temporariamente para `supabase/migrations/` e `supabase/tests/database/` **no seu worktree** e rode `npm run db:test:local`. Não comite nessas pastas.
- O integrador numera, testa em banco limpo e em banco migrado, e inclui em `supabase/migrations/`.
