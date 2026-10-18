# ADR-0011 · Lista de espera, ofertas de vaga e worker do outbox (P06)

Status: aceita · 2026-10-18 · integrador (implementou o P06)

## Decisões

1. **Consentimento antes da fila.** `contact_consents` (finalidade `waitlist_offer`, canal `manual_share`, registrado pelo dono e auditado). Sem consentimento vigente não há entrada nem oferta. Revogar retira da fila e invalida a oferta aberta.
2. **Candidatos pelo worker.** `booking.cancelled.v1` gera `waitlist_candidates` para as entradas ativas cuja janela semanal (horário local) contém o início e cujo serviço cabe no horário livre. A ordem é estável (`joined_at`, `id`) e a chave (entrada, horário) é única, então reprocessar não duplica.
3. **Uma pessoa de cada vez, o dono aprova.** `waitlist.prepare_offer` cria o hold pela agenda (`app.sched_insert_booking`, origem `waitlist`) com a cotação do P05 e um token de 256 bits (só o sha256 fica no banco). O prazo é o menor entre hold e cotação. O hold exclusivo e a constraint do P03 impedem duas ofertas no mesmo horário. No piloto não há política automática nem disparo em massa.
4. **Link: ver ≠ aceitar.** `/oferta#t=…` tira o token da URL e só o envia por POST. `offer_view` não muda estado. `accept_offer` trava a oferta, confere o prazo no banco e confirma o hold com o preço cotado, emitindo `booking.confirmed.v1`. Repetir devolve a mesma reserva, e aceites simultâneos geram uma confirmação. `decline_offer` libera o horário.
5. **Compartilhar ≠ entregar.** A Tinindo não envia mensagens. O dono copia o link ou abre o WhatsApp (wa.me), e o registro vai no máximo a `share_opened`. Uma CHECK impede `sent`/`delivered` no canal manual.
6. **Um mecanismo de fila: o próprio `outbox_events`.** `public.jobs_run()` (só `service_role`) expira ofertas (com `waitlist.offer.expired.v1`) e holds, e despacha eventos com `FOR UPDATE SKIP LOCKED`, lease de 2 min (worker que caiu é retomado), retry com backoff exponencial (15 s · 2ⁿ, até 1 h) e `dead` ao esgotar `max_attempts`. Os handlers são idempotentes. Um evento sem consumidor é concluído sem efeito.
7. **Agendamento.** A Edge Function `jobs` chama `jobs_run` com a chave de serviço, protegida por `X-Tinindo-Jobs-Secret` (`JOBS_SECRET` ≥ 32 caracteres, comparação em tempo constante). O agendamento (Supabase Cron → HTTP a cada minuto) e os segredos são configuração de ambiente (gate do ADR-0006). A correção não depende do cron pontual: comandos de agenda liberam holds vencidos sob lock, e o aceite confere o prazo no banco.
8. Fechar uma oferta (recusa, expiração, retirada) não emite `booking.cancelled.v1`: os próximos candidatos do horário já estão na fila do dono, e assim não há ciclo oferta → cancelamento → candidatos.

## Contrato (aditivo)

Novas operações: `consent.record`, `consent.revoke`, `waitlist.withdraw`, `waitlist.mark_shared`, `waitlist.cancel_offer`, `waitlist.list`, `waitlist.offer_view` e `waitlist.decline_offer`. Campos opcionais em `WaitlistEntry` e `WaitlistOffer` (`token` só na criação, `delivery_state`, `version`).
