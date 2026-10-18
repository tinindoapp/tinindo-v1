# P09 · Proposta de banco: rede (perfil público e convites)

Arquivos: `001_network.sql` (DDL, funções, RLS e grants) e `tests/001_network.test.sql` (48 asserções pgTAP).

## Dependências e ordem

- Depende só da fundação `20261017120000_foundation.sql` (`app.is_member`, `app.idempotency_claim/complete`, `app.audit`, `app.touch_row`) e de `pgcrypto` no schema `extensions` (`gen_random_bytes`, `digest`), que o Supabase já instala.
- Não altera tabela existente nem dado existente. Pode ser numerada depois de qualquer migration do P01–P08.
- Usa `auth.users.email_confirmed_at` / `phone_confirmed_at` para comprovar o contato no claim. Lê a linha via `to_jsonb` para funcionar também com o shim local (que não tem `phone_confirmed_at`).

## O que cria

| Objeto | Acesso | Observação |
|---|---|---|
| `public_profiles` | dono lê o próprio por RLS; escrita só por RPC | Um por negócio; `public_fields` limitado à whitelist do contrato por `CHECK` |
| `referrals` | quem convidou lê os próprios (colunas sem `token_hash`, `idem_key`, `request_hash`) | Sem coluna de telefone, nota ou token em claro |
| `network_profile_publish/unpublish/get` | `authenticated` (dono) | Idempotência pela fundação; auditoria |
| `network_public_profile(slug)` | `anon`, `authenticated` | Só publicados de negócio `active`; nunca devolve `tenant_id` |
| `network_referral_create` | `authenticated` | Colega: dono do tenant. Cliente: sem tenant. Cota: 20/24h por usuário |
| `network_referral_inspect(token)` | `anon`, `authenticated` | Leitura mínima; não muda estado |
| `network_referral_claim(token)` | `authenticated` | Contato confirmado, uso único, sem autoconvite, idempotente para o mesmo usuário |
| `network_referral_list()` | `authenticated` | Até 50, só do próprio usuário |

## Decisões que o integrador deve revisar

1. **Idempotência própria em `referrals`.** A indicação do cliente não tem tenant (cliente não é membro, ADR-0003), e `idempotency_records.tenant_id` é `NOT NULL`. Além disso, a resposta original contém o token, que não pode ficar guardado em claro. Por isso a repetição com a mesma chave devolve **o mesmo convite com link renovado** e invalida o token anterior. Payload diferente com a mesma chave continua `409 IDEMPOTENCY_MISMATCH`.
2. **Slug ocupado** responde `400 VALIDATION_ERROR` com `hint = 'slug'`, porque o catálogo de erros v1 não tem um 409 genérico. O slug é público, então isso não revela dado privado.
3. **Sem evento de outbox.** `EventType` v1 não tem `referral.*` nem `profile.*`, e adicionar é mudança de contrato. A auditoria registra publish, unpublish, create e claim.
4. **Bio e resumo de serviços** estão na whitelist do contrato, mas `ProfilePublishInput` não traz valores. A projeção hoje preenche só `display_name` (nome do tenant), `category`, `area` e `booking_link` (montado pela Edge Function a partir do slug).

## Como testar localmente (sem Docker)

```bash
cp db/proposals/P09/001_network.sql supabase/migrations/20990101000000_p09_network.sql
cp db/proposals/P09/tests/001_network.test.sql supabase/tests/database/90_p09_network.test.sql
PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:local
rm supabase/migrations/20990101000000_p09_network.sql supabase/tests/database/90_p09_network.test.sql
```

Resultado nesta sessão (Postgres 16 + shim): fundação 33/33 e P09 48/48. Mutações verificadas: tirar o filtro `published_at` da leitura pública e desligar a checagem de contato confirmado fazem os testes falharem (asserções 48 e 38).
