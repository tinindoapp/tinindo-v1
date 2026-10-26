# Handoff · P43 · Reserva pelo link público

Sessão `gabriel-p43-a` · branch `task/p43/gabriel-p43-a` · decisão em `docs/adr/0030-reserva-pelo-link-publico.md`.

## Entregue

- **Banco** (`supabase/migrations/20261026164500_p43_public_booking.sql`):
  - `public_booking_requests` (backend-only): contato informado, código, tentativas, prazo e envio.
  - `public_booking_services(slug)`: nome e duração dos serviços ativos, só para perfil publicado com `booking_link`.
  - `public_booking_request(...)`: trava o recurso, checa a chave, exige canal ativo, aplica os limites e cria o hold pelo `app.sched_insert_booking` (`source = 'public_link'`). Visitante logado com vínculo reserva no próprio cadastro.
  - `public_booking_confirm(request, code)`: 5 tentativas, prazo do hold, preço base congelado, `booking.confirmed.v1`.
  - `channel_dispatch_claim` e `channel_dispatch_result` (P12) estendidos com itens `pbk:` e o modelo `codigo_reserva`.
- **Contratos e registro**: `public.services`, `public.book`, `public.confirm` (`network.ts`, `operations.ts`, `docs/03`).
- **Função `network`**: três rotas novas, com tradução do envelope 4xx do código errado.
- **Tela** `/p/:slug`: serviço → dia → horário → nome e WhatsApp → código → confirmado. Mensagens para conflito, limite, sem canal, código errado, tentativas e prazo vencido.
- **Demonstração**: a Agenda da aba segura e confirma (`providePublicBooking` em `src/lib/demo/journey.ts`; `publicHold`/`publicConfirm` no `fixturePort`). O código aparece na tela; nada é enviado.

## Arquivos de outros donos tocados (pedem aceite do integrador)

- `supabase/functions/_shared/contracts/operations.ts`, `network.ts` e `docs/03_CONTRATOS.md`: três operações novas.
- `src/lib/demo/journey.ts`: ponte `providePublicBooking`/`publicBooking`, aditiva.
- `src/features/scheduling/fixturePort.ts` e `SchedulingLayout.tsx`: emulação do link público na Agenda da demo.
- Migration nova redefine `channel_dispatch_claim`/`channel_dispatch_result` do P12, com o corpo anterior preservado.

## Testes e resultados (local, macOS, Postgres 17.11)

- `npm run lint`, `npx tsc -b --noEmit`, `npm run build`: ok.
- `deno check --frozen` das funções: ok.
- `npx vitest run` (unitários e contratos): ok, incluindo `network/handler.test.ts` (5 novos), `tests/contracts/network/public-booking.test.ts` e `network.test.tsx` (fluxo completo na demo).
- Concorrência `tests/db-concurrency/24_public_booking.sh`: 24/24.
  - 20 visitantes no mesmo horário: 1 hold e 19 `SLOT_CONFLICT`.
  - 10 repetições da mesma chave: 1 pedido.
  - 5 confirmações simultâneas: 1 evento.
  - Também cobre tentativas, prazo vencido, limite por contato, CRM intocado e despacho.
- Suíte de concorrência inteira: ok. Única falha é o `13_messaging.sh`, que falha só no macOS (`paste -sd+` sem `-`). Com esse ajuste numa cópia local, passou inteiro com a migration nova.
- Integração `npm run test:integration`: 106/106, com o novo `41_p43_reserva_link.test.ts` (8).
- pgTAP `25_public_booking.test.sql` (20): sem a extensão pgTAP nesta máquina. Rodou com um substituto local mínimo de `plan/ok/is/throws_ok` e passou 20/20. O CI roda com o pgTAP real.
- e2e `tests/e2e/network/public-booking.spec.ts` (desktop e mobile) e ajuste em `public.spec.ts`: não rodaram aqui, porque o Chromium do Playwright não abre no sandbox desta máquina. O mesmo fluxo foi feito à mão no navegador sobre `vite preview` do build: pedido, código errado, código certo e Agenda com "Link de agendamento". Ficam para o CI.

## Limitações e próximos passos

- O dono vê o nome do visitante só no banco (`guest_ref`). A Agenda mostra "Sem cliente cadastrado" porque o contrato `Booking` não traz `guest_ref` nem o telefone do pedido. Próximo passo: proposta de contrato para mostrar nome e contato do pedido no detalhe do atendimento.
- Sem preço dinâmico (P05) no link: confirma pelo preço base.
- Pedidos vencidos ficam na tabela. Não afeta a correção; uma limpeza periódica pode entrar no worker do P06.
- Na demo, o prazo exibido segue o relógio fixo das fixtures (09:00 + 15 min).

## Flags

Nenhuma flag nova. Fora de produção o canal é o provedor simulado do P12; sem canal ativo, o link recusa o pedido com mensagem clara.
