# 07 · Tipografia, espaçamento, densidade e hierarquia visual

## Resumo

- **Veredito: misto.** A base (tokens, escala por papel, teste de CSS) está adequada e deve ficar. A composição das telas está exagerada. A camada de regras de layout está simples demais.
- A base é pequena e disciplinada: 2.504 linhas de CSS, 8 papéis de tamanho, 3 pesos, 3 raios mais pílula, 2 sombras. Nas 49 telas medidas não aparece nenhum valor fora disso.
- O problema é o que se monta com ela. No celular, 19 das 38 telas de `/app` passam de 2 alturas de tela e 7 passam de 3 (Metas 5,4; Caixa 4,2; Relacionamento 3,9; ficha do cliente 3,7).
- A tela **Hoje** mostra o dia só depois de 839 px: a primeira dobra é ocupada por configuração e sugestões.
- **Valor em reais sai do ladrilho de número**: em Hoje já passa 3 px com R$ 1.740,00 e passa 14 px a partir de R$ 10 mil (Hoje, Resultado, Contas).
- Não há regra de abertura de tela: 31 ordens diferentes de título, botão, aviso e ajuda em 38 telas; o conteúdo começa, na mediana, em y=399 dos 778 px visíveis.
- Lista vira caixa dentro de cartão (19 caixas na ficha do cliente); a lista agrupada do sistema só é usada em Hoje.
- A escala de títulos é achatada: h2 vale 20 ou 18 px e h3 vale 18 ou 16 px conforme o contêiner; h3 em cartão tem o tamanho do texto.
- O que resolve é pouco e concreto: quatro regras de layout (abertura, seção, lista, resumo de número), seis ajustes de token e o redesenho de dez telas, na ordem deste relatório.

## 1. Como foi medido

Tudo no app de demonstração em `http://127.0.0.1:4173`, Chromium via Playwright, tema claro.

| Arquivo (em `trabalho/design-tipografia-hierarquia/`) | O que traz |
|---|---|
| `medir.cjs`, `medidas-m.json`, `medidas-d.json` | 49 telas em 390x844 e 1280x900: tamanho e peso de cada texto (estilo computado), títulos, caixas e profundidade, raios, sombras, intervalos entre blocos, ícones, números sem tabular, caracteres por linha |
| `resumo.cjs` | tabela por tela a partir dos dois JSON |
| `medir2.cjs`, `medidas2-m.json` | 38 rotas de `/app` em 390x844: ordem da abertura de tela, y do primeiro conteúdo, títulos, botões por variante, ladrilhos de número, segmentados, blocos |
| `estouro.cjs` | troca o valor do ladrilho por R$ 12.540,00 e R$ 125.400,00 e mede a borda do texto contra a do ladrilho |
| `dobra/`, `inteira/`, `folhas/`, `recortes/` | capturas da primeira dobra (celular e desktop), página inteira, recortes dos defeitos |

Os dois primeiros JSON vieram da tentativa anterior desta auditoria. Conferi por amostra contra as capturas (Hoje, Caixa, Contas, Resultado) e contra o CSS; os números batem. A rota `/entrar` redireciona para Hoje na demonstração e foi descartada.

A faixa "Demonstração" do topo (28 px) e os avisos azuis por tela só existem em demonstração ou homologação. Onde isso pesa na medida, está dito.

## 2. O sistema, em números

### 2.1 Tipografia

Escala declarada (`src/styles/global.css:13-20`, largo em `:55`): título 24 (32 no largo), seção 20 (24), grupo 18, corpo 16, apoio 14, rótulo 12, número 24, número grande 32. Pesos 400, 500, 600.

Uso real no conteúdo das 49 telas (celular), estilo → telas / elementos:

| Estilo | Telas | Elementos | Papel de fato |
|---|---|---|---|
| 14/400 | 45 | 676 | apoio, dica, meta de linha |
| 16/400 | 39 | 357 | texto |
| 16/500 | 43 | 253 | botão, título de linha |
| 16/600 | 28 | 249 | h3 em cartão, negrito, hora |
| 14/500 | 39 | 156 | rótulo de campo, link |
| 14/600 | 37 | 94 | selecionado, negrito de apoio |
| 18/600 | 30 | 92 | h2 em cartão e em Section |
| 24/600 | 49 | 55 | h1, número |
| 20/600 | 8 | 25 | h2 fora de cartão, valor de indicador |
| 12/500 e 12/400 | 10 e 3 | 26 | rótulo em caixa-alta, selo |
| 32/600 | 1 | 1 | "sobrou" em Caixa |

