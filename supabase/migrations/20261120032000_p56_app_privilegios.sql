-- P56 · Privilégios do schema `app` (revisão de 10/11, be-banco-04).
-- A fundação fez `alter default privileges in schema app revoke execute on functions from public`, que no Postgres
-- não tem efeito: privilégio padrão por schema só soma ao padrão global, não tira o EXECUTE que PUBLIC recebe.
-- Ficaram 38 funções de `app` abertas a PUBLIC (10 delas SECURITY DEFINER; `rc_sub_json` e `rc_cycle_json` leem sem
-- conferir o negócio). A API não expõe `app` (supabase/config.toml), por isso era latente.

-- Fecha o que ficou aberto. `authenticated` mantém só os auxiliares com grant explícito, usados em políticas de RLS
-- e de storage e em coluna gerada.
revoke execute on all functions in schema app from public, anon;

-- Não usamos a forma global (`alter default privileges revoke execute on functions from public`, proposta no
-- relatório): ela vale para TODA função que o papel das migrations criar depois, em qualquer schema (extensões,
-- auxiliares de teste), e quebrou 12 arquivos da suíte pgTAP. A garantia para as próximas migrations é a trava do
-- pgTAP 36: falha se alguma função de `app` for executável por `anon`, ou por `authenticated` fora da lista.
