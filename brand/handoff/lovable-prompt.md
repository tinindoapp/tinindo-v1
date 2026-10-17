# Prompt para o Lovable (colar no conhecimento do projeto ou na primeira mensagem)

> Use apenas o projeto Lovable/GitHub que o fundador designar para a Tinindo. Nenhum outro projeto dele é substituto. Não publique, não conecte serviços pagos e não altere segredos sem autorização explícita.

Você vai trabalhar na interface da **Tinindo**, plataforma de gestão para profissionais de serviço e de descoberta de profissionais. A identidade visual está em `tinindo-brand/` (copie a pasta para o repositório, por exemplo em `design/tinindo-brand/`, ou suba os arquivos no projeto).

**Antes de qualquer alteração de interface, leia:** `BRAND.md`, `tokens/tokens.css`, `DECISIONS.md`. Se houver conflito entre este prompt e `BRAND.md`, vale `BRAND.md`.

Regras:
1. **Logotipo:** use os SVG mestres de `assets/logo/`. Não recrie o logotipo com texto, emoji ou novo desenho.
2. **Estilos:** importe `tokens/tokens.css` uma vez (globais). Mapeie os tokens `--tn-*` para o tema do Tailwind/shadcn (`bg-background → --tn-bg`, `primary → --tn-action`, `foreground → --tn-text`, `ring → --tn-focus`, `border → --tn-border`), sem copiar valores HEX para componentes. Não troque fontes, cores ou componentes silenciosamente: registre mudanças em `DECISIONS.md` e atualize `tokens.json` e `tokens.css` juntos.
3. **Stack:** adapte-se à stack existente do projeto; não introduza framework, biblioteca de componentes ou migração sem necessidade. Fontes: Inter (via @fontsource/inter ou arquivo local); não use fontes proprietárias de terceiros.
4. **Telas de referência:** `applications/preview.html` mostra site, agenda, perfil público, agente (cinco estados) e componentes. Reproduza a estrutura e os estados, não o HTML literal.
5. **Conteúdo:** todos os nomes, avaliações, valores e agendas são **fictícios** e precisam estar rotulados “demonstração/exemplo”. Não escreva que há integração com WhatsApp, pagamentos, nota fiscal, verificação de identidade, certificação ou garantia. Simulações dizem “simulada” e “nada foi enviado”.
6. **Reputação:** quatro rótulos independentes (identidade, avaliações, serviços pela Tinindo, formação). “Patrocinado” sempre explícito. Sem selo “Tinindo garante”.
7. **Acessibilidade:** foco visível, alvos ≥44 px, estado nunca só por cor, `prefers-reduced-motion` e `prefers-reduced-transparency` respeitados. Vidro só em barra de navegação, sheets e diálogo do agente.
8. **Fluxo de trabalho:** uma branch por tarefa e revisão antes do merge; não edite o mesmo arquivo em paralelo com Claude Code/Codex sem coordenação; verifique o estado do repositório e preserve alterações de outras ferramentas; nada de force push.

Primeira tarefa sugerida: página inicial com os dois públicos (“Para profissionais” / “Encontre um profissional”), usando somente os componentes e tokens existentes.
