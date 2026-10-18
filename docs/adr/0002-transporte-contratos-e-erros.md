# ADR-0002 · Transporte, contratos e erros

Status: aceita · 2026-10-17 · P00

## Decisão

1. **Fonte única dos contratos:** `supabase/functions/_shared/contracts/`. É TypeScript puro com zod, com imports relativos `.ts`. O frontend importa via alias `@contracts` (Vite/TS). O Deno resolve `zod` pelo `deno.json`. Nada de DTO duplicado à mão.
2. **Registro de operações:** `contracts/operations.ts` lista as 22 operações do doc03, com módulo, pacote, tipo, idempotência e schemas de entrada e saída. Um teste garante que o registro bate com a tabela do doc03.
3. **Transporte:** uma Edge Function por módulo (`supabase/functions/<module>/`), com rotas `POST /functions/v1/<module>/<operação>` para comandos e `GET`/`POST` para consultas. A função valida a entrada com o schema do contrato, resolve o contexto (ADR-0003) e chama **uma RPC transacional** no Postgres para escrita crítica. Leituras simples podem usar a Data API com RLS e projeção explícita.
4. **Envelope:** sucesso `{data, meta:{request_id, as_of, schema_version:1}}` e erro `{error:{code,message,field?,retryable}, request_id}`. Os helpers ficam em `supabase/functions/_shared/http/respond.ts`.
5. **Erros do banco:** `RAISE ... USING ERRCODE = 'PTxxx', MESSAGE = '<ErrorCode>'`. O PostgREST devolve HTTP xxx e as funções Edge traduzem com `mapDbError`. A exclusão de sobreposição (`23P01`) vira `SLOT_CONFLICT`. Mensagens de 403/404 são neutras e não revelam se o objeto existe.
6. **Idempotência:** header `Idempotency-Key` em **todo comando**, nunca no corpo. O corpo entra no hash da requisição e no hash da aprovação do agente. Sem o header, a resposta é 400.
7. **Headers:** `Authorization: Bearer <JWT do usuário>`, `apikey` (chave pública), `X-Tinindo-Tenant` (seleção, não autorização) e `X-Request-Id` (UUID; o servidor gera se faltar ou for inválido).

## Mudança de contrato

Mudança compatível (campo opcional novo) entra em PR pequeno do integrador, antes dos consumidores. Mudança incompatível exige nova ADR, `schema_version` novo e lista de consumidores afetados. Um módulo nunca edita `_shared/contracts` no próprio PR: propõe ao integrador.

## Referência implementada

`supabase/functions/context/` executa o caminho completo request → autorização → banco. O handler é puro e testado em Vitest (8 cenários: 401, 400, 403 neutro, 200, request id, 503, resposta fora do contrato, CORS e log sem PII). `index.ts` é a entrada Deno.
