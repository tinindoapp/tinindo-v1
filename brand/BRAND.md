# BRAND.md — regras para humanos e agentes de código

Tinindo · v0.2 provisória · 2026-10-11 · identidade “sorriso”. Leia isto, `tokens/tokens.css` e `DECISIONS.md` **antes** de alterar qualquer interface. Manual completo: `guidelines/brand-manual.md`.

## Fatos que você não pode contradizer
- Nome: **Tinindo** (confirmado). Não adicionar “App” à marca. Domínio escolhido: tinindoapp.com.br (compra **não comprovada**).
- Identidade: “sorriso” (preto + laranja), **proposta** sujeita à aprovação do fundador e do sócio.
- Registro/uso jurídico da marca: **pendente**. Não afirmar liberação.
- O produto hoje é **demonstração**. Não escrever, na interface, que existe integração com WhatsApp, pagamento, nota fiscal, verificação de identidade, certificação ou garantia.

## Logotipo
- Use **somente** os SVG de `assets/logo/`, `assets/app-icons/`, `assets/icons/`. Não redesenhe, não digite “tinindo” em fonte, não use emoji.
- O “O” da palavra é o mesmo desenho do símbolo, inclinado 10°. **Nunca endireite, recorte, redesenhe nem inverta as metades.** Metade esquerda do sorriso = laranja; direita = preto (branco no negativo).
- Fundo claro: `tinindo-wordmark-color.svg`. Escuro: `…-negativo-cor.svg`. Uma cor: `…-preto.svg` / `…-branco.svg` (a divisão vira fresta).
- **Mínimos:** wordmark **120 px** de largura; símbolo 32 px (padrão) e **16 px** com a variante `…-pequeno-optico-…` (use-a até 24 px). Abaixo de 120 px de largura use o símbolo, não a palavra.
- Símbolo principal = **sem anel**. O com anel só em tamanhos grandes.
- Área de proteção: raio do “O” (palavra); diâmetro de um olho (símbolo).
- Proibido: distorcer, girar a palavra, sombra/brilho/vidro/gradiente, recolorir, fundo movimentado, usar laranja como texto.

## Cor (use tokens, nunca HEX solto)
- Importe `tokens/tokens.css`; use `var(--tn-…)`. Semânticos: `--tn-bg --tn-surface --tn-text --tn-text-muted --tn-action --tn-action-hover --tn-link --tn-focus --tn-border-control --tn-brand-accent --tn-accent-text`.
- Marca: **tinta** `#111111` (base); destaque: **laranja** `#FF4B1F` (escuro: `#FF6A3D`).
- **Ação principal = preta** (`--tn-action`). **Laranja não é cor de botão nem de estado** (evita confusão com erro/atenção).
- **Laranja nunca é cor de texto**; texto em destaque usa `--tn-accent-text` (laranja-700).
- Estados (`--tn-success-*`, `--tn-warning-*`, `--tn-danger-*`, `--tn-info-*`) são separados da marca; **nunca só por cor**: ícone + texto sempre.
- Tema escuro: automático (`prefers-color-scheme`) ou `data-theme="dark"`. Sem valores novos para o escuro.

## Tipografia
- Inter (texto) e Inter Display (títulos); 400/500/600; 700 só em títulos grandes. Números de agenda, preço e indicador: `font-variant-numeric: tabular-nums`. Rótulos em caixa-alta com `letter-spacing: .06em`. Não trocar fonte sem registrar em `DECISIONS.md`.

## Componentes e interface
- Alvos de toque principais ≥ 44 px. `:focus-visible` com 3 px em `--tn-focus`.
- Vidro (`.tn-glass`) só em barra de navegação, sheets e diálogo do agente; **nunca** em tabelas, campos, formulários ou texto corrido. Mantenha a alternativa opaca.
- Respeite `prefers-reduced-motion` e `prefers-reduced-transparency`.
- **Sem rostos sorridentes/emoji decorativos** na interface: o sorriso é do logotipo.
- Valores financeiros com período; em demonstração, “exemplo”.
- Agente: cinco estados distintos (consultado, recomendação, pendente de aprovação, executado, falha). Aprovação mostra destinatários, texto, benefício/desconto, custo estimado e horário. Em protótipo: “simulada / nada foi enviado”.
- Reputação: quatro rótulos independentes (identidade, avaliações de clientes, serviços pela Tinindo, formação). “Patrocinado” explícito. Perfil novo = “Perfil novo · ainda sem avaliações”. **Sem selo “Tinindo garante”.**
- Não usar a interface oficial do WhatsApp nem símbolos da Apple.

## Voz
- Português brasileiro claro, adulto, respeitoso; “você”. Sem gíria forçada, diminutivos, “revolucione/turbine/garantido”. Nunca retratar o profissional como incapaz. O sorriso do logotipo não autoriza tom infantil.
- Assinatura verbal: **nenhuma aprovada**. Candidata: “Serviço bem-feito, negócio em ordem.” Marque como provisória.

## Dados
- Todo nome, avaliação, valor e agenda de exemplo é **fictício** e rotulado como demonstração.

## Como mudar a identidade
1. Registre em `DECISIONS.md`. 2. Atualize `tokens/tokens.json` **e** `tokens/tokens.css` juntos. 3. Atualize `guidelines/brand-manual.md`. 4. Rode `tools`/relatório de contraste. Não faça só um dos passos.
