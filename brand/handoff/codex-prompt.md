# Instruções para Codex (colar em `AGENTS.md` do repositório da Tinindo)

> Use apenas o repositório que o fundador fornecer para a Tinindo (ainda não fornecido).

## Identidade visual da Tinindo
1. Leia, nesta ordem: `design/tinindo-brand/BRAND.md`, `tokens/tokens.css`, `DECISIONS.md`.
2. **Logotipo:** use somente os SVG mestres em `assets/logo/`. Não redesenhe, não use texto, emoji nem outra fonte.
3. **Estilo:** use tokens `--tn-*`; não espalhe HEX ou valores arbitrários; não troque fonte, cor ou componente sem registrar em `DECISIONS.md` e atualizar `tokens.json` e `tokens.css` juntos.
4. **Stack:** adapte-se à existente; não adicione framework, biblioteca de componentes nem migração sem necessidade.
5. **Conteúdo:** nenhum recurso inexistente pode aparecer como disponível (WhatsApp, pagamentos, nota fiscal, verificação, certificação, garantia). Dados são fictícios e rotulados; simulação diz “simulada / nada foi enviado”.
6. **Reputação:** identidade, avaliações, serviços pela Tinindo e formação são rótulos independentes. “Patrocinado” explícito.
7. **Acessibilidade:** foco visível, alvo ≥44 px, estado com ícone e texto, respeitar `prefers-reduced-motion` e `prefers-reduced-transparency`.
8. **Git:** uma branch por tarefa; revisão antes do merge; confira `git status` e preserve o trabalho de outras ferramentas; sem force push; não publique, não altere segredos, não conecte serviços pagos.
9. Antes de concluir: rode lint, typecheck e testes; verifique visualmente 390 px e 1280 px; atualize `STATUS.md`.
