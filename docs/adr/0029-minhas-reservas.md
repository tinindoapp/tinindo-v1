# ADR-0029 · Minhas reservas (cliente com login)

Status: aceita · 2026-10-25 · integrador (decisão do dono após a auditoria da demo; `docs/qa/AUDITORIA-DEMO-2026-10-25.md`)

## Decisões

1. **Só leitura.** A cliente vê as próprias reservas em `/app/conta/reservas`; remarcar e cancelar continuam com o profissional. Nenhuma ação nova de escrita.
2. **Mesma regra da RLS, em projeção mínima.** `public.my_bookings()` (`security definer`, `search_path` vazio, só `authenticated`) lista as reservas cujo cadastro está ligado ao login por vínculo ativo (`customer_links`, P01), em negócios não encerrados. Devolve negócio, serviço, horário, fuso, situação e preço combinado. Não devolve notas, motivo de cancelamento, origem, ids do CRM nem outros clientes. Reserva provisória vencida não aparece.
3. **Vários profissionais, CRMs separados.** A lista junta os negócios só para a cliente; nenhum profissional vê o que ela tem com outro (UAT cliente de dois, integração 13).
4. **Leitura direta, sem rota de função**, como `my_customer_links()`: sem idempotência (não escreve), validada no cliente pelo contrato `MyBooking`.
5. **Demonstração:** a cliente é a Cliente Exemplo Ana e a lista lê a Agenda da mesma aba (`src/lib/demo/journey.ts`): o que o dono agenda ou conclui aparece para ela; concluída em até 30 dias leva a "Avaliar".

## Fora desta decisão

Reserva pelo link público (`public.book`) e ações da cliente sobre a reserva (cancelar, remarcar) continuam pendentes de decisão.
