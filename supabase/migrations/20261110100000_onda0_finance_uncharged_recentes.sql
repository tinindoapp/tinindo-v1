-- Onda 0 (revisão de 10/11): finance_uncharged cortava em 100 a partir das pendências mais antigas.
-- Com mais de 100 atendimentos concluídos sem cobrança no período (a tela pede um ano), as mais novas,
-- justamente as do dia, não chegavam. Agora o corte guarda as 100 mais recentes. A saída continua
-- ordenada por starts_at crescente, como antes; assinatura e permissões não mudam.

create or replace function public.finance_uncharged(p_tenant_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.fin_owner(p_tenant_id);
  perform app.fin_period(p_from, p_to);
  return jsonb_build_object('bookings', coalesce((select jsonb_agg(x order by x->>'starts_at') from (
    select jsonb_build_object(
      'booking_id', b.id, 'customer_id', b.customer_id, 'service_id', b.service_id,
      'starts_at', app.fin_ts(b.starts_at), 'agreed_price_cents', b.agreed_price_cents,
      'completed_event_id', (select o.event_id from public.outbox_events o where o.tenant_id = b.tenant_id
        and o.aggregate_id = b.id and o.event_type = 'booking.completed.v1' order by o.occurred_at desc limit 1),
      'package_ids', coalesce((select jsonb_agg(p.id order by p.created_at) from public.session_packages p
        where p.tenant_id = b.tenant_id and p.customer_id = b.customer_id and p.service_id = b.service_id
          and (p.expires_at is null or p.expires_at >= b.starts_at)
          and p.purchased_credits + coalesce((select sum(e.delta) from public.session_entries e
            where e.tenant_id = p.tenant_id and e.package_id = p.id), 0) > 0), '[]'::jsonb)
    ) as x
    from public.bookings b
    where b.tenant_id = p_tenant_id and b.status = 'completed' and b.starts_at >= p_from and b.starts_at < p_to
      and not exists (select 1 from public.receivables r where r.tenant_id = b.tenant_id and r.booking_id = b.id
                      and r.status <> 'cancelled')
      and not exists (select 1 from public.session_entries e where e.tenant_id = b.tenant_id and e.booking_id = b.id
                      and e.reason = 'consume'
                      and not exists (select 1 from public.session_entries r where r.reversal_of = e.id))
    -- Os 100 mais recentes: com mais de 100 pendências, as novas não podem ficar de fora.
    order by b.starts_at desc limit 100) s), '[]'::jsonb));
end $$;

