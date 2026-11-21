# Handoff · Página do cliente, parte 2 (leve, bonita e sem ponta solta)

Sessão: Claude Code na nuvem, para @fffalleiros · 2026-11-21
Branch: `claude/public-client-journey-a4g596` → PR para `main`.
Base: `P55-claude-cliente-final.md`, `P53-camada-comum-parte2.md` (Defeitos encontrados), `P54-regras-de-layout.md` e
`docs/qa/revisao-2026-11-10/14-ux-cliente-final.md`.

## Entregue

### 1. Pacote de JS separado para as rotas públicas (recado #119)

Parti do rascunho da branch `claude/recado-119-pacote-publico`.

- **Escolha do pacote.** `src/main.tsx` olha o caminho (`src/app/public-paths.ts`) e carrega um de dois pacotes:
  - `src/app/public-app.tsx`: perfil, reserva, pagar, orçamento e avaliações públicas, sem sessão nem cliente Supabase;
  - `src/app/mount.tsx`: o app completo.
- **Caminho fora da lista.** Um caminho fora das páginas do cliente recarrega a página, e o `main.tsx` escolhe o app completo.

| JS baixado por página do cliente (`/p`, `/pagar`, `/orcamento`, `/reserva`, `/avaliacoes`) | Bytes |
|---|---|
| Antes | 1.039.293 (304.108 gzip), 7 arquivos |
| Depois, somando os arquivos do build que a página referencia | 650.035 (203.759 gzip) |
| Depois, recebido no `/p` (medido pelo teste) | 577.682 |

- **Teste do teto.** `tests/e2e/network/pacote-publico.spec.ts` falha se uma das cinco páginas passar de 700.000 bytes de JS. Também falha se o pacote do app completo (`mount-*`) entrar nelas.
- **O que ainda pesa:**
  - `react-dom`;
  - `react-router`;
  - o barril `@contracts` inteiro (com o zod), que o `src/lib/api/client.ts` importa. Esse arquivo está fora da área e foi para o recado #159.

### 2. Regras de layout do P54 (390 × 844, limite de 1.688 px)

Medido em `tests/e2e/network/medidas-cliente.spec.ts`. Ele mede altura, contraste nos dois temas, alvos de 44 px, nomes acessíveis e foco visível no primeiro Tab. Com `MEDIR_OUT=arquivo.jsonl`, grava as medidas.

| Tela | Antes | Depois |
|---|---|---|
| Dono · Perfil `/app/perfil` (no ar) | **3.539 px** | 1.120 px |
| Dono · Site e Google `/app/site` | **2.876 px** | 1.664 px |
| Dono · Avaliações | 1.127 | 1.127 |
| Dono · Pagamentos | 1.168 | 1.168 |
| Perfil e reserva `/p/:slug`, passo 1 (com vitrine e destaques) | 1.246 | 1.246 |
| Perfil, seus dados | 879 | 879 |
| Perfil, horário confirmado | 1.380 | 1.380 |
| Ver a reserva `/reserva/:slug` | 872 | 872 |
| Lista de avaliações `/avaliacoes/:slug` | 872 | 872 |
| Avaliar `/avaliar` | 844 | 844 |
| Cobrança `/pagar` | 941 | 941 |
| Orçamento `/orcamento` | 907 | 907 |
| Oferta da lista de espera `/oferta` | 872 | 872 |

**Perfil do dono:**
- A abertura é um `PageHeader` com o texto de privacidade como subtítulo. Saiu o aviso "Demonstração: nada é salvo" (D11 b). O "o link só funciona nesta aba" ficou junto do link.
- Com o perfil no ar, a primeira seção é "Seu perfil está no ar!": data, "Ver como o cliente vê", "Abrir perfil público" e os botões de mandar.
- Quatro seções do kit (`Section collapsed`) nascem recolhidas: "Endereço e o que aparece", "Foto e contato", "Onde, quando e cancelamento" e "Convidar um colega".
- Antes de publicar, nada é recolhido.
- "Mostrar foto" só aparece com foto. Antes, aparecia desligado, com o texto a 2,48:1 de contraste.
- O campo de foto agora tem 44 px.

**Site e Google:**
- A ajuda foi para o `help` do `PageHeader`.
- Saiu o aviso de demonstração (D11 b); o botão "Simular registro no DNS (demonstração)" já diz que é demonstração.
- "Sem promessa de posição no Google." continua visível em uma linha; a explicação foi para a ajuda.
- Recolhidos:
  - "Domínio", quando ainda não há domínio;
  - "Perfil da Empresa no Google", sem acesso concedido;
  - "Entregas", sempre, com contagem.
- O link do assistente foi para a dica do campo. Link dentro de frase é isento do alvo de 44 px (WCAG 2.5.8); antes, tinha 24 px.

**Páginas do cliente:** já cabiam. Não mudou a estrutura, só entrou a vitrine (item 5). O cartão com `ActionRow` na lista de serviços (P54, item 3 das páginas públicas) ficou de fora: a lista do passo 1 é a escolha da reserva, com uma ação ("Escolher dia e hora").

### 3. Defeitos do P53

- **`whatsappLink` do perfil** agora é o `whatsappHref` do kit. Com E.164 curto (menos de 10 dígitos), o WhatsApp abre sem número e com o texto. Teste: `src/features/network/whatsapp-link.test.ts`.
- **`formatDay` (payments)** com data impossível (2026-02-31, 2026-13-01) devolve `data inválida (2026-02-31)`. Antes, devolvia o texto como veio, sem avisar. 29/02 de ano bissexto continua válido. Teste em `labels.test.ts`.

