# Handoff · P55 Página do cliente

Sessão: Claude Code na nuvem, para @fffalleiros · 2026-11-20
Branch: `claude/public-client-journey-a4g596` → PR para `main`.
Base: auditorias `docs/qa/revisao-2026-11-10/14-ux-cliente-final.md` e `docs/qa/revisao-2026-11-04/05-cliente-final.md`; decisões D18 a D24 (`docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md`).

## Entregue neste PR

- **Uma moldura para as páginas do cliente (D18).** Cabeçalho do negócio (foto ou inicial, nome, categoria e bairro), coluna de 560 px, a Tinindo só no rodapé ("Página feita com a Tinindo"). Vale para `/p/:slug`, `/pagar`, `/orcamento` e `/avaliacoes/:slug`. Carregamento com esqueleto no lugar de "Carregando…".
- **Uma página pública só (D19).** `/s/:slug` redireciona para `/p/:slug` (no app e com 301 no Worker). O perfil mostra a frase, os horários ("Hoje: 09:00–18:00" e a semana recolhida) e, sem reserva on-line, a lista de serviços com preço do site publicado. `PublicSitePage` saiu.
- **Perfil (auditoria 14 §3.1).** Sem o botão redundante "Ver horários livres": a reserva aparece na primeira tela. Do passo 2 em diante o cabeçalho recolhe para 40 px e selos, texto e rodapé saem da frente. WhatsApp vira o link discreto "Prefere combinar por mensagem?". Linha "Pagamento direto ao profissional".
- **D20 na frente.** Saíram "Tem login? Veja em Minhas reservas" e o rodapé "Avaliar meu atendimento · Minhas reservas". A confirmação diz "Para remarcar ou cancelar, fale com <negócio> pelo WhatsApp" e o botão é "Falar com <negócio> no WhatsApp".
- **Pagamento (§3.2, 05 #7, #11, #19).** Valor grande, "Pague até HH:MM de hoje" (do `expires_at` que o servidor já manda), botão "Copiar código Pix" de largura total, "No app do banco, confira se quem recebe é <nome>…", tela própria de "Pagamento confirmado · Não precisa mandar comprovante", link vencido com "Este link de pagamento não vale mais" e saída.
- **D22.** A simulação de pagamento ("Pagar (simulação)", "Deixar expirar", Pix falso) só aparece com a porta da demonstração offline. Com servidor e cobrança simulada, o cliente vê "Esta cobrança é um teste e não pode ser paga…", sem código nem botão.
- **Orçamento (§3.3, 05 #10, #15).** Fora do cartão de login. Título "Orçamento: <título>", etiqueta de validade, itens com "2 × R$ 40,00" só quando a quantidade passa de 1, total em faixa própria, "Ao aceitar, você reserva: …", **"Recusar" pede confirmação**, "Pedir ajuste pelo WhatsApp" quando o número é conhecido, tela própria de aceito. O código (hash) saiu da vista; "Versão N" no rodapé.
- **Avaliações públicas (05 #12).** "Avaliações de <negócio>" com o cabeçalho do negócio e "não encontrado" com saída.
- **"Não encontrado" com saída em todas.** "Falar com <negócio> no WhatsApp" e "Ver a página de <negócio>" quando o negócio é conhecido, e sempre "Tentar de novo".
- **Links com o endereço do negócio.** A cobrança e o orçamento passam a sair como `/pagar/<slug>#t=…` e `/orcamento/<slug>#t=…` quando o perfil está publicado (o token continua no fragmento). Isso dá cabeçalho e saída mesmo com o token vencido, e a prévia do WhatsApp sabe quem mandou. As mensagens prontas do dono dizem o nome: "Oi, Ana! Aqui é <negócio>. Segue o Pix…".
- **Prévia do link (D24, 05 #6, 14 #13), `worker/og.ts`.** `/pagar/:slug`, `/orcamento/:slug`, `/avaliar/:slug`, `/reserva/:slug` e `/avaliacoes/:slug` levam o nome do negócio ("Pagamento · <nome>" / "<nome> enviou um link de pagamento. Abra para ver o valor e o prazo."). Sem endereço, prévia neutra voltada ao cliente (nunca o slogan para profissionais). `/p/:slug` ganha `canonical` e JSON-LD (`HairSalon` ou `LocalBusiness`, sem nota nem endereço inventado). Páginas com token levam `noindex`. "no Tinindo" → "na Tinindo". Imagem sempre absoluta.
- **Pacote separado, parte dos módulos.** As rotas públicas ficam em arquivos sem a tela do dono, sem sessão e sem o cliente Supabase: `network/public-routes.tsx` (`networkAnonRoutes`), `payments/public-routes.tsx`, `sales/public-routes.tsx`, `reputation/public-routes.tsx` (`reputationAnonRoutes`), `presence/public-routes.tsx`. Os `module.tsx` reexportam os mesmos nomes, então `src/app/router.tsx` não muda.

## O que ficou fora (precisa do integrador ou do próximo PR)

1. **Ligar o pacote separado (item 5).** Falta o ponto de entrada: `src/main.tsx` escolher, pelo caminho, entre um `public-app.tsx` (só as rotas acima) e o app completo, com `import()` dinâmico. São arquivos de `src/app` e `src/main.tsx` (integrador). Issue `para-felipe` aberta com o código pronto. Sem isso o pacote continua com ~1,6 MB; as rotas já estão prontas para separar.
2. **`wrangler.jsonc` e `wrangler.homolog.jsonc`**: `run_worker_first` precisa incluir `/s/*`, `/pagar`, `/pagar/*`, `/orcamento`, `/orcamento/*`, `/avaliar`, `/avaliar/*`, `/reserva`, `/reserva/*`, `/avaliacoes/*`, `/oferta`. Sem isso o Worker só roda em `/p/*` e `/s/*` e as prévias novas não aparecem. Na mesma issue.
3. **`index.html`**: `og:image` padrão é relativo (o WhatsApp ignora). Na mesma issue.
4. **D22 no servidor.** A função `payments` ainda aceita o pagamento simulado pelo link; a tela não oferece mais, mas a trava no servidor é de `supabase/functions/payments` (fora da área). Na mesma issue.
5. **Jornada do link no servidor** (corrigir o número libera o pedido anterior, tentativas zeradas com limite, estado real do envio e "Reenviar código", preço, política e local antes de confirmar, bairro em domicílio, campos D21 no perfil, ver a reserva e avaliar por link com token): vai no PR 2, com migration nova.
6. Imagem de prévia neutra própria: `public/` só tem o ícone do app; segue o ícone, com URL absoluta.

## Decisões tomadas aqui

- **Kit público copiado em quatro módulos.** O lint proíbe um módulo importar outro e `src/app`, `src/components/ui` e `src/lib` são do integrador. O kit (`public-kit.tsx` + `.css`) existe em `network`, `payments`, `sales` e `reputation`; `network/public-kit.sync.test.ts` falha se as cópias divergirem. Proposta ao integrador: mover para `src/components/public/` e apagar as cópias. Mesmo caso para `owner-slug.ts` (payments e sales).
- `/s/:slug` no app: com servidor, a página `/p` lê o site publicado pela API (`presence.public_site`); na demonstração o site de exemplo segue no estado da navegação.
- Perfil sem `display_name`: o nome é a categoria; a prévia de páginas com token fica neutra nesse caso.

## Testes e resultados (local)

| Comando | Resultado |
|---|---|
| `npm run lint` | ok |
| `npm run typecheck` | ok |
| `npm run test:unit` | 898+ ok (125 arquivos) |
| `npm run test:contracts` | ok |
| `npm run build` | ok |
| `npx playwright test` (desktop + Pixel 7) | 283 ok |
| `tests/e2e/network/cliente-375.spec.ts` (375 × 812, novo) | ok |
| `npx vitest run --project unit worker` | 24 ok |

Nenhuma migration neste PR. Nada aplicado em homologação.

## Flags e mocks

Nenhuma flag nova. Demonstração continua rotulada; a simulação de Pix só nela.

---

# Parte 2 · Jornada do link no servidor e na tela (PR 2)

## Entregue

Migration `supabase/migrations/20261120091000_p55_public_link_journey.sql` (append-only; nada aplicado em homologação):

- **Corrigir o WhatsApp libera o pedido anterior (05 #2).** `public_booking_request` ganhou `p_supersedes`: o pedido anterior da mesma tela é encerrado (`cancelled`) e o horário é liberado na mesma transação, antes de segurar o novo. Dá para pedir o mesmo horário com o número certo. Id desconhecido ou que já não espera é ignorado, sem revelar nada. A tela só usa isso quando o número mudou. Com o mesmo número, continua o aviso "Já existe um pedido…" (decisão do P43).
- **Pedir de novo zera as tentativas (05 #1).** O pedido novo nasce com 0 tentativas. Os limites por contato e por hora seguem (3 no negócio, 6 em toda a Tinindo, 30 por perfil), o que dá no máximo 15 palpites por hora num negócio. Na 5ª tentativa errada, o horário é liberado e o pedido vira `exhausted` na mesma chamada, sem `raise`. O código errado devolve `details.attempts_left`.
- **Estado real do envio e "Reenviar código" (05 #3).** `public_booking_status` mostra o envio (fila, enviado, falhou, sem confirmação), as tentativas e os reenvios restantes. `public_booking_resend` reenvia o mesmo código até 2 vezes, com 30 s entre um e outro, e o despacho pega o pedido de volta pela fila (`queued_at`). A tela consulta a cada 4 s enquanto o código está na fila e mostra "Reenviar código (em N s)" e "Falar com <negócio>".
- **Preço, política e local antes de confirmar (D23, 05 #5).**
  - A resposta do pedido traz serviço, duração, `price_cents` (o preço base que a confirmação congela), `place` (endereço ou domicílio) e `policy`.
  - A confirmação traz o mesmo, mais o nome do negócio.
  - A tela mostra isso nos passos 3 e 4 e na confirmação. O `.ics` leva o local.
- **Bairro em domicílio.** Com `home_service`, o pedido exige `neighborhood` (400 `neighborhood`). O dono vê o bairro em `public.contact`.
- **Campos do perfil (D21).** Colunas `address`, `home_service`, `opening_hours` e `cancellation_policy`, gravadas por `network_profile_details_set` (só o dono, idempotente, auditoria sem o texto) e lidas em `details` no perfil público. Na tela:
  - o dono preenche no cartão "Onde, quando e cancelamento";
  - o perfil público mostra o endereço com link para o mapa, ou "Atende em domicílio", o horário e a política.
- **Ver a reserva e avaliar por link com token (D20).**
  - Tabela `booking_links`, só backend, guarda apenas o sha256 do token de 256 bits.
  - A confirmação devolve `booking_token`; repetir a confirmação devolve o mesmo token.
  - O dono gera links com `booking_link.issue`. A URL sai como `/reserva/<slug>#t=…`.
  - O cliente usa `booking_link_view`, `booking_link_review_submit` e `booking_link_review_withdraw`. As regras são as do `review_submit`: atendimento concluído, janela de 30 dias, uma avaliação por atendimento, sem autor.
  - Em `reviews`, `author_user_id` passou a aceitar nulo e entrou `author_link_id`; uma das duas colunas é obrigatória.
  - Página nova `/reserva` e `/reserva/:slug`: a reserva, "Falar com <negócio>", estrelas de 44 px, comentário opcional e "Retirar avaliação" com confirmação.
  - A confirmação na tela leva a "Ver minha reserva".
- **Mensagens com o nome do negócio (05 #8).**
  - O código da reserva sai como "Código de <negócio>: 123456. Use para confirmar …".
  - Os modelos ao cliente (confirmação, lembrete, link de orçamento, oferta de vaga, lembrete de orçamento, lembrete de cobrança, pacote vencendo) ganharam `{{negocio}}`. Um gatilho em `channel_messages` e em `lifecycle_steps` troca o marcador pelo nome do negócio. Reativação e campanha já recebiam o nome.
- **Contratos e função `network`.**
  - Operações novas: `public.status`, `public.resend`, `profile.details`, `booking_link.issue`, `public.booking`, `public.review` e `public.review_withdraw`. Estão em `operations.ts` e `docs/03`.
  - Os campos novos de `PublicBookOutput` e `PublicConfirmOutput` são opcionais, para tolerar servidor antigo.
  - `docs/02_DICIONARIO.md` foi regenerado.

## Testes alterados de propósito

- pgTAP 25 e o script de concorrência 24: "trocar não zera as tentativas" passou a "pedido novo começa zerado". Depois de 5 erradas, o horário é liberado em vez de continuar provisório. A checagem do despacho passou a usar um pedido ainda pendente.
- pgTAP 09, 13 e 15 e integração 30, 32 e 41: a chave `details` no perfil e os textos das mensagens com o nome do negócio.
- Contrato P43: lê a definição mais nova da função. `price_cents` passou a ser permitido no pedido e na confirmação, porque é o preço do serviço escolhido, não o catálogo.
- e2e `trocar-pedido` e `public-booking`, e o unitário `network.test.tsx`: textos novos ("Código não confere… Restam N", "Guardamos este horário até…", "Seu pedido anterior: …").

## Testes novos

- `supabase/tests/database/40_p55_public_link_journey.test.sql` (49 asserções).
- Concorrência 4b e 4c em `tests/db-concurrency/24_public_booking.sh`:
  - oito códigos errados ao mesmo tempo gravam 5 tentativas e liberam o horário uma vez só;
  - a correção do número mantém o horário.
- `tests/integration/49_p55_jornada_link.test.ts` (6 passos pelos handlers).
- `src/features/network/journey.test.ts` (7).
- `tests/e2e/network/jornada-link.spec.ts` (3 × desktop e celular).

## Resultados (local, sobre a main de 20/11 09:00)

| Comando | Resultado |
|---|---|
| `npm run lint` / `typecheck` | ok |
| `npm run test:unit` | 991/991 |
| `npm run test:contracts` | 842 ok, 2 falhas esperadas e 38 pulados (iguais na main) |
| `npm run db:test:local` | todos passaram |
| `npm run db:test:concurrency` | todos passaram |
| `npm run test:integration` | 151/151 |
| `npm run check:functions` | ok |
| `npm run build` | ok |
| `npx playwright test` | 312 ok |
| `db-dictionary.sh --check` e `check-migrations.mjs` | ok |

## Pendências (fora da área ou próximos passos)

- **Botão do dono "Mandar link da reserva" no detalhe do atendimento.** É tela da Agenda (`src/features/scheduling`). A API `booking_link.issue` está pronta. Registrado na issue de recado.
- **Modelos aprovados na Meta.** O marcador `{{negocio}}` é preenchido no texto que o canal guarda e manda. No WhatsApp oficial, cada modelo precisa ser reaprovado com o nome como variável numerada antes de ligar o provedor real; hoje só o simulado está aprovado.
- **Limpeza periódica** de pedidos encerrados e de links antigos: candidata a uma linha em `job_ticks` (P56).