Leitura:

- Por tela aparecem de 4 a 6 tamanhos e sempre os 3 pesos, em 5 a 10 combinações. O número é razoável; o defeito é a distância entre os níveis.
- **O mesmo nível muda de tamanho conforme o contêiner.** `src/components/ui/ui.css:333` e `:407` baixam o h2 para 18 px dentro de `Section` e de cartão; `:408` baixa o h3 em cartão para 16 px, igual ao corpo. Em Hoje, o h2 "Atendimentos de hoje" e o h3 "Próximo: 09:00" têm os mesmos 18/600 (`src/app/pages/pages.css:66`). Em Caixa e Preços convivem h2 de 20 e de 18 px na mesma tela.
- 16 px carrega três pesos. Entre um h3 de cartão (16/600), o título de uma linha (16/500) e o parágrafo (16/400) só o peso separa. Em Metas são 12 h3 de 16/600 sobre parágrafos de 16/400: a tela vira um bloco de texto.
- Degraus 24 → 20 → 18 → 16: razões de 1,2, 1,11 e 1,125. Seção e grupo não se distinguem.
- 97 das 163 declarações de `font-size` em `src` são `--tn-text-support`: o app "fala" em 14 px cinza.
- Comprimento de linha: no celular o máximo é 49 caracteres (bom). No desktop chega a 108 em Metas (16 px), 103 em Notas, 98 em Site, 95 em Serviços Tinindo, porque a coluna de 846 a 896 px não tem medida máxima.
- Números tabulares dependem da classe `.tn-num` (`global.css:107-115`), aplicada 100 vezes em 30 arquivos. Faltam: ficha do cliente 38 de 38, Domicílio 15 de 15, Contas 13 de 20, Resultado 12 de 21, Metas 12 de 16, Indicações 9 de 9, Materiais 9 de 9, Relacionamento 7 de 7. Onde foi aplicada, funciona (Novo agendamento 0 de 23, Caixa 1 de 36).
- Truncamento: nenhum texto cortado com reticências nas 49 telas. O problema é o oposto: valor que não quebra e sai da caixa (seção 3.2).

### 2.2 Espaço e ritmo

- Intervalo entre blocos de primeiro nível (celular, 178 medidas): 16 px em 110, 12 em 16, 32 em 16, 24 em 10, 28 em 7, 8 em 5, 36 em 4, 40 em 4, 20 em 3, e 0, 2 e 4 px uma vez cada.
- Seção e item ficam à mesma distância (16 px). Caixa separa as seis seções por 16 px, o mesmo que separa dois itens dentro de uma seção. Nada agrupa.
- A margem de seção de 24 px existe (`ui.css:325`), mas `Section` é usado em 3 arquivos. O resto usa `.tn-stack` com 16 px (`ui.css:294`).
- Em Hoje o intervalo entre as sugestões e os números é 0 px: o botão "Ver" encosta nos ladrilhos (visível em `dobra/home__d.png`).
- Espaço em px solto é raro (9 ocorrências, quase todas de 1 a 3 px). O token de espaço é respeitado; o que falta é o papel (quanto entre seções, quanto entre blocos).

### 2.3 Cartão, raio, borda, sombra

- Raios medidos: 8, 12, 20 e 999 px. Sombras: 2 valores. Consistente.
- **Tudo é cartão.** `Card` aparece 119 vezes em 49 arquivos; `.tn-list` (linhas agrupadas com divisor) em 1 arquivo; `Section` em 3; `Stat` em 3.
- **Cartão dentro de cartão**: caixas com borda dentro de outra caixa: ficha do cliente 19, Resultado 9, Configurar 8, Relacionamento 5, Contas 4. Vem de `.tn-item-list > li` (`ui.css:301-308`) e das caixas próprias de cada módulo (`.tn-an-metric`, `.tn-setup-step`, `.crm-visit`, `.tn-ga-item`) dentro de `.tn-card`.
- Raio aninhado igual: `.tn-stat` usa 20 px (`ui.css:381`) dentro de cartão de 20 px (`ui.css:77`). Só Hoje corrige para 12 px (`pages.css:21`).

