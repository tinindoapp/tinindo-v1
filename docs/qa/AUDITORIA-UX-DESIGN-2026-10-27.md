# Auditoria de usabilidade e design · 27/10/2026

Varredura de cinco especialistas, cada um numa área: Agenda; Clientes e Mensagens; Dinheiro e Crescer; páginas públicas e entrada; sistema visual.

- **O que foi auditado:** a demonstração da `main` (f952daf), em 375 px com toque e em 1280 px, nos temas claro e escuro.
- **Como:** leitura do código e medições com Playwright (alvos de toque, contraste, fonte e rolagem).
- **O que chegou:** 81 achados. Os repetidos entre áreas viraram um item só, e o total ficou em **74 oportunidades**: 60 numeradas (A a D) e 14 das páginas públicas (E1 a E14).
- **Já conhecidos e fora da lista:** o que está em `docs/qa/acessibilidade.md` e em `AUDITORIA-DEMO-2026-10-25.md`, e os campos com menos de 16 px no iPhone, que o PR #47 corrige.

**Conferido e aprovado** (não entra como problema):
- Anel de foco de 3 px.
- Contraste do tema claro nas 13 rotas medidas.
- `prefers-reduced-motion` global.
- Safe-area do iPhone.
- Texto secundário e aviso azul no AA.

**Legenda:**
- Impacto: A (alto), M (médio), B (baixo).
- Esforço: P (horas), M (1 a 2 dias), G (mais que isso).
- Código de origem: `AGD`, `CLI`, `DIN`, `PUB` e `DS` são os relatórios de cada especialista.
- ✓ ao lado do número: feito. O que foi feito em cada item, as decisões e os testes estão em `docs/handoffs/UX-ONDA2.md`.

## Ordem sugerida

1. **Onda 1, antes ou logo depois do piloto de 28/10.** Itens de impacto A e esforço P, que atrapalham o teste com pessoas reais: 1, 2, 3, 4, 16, 26, 38, 48, 49, 50, 51, 52, 53, E2, E3 e E6.
2. **Onda 2, a semana seguinte.** Os padrões do sistema que corrigem várias telas de uma vez (Toast, confirmar/desfazer, IconButton, Field, estado selecionado, escala de texto): 5 a 15 e 17. Depois, os fluxos principais de impacto A: 24, 25, 27, 35, 36, 37, 47, E1, E4 e E5.
3. **Onda 3, refinamento.** O restante.

## A. Padrões do sistema (corrigir uma vez, melhora todas as telas)

