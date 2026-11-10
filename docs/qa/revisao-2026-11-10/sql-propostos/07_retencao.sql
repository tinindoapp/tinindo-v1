-- Migration nova (ex.: 2026111x_retencao_tabelas_tecnicas.sql). PRAZOS SÃO DECISÃO DOS DONOS (docs/02 §Retenção): os valores abaixo são a proposta.
-- Depende de 06_jobs_registro.sql (registro public.job_ticks). Não toca audit_events nem livros-caixa (append-only).
create function app.retention_tick(p_batch integer default 500) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_idem integer; v_outbox integer; v_chan integer; v_pay integer; v_lc integer;
begin
  delete from public.idempotency_records i where i.ctid in (
    select x.ctid from public.idempotency_records x where x.completed_at < clock_timestamp() - interval '30 days' limit p_batch);
  get diagnostics v_idem = row_count;
  delete from public.outbox_events o where o.event_id in (
    select x.event_id from public.outbox_events x where x.status = 'done' and x.occurred_at < clock_timestamp() - interval '90 days' limit p_batch);
  get diagnostics v_outbox = row_count;
  delete from public.lifecycle_processed_events l where l.event_id in (
    select x.event_id from public.lifecycle_processed_events x where x.processed_at < clock_timestamp() - interval '90 days' limit p_batch);
  get diagnostics v_lc = row_count;
  delete from public.channel_webhook_events w where w.ctid in (
    select x.ctid from public.channel_webhook_events x where x.received_at < clock_timestamp() - interval '90 days' limit p_batch);
  get diagnostics v_chan = row_count;
  delete from public.payment_webhook_events w where w.ctid in (
    select x.ctid from public.payment_webhook_events x where x.received_at < clock_timestamp() - interval '90 days' limit p_batch);
  get diagnostics v_pay = row_count;
  return jsonb_build_object('idempotency', v_idem, 'outbox_done', v_outbox, 'lifecycle_processed', v_lc, 'channel_webhooks', v_chan, 'payment_webhooks', v_pay);
end $$;
revoke all on function app.retention_tick(integer) from public, anon, authenticated;
insert into public.job_ticks (name, fn, takes_batch, batch, phase, position) values ('retention', 'app.retention_tick', true, 500, 'after_outbox', 90);
