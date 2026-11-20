# Handoff · P55 Página do cliente (parte 1: frente)

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
