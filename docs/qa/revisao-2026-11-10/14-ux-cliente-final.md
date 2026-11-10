# 14 · UX e design do que o cliente final vê

Auditoria de 10/11/2026, `main` em `8e113c4`, demonstração offline servida em `http://127.0.0.1:4173`. Celular em 390×844 e 360×740, tema claro. Rodada retomada com orçamento curto: aproveitei as medidas e capturas da primeira tentativa (pasta `trabalho/ux-cliente-final/`), conferi por amostra e reli o código de cada achado.

## Resumo

**Veredito: misto.**

- **O fluxo está no tamanho certo.** Reservar em 4 passos, código pelo WhatsApp num campo só, alvos de 44 px, textos humanos e "abrir esta página não aceita nada". Isso deve ficar.
- **Como vitrine, está simples demais.** O perfil mínimo é nome, região e um formulário. Não há endereço, descrição, horário de funcionamento nem política. Não parece golpe, mas também não parece o negócio de alguém.
- **A marca na página é a Tinindo, não o profissional.** No orçamento e na oferta o logotipo tem 144 px e o nome do negócio está em texto de 16 px.
- **Em largura, está exagerado.** São 12 rotas do cliente em 5 molduras visuais diferentes, duas páginas públicas para o mesmo negócio (`/p` e `/s`) e um diretório para um piloto de 6 a 10 profissionais.
- **Toda página pública baixa o app inteiro do profissional**: 1.589.139 bytes de JS num arquivo, 16% usados, tela vazia por 2,3 a 3,0 s em rede de celular simulada.
- **Um risco de dinheiro:** com servidor, "Recebimento simulado" é o padrão do profissional, e a página do cliente mostra um Pix falso e o botão "Pagar (simulação)", que o servidor aceita. Não testei com servidor; li o código.
- As páginas de pagamento, orçamento e avaliação funcionam, mas têm acabamento de formulário interno. Proponho o redesenho das quatro páginas principais na seção 3.

O relatório `docs/qa/revisao-2026-11-04/05-cliente-final.md` cobre os defeitos de funcionamento (bloqueio por código, "Corrigir" o número, reenvio, vínculo, textos). Não repito: cito como "05 #N".

## 1. O que medi e de onde vem cada dado

| Dado | Fonte |
|---|---|
| Posição e tamanho dos elementos do perfil | `trabalho/ux-cliente-final/log-perfil-m390-full.json`, `log-perfil-m360-min.json` |
| Texto, moldura (`mainClass`) e botões de cada rota | `log-fluxos-m390.json`, `log-fluxos-m360.json` |
| Peso da página e cobertura de código | `log-perf.json` |
| Tempo até o primeiro conteúdo com rede limitada | `log-perf2.json` (3 medidas por cenário) |
| Capturas | `trabalho/ux-cliente-final/shots/` (perfil mínimo em 360, perfil completo em 390, fluxos com token nas duas larguras) |

Conferência por amostra: `ls -la dist/assets` dá 1.589.139 bytes para `index-BAq6pvoJ.js`, igual ao registro; `gzip -9` dá 446.093 bytes, contra 447.705 do registro.

## 2. Respostas às perguntas do briefing

### 2.1 Primeira impressão e confiança

