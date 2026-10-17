# ADR-0003 · Tenancy, identidade e autorização

Status: aceita · 2026-10-17 · P00

## Decisão

- `auth.users` é a identidade global. `tenants` é o negócio. `tenant_memberships (tenant_id, user_id, role)` dá o papel `owner` ou `staff`. Cliente final **não** é membro: P01 cria `customer_links` (cadastro privado do negócio ↔ login, após comprovação).
- **O tenant do request é seleção.** O servidor decide com `app.is_member(tenant, roles)` e `public.resolve_context(tenant)`. Ambas são `SECURITY DEFINER` com `search_path = ''`, leem `auth.uid()` e excluem tenants `closed`. Para quem não é membro, tenant inexistente e tenant alheio dão o mesmo `FORBIDDEN`.
- Toda tabela privada tem `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)` e FKs **compostas** `(tenant_id, x_id)`, para impedir que um registro de A aponte para objeto de B. RLS fica ligada em todas as tabelas públicas (há teste que falha se alguma ficar sem).
- Grants explícitos (`auto_expose_new_tables = false`). Usuário autenticado só faz `SELECT` com política. Escrita só por RPC do módulo. `idempotency_records` e `outbox_events` não têm política nenhuma (backend-only).
- Funções internas ficam no schema `app`, sem `EXECUTE` para `public`. Só `service_role` executa as de idempotência, outbox e auditoria. As RPCs dos módulos (definer) as chamam internamente.
- Piloto: um recurso ativo por negócio (índice único parcial).
- Telefone nunca é chave de autorização nem de merge entre negócios.

## Como um módulo escreve com segurança (padrão para P01–P09)

```sql
create function public.<modulo>_<comando>(p_tenant_id uuid, ..., p_idem_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;                                    -- 1. autoriza (também na repetição)
  v_replay := app.idempotency_claim(p_tenant_id, auth.uid(), '<op>', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;    -- 2. repetição
  -- 3. mutação com lock/versão; 4. app.emit_event(...); 5. app.audit(...)
  perform app.idempotency_complete(p_tenant_id, auth.uid(), '<op>', p_idem_key, 201, <resposta>);
  return jsonb_build_object('status_code', 201, 'body', <resposta>);
end $$;
revoke all on function public.<...> from public, anon;
grant execute on function public.<...> to authenticated;
```

## Evidência

`supabase/tests/database/00_foundation.test.sql`: 33 asserções pgTAP. Cobrem isolamento A/B por SELECT, INSERT e UPDATE, anon, cliente sem membership, usuário sem vínculo, JWT sem `sub`, privilégios de funções internas, invariantes, idempotência, outbox e auditoria append-only. Os testes falham ao trocar a política de `tenants` por `using (true)`; isso foi verificado.
