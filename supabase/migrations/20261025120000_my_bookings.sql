-- Minhas reservas (auditoria da demo, 25/10): o cliente com login vê as próprias reservas em todos os negócios em que
-- tem vínculo comprovado (customer_links, P01). Só leitura. Mesma regra da RLS bookings_select_linked_customer, numa
-- projeção mínima: nome do negócio e do serviço, horário, fuso, situação e preço combinado. Nada de CRM, notas, motivo
-- de cancelamento, origem ou dados de outros clientes. Vínculo revogado ou negócio encerrado some da lista.

create function public.my_bookings()
returns table (
  booking_id uuid,
  tenant_id uuid,
  tenant_name text,
  timezone text,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  agreed_price_cents bigint
)
language sql stable security definer set search_path = '' as $$
  select b.id, b.tenant_id, t.name, t.timezone, s.name, b.starts_at, b.ends_at, b.status, b.agreed_price_cents
  from public.customer_links l
  join public.tenants t on t.id = l.tenant_id
  join public.bookings b on b.tenant_id = l.tenant_id and b.customer_id = l.customer_id
  join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
  where l.user_id = (select auth.uid())
    and l.revoked_at is null
    and t.status <> 'closed'
    -- Reserva provisória vencida nunca existiu para o cliente.
    and b.status <> 'expired'
  order by b.starts_at desc
  limit 200
$$;
comment on function public.my_bookings() is
  'Reservas do login atual nos negócios com vínculo ativo. Projeção sem CRM. Só leitura.';
revoke all on function public.my_bookings() from public, anon;
grant execute on function public.my_bookings() to authenticated;
