# STATUS.md — 2026-10-11 (v0.3)

## Novo nesta versão (v0.3)
- **`marca-pronta/`**: pacote completo para download (logotipo e símbolo em cor, negativo, preto e branco; SVG, PNG em vários tamanhos e PDF vetorial; ícones de app para iOS/Android/PWA, favicon.ico/svg, redes sociais, papelaria com sangria, arquivos para bordado, cores em .ase/.gpl/.css/.json, 12 ícones de interface, padrão de pontos). Guia: `marca-pronta/LEIA-ME.md`. Verificado: SVG sem máscara/raster/script; PDFs sem imagens raster (vetoriais).
- **Contornos fechados:** as metades do sorriso deixaram de usar `clipPath`; são formas independentes com arcos exatos (comparação pixel a pixel: idênticas na palavra e no símbolo).
- **`mockups/site/`**: mockup do site em desktop (1440) e celular (390), com referência HTML.
- **`mockups/app/`**: 10 telas do app do profissional (3×) e prancha de apresentação. Notas para o desenvolvedor: `mockups/LEIA-ME.md`.

## Concluído e verificado nesta sessão
- Identidade “sorriso” (escolha do fundador, variante Z3) aplicada em todo o kit: wordmark e símbolo em 4 variantes (cor, negativo, preto, branco), símbolo com anel, variante óptica pequena, ícone de app (1024/512/192/180), avatar claro/escuro, favicon SVG + PNG 16/32/48, 12 ícones de interface. SVG e PNG regerados.
- **Verificações:** todos os SVG validados como XML e sem `<image>`, `<script>`, `<text>`, `<foreignObject>` ou referência externa; PNG renderizados e conferidos visualmente (incluindo recorte circular do avatar e escalas 16 a 48 px / 96 a 200 px em pixels reais). Mínimos definidos a partir do teste: wordmark 120 px; símbolo 16 px (variante óptica).
- Tokens v0.2 (JSON e CSS, mesmos nomes e valores; primitivos e semânticos; claro e escuro). **36 pares de contraste calculados, todos passam**; laranja-500 como texto (3,12:1) fica proibido; sorriso em laranja claro/cinza rejeitado (1,8–2,0:1).
- Vitrine `applications/preview.html` (site, agenda, perfil, agente com 5 estados, estados de botão, vazio, erro, validação), responsiva (1280 e 390 px) e com tema claro/escuro, inspecionada. Peças: cartão, uniforme, cartaz de condomínio, avatar.
- Manual (MD, HTML, PDF) e **apresentação para o sócio em PowerPoint (27 slides, notas do apresentador, gráfico nativo)**, validada (`validate.py`) e inspecionada slide a slide; PDF da apresentação incluído.
- Prompts de handoff (Lovable, Claude Code, Codex) e roteiros de Canva e Figma atualizados.

## Limitações e pendências
1. **Pesquisa de referências NÃO feita** (rede bloqueada). Notas de “distinção” são hipóteses; inclui marcas que usam sorriso.
2. **Diligência jurídica NÃO feita.** Dados da 3M/INPI (02/10/2026) são relatados, não reverificados. Sem comparação visual com a linha Tinindo da 3M.
3. **Corte do sorriso: resolvido.** As metades do sorriso agora são contornos fechados com arcos exatos (sem `clipPath`); comparação pixel a pixel com a versão anterior: 0 pixels de diferença no símbolo e na palavra; na variante pequena, ~1 px ao longo da curva interna (a versão nova é a geometricamente correta).
4. Wordmark fino: mínimo 120 px; abaixo disso usar o símbolo. A fresta (uma cor) é a primeira coisa que some em tamanhos pequenos.
5. **Nenhum teste com pessoas.** Risco de leitura “infantil/emoji”; matriz: sorriso 6,85 contra 7,80 do território B (julgamento de design).
6. Acessibilidade: contraste medido; foco por teclado, leitor de tela e zoom 200% **não testados manualmente**. WCAG 2.2 citado de memória.
7. Fontes: só Inter verificada (arquivos não incluídos). Apresentação usa Arial por compatibilidade.
8. Bordado, impressão, CMYK: aproximações/hipóteses; sem Pantone; pedir prova. `favicon.ico` não gerado.
9. Fotografia: nenhuma. Figma/Canva: nada criado, só roteiros. Repositório: nenhum fornecido; o repositório da sessão (`bolotacolmeia`) é de outro projeto e não foi usado. Nada commitado, comprado ou publicado.
10. Domínio tinindoapp.com.br: compra não comprovada. Assinatura verbal: nenhuma aprovada.
11. **Erro corrigido (D27):** os PNG de versões anteriores do ZIP (kit B) estavam em branco por falha do gerador (os SVG estavam corretos). Use apenas os arquivos deste pacote.
12. A apresentação foi renderizada com LibreOffice; fontes e quebras podem variar levemente no PowerPoint.

## Decisões humanas necessárias
Arte aprovada em 2026-10-11 (D28). Pendente: autorizar diligência jurídica; escolher assinatura verbal; indicar o repositório; autorizar pesquisa de referências com navegação.

## Próxima ação concreta
Apresentar `apresentacao/Tinindo-apresentacao-socio.pptx`; registrar a decisão em `DECISIONS.md`. Em paralelo: advogado de PI analisa o nome; pedir provas de impressão e bordado. Retomar: abrir `STATUS.md`, `DECISIONS.md`, `BRAND.md`; regenerar com `assets/logo/source/build_kit.py`.
