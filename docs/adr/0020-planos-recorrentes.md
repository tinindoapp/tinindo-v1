# ADR-0020 · Planos recorrentes do profissional (P20)

Status: aceita · 2026-10-23 · integrador (onda 2, PR 5; plano em `docs/plano-onda-2.md`)

## Contexto

O profissional quer vender recorrência (ex.: 4 cortes por mês por R$ 200) sem perder o controle: o que a cliente aceitou precisa valer mesmo que o plano mude, o saldo de sessões precisa sobreviver ao cancelamento e nada pode ser cobrado automaticamente sem o P14. O P07 já tem pacotes de sessões com consumo único por atendimento e recebíveis; o P20 compõe sobre isso.

## Decisões

1. **Plano é oferta; assinatura é contrato congelado.** `recurrence_plans` (serviço, sessões por ciclo, ciclo de 7/14/30 dias, preço, ativo) pode mudar a qualquer momento. `recurrence_subscriptions.terms` guarda o snapshot aceito (com `terms_hash`); mudar o plano não altera assinaturas em curso. Adesão nova aceita o plano como está hoje.
2. **Um ciclo = um pacote (P07) + um recebível.** `app.rc_open_cycle` cria `session_packages` com os créditos aceitos, vencendo no fim do ciclo, e `receivables` pelo preço aceito, com `package_id` (o mesmo vínculo de `package.sell`). O consumo de sessões é o do P07 (`package.consume`, débito único por evento); o P07 lista pacotes válidos por cliente e serviço, então o atendimento concluído encontra o ciclo corrente. Créditos não usados não passam de ciclo.
3. **Renovação idempotente pelo worker.** `app.rc_tick` (chamado por `public.jobs_run`, substituído por `create or replace` como no P13) renova assinaturas ativas vencidas sob `for update skip locked`; `UNIQUE (subscription_id, cycle_no)` garante um ciclo por número mesmo com vários workers. Cada ciclo emite `recurrence.cycle.opened.v1` (aditivo em `EventType`).
4. **Cancelamento preserva o aceito.** Ao fim do ciclo (padrão): segue ativa até vencer e então encerra sem renovar; retomar desfaz o pedido. Agora: encerra na hora, mas o pacote do ciclo corrente continua válido até o fim do ciclo (saldo preservado) e o recebível do ciclo fica como está (o dono decide no Caixa).
5. **Cobrança nunca automática no PSP.** O ciclo abre um recebível; o dono cobra pelo P14 (`payment.charge_create`, link e Pix) ou registra o recebimento manual no P07. Cobrança recorrente automática no provedor fica para quando houver PSP contratado e mandato da cliente; o P13 já lembra cobranças vencidas.
6. **Adesão declarada.** `accepted_source = 'owner_declared'`: o dono registra que a cliente aceitou os termos com ele (como no consentimento do P06 e nos pacotes do P07). Aceite pela própria cliente por link (como o orçamento do P11) é expansão futura.
7. **Privacidade e isolamento.** Auditoria guarda ids, preço e sessões, nunca nomes. RLS: dono lê planos, assinaturas e ciclos do próprio negócio; ciclos são append-only.

## Consequências

- `jobs_run` passa a devolver também `recurrence` (renovados e encerrados). Já são três responsabilidades na mesma rodada (outbox, réguas, renovação); se crescer, vale separar a renovação num cron próprio.
- O Caixa (P07) mostra os recebíveis dos ciclos com a descrição "Assinatura … · ciclo n"; o indicador de cobertura de cobrança do P18 não muda.
- Reajuste de preço para quem já assina exige nova adesão (cancelar e assinar de novo), por decisão: o aceito vale até a cliente aceitar outra coisa.
