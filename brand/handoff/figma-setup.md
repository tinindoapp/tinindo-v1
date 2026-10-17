# Organização no Figma

**Estado:** nenhum arquivo Figma foi criado nesta sessão. Roteiro manual. Os tokens em JSON são a fonte; o Figma os espelha.

1. Crie o arquivo “Tinindo — Fundações” com páginas: `Logotipo`, `Cor`, `Tipo`, `Componentes`, `Telas`.
2. **Logotipo:** importe os SVG de `assets/logo/` (arrastar para o canvas mantém as curvas). Crie componentes: wordmark (4 variantes), símbolo (4 variantes + óptica pequena), ícone de app.
3. **Variáveis:** crie coleções “Primitivos” e “Semânticos (claro/escuro)” a partir de `tokens/tokens.json` (via plugin de importação de tokens ou manualmente). Mantenha os **mesmos nomes** de `tokens.css` (sem o prefixo `--tn-`).
4. **Estilos de texto:** Inter 400/500/600 e Inter Display 700 nos tamanhos de `tokens.json` (`font-size`, `line-height`).
5. **Componentes:** botão (normal, hover, foco, pressionado, desabilitado, carregando), campo (normal, erro), cartão de profissional, linha de agenda (confirmado, aguardando, cancelado, bloqueado, livre), bloco de reputação, diálogo de aprovação do agente. Use `applications/preview.html` como referência de estados.
6. **Responsivo:** quadros em 390 px e 1280 px.
7. Ao alterar qualquer valor no Figma, atualize `tokens.json`, `tokens.css` e o manual, e registre em `DECISIONS.md`.
8. Não há plugin ou biblioteca recomendada aqui sem verificação; escolha com a equipe.
