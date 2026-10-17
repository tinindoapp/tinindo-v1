# BRAND.md — regras para humanos e agentes de código

Tinindo · v0.1 provisória · 2026-10-11. Leia isto, `tokens/tokens.css` e `DECISIONS.md` **antes** de alterar qualquer interface. Manual completo: `guidelines/brand-manual.md`.

## Fatos que você não pode contradizer
- Nome: **Tinindo** (confirmado). Não adicionar “App” à marca. Domínio escolhido: tinindoapp.com.br (compra **não comprovada**).
- Direção visual: **Território B**, **provisória**, sujeita à aprovação do fundador e do sócio.
- Registro/uso jurídico da marca: **pendente**. Não afirmar liberação.
- O produto hoje é **demonstração**. Não escrever, na interface, que existe integração com WhatsApp, pagamento, nota fiscal, verificação de identidade, certificação ou garantia.

## Logotipo
- Use **somente** os SVG de `assets/logo/` e `assets/app-icons/`. Não redesenhe, não digite “tinindo” em fonte, não use emoji, não converta para texto.
- Fundo claro: `tinindo-wordmark-color.svg`. Fundo escuro: `…-negativo-cor.svg`. Uma cor: `…-preto.svg` / `…-branco.svg`.
- Mínimos: símbolo 16 px (use `tinindo-symbol-small-optical.svg` até 24 px); wordmark 80 px de largura.
- Área de proteção: metade da altura do “o” (wordmark); uma perna do arco (símbolo).
- Proibido: distorcer, girar, sombra/brilho/vidro/gradiente, recolorir fora da paleta, usar sobre foto movimentada, usar barro como cor de texto.

## Cor (use tokens, nunca HEX solto)
- Importe `tokens/tokens.css`. Use `var(--tn-…)`. Semânticos: `--tn-bg --tn-surface --tn-text --tn-text-muted --tn-action --tn-action-hover --tn-link --tn-focus --tn-border-control --tn-brand-accent --tn-accent-text`.
- Marca: petróleo `#0B4F5C`; destaque: barro `#D9602B` (**só ponto, ícone ou linha; texto em barro usa `--tn-accent-text`**).
- Estados (`--tn-success-*`, `--tn-warning-*`, `--tn-danger-*`, `--tn-info-*`) nunca reutilizam as cores da marca.
- Estado/avaliação/disponibilidade **nunca só por cor**: sempre ícone + texto.
- Tema escuro: automático via `prefers-color-scheme` ou `data-theme="dark"`. Não criar valores de cor novos para o escuro; use os tokens.

## Tipografia
- Inter (texto) e Inter Display (títulos). Pesos 400/500/600; 700 só em títulos grandes. Números de agenda, preço e indicador: `font-variant-numeric: tabular-nums`. Não trocar fonte sem registrar em `DECISIONS.md`. Não incorporar fontes proprietárias de terceiros.

## Componentes e interface
- Alvos de toque principais ≥ 44 px. Foco visível sempre (`:focus-visible`, 3 px, `--tn-focus`).
- Material vidro (`.tn-glass`) só em barra de navegação, sheets e diálogo do agente; **nunca** em tabelas, campos, formulários ou texto corrido. Mantenha a alternativa opaca.
- Respeite `prefers-reduced-motion` e `prefers-reduced-transparency` (já em `tokens.css`).
- Valores financeiros sempre com período; em demonstração, rotule “exemplo”.
- Agente: mostrar os cinco estados distintos (consultado, recomendação, pendente de aprovação, executado, falha). A aprovação mostra destinatários, texto, benefício/desconto, custo estimado e horário. Em protótipo: “simulada / nada foi enviado”.
- Reputação: quatro rótulos independentes (identidade, avaliações de clientes, serviços pela Tinindo, formação). Patrocinado = rótulo “Patrocinado”. Perfil novo = “Perfil novo · ainda sem avaliações”. **Não criar selo “Tinindo garante”.**
- Não usar a interface oficial do WhatsApp nem símbolos da Apple.

## Voz
- Português brasileiro claro, adulto, respeitoso. “Você”. Sem gíria forçada, sem diminutivo, sem “revolucione/turbine/garantido”. Nunca retratar o profissional como incapaz.
- Assinatura verbal: **nenhuma aprovada**. Candidata: “Serviço bem-feito, negócio em ordem.” Marque como provisória em qualquer uso.

## Dados
- Todo nome, avaliação, valor e agenda de exemplo é **fictício** e deve estar rotulado como demonstração. Não copie dados reais de ninguém.

## Como mudar a identidade
1. Registre em `DECISIONS.md`. 2. Atualize `tokens/tokens.json` **e** `tokens/tokens.css` juntos (mesmos nomes e valores). 3. Atualize `guidelines/brand-manual.md`. 4. Rode o relatório de contraste. Não faça só um dos passos.
