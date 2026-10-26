# Handoff · P43 · Reserva pelo link público

Sessão `gabriel-p43-a` · branch `task/p43/gabriel-p43-a` · decisão em `docs/adr/0030-reserva-pelo-link-publico.md`.

## Entregue

- **Banco** (`supabase/migrations/20261026164500_p43_public_booking.sql`):
  - `public_booking_requests` (backend-only): contato informado, código, tentativas, prazo e envio.
  - `public_booking_services(slug)`: nome e duração dos serviços ativos, só para perfil publicado com `booking_link`.
  - `public_booking_request(...)`: trava o recurso, checa a chave, exige canal ativo, aplica os limites e cria o hold pelo `app.sched_insert_booking` (`source = 'public_link'`). Visitante logado com vínculo reserva no próprio cadastro.
  - `public_booking_confirm(request, code)`: 5 tentativas, prazo do hold, preço base congelado, `booking.confirmed.v1`.
  - `public_booking_contact(tenant, booking)`: só o dono lê nome e WhatsApp do pedido.
  - Código por `app.pbk_new_code()`: pgcrypto, sem `random()` e sem viés (alerta do CodeQL resolvido).
  - `channel_dispatch_claim` e `channel_dispatch_result` (P12) estendidos com itens `pbk:` e o modelo `codigo_reserva`.
- **Contratos e registro**: `public.services`, `public.book`, `public.confirm`, `public.contact` (`network.ts`, `operations.ts`, `docs/03`).
- **Agenda**: o detalhe do atendimento vindo do link mostra "Pedido pelo link: nome · WhatsApp" (`port.publicContact`, servidor e demo).
- **Função `network`**: três rotas novas, com tradução do envelope 4xx do código errado.
- **Tela** `/p/:slug`: serviço → dia → horário → nome e WhatsApp → código → confirmado. Mensagens para conflito, limite, sem canal, código errado, tentativas e prazo vencido.
- **Demonstração**: a Agenda da aba segura e confirma (`providePublicBooking` em `src/lib/demo/journey.ts`; `publicHold`/`publicConfirm` no `fixturePort`). O código aparece na tela; nada é enviado.

## Arquivos de outros donos tocados (pedem aceite do integrador)

- `supabase/functions/_shared/contracts/operations.ts`, `network.ts` e `docs/03_CONTRATOS.md`: três operações novas.
- `src/lib/demo/journey.ts`: ponte `providePublicBooking`/`publicBooking`, aditiva.
- `src/features/scheduling/fixturePort.ts`, `SchedulingLayout.tsx`, `port.ts`, `serverPort.ts` e `BookingDetailPage.tsx`: emulação do link na demo e contato do pedido no detalhe.
- e2e de outros pacotes que esperavam "nada foi reservado" (`network/profile.spec.ts`, `qa/jornada-integrada.spec.ts`, `qa/uat-barbeiro.spec.ts`) e `qa/helpers.ts`. A UAT barbeiro 4b deixou de ser pendente.
- Migration nova redefine `channel_dispatch_claim`/`channel_dispatch_result` do P12, com o corpo anterior preservado.

## Testes e resultados

Local (macOS, Postgres 17.11):
- `npm run lint`, `npx tsc -b --noEmit`, `npm run build`: ok.
- `deno check --frozen`: ok.
- `npx vitest run`: 943/943.
- Concorrência `24_public_booking.sh`: 24/24. A suíte inteira passa, menos o `13_messaging.sh` no macOS (`paste`), corrigido no PR #43.
- Integração: 106/106, com o novo `41_p43_reserva_link.test.ts`. Inclui o contato visto pelo dono, `FORBIDDEN` para outro dono e `AUTH_REQUIRED`.
- pgTAP `25_public_booking.test.sql`: 24/24 com um substituto local do pgTAP. No CI roda com o pgTAP real.
- Fluxo à mão no navegador (build): pedido → código errado → código certo → Agenda com "Link de agendamento" e "Pedido pelo link: Maria Visitante · +5511977774343".

No CI do PR #42, rodada do commit ca28b7f:
- pgTAP real, lint/unit, Deno, CodeQL e varredura de segredos: verdes.
- e2e: o teste novo passou em desktop e mobile. Três e2e antigos esperavam o comportamento anterior e foram ajustados no commit seguinte.

## Limitações e próximos passos

- A lista da Agenda continua mostrando "Sem cliente cadastrado" para quem não tem cadastro. O nome e o WhatsApp aparecem no detalhe do atendimento. Transformar o contato em cliente do CRM fica para uma decisão do dono, que não é automática.
- Sem preço dinâmico (P05) no link: confirma pelo preço base.
- Pedidos vencidos ficam na tabela. Não afeta a correção; uma limpeza periódica pode entrar no worker do P06.
- Na demo, o prazo exibido segue o relógio fixo das fixtures (09:00 + 15 min).

## Flags

Nenhuma flag nova. Fora de produção o canal é o provedor simulado do P12; sem canal ativo, o link recusa o pedido com mensagem clara.
