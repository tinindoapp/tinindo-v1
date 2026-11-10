-- Recado #89, pedido 2: contador leve de não lidas para o selo da aba "Mensagens" (item 39 da onda 3).
-- Hoje o shell chama inbox.list (até 200 contatos com a última mensagem) a cada troca de tela só para somar unread_count.
-- inbox.unread_count devolve só dois números: total de mensagens não lidas e quantos contatos têm alguma.
-- Sem nome, telefone nem texto. Só o dono do negócio lê o canal (mesma regra de channel_inbox).

create function public.channel_unread_count(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.ch_owner(p_tenant_id);
  return (select jsonb_build_object('unread', coalesce(sum(k.unread_count), 0)::int, 'contacts', count(*)::int)
    from public.channel_contacts k where k.tenant_id = p_tenant_id and k.unread_count > 0);
end $$;
comment on function public.channel_unread_count(uuid) is
  'Recado #89: total de não lidas e contatos com não lidas do negócio. Só o dono; sem dados de contato.';
revoke all on function public.channel_unread_count(uuid) from public, anon;
grant execute on function public.channel_unread_count(uuid) to authenticated;