### 2.4 Botões e ícones

- Botões por tela (celular): Caixa 25, Novo agendamento 22, Reagendar 21, Relacionamento 20, Metas 19. Mais de um botão principal: Relacionamento 4, Caixa 3, Hoje, Metas, Lista de espera, Domicílio, Configurar e Site com 2.
- Toda ação é pílula de 44 px em 16/500, seja a ação da tela, seja a de uma linha. O fantasma (`ui.css:21`) não tem borda nem fundo e parece texto solto ("Agora não", "Faltou", "Arquivar").
- Ícones: 6 tamanhos (14, 16, 18, 20, 22, 24) e 4 traços (1; 1,7 em `tone.tsx:22`; 2 em `icons.tsx:157`; 2,4 em `selection.tsx:154`). O ícone de aviso (18 px, traço 1,7) fica mais fino que os demais de 18 px (traço 2).

### 2.5 Abertura de tela e primeira dobra

No celular a área visível vai de y=84 (faixa de demonstração 28 px mais barra do topo 56 px) a y=778 (barra de abas de 66 px): 694 px.

- Primeiro conteúdo: mediana y=399, mínimo 168 (Hoje), máximo 635 (Contas e Domicílio), 618 em Indicações. A abertura consome 45% da área visível na mediana. Descontando o aviso azul de cada tela (45 a 108 px mais 16 px de intervalo), que só existe em demonstração, a mediana cai para y=318 (34% da área visível) e o máximo para y=553.
- 31 ordens diferentes em 38 telas. A mais comum ("título, apoio, aviso") aparece em 3. Exemplos: Assinaturas "título, botão, aviso, ajuda"; Equipe "título, botão, ajuda, aviso"; Pagamentos "título, aviso, ajuda"; Mensagens "título, ajuda, aviso".
- Três mecanismos para o mesmo papel em `ui.css`: `.tn-page-header` (311-323; 76 usos em 64 arquivos), `.tn-page-intro` (394-397; 32 usos em 27 arquivos) e `.tn-card:has(> h1)` (402-405).
- O aviso por tela repete a faixa do topo. Na Agenda o mesmo aviso é texto solto, sem caixa: dois tratamentos.

### 2.6 Ponto focal: o que o olho vê primeiro

| Tela | O que aparece primeiro | O que deveria |
|---|---|---|
| Hoje | "Deixe seu negócio pronto" e 3 sugestões | próximo atendimento e os números do dia |
| Agenda | pílulas, título, aviso, ajuda, Dia/Semana, data em 20 px em duas linhas; primeiro horário em y=541 | o primeiro horário mais alto (não detalhado aqui) |
| Caixa | título, apoio, "Registrar", aviso; lista "sem cobrança" em y=484 | certo que a cobrança venha cedo; falta o resumo do mês, que está em y=1702 |
| Ficha do cliente | aviso e cartão "Contato" | nome com "Agendar" e resumo de atendimentos |
| Metas | aviso, ajuda e o botão "Avançar 30 dias (simulação)" | metas do mês |
| Relacionamento | ajuda, aviso e "Rodar a régua (simulação)" | o que precisa de ação na fila |
| Resultado | dois seletores empilhados | "Sobrou" |
| Contas | botão, ajuda, aviso, segmentado quebrado, campo de mês | resumo do mês |

Em Metas, Relacionamento e Indicações o primeiro controle da tela é um botão de simulação. Esses botões dependem de `port.followUp` e `port.tick`, que só o modo de demonstração oferece (não existem em `serverPort.ts` desses módulos): no uso real eles somem. Continuam contando porque a demonstração é o que os profissionais do piloto veem primeiro.

### 2.7 Identidade

