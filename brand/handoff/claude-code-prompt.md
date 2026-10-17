# Prompt / CLAUDE.md para Claude Code

> Cole no `CLAUDE.md` do repositório **que o fundador fornecer para a Tinindo** (ainda não fornecido). Nenhum outro projeto dele é substituto.

## Tinindo — identidade e interface
Antes de alterar interface, leia `design/tinindo-brand/BRAND.md`, `tokens/tokens.css` e `DECISIONS.md` (ajuste o caminho se a pasta ficar em outro lugar).

- Use os SVG de `assets/logo/` e `assets/app-icons/`. Nunca recrie o logotipo com texto, emoji ou desenho novo.
- Estilos só por tokens `--tn-*`. Sem HEX solto, sem valores arbitrários espalhados. Se faltar um token, proponha-o em `tokens.json` **e** `tokens.css` (mesmos nomes e valores), registre em `DECISIONS.md` e atualize o manual.
- Não troque fonte, cor ou componente sem registrar a decisão. Respeite a stack existente; não introduza framework, biblioteca de componentes ou migração sem necessidade.
- Não afirme em UI/texto funcionalidades inexistentes (WhatsApp, pagamento, nota fiscal, verificação, certificação, garantia). Dados de exemplo são fictícios e rotulados.
- Vidro (`.tn-glass`) só em navegação/sheets/diálogo do agente. Estado nunca só por cor. Alvos ≥44 px. Foco visível.
- **Git:** uma branch por tarefa (`feat/…`), revisão antes do merge; rode `git status` e `git log` antes de editar e preserve alterações de outras ferramentas (Lovable, Codex); não edite o mesmo arquivo em paralelo sem coordenar; nada de force push; não publique, não altere segredos, não conecte serviços pagos por inferência.
- **Verificação antes de entregar:** rode lint/typecheck/testes do projeto; renderize as telas alteradas em 390 px e 1280 px; confira contraste de qualquer cor nova (`tokens/contrast-report.md` mostra o método) e o foco por teclado.
- Atualize `STATUS.md` ao fim de cada tarefa.
