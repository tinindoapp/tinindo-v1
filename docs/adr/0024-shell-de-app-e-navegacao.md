# ADR-0024 · Shell de app mobile-first e navegação agrupada

Status: aceita · 2026-10-23 · integrador (pedido do dono: "parece um website; quero app mobile friendly, com menu organizado")

## Contexto

O shell herdado do P00 era uma faixa horizontal de abas com um item por módulo (19 itens com Início) e um cartão grande na tela inicial. No celular, a navegação rolava de lado e escondia quase tudo; no desktop, virava uma coluna de 19 links sem agrupamento. As telas abriam com um cartão branco contendo o título e um parágrafo longo. O doc 12 já pedia outra coisa: "Home 'Hoje' com próximos atendimentos, pendências e até três ações úteis. Navegação: Hoje, Agenda, Clientes, Dinheiro, Assistente; configurações e perfil em menu secundário. Ofertas e lista de espera aparecem no contexto da agenda. Mobile web é prioridade."

## Decisões

1. **Arquitetura de navegação em `src/app/navigation.ts` (integrador).** Seis grupos sobre os módulos registrados: Agenda (Agenda, Lista de espera, Preços), Clientes (Clientes, Mensagens, Orçamentos, Relacionamento), Dinheiro (Caixa, Pagamentos, Assinaturas), Assistente, Crescer (Metas, Campanhas, Indicações, Resultado) e Negócio (Perfil, Plano e serviços, Conta). Rótulo e caminho continuam vindo de cada `module.tsx`; o mapa só agrupa e escolhe o ícone. Teste: todo módulo está em exatamente um grupo.
2. **Celular:** barra superior compacta (símbolo, nome do negócio, botão "Menu" com rótulo), barra de abas fixa embaixo com Hoje, Agenda, Clientes, Dinheiro e Assistente (literal do doc 12), e o menu completo numa folha que sobe de baixo (Esc fecha e devolve o foco; navegar fecha). Telas de grupos fora das abas (Crescer, Negócio) marcam o botão Menu como ativo. Área segura do iPhone respeitada.
3. **Desktop (≥ 900 px):** barra lateral fixa com os grupos visíveis; sem abas e sem sub-abas.
4. **Sub-abas por grupo:** dentro de um grupo com mais de uma tela, chips roláveis no topo ("Telas de Dinheiro": Caixa, Pagamentos, Assinaturas). A ativa vem preenchida (não só por cor).
5. **Hoje:** resumo do dia lendo as mesmas portas da Agenda, do Caixa e das Metas (na demonstração, as mesmas instâncias). Três indicadores com contexto (atendimentos hoje, a cobrar, recebido no mês "registrado"), três ações rápidas (novo agendamento, registrar recebimento, perguntar ao assistente), próximos atendimentos e pendências. Cada bloco falha sozinho; conta vazia mostra a lacuna, nunca número inventado.
6. **Componentes de app em `src/components/ui`:** `PageHeader`, `Section`, `List`/`ListItem`, `Stat`/`Stats`, `LinkButton`, `BrandSymbol` e `Icon`. Campos de formulário de todas as telas ganham a mesma aparência por regra de especificidade zero (`:where`), sem tocar nos módulos. Cartão de abertura com `h1` vira cabeçalho de tela por CSS (`:has`), até cada tela adotar o `PageHeader`.
7. **Ícones:** os 12 da marca são usados direto do arquivo oficial (`brand/assets/icons/ui-icons-sprite.svg`, injetado uma vez e referenciado por `<use>`). Os que a marca ainda não tem (início, assistente, crescer, negócio, menu, fechar, seta, mais, preço, pagamento, assinatura, relacionamento, campanha, indicação, metas, resultado, perfil, plano, conta, sair) seguem a especificação do manual (grade 24 px, traço 2 px, pontas arredondadas, `currentColor`) e evitam robô, cérebro e faísca de "IA". Ficam no código do app (`icons.tsx`) até a marca incorporá-los ao sprite oficial; nenhum arquivo de `brand/` foi alterado.
8. **Marca:** só tokens (`var(--tn-…)`), ação principal preta, laranja apenas como traço decorativo do item ativo no menu, vidro só nas barras (superior e abas) com a alternativa opaca do `tokens.css`. Símbolo no celular (32 px, mínimo do manual) e wordmark no desktop (120 px).

9. **Telas internas promovidas a item de navegação:** "Horários" (Agenda) e "Serviços" (Clientes) entram no grupo como itens próprios (`sub` no mapa); o item ativo é o mais específico. Some a segunda fileira de abas de Clientes e o botão "Horários" da Agenda. "Importar planilha" vira ação no cabeçalho de Clientes, ao lado de "Novo cliente".
10. **Explicações longas recolhidas:** o componente `Help` ("Como funciona") guarda os parágrafos longos de Pagamentos, Assinaturas, Relacionamento, Mensagens, Campanhas, Indicações e Metas. Avisos de honestidade continuam visíveis (faixas de "Medição honesta", "Sem inteligência artificial", "O benefício não é avaliação", "Aceito não é pago", "não prova que a mudança veio da Tinindo", "não é pagamento"). Em Indicações, o convite pelo Perfil virou botão visível no cabeçalho.
11. **Agenda no celular:** "Novo agendamento" vira botão flutuante acima das abas (mesmo elemento que, no desktop, fica na barra); o conteúdo ganha folga embaixo para não ficar coberto.
12. **Instalável:** `manifest.webmanifest` com os ícones de app oficiais (`brand/assets/app-icons`, copiados sem alteração), abre em tela cheia no `/app`. As cores do manifesto repetem os tokens papel-50 e tinta-950 porque o formato não aceita variáveis CSS.

## Consequências

- Testes e2e navegam pelo helper `openFromNav`, que abre o Menu no celular. Alvos de toque: abas ≥ 44 px, linhas do menu no celular com 48 px.
- O texto de desenvolvimento "Pacote P04" saiu da Agenda.
- Etapa 2 (onda 3, PR 1): Orçamentos, Assinaturas e Campanhas abrem pela lista; o formulário de criação aparece por "Novo orçamento", "Nova assinatura"/"Novo plano" e "Nova campanha" e fecha ao concluir (erro mantém aberto). As telas internas do app usam o `PageHeader` explícito; a abertura sem caixa é `.tn-page-intro`. A regra com `:has` fica só para as telas de fallback e as páginas públicas, que ainda abrem com cartão.