Fora o símbolo na barra do topo e o logotipo no menu lateral, as telas internas são cartão branco sobre cinza com Inter. Passa seriedade e é legível; é difícil de distinguir de um modelo pronto (inferência, não medida). O que já é próprio e funciona: a hora em 20 px tabular nos cartões da Agenda, o rótulo em caixa-alta com a data em Hoje, a barra de progresso preta. Recomendo eleger três assinaturas dentro das regras atuais da marca (decisão dos donos, achado 17).

## 3. Achados

Os 17 achados com evidência e recomendação completas estão em `achados/design-tipografia-hierarquia.json`. Em ordem de impacto:

| Nº | Gravidade | Achado |
|---|---|---|
| 01 | alta | Hoje: o dia só aparece depois de 839 px |
| 02 | alta | Valor em reais sai do ladrilho de número |
| 03 | alta | Abertura de tela sem regra (31 ordens em 38 telas) |
| 04 | alta | Lista como caixa dentro de cartão; ficha do cliente com 19 caixas |
| 05 | alta | Caixa: 3.553 px, 25 botões, número do mês em y=1702 |
| 06 | média | Escala de títulos achatada e dependente do contêiner |
| 07 | média | Metas e sugestões: 4.530 px, repetições, botão de simulação no topo |
| 08 | média | Relacionamento: 3.310 px, 20 botões, 4 principais |
| 09 | média | Resultado: "Sobrou" sem destaque; indicadores em coluna única |
| 10 | média | Contas: segmentado de 4 opções quebra dentro da pílula |
| 11 | média | Ritmo vertical sem níveis |
| 12 | média | Ação de linha com o peso do botão da tela |
| 13 | média | Site, Configurar e Preços: tudo aberto |
| 14 | baixa | Número tabular depende de classe aplicada à mão |
| 15 | baixa | Desktop: linhas de até 108 caracteres |
| 16 | baixa | Ícones com 6 tamanhos e 4 traços; raio aninhado igual |
| 17 | baixa | Identidade das telas internas (decisão) |

### 3.1 Hoje (achado 01)

Medida em 390x844: cartão de configuração em y=168 (235 px), "Para você esta semana" em y=427 (412 px, 6 botões), números em y=839, ações rápidas em y=970, "Atendimentos de hoje" em y=1107, "Próximo: 09:00" em y=1137. A barra de abas começa em y=778. Causa: `src/app/pages/Home.tsx:146-148` renderiza `SetupCard` e `InsightsCard` antes de `Stats` (linha 154) e da seção de atendimentos (linha 166). No desktop os números começam em y~800 de 900.

### 3.2 Número que sai do ladrilho (achado 02)

Borda direita do texto contra a borda direita do ladrilho, em 390 px:

| Tela | Fonte | Valor | Texto | Ladrilho | Passa |
|---|---|---|---|---|---|
| Hoje, "Recebido no mês" | 18 px, sem quebra | R$ 1.740,00 (demonstração) | 377 | 374 | 3 px |
| Hoje | 18 px | R$ 12.540,00 | 388 | 374 | 14 px |
| Hoje | 18 px | R$ 125.400,00 | 399 | 374 | 25 px (fora da tela de 390) |
| Resultado e Contas | 24 px | R$ 2.540,00 (demonstração) | 188 | 189 | encosta, sem os 16 px de respiro |
| Resultado e Contas | 24 px | R$ 12.540,00 | 203 | 189 | 14 px |
| Resultado e Contas | 24 px | R$ 125.400,00 | 218 | 189 | 29 px |

Os valores de 5 e 6 dígitos foram simulados trocando o texto do ladrilho (`estouro.cjs`); a captura `recortes/home-estouro-12mil.png` mostra o caso de 6 dígitos. O valor não quebra porque o formatador usa espaço não separável. Causa: `ui.css:373` (grade de ladrilhos com mínimo de 140 px), `ui.css:388` (valor em 24 px sem regra de encolher) e `pages.css:20-23` (3 colunas fixas e `white-space: nowrap` em Hoje). Um profissional com 200 atendimentos de R$ 60 no mês recebe R$ 12 mil.

### 3.3 Segmentado de Contas (achado 10)

