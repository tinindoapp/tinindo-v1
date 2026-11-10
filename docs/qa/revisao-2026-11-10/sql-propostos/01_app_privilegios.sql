-- Migration nova (ex.: 2026111x_app_execute_minimo.sql)
-- (a) ALTER DEFAULT PRIVILEGES ... IN SCHEMA não consegue tirar o EXECUTE que PUBLIC recebe por padrão global;
--     só a forma global (sem IN SCHEMA), para o papel que cria as funções, tem efeito.
alter default privileges revoke execute on functions from public;
-- (b) fecha as 38 funções de app que ficaram com a ACL padrão (PUBLIC).
revoke execute on all functions in schema app from public, anon;
-- (c) os auxiliares usados em políticas RLS e storage já têm grant explícito para authenticated
--     (is_member, member_role, linked_customer_id, profile_photo_tenant, profile_photo_writer, crm_name_key) e não mudam.