### 4. Dados estruturados, canonical e prévia (D24)

- **Imagem de prévia própria.** `public/og/previa.png`, 1200 × 630, gerada por `worker/gerar-imagem-previa.cjs` (marca e "Agenda e reserva pelo link").
  - Vale no `index.html` e é a imagem padrão do Worker, em cartão grande (`summary_large_image`).
  - Com foto do negócio, a prévia usa a foto (800 × 800, `summary`).
- **JSON-LD:**
  - o perfil tem o negócio, com o tipo pela categoria, endereço e `areaServed`;
  - as páginas do cliente têm `WebPage` com o negócio em `about`.
- **Canonical:** só nas páginas indexáveis (`/p`, `/avaliacoes`). As de token (`/reserva`, `/pagar`, `/orcamento`, `/oferta`, `/avaliar`) levam `noindex` e nenhum canonical.
- **Testes:** `worker/og.test.ts` e `worker/og-default.test.ts`.

### 5. Vitrine do perfil

- **Serviços.** Com a reserva ligada, o passo 1 já mostra cada serviço com a duração e "a partir de R$ X" (com "Mostrar preços"). Sem a reserva, a lista do site agora diz "a partir de" no preço.
- **Fatos.** Na linha de fatos:
  - o endereço (com link para o mapa) ou "Atende em domicílio";
  - o horário de funcionamento (campo D21) ou o "Hoje: …" do site;
  - "Pagamento direto ao profissional".
- **Política** curta logo abaixo.
- **Avaliações em destaque** (`src/features/network/public/ReviewHighlights.tsx`):
  - média com 3 ou mais avaliações;
  - as 3 mais recentes com comentário, sem filtrar pela nota (BRAND.md, Reputação);
  - serviço, mês e "atendimento verificado";
  - link "Ver as N avaliações".
  - A lista vem da API pública do módulo Avaliações (`review.public_list`). O Perfil não importa o módulo: quem monta as rotas (`public-app.tsx` e `mount.tsx`) liga a leitura com `setReviewsReader(readPublicReviews)`. Assim, a demonstração mostra as avaliações de exemplo.
  - O selo "N avaliações de clientes" usa o mesmo número da lista. Na demonstração, o perfil dizia "Perfil novo" enquanto havia avaliações.

### 6. Acessibilidade das páginas públicas

| Medida (13 telas, 390 × 844) | Resultado |
|---|---|
| Contraste mínimo, tema claro | 6,12:1 |
| Contraste mínimo, tema escuro | 7,62:1 (o selo da reputação no perfil) |
| Falhas de contraste | 0 nos dois temas (antes: 2 no claro e 1 no escuro, no Perfil do dono) |
| Alvos menores que 44 px | 0 (antes: Perfil do dono 1, Site 1, reserva e avaliações 1 cada). Exceções: o nome do negócio no cabeçalho do kit público e o "Fechar aviso" do toast, ambos no recado #159 |
| Controles sem nome acessível | 0 |
| Foco no primeiro Tab | Contorno de 3 px em todas as telas |

e2e em 375 px com toque: em `tests/e2e/network/cliente-375.spec.ts`, um teste novo percorre com `tap()`:
- a vitrine: domicílio, horário, política e destaques com link de 44 px;
- a reserva inteira, até "Horário confirmado", sem rolagem horizontal.

## Decisões tomadas aqui

- **Páginas de token:** `noindex` sem canonical, mas com JSON-LD `WebPage`. A prévia do link mostra o negócio, e nada do token vai para o HTML.
- **Destaques:** os mais recentes com comentário, e não as melhores notas.
- **Seções recolhidas com o perfil no ar:** a tarefa depois de publicar é mandar o link.
- **Testes do Perfil e do Site:** os testes da área (`tests/e2e/network/*`, `tests/e2e/presence/site.spec.ts` e os unitários) passaram a abrir a seção antes de editar. Também conferem a ausência do aviso de demonstração (D11 b).
- **Oferta da lista de espera** (`src/features/waitlist`, fora da área): só medida. Coube (872 px) e passou em tudo; nada foi mexido.

## Testes e resultados (local, sobre a `main` de 21/11, com o #158)

| Comando | Resultado |
|---|---|
| `npm run lint` / `typecheck` | ok |
| `npm run test:unit` | 1124/1124 |
| `npm run test:contracts` | 846 ok, 38 pulados (iguais à main) |
| `npm run build` | ok |
| `npx playwright test` (desktop e Pixel 7) | 342 ok |
| Banco, integração e concorrência | Pelo CI. Nenhuma migration, função ou contrato mudou |

## Pendências

- Recado #159 (`para-felipe`):
  - alvo do nome no cabeçalho público;
  - "Fechar aviso" do toast com 40 px;
  - `lib/api/client.ts` importar só os contratos que usa, para o teto do pacote público baixar.
- Nada foi aplicado na homologação.

## Atualização · CI do PR

- **O que falhou.** O e2e do CI falhou em 3 testes de `tests/e2e/foundation`: `menuRoutes`, em `rotas.ts`, e o teste de alvos de toque, em `smoke.spec.ts`. Os dois liam o menu logo depois do `page.goto("/app")`.
- **Por quê.** Com o pacote separado, o app completo chega num pedaço próprio depois do `main.tsx`; numa máquina lenta, o menu ainda não existia na hora da leitura. É o padrão que o P53 já tinha anotado ("e2e lê o DOM antes de a tela carregar").
- **Correção.** Os dois agora esperam o menu ou o `<h1>` antes de ler. Foi só a espera; o que os testes verificam não mudou.