`recortes/contas-segmentado.png`: o trilho tem 102 px de altura e duas linhas, com raio de pílula, e vira uma mancha. Causa: `ui.css:220-229` (`flex-wrap: wrap`) com 16 px de respiro em cada opção (`:230-241`); as quatro opções somam cerca de 369 px em 358 disponíveis. Uso em `src/features/finance-advanced/AccountsPage.tsx:310`.

## 4. As 10 telas de pior hierarquia e o redesenho

Altura no celular (390x844) com os dados da demonstração. "Meta" é a altura a atingir.

### 1. Hoje · `src/app/pages/Home.tsx` (2.084 px)
- **Problema**: nada do dia na primeira dobra; sugestões com 6 botões antes dos números; h2 e h3 do mesmo tamanho; valor que sai do ladrilho.
- **Ordem nova**: cabeçalho (data em caixa-alta e "Hoje") → cartão "Próximo" → faixa com os 3 números → outros atendimentos de hoje → pendências → ações rápidas → configuração → sugestões.
- **Some**: os três blocos de sugestão com "Ver / Agora não".
- **Vira resumo**: configuração em uma linha fina (barra "5 de 8" e o próximo passo como link, cerca de 64 px), só enquanto faltar passo; sugestões em uma linha ("3 sugestões para esta semana").
- **Ganha destaque**: "Próximo" com a hora em 20 px tabular; "A cobrar" como número com valor.
- **Meta**: "Próximo" e os números com y menor que 500 px.

### 2. Caixa · `src/features/finance/FinancePage.tsx` (3.553 px)
- **Problema**: 6 seções abertas, 25 botões, 3 principais; o único número grande (32 px) está em y=1702; três botões empilhados por atendimento sem cobrança.
- **Ordem nova**: título com o seletor de mês na mesma linha → faixa de resumo do mês → "Para cobrar" → "A receber" → um segmentado de 3 opções (Recebidos, Despesas, Pacotes) mostrando uma lista por vez.
- **Some**: o subtítulo "Recebíveis, recebimentos manuais e pacotes de sessões"; "Cobrar depois" e "Usar crédito do pacote" como botões visíveis (vão para o menu da linha).
- **Vira resumo**: Recebimentos, Despesas e Pacotes com 5 itens e "ver todos".
- **Ganha destaque**: "Sobrou" em 32 px no topo, com Recebido, Gasto e A receber em linha; uma ação cheia por linha ("Recebi R$ 60 no Pix").
- **Meta**: 1.600 px e um botão principal por dobra.

### 3. Ficha do cliente · `src/features/crm/CustomerPage.tsx` (3.093 px)
- **Problema**: cartão "Atendimentos" de 2.299 px com 19 caixas de 103 px, todas abertas; nenhum botão de agendar; 38 números sem tabular.
- **Ordem nova**: nome com as ações (Agendar como principal, WhatsApp, Ligar) → faixa de resumo (15 concluídos, 1 falta, último atendimento) → Próximos → Anteriores → Contato.
- **Some**: a caixa em volta de cada atendimento.
- **Vira resumo**: "Anteriores" com os 5 mais recentes e "Ver todos (16)"; contato em 3 linhas.
- **Ganha destaque**: "Agendar" para este cliente; data e valor alinhados em coluna.
- **Meta**: 1.400 px com 19 atendimentos.

### 4. Metas e sugestões · `src/features/growth-advice/GoalsPage.tsx` (4.530 px)
- **Problema**: 5 cartões, 18 títulos, 19 botões; cada sugestão ocupa de 222 a 363 px; repete as sugestões da Hoje e o resumo de Mensagens; na demonstração, abre com botão de simulação.
- **Ordem nova**: "Metas do mês" como faixa de resumo → lista única de sugestões → "Conteúdo aprovado".
- **Some**: "Resumo da semana" (fica em Mensagens); o cartão separado "Sugestões para você" (junta com "do mês"); o botão de simulação do topo (vai para o fim, só na demonstração).
- **Vira resumo**: cada sugestão em uma linha (título e evidência em 14 px) que abre texto e ações ao tocar; "Conteúdo aprovado" em uma linha com contagem.
- **Ganha destaque**: meta, feito e barra.
- **Meta**: 1.500 px.