| # | Oportunidade | Onde | Proposta | Imp. | Esf. | Origem |
|---|---|---|---|---|---|---|
| 1 | Tokens inexistentes deixam texto com 2,29:1 no modo escuro (WCAG 1.4.3) | campaigns.css, referrals.css, growth-advice.css (`--tn-muted`), messaging.css (`--tn-surface-2`) | Usar `--tn-text-muted`. Criar `--tn-surface-raised` para o balão enviado. Teste no CI que proíba `var(--tn-*)` não definido e valor de reserva | A | P | DS-01 |
| 2 | Barra lateral com 26 px escondidos sob o topo, e foco que pode parar atrás das barras (WCAG 2.4.11) | shell.css:45, 296-298 | `--tn-top-h` = faixa + barra. `scroll-padding-top` e `scroll-padding-bottom` no `html`. Faixa Demonstração em 1 linha no celular (fica, é exigência do AGENTS.md) | A | P | DS-02 |
| 3 | Aba ativa quase invisível (1,09:1) e rótulo de 11 px (WCAG 1.4.11) | shell.css:175, 187-188, 231-243 | Pílula ativa preenchida (`--tn-action`), rótulo de 12 px peso 600, token `--tn-selected-indicator` com 3:1 | A | P | DS-03 |
| 4 | Sub-abas com 40 px e telas escondidas sem indício ("Preços", "Relacionamento", "Avaliações") | shell.css:127-151 | `min-height: var(--tn-size-touch)`, degradê na borda quando houver mais, rolar a aba ativa para o centro, rótulos curtos ("Espera", "Lembretes") | A | P | AGD-05, CLI-09, DS-09 |
| 5 ✓ | Confirmação de ação aparece no topo, fora da tela (medido em −667 px e −163 px) | CustomersPage, InboxPage, QuotesPage, LifecyclePage, FinancePage, PaymentsPage, RecurrencePage | Componente `Toast` fixo acima da barra de abas, `role="status"`, 4 a 6 s, com "Desfazer" quando der | A | M | CLI-04, DIN-06 |
| 6 ✓ | Ações destrutivas sem confirmação nem desfazer (arquivar, remover bloqueio, desativar regra, cancelar orçamento, desconectar, revogar, denunciar, estornar despesa, cancelar assinatura) | 12 pontos em 8 telas | Padrão único: se dá para voltar, executa e oferece "Desfazer". Se não dá, pede confirmação com o verbo e a consequência ("Cancelar orçamento? O link do Carlos para de funcionar.") e botão `danger` | A | M | CLI-05, AGD-07, DIN-04 |
| 7 ✓ | Avisos no modo escuro com o mesmo fundo do cartão (1,00:1) e tom só pela cor (WCAG 1.4.1) | tokens.css:142-148, ui index.tsx:159-172 | Fundo por tom com `color-mix`, barra de 4 px na cor do tom, ícone diferente para info, atenção, erro e sucesso | A | M | DS-04 |
| 8 ✓ | CSS repetido em cada módulo (`-muted` em 21, `-actions` em 19, `-list` em 19, `-form` em 15) e divergente | src/features/*/*.css | Utilitários `.tn-muted`, `.tn-stack`, `.tn-actions`, `.tn-form-grid` e `.tn-item-list` em ui.css, migração dos módulos, regra de stylelint | A | M | DS-05 |
| 9 ✓ | "Selecionado" com 7 aparências diferentes | shell, crm, scheduling, identity | Tokens `--tn-selected-*` e componentes `Segmented`, `ChipNav` e `ChoiceCard` iguais em todo o app | M | M | DS-06 |
| 10 ✓ | Dez tamanhos de fonte em uso (inclusive 11 px e 13,33 px) e h1 que muda conforme o contêiner | global.css, ui.css, payments/campaigns/referrals/growth-advice.css | Tokens por papel (título, seção, corpo, apoio, rótulo, número), `strong` em 600, `PageHeader` no lugar de `.tn-card > h1` | M | M | DS-07 |
| 11 ✓ | Botão sem estado "carregando": ocupado parece bloqueado | ui index.tsx:15-22, ui.css:26 | `<Button loading>` com `aria-busy`, spinner e texto opcional | M | M | DS-11 |
| 12 ✓ | Botões desativados até o formulário ficar válido, sem dizer o que falta | PublicProfileView:224 e 344, NetworkHome:241, /app/conta, /avaliar | Botão sempre ativo. Ao enviar, valida, foca o primeiro campo com erro e mostra a mensagem embaixo dele. `disabled` só enquanto envia | M | P | PUB-08 |
| 13 ✓ | Números tabulares anulados por `font: inherit` (horários e valores "dançam") | 22 ocorrências, ui.css:153 | Um `font: inherit` global para controles e `tabular-nums` declarado depois | M | P | DS-08 |
| 14 ✓ | Hover "gruda" no toque e linhas sem retorno ao tocar | ui.css, shell.css, scheduling.css (0 `@media (hover)`) | Hovers dentro de `@media (hover: hover)` e um `:active` comum em linhas, cartões e abas | M | P | DS-12 |
| 15 ✓ | Campo padrão cobre só `<input>`: select, textarea e 9 campos de módulo divergem | ui index.tsx:129-157 | `<Field as="input|select|textarea" hint error required>`, como única fonte | M | M | DS-13 |
| 16 | Campos sem estilo nas páginas públicas (seletor de 19 px, rádios de 13 px) | ui.css:46 (só `.tn-app` e `.tn-auth`) | Classe raiz `.tn-public` em todo layout público e incluída na regra. Nota de 1 a 5 com botões de 44 px | A | P | PUB-01 |
| 17 ✓ | Botão de ícone com 4 implementações e três opacidades de desabilitado | shell, scheduling, finance | `<IconButton>` 44×44 e token `--tn-opacity-disabled` | M | M | DS-10 |
| 18 | Opções em linha (horas de lembrete, dias da semana) feitas de caixas de seleção soltas, com texto quebrado ("1⏎h") | LifecyclePage:29-34, WaitlistPage:262-282 | Componente Chip de 44 px com ✓ e atalhos ("Dias úteis", "1 dia e 2 h antes") | M | P | CLI-11, AGD-14 |
| 19 | Avisos repetidos empilhados (até 250 px antes do conteúdo) | parts.tsx:32-40, FiscalPage, GoalsPage, campanhas, indicações | Manter a faixa global, juntar os avisos da tela em 1 linha e levar as explicações para "Como funciona" | M | P | AGD-06, DIN-14 |
| 20 | Formulário de editar abre longe do item e sem foco | CustomersPage:117-128, ServicesPage:126-137, InboxPage:196 | No celular, folha inferior (bottom sheet) com o primário fixo. No desktop, rolar até o formulário e focar | M | M | CLI-08, CLI-03 |
| 21 | Elevação sem regra (cartão com sombra, lista sem) e superfície "afundada" mais escura que o cartão no escuro | tokens.css:78-80, ui.css:28-150 | Três níveis documentados (página, cartão/lista, camada flutuante) e ajuste de `--tn-surface-sunken` | B | P | DS-14 |
| 22 | `theme-color` preto no tema claro: faixa preta sobre o app no iPhone e no Android | index.html:7 | Duas metas com `media` (claro `#F7F7F5`, escuro `#111111`) e conferir o manifest | B | P | DS-16 |
| 23 | Pontos de quebra soltos (480, 560, 900 px) | 14 `@media` nos módulos | Dois pontos de quebra com nome e `@container` nos formulários | B | P | DS-15 |

## B. Agenda

| # | Oportunidade | Onde | Proposta | Imp. | Esf. | Origem |
|---|---|---|---|---|---|---|
| 24 | Tela "Hoje" pede para confirmar uma reserva provisória, mas não há botão de confirmar | BookingDetailPage:180-204, Home:153 | "Confirmar reserva" (primário), "Liberar horário" (sem pedir motivo) e "Vence às 10:55". A pendência leva direto à reserva | A | M | AGD-01 |
| 25 | Não existe "Faltou" | BookingDetailPage, agenda.ts | Depois do horário, mostrar "Atendido" e "Faltou" no detalhe e no cartão da linha do dia | A | M | AGD-02 |
| 26 | No celular, nenhum atendimento aparece sem rolar (o cartão de ocupação vem antes) | AgendaPage:41-46, 113 | Linha do dia logo abaixo da data e ocupação como uma linha compacta ("26% ocupado") | A | P | AGD-03 |
| 27 | Cancelar sem "Desfazer" e sem próximo passo | BookingDetailPage:122-124, 207-250 | Botão `danger` "Sim, cancelar". Depois: "Desfazer", "Avisar no WhatsApp" e "Oferecer à lista de espera (1 pessoa)". Mostrar o motivo | A | M | AGD-04 |
| 28 | Horários: página de 3.549 px, sem copiar para outros dias e sem aviso de alteração não salva | HoursPage:120-165 | Um cartão-resumo por dia, botão "Usar o horário de segunda nos dias úteis", barra "Salvar" só quando algo mudou e aviso ao sair | M | M | AGD-08 |
| 29 | Novo agendamento: o cliente é escolhido por último, num `<select>` sem busca | BookingFlowPage:157-277 | Ordem Cliente → Serviço → Horário, busca de cliente com "+ Novo" e "Sem cadastro", barra fixa "Confirmar · Corte · 13:00 · R$ 51" | M | G | AGD-10 |
| 30 | Selo "Confirmado" repetido em todo cartão e rótulos diferentes entre telas | Home:39, AgendaPage:197-201 | Mostrar só as exceções (Provisória, Falta, Cancelado), com um único mapa de rótulos | M | P | AGD-11 |
| 31 | "Hoje" não destaca o próximo atendimento | Home:130-145 | Cartão "Próximo: 11:25 · Ana · em 20 min", com "Abrir" e "WhatsApp". Passados em cinza e "Ver os 6 de hoje" como link | M | M | AGD-12 |
| 32 | Visão Semana com datas quebradas e sem indício de toque | AgendaPage:262-276, scheduling.css:156-171 | "Seg 19" sem quebra, "2 · 9%" à direita com chevron, selo "Hoje" e "Livre" em cinza | B | P | AGD-13 |
| 33 | Jargão em Preços, Agenda e Lista de espera ("piso", "regra v3", "vendáveis", "contribuição") | PricingPage, AgendaPage, BookingFlowPage, WaitlistPage | "Menor preço que você aceita", "Desconto máximo", "livres para agendar", "Sobra depois dos custos". Tirar "v3" | M | P | AGD-09 |
| 34 | Nota de fuso horário técnica ("America/Sao_Paulo") repetida em toda tela | parts.tsx:42+ | Mostrar só se o fuso do aparelho for diferente: "Horários de Brasília" | B | P | AGD-15 |

## C. Clientes, Serviços, Mensagens, Orçamentos, Avaliações

| # | Oportunidade | Onde | Proposta | Imp. | Esf. | Origem |
|---|---|---|---|---|---|---|
| 35 | Lista de clientes sem ligar, WhatsApp nem ficha | CustomersPage:139-177, crm module.tsx:58-66 | Botões de 44 px para "Ligar" e "WhatsApp" no cartão, "Editar/Arquivar" no menu "⋯" e rota `/app/clientes/:id` com histórico | A | M | CLI-01 |
| 36 | Na caixa de entrada, a configuração vem antes das conversas | InboxPage:167-201 | Com o número conectado, a conexão vira uma linha de status. Conversas primeiro. Sem conexão, estado vazio guiado | A | M | CLI-02 |
| 37 | Conversa abre longe da lista e o contato não é tocável por inteiro | InboxPage:196-235 | Linha inteira leva a `/app/mensagens/:id`, campo de escrever fixo no rodapé e selo numérico de não lidas | A | M | CLI-03 |
| 38 | Compartilhar link de orçamento ou lembrete só copia, sem retorno, e marca "compartilhado" mesmo se a cópia falhar | QuotesPage:219-231, LifecyclePage:65 | Botão "Enviar pelo WhatsApp" (wa.me com texto pronto), "Compartilhar…", "Copiado ✓" e só marca depois de copiar | A | P | CLI-06 |
| 39 | Promover "Mensagens" a aba principal, com selo de não lidas | navigation.ts:29-37 | Trocar ou juntar com "Assistente" na barra de abas | M | M | CLI-09 |
| 40 | Busca sem resultado mostra "lista vazia", e a lista vazia pisca enquanto carrega | CustomersPage:44, 135-137, ServicesPage:144 | Três estados: carregando (esqueleto), vazio de verdade e busca vazia ("Ninguém com “zzz”" + "Cadastrar") | M | P | CLI-07 |
| 41 | Modelos de mensagem com código técnico (`confirmacao_agendamento`) e campos "Campo 1/2/3" | InboxPage:82, 108-118 | Nomes legíveis, campos com nome e já preenchidos, prévia do texto e rótulo "Sua resposta" | M | M | CLI-10 |
| 42 | Campos numéricos em Relacionamento viram "0" ao apagar | LifecyclePage:36-43 | Guardar o texto e converter ao salvar, validar faixas e usar botões − / + com a unidade como sufixo | M | P | CLI-12 |
| 43 | Avaliações: selos parecem campos e o negativo vem primeiro | ReviewPages:24-31, reputation.css:5-6 | Resumo "4,5 ★ · 2 avaliações" no topo, selos como pílulas, "Verifique sua identidade →" como tarefa e tirar o não-selo | M | P | CLI-13 |
| 44 | Responder avaliação sem foco, contador nem prévia, e "Denunciar" com o mesmo peso | ReviewPages:54-72 | Foco no campo, contador "0/600", inícios rápidos, prévia pública e "Denunciar" (com motivo) no menu | B | P | CLI-14 |
| 45 | Modelos de serviço visíveis para sempre e preço perdido no meio do texto | ServicesPage:114-122 | Modelos só com a lista vazia ou dentro de "Novo serviço". Preço à direita em destaque e piso/custo na edição | B | P | CLI-15 |
| 46 | Novo orçamento já escolhe um cliente sozinho e mostra um erro por vez, no rodapé | QuotesPage:61, 238-245, 308 | "Escolha o cliente" com busca, título sugerido pelos itens e todos os erros de uma vez, embaixo de cada campo | B | M | CLI-16 |

## D. Dinheiro e Crescer

| # | Oportunidade | Onde | Proposta | Imp. | Esf. | Origem |
|---|---|---|---|---|---|---|
| 47 | Os mesmos números mudam de tela para tela na demonstração (Caixa R$ 260, Assistente R$ 160 na semana em que o Caixa tem R$ 60, faltas 6,8% e 15%) | FinancePage, ResultPage, GoalsPage, AgentPage, PaymentsPage | Uma base de exemplo única, teste e2e que compara os totais e período escrito ao lado de cada número | A | M | DIN-01 |
| 48 | O link de pagamento que a própria tela manda abrir dá "link inválido" | PaymentsPage:116-119, PayLinkPage:61 | Na demonstração, guardar a cobrança na sessão e manter o `#t=`. Mensagem que não culpa a cliente | A | P | DIN-02 |
| 49 | O Caixa não diz quanto sobrou e mostra "A receber R$ 0,00" com R$ 100 sem cobrança logo abaixo | FinancePage:211-235 | Número grande "Sobrou no mês: R$ 245,00", alerta "2 sem cobrança · R$ 100 → Cobrar agora" e ressalvas em "Como esse número é feito" | A | P | DIN-03 |
| 50 | Emitir nota e cancelar assinatura com um toque, sem revisão | FiscalPage:133, RecurrencePage:123, FinancePage:611 | Tela "Confira antes de emitir", confirmação para encerrar assinatura e estorno de despesa igual ao de recebimento | A | P | DIN-04 |
| 51 | Pix "copia e cola" e link aparecem como texto cru, sem copiar nem compartilhar | PaymentsPage:119, 147, PayLinkPage:72-73 | "Copiar Pix" (primário), "Enviar pelo WhatsApp" com mensagem pronta, "Copiar link" e o código em "Ver código" | A | P | DIN-05 |
| 52 | Jargão técnico e contábil ("Recebível", "PSP", "Conciliação", "worker", "IBGE", "baseline", código da proposta) | PaymentsPage, RecurrencePage, GoalsPage, FiscalPage, ResultPage, AgentPage | "Quem está devendo", "Conferir com o extrato", busca por cidade no lugar do IBGE, "Guardar como ponto de partida" | A | P | DIN-07 |
| 53 | Sugestões de Metas mostram variáveis (`no_show = 15% · no_show_n = 40`) | GoalsPage:79 | Frases prontas: "Faltas: 15% (6 de 40 atendimentos) · Lembrete enviado: 50%" | A | P | DIN-08 |
| 54 | Resultado: dinheiro é o 7º de 11 cartões e a comparação não diz se melhorou | ResultPage:107-118, format.ts:25-32 | Faixa Recebido, Gasto e Sobrou no topo. Delta com seta e palavra ("▼ 1,2 p.p. · melhorou"). Agrupar "sem dados" e tirar a métrica interna | M | M | DIN-09 |
| 55 | Cartões do Resultado desalinhados em "escada" no desktop (regra declarada duas vezes) | analytics.css:5 e 29 | Apagar a regra da linha 5 | M | P | DIN-10 |
| 56 | Caixa numa página de 3.279 px, com 4 formulários sempre abertos | FinancePage:180-188, 556-596 | Pendências → Resumo → Histórico, botão "+ Registrar" com folha e "Recebi R$ 60 no Pix ▾" | M | G | DIN-11 |
| 57 | Assistente esconde o valor no meio do parágrafo e pede aprovar e executar em dois passos | AgentPage:83-100 | Valor em destaque na primeira linha, ressalvas em "Detalhes", um passo com resumo no botão e rolar até a resposta | M | M | DIN-12 |
| 58 | Datas fora do padrão ("Outubro De 2026", "2026-10-27") e plurais "(s)" | finance.css:10, PaymentsPage:104 e 172, referrals labels.ts:21, RecurrencePage:211 | Só a primeira letra em maiúscula, `Intl` pt-BR, função `plural()` e progresso "1 de 3 clientes" com barra | M | P | DIN-13, DIN-15 |
| 59 | Lacunas de dados sem atalho e links "Ir para a tela" de 24 px | ResultPage:126-128, GoalsPage:81 | "Cobrar 5 atendimentos →" e links com texto específico e 44 px | M | P | DIN-16 |
| 60 | Tela "Custo por cliente" cortada no celular, aparece para o profissional, e o item ativo do menu fica fora da vista no desktop | CostPage:41-57, AppShell:146-170 | Cartões no celular, rota só para a equipe e `scrollIntoView` no link ativo | B | M | DIN-17, DIN-18 |

## E. Páginas públicas e entrada

Os do topo vêm antes no funil do cliente final.

| # | Oportunidade | Onde | Proposta | Imp. | Esf. | Origem |
|---|---|---|---|---|---|---|
| E1 | Link do perfil sem prévia no WhatsApp (sem Open Graph) | index.html, /p/:slug, /s/:slug | Servir `og:title`, `og:description` e `og:image` pelo servidor para essas rotas e deixar um padrão genérico no index | A | M | PUB-02 |
| E2 | Faixa "Demonstração" ausente em /entrar, /criar-conta, /diretorio, /pagar, /avaliar e outras | AppShell:115, PublicPages:19 | Colocar `<DemoBanner />` uma vez no `RouteFrame` | A | P | PUB-03 |
| E3 | Reserva diz que o código vai "pelo WhatsApp do profissional" | PublicProfileView:318-321 | "Vamos mandar um código de 6 dígitos para o seu WhatsApp. Seu número só vai para este profissional." | A | P | PUB-04 |
| E4 | Reserva sem etapas e sem dia visível antes da hora | PublicProfileView:242-351 | Passos "Serviço · Dia e hora · Seus dados · Código", fileira de dias em chips e resumo fixo | A | M | PUB-05 |
| E5 | Perfil sem preço, foto nem contato, e "Identidade não verificada" como primeiro selo | PublicProfileView:46-67, 264-267 | Preço opcional, só selos positivos, foto/logo e "Falar no WhatsApp" opcionais | A | M | PUB-06 |
| E6 | Depois de publicar o perfil, o dono não recebe o link para mandar | NetworkHome:147, 174-179 | Cartão "Seu perfil está no ar!" com o endereço, "Copiar", "Mandar no WhatsApp" e "Compartilhar" (reaproveitar o ShareLink) | A | P | PUB-07 |
| E7 | Cadastro sem dizer para quem é e regra de senha só no erro. E-mail já usado mostra mensagem vaga | AuthPages:45-72, SignIn:23-41 | Subtítulo de valor, "Pelo menos 8 caracteres", botão "Mostrar senha" e texto neutro: "Não deu para criar a conta com esse e-mail. Se já tem conta, entre ou recupere a senha." | M | P | PUB-09 |
| E8 | Aceite de termos sem link para os termos | CreateBusinessPage:101-107 | Links que abrem numa folha e a frase de saúde separada | M | P | PUB-10 |
| E9 | Onboarding pede os mesmos dados duas vezes (profissão e categoria) e o fuso aparece sempre | CreateBusinessPage, NetworkHome, /app/site | Só nome e profissão. Fuso detectado, endereço sugerido pelo nome com prévia do link e um único "Primeiros passos" | M | M | PUB-11 |
| E10 | Telefone em formato cru (+5511977774343) e confirmação sem próximo passo | PublicProfileView:175-200 | "(11) 97777-4343", "Número errado? Corrigir", "Adicionar à agenda" (.ics) e "Falar com o profissional" | M | P | PUB-12 |
| E11 | Diretório sem a marca, com dados repetidos e "Ver horários" de 20 px | DirectoryPages:119 | Usar o PublicLayout, título sem repetir, "3 profissionais" e botão de 44 px | M | P | PUB-13 |
| E12 | Links secundários competem com a reserva no perfil | PublicProfileView:61-64 | Mandar os links para o rodapé e mostrar "Ver horários livres" primeiro | B | P | PUB-14 |
| E13 | Texto técnico e "Criar outro negócio" em destaque em "Sua conta" | AccountPage:43-50 | Tirar "O servidor confere…" e mostrar os primeiros passos no topo para quem acabou de entrar | B | P | PUB-15 |
| E14 | Caixa de seleção separada do texto em "Site e Google" | PresencePage | Mesmo padrão de linha clicável de 44 px | B | P | PUB-16 |

## Fotos e roteiros

Fotos e scripts de medição ficam fora do repositório, na máquina do Gabriel. Os prefixos `agd-*`, `cli-*`, `din*-*`, `pub*-*` e `ds-*` correspondem a cada área. Para repetir uma medição, rode a demonstração (`vite preview`) e o `shot.mjs` descrito no PR desta auditoria.
