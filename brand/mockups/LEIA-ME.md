# Mockups — site e app (primeira versão, para discussão)

Imagens para orientar quem vai construir. Não são telas aprovadas de produto: são o primeiro desenho, com **dados fictícios**.

## Site (`site/`)
| Arquivo | O que é |
|---|---|
| `site-desktop-1440.png` | Página inteira em 1440 px de largura |
| `site-celular-390.png` | Página inteira em 390 px (iPhone), em 2× |
| `fonte/index.html` | Referência em HTML/CSS (abra no navegador). Não é código de produção: serve para copiar medidas, cores e textos |

**Seções, de cima para baixo:** cabeçalho fixo (logo, menu, “Entrar”, “Lista de espera”) → hero com o celular mostrando a agenda e o assistente → faixa de categorias → “Para profissionais” (3 cartões: agenda, orçamentos e contas a receber, assistente) → “Como funciona” (3 passos) → “Para quem contrata” (busca + 3 perfis de exemplo) → “Confiança” (4 informações separadas; fundo preto) → perguntas frequentes → chamada final com lista de espera → rodapé.

**Pontos de atenção para o desenvolvimento**
- Cores, fontes, raios e espaçamentos: use `tinindo-brand/tokens/tokens.css` (não copie HEX solto). Regras completas em `tinindo-brand/BRAND.md`.
- Fonte: Inter (Google Fonts ou @fontsource/inter). Títulos 700 com `letter-spacing: -0.025em`; números com `tabular-nums`.
- Logotipo e símbolo: use os SVG de `tinindo-brand/marca-pronta/` (nunca escreva “tinindo” em texto no lugar do logo). Favicon e ícones: `marca-pronta/03-icone-app-e-favicon/COMO-USAR.txt`.
- Botão principal é **preto**. Laranja só nos detalhes (pontos, sublinhado do título, numeração). Laranja nunca é texto nem botão.
- “bem-feito” não pode quebrar no hífen (`white-space: nowrap`).
- Quebra para celular em 760 px: menu vira só logo + “Lista de espera”; grades viram uma coluna.
- **Textos a definir com vocês:** respostas do FAQ (só a primeira está escrita), preço, cidades atendidas, links do rodapé e política de privacidade. A assinatura “Serviço bem-feito, negócio em ordem.” ainda é candidata.
- **Não publicar como está:** os perfis, avaliações e o selo “Identidade verificada” são ilustrativos; só podem ir ao ar quando existirem de verdade (processo de verificação, avaliações reais). O formulário de lista de espera precisa de aviso de privacidade (LGPD).

## App do profissional (`app/`)
| Arquivo | O que é |
|---|---|
| `app-prancha-todas-as-telas.png` | Prancha com as 10 telas lado a lado (para apresentar) |
| `telas/01…10-*.png` | Cada tela em 1170 × 2532 px (3×, tamanho real de iPhone) |
| `fonte/index.html` | Referência em HTML/CSS |

**Telas:** 01 abertura · 02 início (resumo do dia, próximo atendimento, recomendação do assistente, pendências) · 03 agenda do dia (confirmado, aguardando, livre, bloqueado, cancelado) · 04 detalhe do atendimento (cliente, itens, checklist, concluir/reagendar/cancelar) · 05 assistente com aprovação (consultado → recomendação → aguardando aprovação) · 06 novo orçamento · 07 clientes (com consentimento de ofertas visível) · 08 dinheiro (recebido, a receber, atrasado) · 09 perfil público (as 4 informações separadas) · 10 agenda no tema escuro.

**Navegação:** barra inferior com Início, Agenda, **Assistente** (botão central com o símbolo), Clientes e Mais.

**Regras que as telas já seguem e o app precisa manter**
- Todo estado tem ícone e texto, nunca só cor.
- O assistente nunca envia nada sozinho: mostra destinatários, mensagem, desconto e horário, e espera “Aprovar”.
- Só clientes que autorizaram recebem ofertas (“Ofertas ok”).
- Identidade, avaliações, serviços pela Tinindo e formação são informações separadas.
- Alvos de toque de 44 px ou mais; tema claro é o padrão, escuro suportado.

**Fora deste mockup (próximas versões):** lado do contratante no app, cadastro e onboarding passo a passo, configurações, notificações, estados vazios e de erro em cada tela, integração real com WhatsApp e pagamentos (ainda não existem).