### 5. Relacionamento · `src/features/lifecycle/LifecyclePage.tsx` (3.310 px)
- **Problema**: fila de 1.571 px e réguas de 859 px abertas; 20 botões com 4 principais; 8 campos; contadores, seletor e lista competindo.
- **Ordem nova**: fila agrupada por estado, com "Para você compartilhar" primeiro → Réguas → Reativação.
- **Some**: o seletor "Mostrar" (os contadores viram o filtro, em segmentado de 3 opções); o corpo da mensagem aberto.
- **Vira resumo**: cada régua em uma linha ("Lembrete: 24 h antes, ligado"), editando em folha; Reativação em uma linha.
- **Ganha destaque**: a única ação que depende do profissional (compartilhar).
- **Meta**: 1.400 px e um botão principal.

### 6. Resultado · `src/features/analytics/ResultPage.tsx` (2.994 px)
- **Problema**: abertura de 372 px com dois seletores empilhados; "Sobrou" é o terceiro ladrilho, sozinho na segunda linha; 6 indicadores de 176 a 218 px em coluna única (1.472 px).
- **Ordem nova**: título com o período em segmentado na mesma linha → "Sobrou" → indicadores → o que falta nos dados → ponto de partida.
- **Some**: "Comparar com" da abertura (vai para um menu).
- **Vira resumo**: indicadores em grade de 2 colunas (rótulo de 14 px, valor de 20 px, variação), com a explicação ao tocar; os dois últimos cartões recolhidos.
- **Ganha destaque**: "Sobrou" em 32 px, com Recebido e Gasto em linha.
- **Meta**: 1.300 px.

### 7. Contas · `src/features/finance-advanced/AccountsPage.tsx` (2.711 px)
- **Problema**: primeiro cartão em y=635; segmentado quebrado; campo de mês nativo enquanto Caixa usa setas; aviso dentro de cartão; cartão de 1.030 px.
- **Ordem nova**: título com o seletor de mês de Caixa → segmentado em uma linha → faixa de resumo (Entradas, Saídas, Saldo) → "O que falta lançar" → lançamentos.
- **Some**: o campo "Mês" como bloco; o aviso dentro do cartão vira uma linha de apoio.
- **Vira resumo**: Entradas e Saídas em duas linhas com total; lançamentos com 10 itens e "ver todos".
- **Ganha destaque**: o saldo do mês e o que falta lançar.
- **Meta**: 1.400 px.

### 8. Site e Google · `src/features/presence/PresencePage.tsx` (2.861 px)
- **Problema**: dois avisos na abertura (108 e 66 px); "Seu site" com 1.099 px por causa da prévia; o título da prévia é um h2 de 18 px igual aos de seção.
- **Ordem nova**: lista de estado com 4 linhas (Site, Domínio, Google, Entregas) → detalhe de cada uma ao tocar.
- **Some**: a prévia do corpo da tela (vai para folha).
- **Vira resumo**: cada frente em uma linha com a situação em uma frase.
- **Ganha destaque**: o que está pendente em cada frente.
- **Meta**: 1.200 px.

### 9. Configurar · `src/features/setup/SetupPage.tsx` (2.485 px)
- **Problema**: 8 caixas num cartão de 1.199 px; os 5 passos feitos ocupam o mesmo espaço dos pendentes; dois cartões soltos que são conteúdo de passos.
- **Ordem nova**: progresso → passos pendentes abertos → passos feitos.
- **Some**: os cartões "Descreva seu negócio" e "Modelos de serviço" como blocos separados (entram no passo correspondente).
- **Vira resumo**: os feitos em uma linha ("5 feitos, ver").
- **Ganha destaque**: o próximo passo, com o único botão principal.
- **Meta**: 1.200 px.

### 10. Preços · `src/features/pricing/PricingPage.tsx` (2.387 px)
- **Problema**: o simulador (683 px) vem antes das regras que existem; 10 campos na tela; h2 de 18 e de 20 px misturados.
- **Ordem nova**: "Regras ativas" → botão principal "Nova regra" (abre folha) → "Simular um desconto".
- **Some**: o formulário "Nova regra por horário" do corpo da tela.
- **Vira resumo**: o simulador recolhido em uma linha.
- **Ganha destaque**: o estado atual (quais descontos estão valendo).
- **Meta**: 1.200 px.