- **Parece golpe?** Não no perfil. Nas páginas com token, o risco existe: a pessoa recebe um link de cobrança, abre e vê primeiro a palavra "TININDO", que ela não conhece, e só depois "Pagar Barbearia do Léo". A prévia do link também fala da Tinindo (05 #6).
- **Parece negócio de verdade?** Pouco. Captura `m360-min-01-perfil-inteiro.png`: categoria, nome, "Centro, Campinas", um botão, uma pílula "2 avaliações de clientes" sozinha num cartão e o formulário. Com foto e WhatsApp (`m390-full-01-perfil-topo.png`) melhora, mas continua sem endereço, descrição e horário.
- **O que passa confiança hoje e deve ficar:** "Seu número só vai para este profissional", "Abrir esta página não aceita nada", avaliações sem nome do autor, "sem destaque pago".

### 2.2 De quem é a marca

| Página | Primeiro elemento | Onde está o negócio | Evidência |
|---|---|---|---|
| `/p/:slug` | Logotipo Tinindo 120×30 (y 19–49) | h1 de 24 px logo abaixo (y 87–117); foto opcional de 96 px | `src/app/PublicLayout.tsx:12`, `PublicProfileView.tsx:89-90` |
| `/pagar` | Logotipo Tinindo 132 px | h1 "Pagar <negócio>" | `PayLinkPage.tsx:72-73` |
| `/orcamento` | Logotipo Tinindo 144 px | linha de corpo, 16 px, junto do título do orçamento | `QuoteLinkPage.tsx:82-83, 89` |
| `/oferta` | Logotipo Tinindo 144 px | linha "Onde" de uma lista | `OfferPage.tsx:73-74` |
| `/avaliar`, `/avaliacoes/:slug` | h1 genérico, sem marca nenhuma | no meio do texto | `ReviewPages.tsx:380-381, 442-443` |
| `/s/:slug` | cartão do negócio, sem Tinindo no topo | h1 | `PublicSitePage.tsx:19-28` |

Só o site (`/s`) põe o profissional em primeiro lugar. É a hierarquia certa e deveria valer para todas (achado 02).

### 2.3 Foto, serviços, preço, endereço e política

- **Foto:** opcional, círculo de 96 px. Sem foto não há nada no lugar (nem inicial).
- **Serviços:** aparecem só dentro do passo 1 da reserva. Preço "a partir de" só se o dono ligar (`PublicProfileView.tsx:481`); o padrão é desligado (05 #5).
- **Endereço, horário de funcionamento, política de cancelamento:** não existem no contrato do perfil (`supabase/functions/_shared/contracts/network.ts:9-13`, `35-37`). O horário de funcionamento existe no site (`/s`), não no perfil.
- **Canal de reclamação:** "Fale com a equipe Tinindo" sem link (05 #18).

### 2.4 Fluxo de reserva

Quatro passos é adequado. O que atrapalha é a moldura em volta:

- O bloco de reserva começa em y 370 de 844 (44%) no perfil completo e em y 343 de 740 (46%) no mínimo.
- O botão "Ver horários livres" leva a um bloco que já está 97 px abaixo dele, e continua preto no topo durante todos os passos e depois de "Horário confirmado" (`m390-full-08-confirmado.png`).
- No passo "Seus dados" em 390×844 (`m390-full-04-passo3-dados.png`), o rótulo "WhatsApp com DDD" está em y 763; o campo e os botões ficam fora da tela antes de o teclado abrir.
- No passo do código, o cartão tem 609 px e traz dois avisos antes do campo (um deles é da demonstração).
- Depois: "Horário confirmado" é um aviso verde; as duas ações são secundárias; não há preço, endereço (05 #5) nem "o que acontece agora".

### 2.5 Estados de erro

Os textos são bons e já foram revistos (05 seção 4). Do ponto de vista de desenho:

- Link inválido em `/orcamento`, `/oferta` e `/pagar` mostra o título da página normal ("Vaga disponível", 05 #13) com um aviso amarelo embaixo. Não há ação: nem "falar com o profissional", nem voltar.
- `/p/:slug` inexistente: "Perfil não encontrado" sem logotipo e sem saída (`log-fluxos-m390.json`, `86-perfil-direto`, `wordmark: None`, `botoes` vazio).
- Carregamento: só o texto "Carregando…" (`PublicPages.tsx:31`, `PayLinkPage.tsx:76`).

### 2.6 Velocidade percebida

Sim, o pacote inteiro do app carrega para abrir uma página pública.

| Medida | Valor | Fonte |
|---|---|---|
| JS (único arquivo) | 1.589.139 bytes; 447.705 gzip; 357.056 brotli | `log-perf.json`, `dist/assets` |
| JS usado em `/pagar` | 257.054 de 1.583.971 bytes (16,2%) | `log-perf.json` |
| CSS | 115.647 bytes; 7.274 usados (6,3%) | `log-perf.json` |
| Fonte | 72.920 bytes (Inter latin) | `log-perf.json` |
| Conteúdo antes do JS | nenhum (`#root` vazio) | `index.html:34`, `log-perf2.json` |
| Tempo até o h1, 1,6 Mbps e 150 ms | 3,04 / 3,01 / 3,03 s | `log-perf2.json` |
| Tempo até o h1, 4 Mbps, 100 ms, CPU 4× | 2,27 / 2,32 / 2,31 s | `log-perf2.json` |
| Sem limite | 0,38 a 0,45 s | `log-perf2.json` |

Causa: `src/app/router.tsx:3-16` importa todos os módulos de forma estática; `vite.config.ts:70` não divide o pacote. Os tempos são contra o servidor local; com TLS, rede real e a chamada ao servidor, o número real é maior (inferência).

### 2.7 Prévia do link e busca

- `/p` e `/s`: o Worker troca título e descrição e usa a foto quando existe (`worker/og.ts:107-121`). Bom.
- Sem foto, e sempre no site, a imagem é o ícone do app Tinindo (`og.ts:104`, `121`, `135`). Cartão "summary" (quadrado pequeno).
- No navegador, a descrição da página do perfil continua a do app, não há `canonical` nem dados estruturados (`log-perfil-m390-full.json`: `metaDesc`, `canonical: null`, `jsonld: 0`).
- `public/` não tem `robots.txt` nem sitemap.
- A versão indexável do site existe só na função do Supabase (`supabase/functions/presence/handler.ts:4`, `150`), fora do domínio do app.
- `/pagar`, `/orcamento`, `/oferta`: prévia genérica do app (05 #6).

### 2.8 Acabamento comparado às telas do profissional

- **Igual:** tokens, fundo, botão preto, cartões, avisos. Não há laranja em botão ou estado.
- **Pior:** espaçamento dentro dos cartões (aviso colado no botão em `/pagar`, `/orcamento` e na confirmação), botões principais estreitos (Copiar Pix com 119 px numa coluna de 358), valor e total sem destaque, cinco molduras.
- **Melhor que o resto:** o indicador de passos e o resumo "Corte · ter 20/10 · 13:45".

## 3. Redesenho das quatro páginas principais

Vale para as quatro: uma moldura só (achado 06), com **cabeçalho do negócio** (foto ou inicial em círculo, nome como h1, categoria e bairro), coluna de até 560 px, e **rodapé Tinindo** discreto ("Agendamento por Tinindo", link "o que é isto", canal de contato). Botão principal de largura total no celular. Estado final como tela própria (achado 08).

### 3.1 Perfil com reserva (`/p/:slug`)

Arquivos: `src/features/network/PublicProfileView.tsx`, `network.css`, `src/app/PublicLayout.tsx`.

1. **Cabeçalho do negócio.** Foto de 72 px (ou inicial), nome, "Barbearia · Centro, Campinas", e ao lado a nota ("4,7 ★ · 12 avaliações") ou "Perfil novo". Sem logotipo Tinindo no topo.
2. **Linha de fatos**, só o que existir: endereço com link para o mapa (ou "atende em domicílio"), "Hoje: 09:00–18:00" com o resto da semana ao tocar, "Pagamento direto ao profissional".
3. **Sobre**: uma ou duas linhas (`bio`).
4. **Agendar**: é o bloco principal e aparece na primeira tela. Serviços com duração e preço; tocar no serviço já leva ao dia e hora. Sem o botão "Ver horários livres" quando o bloco está logo abaixo; "Conversar no WhatsApp" vira link discreto ("Prefere combinar por mensagem?").
5. **Durante a reserva** (passo 2 em diante): o cabeçalho recolhe para uma barra de 48 px (foto pequena e nome), a linha de fatos e as avaliações somem, o assistente sobe para o topo e o botão do passo fica numa barra fixa no rodapé. O resumo mostra "Corte · 30 min · R$ 60,00 · ter 20/10 · 13:45".
6. **Horários** agrupados em Manhã, Tarde e Noite, com o dia escolhido por extenso.
7. **Código**: resumo, "Mandamos um código para (19) 97777-4343 · Corrigir", campo, "Guardamos o horário até 09:15". Reenvio conforme 05 #3.
8. **Confirmado** (tela inteira): selo verde, "Horário confirmado", bloco com serviço, dia, hora, valor e local, botão principal "Adicionar à agenda", secundário "Falar com <negócio> no WhatsApp", linha "Para remarcar ou cancelar, fale com o profissional".
9. **Abaixo da reserva**: duas avaliações mais recentes com "ver todas", política de cancelamento em uma frase, rodapé Tinindo com o aviso legal em uma linha e canal de contato real.

Manter: os 4 passos, o indicador, o campo único do código, os textos de erro.

### 3.2 Pagamento (`/pagar`)

Arquivos: `src/features/payments/PayLinkPage.tsx`, `payments.css`.

1. **Quem cobra**: cabeçalho do negócio e "Cobrança de Corte" (sem o nome do cliente na descrição; 05 #19).
2. **Quanto e até quando**: valor em 32 a 40 px; etiqueta "Aguardando pagamento"; "Pague até 14:35 de hoje" (`expires_at` já vem do servidor).
3. **Como pagar**: botão "Copiar código Pix" de largura total; depois de copiar, o botão confirma "Código copiado" e aparece "Abra o app do seu banco e escolha Pix copia e cola". QR Code recolhido em "Pagar por QR Code" (útil para quem abre no computador). Linha de segurança: "No banco, confira se o recebedor é <nome>. Se for outro, não pague."
4. **Pago** (tela própria): selo verde, "Pagamento confirmado", valor, data e hora, "Não precisa mandar comprovante".
5. **Vencido ou cancelado**: "Este link não vale mais" e o botão "Pedir novo link a <negócio>" (WhatsApp, quando houver número).
6. **Simulação nunca aparece para cliente** fora da demonstração (achado 01).

### 3.3 Orçamento (`/orcamento`)

Arquivo: `src/features/sales/QuoteLinkPage.tsx`.

1. Cabeçalho do negócio e o título "Orçamento: Corte e Barba". Etiqueta visível "Válido até 27/10".
2. Itens em lista: descrição à esquerda, valor à direita; quantidade só quando for maior que 1 ("2 × R$ 40,00").
3. **Total** em 24 px, numa faixa própria.
4. Bloco destacado: "Ao aceitar, você reserva: quarta-feira, 21/10, das 10:00 às 10:30 (Corte)".
5. Observações do profissional, se houver.
6. "Abrir esta página não aceita nada. Aceitar não é pagar." (mantido).
7. Botão "Aceitar orçamento" de largura total; "Recusar" como ação discreta, com confirmação (05 #10); "Pedir ajuste pelo WhatsApp" quando houver número.
8. **Aceito** (tela própria): selo, "Orçamento aceito", horário reservado, "Adicionar à agenda", "O pagamento é combinado com <negócio>".
9. "Versão 1" e o código ficam no rodapé em letra pequena, ou saem (05 #15).

Sair do cartão de login centralizado (`tn-auth`): o conteúdo começa no topo.

### 3.4 Avaliar (`/avaliar`)

Arquivo: `src/features/reputation/ReviewPages.tsx`.

1. Cabeçalho do negócio e a pergunta como título: "Como foi seu Corte em 19/10?".
2. **Cinco estrelas** de 44 px; ao tocar, o rótulo aparece ("4 · Muito bom"). Mesmo símbolo que a página pública de avaliações já usa.
3. Comentário opcional, com a dica "O que você contaria a um amigo?".
4. "Seu nome não aparece. <Negócio> pode responder." ao lado do botão "Publicar avaliação" (largura total).
5. **Publicado** (tela própria): "Obrigado!", a prévia de como ficou e "Retirar avaliação" como ação discreta.
6. Uma avaliação por página, aberta por link do profissional. A lista "Suas avaliações" e o link "Minhas reservas" saem daqui. Isso depende da decisão sobre conta do cliente (achado 11 e 05 #4).

## 4. Problemas priorizados

Os 15 achados estão em `achados/ux-cliente-final.json` com evidência e recomendação completas. Resumo:

| # | Gravidade | Problema | Componente |
|---|---|---|---|
| 01 | alta | Com servidor, simulado é o padrão e o cliente vê Pix falso e "Pagar (simulação)", que o servidor aceita | `PaymentsPage.tsx:24, 61-64`; `PayLinkPage.tsx:82, 92-99`; `payments/handler.ts:252-276` |
| 02 | alta | A marca dominante é a Tinindo; o profissional vira texto de corpo | `PublicLayout.tsx:12`; `QuoteLinkPage.tsx:82-89`; `OfferPage.tsx:73-74`; `PayLinkPage.tsx:72` |
| 03 | alta | Página pública baixa 1,59 MB de JS (16% usados); tela vazia por 2,3 a 3,0 s | `router.tsx:3-16`; `vite.config.ts:70`; `index.html:34` |
| 04 | alta | Perfil mínimo é nome, região e formulário; botão redundante no topo; rodapé de 197 px | `PublicProfileView.tsx:86-148`; `contracts/network.ts` |
| 05 | alta | Pagamento sem cara de pagamento: valor de 24 px, botão de 119 px, sem QR, prazo, recebedor ou tela de pago | `PayLinkPage.tsx:79-90`; `payments.css:12` |
| 06 | média | Cinco molduras para doze rotas; orçamento e oferta no cartão de login | `PublicLayout.tsx`; `pages.css:2-8`; cinco páginas |
| 07 | média | Na reserva, o cabeçalho ocupa 44 a 46% da tela; passo 3 abaixo da dobra | `PublicProfileView.tsx`; `network.css` |
| 08 | média | Estado final é um aviso; só o perfil dá agenda e contato | `OfferPage.tsx:108`; `QuoteLinkPage.tsx:116-119`; `PublicProfileView.tsx:392-414` |
| 09 | média | Orçamento: total de 16 px, validade escondida, "Valor" desalinhado | `QuoteLinkPage.tsx:80-102` |
| 10 | média | Avaliar com nota em números, sem estrelas, sem identidade | `ReviewPages.tsx:325, 380-381` |
| 11 | média (decisão) | Cliente precisa de e-mail e senha de 10 para avaliar ou ver reserva | `PublicProfileView.tsx:141-142, 414`; `AuthPages.tsx:61` |
| 12 | média (decisão) | `/s` e `/p` duplicados e incompletos; rodapé público mostra "versão 1" | `PublicSitePage.tsx:28` |
| 13 | média | Prévia sem foto usa ícone do app; sem canonical, dados estruturados, robots e sitemap | `worker/og.ts:104, 121, 135` |
| 14 | média (decisão) | Diretório com 4 filtros antes do primeiro resultado, para piloto pequeno | `src/features/discovery/` |
| 15 | baixa | Elementos colados dentro dos cartões públicos | `PayLinkPage.tsx:74-90`; `QuoteLinkPage.tsx:81-89` |

Fora do JSON, de menor impacto:

- **Erro sem saída.** "Perfil não encontrado" e link inválido não oferecem ação nem identidade (`PublicPages.tsx`, `OfferPage.tsx:74`). Dar "Falar com o profissional" quando o negócio é conhecido e um rodapé Tinindo sempre.
- **Carregamento.** Trocar "Carregando…" por um esqueleto com a forma do cabeçalho e do cartão.
- **Cartão de avaliações do perfil** com uma pílula só (`PublicProfileView.tsx:115-131`): vira parte do cabeçalho.
- **Passos concluídos em verde** no indicador: aceitável; se quiser reduzir cor, usar preto com ✓.
- **Entrar, criar conta e recuperar senha** têm bom acabamento para o profissional; o problema é o cliente cair nelas (achado 11).
- **Demonstração como ferramenta de venda:** abrir `/p/:slug` numa aba nova dá "não encontrado" e os nomes divergem (05 #16 e #17). Vale um perfil de exemplo sempre publicado.

## 5. O que manter intacto

- Os 4 passos, o indicador "Passo N de 4" e o resumo da escolha.
- Código num campo único (`inputMode` numérico, `one-time-code`) e "Número errado? Corrigir".
- "Abrir esta página não aceita nada. Aceitar não é pagar." e "Abrir esta página não reserva nada."
- Token no fragmento, removido da barra de endereço.
- Botão principal preto, tokens da marca, alvos de 44 px, nenhuma rolagem horizontal em 360 e 390.
- Regras de reputação: sem autor, média a partir de 3, sem destaque pago.
- Prévia própria de `/p` e `/s` com foto quando existe; `.ics` e mensagem pronta de WhatsApp na confirmação.

## 6. Decisões para os donos

1. **Pix no piloto**: só real, simulado só em homologação sem link ao cliente, ou como está. Recomendo esconder o simulado fora da demonstração.
2. **Quanto a Tinindo aparece**: só no rodapé, símbolo pequeno no topo, ou logotipo no topo. Recomendo só no rodapé.
3. **Uma página pública ou duas**: recomendo `/p` absorver `/s`.
4. **Cliente tem conta?** Recomendo não ter no piloto: tudo por link com token.
5. **Campos novos no perfil** (endereço, horário, política): recomendo os três, opcionais.
6. **Diretório no piloto**: recomendo esconder.
7. **Busca**: agora só canonical, dados estruturados e imagem própria no Worker; sitemap depois.

## 7. O que não foi coberto

- Nada foi testado com servidor: código pelo WhatsApp, webhook do Pix, Worker da prévia em produção e `/presence/page` foram lidos no código. O achado 01 tem confiança média por isso.
- Mensagens que o cliente recebe: não reavaliei; sigo o 05 #8 e a seção 4 dele.
- Tema escuro e desktop das páginas públicas.
- Leitor de tela, contraste e teclado.
- `/convite` com token válido, `/indicar` depois de gerar o link, `/recuperar-senha` depois do envio, `/entrar` com servidor.
- Diretório: usei só as medidas, não abri as capturas.
- Tempos medidos contra o `vite preview` local com rede simulada, não num celular real.
