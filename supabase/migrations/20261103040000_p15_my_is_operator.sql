-- Recado #88: sinal só de leitura para o cliente saber se quem entrou é da equipe Tinindo
-- (public.platform_operators ativo). Serve só para não mostrar as telas da equipe
-- (/app/resultado/custo e /app/servicos-tinindo/operacao) a quem receberia FORBIDDEN.
-- Não autoriza nada: cada função da equipe continua chamando app.svc_operator() no servidor.
-- Devolve só o booleano do próprio usuário; não expõe nome, lista de operadores nem de outro usuário.

create function public.my_is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_operators o where o.user_id = (select auth.uid()) and o.active
  )
$$;
comment on function public.my_is_operator() is
  'Recado #88: true se o usuário autenticado é operador ativo da Tinindo. Só para a interface; a autorização fica no servidor.';
revoke all on function public.my_is_operator() from public, anon;
grant execute on function public.my_is_operator() to authenticated;