Fora da lista, mas no núcleo: na **Agenda** o primeiro horário aparece em y=541. A linha da data em 20 px quebra em duas por causa de "(data da demonstração)" e há uma linha de ocupação e um link antes da lista. Vale aplicar a regra de abertura da seção 5.1.

## 5. Regras de layout que faltam no sistema

### 5.1 Abertura de tela
Um componente só (estender `PageHeader`, `src/components/ui/index.tsx:104`), com lugares fixos nesta ordem:
1. voltar ou rótulo em caixa-alta (12 px);
2. título (h1);
3. uma linha de apoio, opcional, até 2 linhas, 14 px;
4. uma ação principal, à direita no largo e logo abaixo do título no compacto;
5. ajuda "Como funciona" como botão de ícone ao lado do título, abrindo folha;
6. filtro da tela (período ou segmentado) na mesma linha.

Intervalo interno de 12 px. Aviso de ambiente não é bloco da abertura (decisão 2). Remover `.tn-page-intro` e `.tn-card:has(> h1)`. Aceite: primeiro conteúdo com y até 280 px em toda tela de `/app`.

### 5.2 Seção
- Título h2 no tamanho de seção, com ação opcional à direita (o `Section` que já existe).
- 32 px entre seções no celular, 40 px no largo; 16 px entre blocos da mesma seção.
- Cartão só quando o bloco é um objeto (formulário, item em foco, resumo). Seção de lista não leva cartão em volta.
- Nunca cartão dentro de cartão.
- Seção secundária nasce recolhida em uma linha de resumo com contagem.

### 5.3 Lista
- Registro que se repete é linha de `.tn-list`: divisor, 56 px de altura mínima, título em 16/500, apoio em 14 px, valor à direita em tabular.
- No máximo uma ação visível por linha, em tamanho compacto; o resto no menu "...".
- Caixa com borda só para item selecionável ou com formulário dentro.
- Lista longa mostra 5 itens e "Ver todos (N)".

### 5.4 Resumo de número
- No compacto, cada número é uma linha: rótulo à esquerda, valor à direita em 20 px tabular, dica em 12 px embaixo. Sem ladrilho.
- No largo, ladrilhos lado a lado.
- O número principal da tela fica sozinho em 32 px, acima dos outros.
- Aceite: R$ 999.999,99 cabe em 320, 390 e 1280 px.

### 5.5 Ações
- Um botão principal por tela ou folha.
- Botão compacto para linha: 14/500, 36 px de altura visual, área de toque de 44 px.
- Fantasma com cor de link, para ler como ação.
- Botão de simulação nunca é o primeiro controle da tela.

## 6. Ajustes de token, com valor

Todos em `src/styles/global.css` (papéis), sem mexer em `brand/tokens/tokens.css`.

| Token | Hoje | Proposto | Efeito |
|---|---|---|---|
| `--tn-text-section` | 20 px (24 no largo), mas 18 em cartão e em Section | 20 px (24 no largo) para todo h2; remover `ui.css:333` e `:407` | um tamanho por nível |
| `--tn-text-group` | 18 px, mas 16 em cartão | `var(--tn-font-size-md)` (16 px, peso 600) para todo h3; remover `ui.css:408` | escala 24, 20, 16, 14, 12: cinco tamanhos, degraus de 1,2 e 1,25 |
| `--tn-text-lead` (novo) | não existe | `var(--tn-font-size-lg)` (18 px) | só o título do item em foco ("Próximo") |
| `--tn-text-number-sm` (novo) | não existe; `analytics.css:14` usa o papel de seção | `var(--tn-font-size-xl)` (20 px) | valor de indicador e de linha de resumo |
| `--tn-gap-item` (novo) | 8 px solto | `var(--tn-space-2)` | entre linhas e campos irmãos |
| `--tn-gap-block` (novo) | 16 px por `.tn-stack` | `var(--tn-space-4)` | entre blocos da mesma seção |
| `--tn-gap-section` (novo) | 16 a 40 px, sem regra | `var(--tn-space-8)` (32 px); `var(--tn-space-10)` (40 px) no largo | seção se separa de bloco |
| `--tn-gap-opener` (novo) | 8 a 36 px | `var(--tn-space-3)` (12 px) | abertura compacta |
| `--tn-row-min` (novo) | `min-height: 60px` solto em `ui.css:351` | `56px` | linha de lista |
| `--tn-measure` (novo) | sem limite | `68ch` em p, apoio, dica e aviso | linha de até 75 caracteres no desktop |
| números tabulares | só com `.tn-num` | `font-variant-numeric: tabular-nums` no `body` | alinhamento por padrão |
| raio de caixa interna | 20 px em `.tn-stat` | `var(--tn-radius-md)` (12 px) dentro de cartão | canto interno menor que o externo |
| respiro da opção do segmentado | `var(--tn-space-4)` | `var(--tn-space-3)` no compacto, trilho sem quebra | 4 opções em uma linha |
| traço de ícone | 1; 1,7; 2; 2,4 | 2 em todos; tamanhos 20 px (com texto) e 24 px (sozinho) | conjunto uniforme |
| entrelinha solta | `1.1`, `1.15`, `1`, `16px` em 5 lugares | `--tn-line-height-tight` e `--tn-line-height-snug` | sem número solto |

Regras novas para `src/app/css-system.test.ts`: módulo não declara `font-size` em h1, h2 ou h3; `line-height` só por token; intervalo entre blocos só pelos papéis de espaço.

## 7. O que está certo e deve ficar

- Tokens e o teste de CSS: é a disciplina que permite refatorar com segurança. Não trocar por biblioteca de componentes.
- Corpo em 16 px, apoio em 14, mínimo de 12 e alvo de toque de 44 px.
- Inter variável com eixo óptico, entrelinha de 1,25 nos títulos e 1,5 no texto, peso máximo 600.
- Cartão de atendimento da Agenda e o detalhe do atendimento em rótulo e valor: modelo para as outras listas.
- `Section`, `List` e `Stat` usados em Hoje: a linguagem certa já existe; estender o uso.
- Ajuda "Como funciona" recolhida por padrão.
- Botão principal preto em pílula, barra de 5 abas e pílulas de navegação.
- Telas públicas de oferta, orçamento e pagamento: um cartão, 2 ou 3 estilos de texto.
- Dois pontos de quebra com nome.

## 8. Decisões para os donos

1. **Hoje: o que vem primeiro.** (a) Como está; (b) o dia primeiro, configuração como linha fina e sugestões como uma linha. Recomendo (b).
2. **Aviso de demonstração por tela.** (a) Bloco azul em toda tela; (b) só a faixa do topo mais o rótulo "(simulação)" nos botões que simulam; (c) uma linha de 14 px sem caixa. Recomendo (b), desde que a regra "simulação é identificada como simulação" continue atendida.
3. **Sugestões e resumo da semana em dois lugares.** (a) Manter; (b) um lugar para cada. Recomendo (b).
4. **Identidade das telas internas.** (a) Manter; (b) três assinaturas dentro das regras atuais; (c) rever tipografia ou paleta. Recomendo (b).
5. **Meta de altura.** Adotar "nenhuma tela de `/app` passa de 2 alturas (1.700 px) com os dados da demonstração, salvo lista com paginação"? Recomendo adotar; hoje 19 de 38 passam.

## 9. O que não foi coberto

- Tema escuro: hierarquia avaliada só no claro.
- Desktop: há medidas das 49 telas, mas só a Hoje foi vista em captura; o redesenho em duas colunas não foi detalhado.
- Folhas, menus, avisos flutuantes, estados vazio, carregando e erro; Agenda em visão de semana.
- Perfil público e site público (`/p/:slug`), que dependem de publicar na mesma aba.
- Volume real: tudo medido com os dados da demonstração. Com 200 atendimentos por mês as listas abertas ficam piores; não simulei.
- Largura de 320 px, zoom de texto de 200% e Safari no iPhone.
- Não rodei o `css-system.test.ts` nem os testes e2e; o risco de quebrar teste por mudança de ordem dos blocos não foi levantado.
- O redesenho da Agenda (primeiro horário em y=541) não foi detalhado.
