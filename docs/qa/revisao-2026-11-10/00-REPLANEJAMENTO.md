# Revisão geral e replanejamento · 10/11/2026

Base: `main` em `8e113c4` (P00 a P46 entregues). Auditoria de leitura: os auditores não alteraram código, banco nem GitHub. A única mudança feita na mesma sessão foi a renumeração dos PRs #91 e #92 (seção 4, linha R).

Pedido do Felipe: verificar se o produto está simples demais ou exagerado para o que queremos, se o design (cores, UI, UX) está apropriado, e replanejar a refatoração.

## 1. Resposta curta

**O produto está exagerado na largura e raso no meio.** Não é caso de reescrever. É caso de esconder, aprofundar e consolidar.

| Pergunta | Resposta |
|---|---|
| Está exagerado? | Sim, na largura. Todo negócio vê os 27 módulos (30 links no menu, 20 sub-abas). Onze deles não têm como ser usados no piloto: sete dependem de integração que não existe (WhatsApp oficial, PSP, NFS-e, Google) e quatro estão fora do objetivo escrito no `AGENTS.md` (equipe, estoque, contas a pagar, diretório). No banco, 72% do SQL é periferia. |
| Está simples demais? | Sim, no ciclo que o piloto mede: agendar, confirmar, atender, receber, retornar. A Hoje abre com configuração e sugestões; marcar "Atendido" não leva a receber; não há aviso de confirmação ao cliente; a agenda semanal do personal existe no servidor e não tem tela; "quem não volta" não aparece em Clientes. |
| O design está apropriado? | A base, sim: paleta, contraste, tipografia e tokens estão certos e não devem mudar. A composição, não: 19 das 38 telas de `/app` passam de duas alturas de celular, não há regra de abertura de tela, de lista nem de número, o preto preenchido significa cinco coisas e a página do cliente mostra a marca Tinindo no lugar da marca do profissional. |
| A engenharia aguenta? | O servidor, sim: RLS em 123 tabelas, toda escrita por RPC, idempotência, 1.779 asserções pgTAP. O front tem o esqueleto certo e o meio copiado: 12 leitores de dinheiro com 5 comportamentos, 24 geradores de chave, e a demonstração virou um segundo backend (6 mil linhas). O caminho real tela → servidor quase não tem teste. |

## 2. O que foi auditado

Doze áreas de 27 planejadas, uma por agente, cada uma com relatório e achados em JSON (dez delas nesta pasta). A rodada completa (27 áreas mais verificação independente) não coube no limite de uso da conta; a seção 8 lista o que ficou de fora.

| # | Área | Veredito | Em uma linha | Achados |
|---|---|---|---|---:|
| 01 | Escopo do produto | misto | Largo demais à vista de todos, raso em cinco pontos do ciclo | 15 |
| 04 | Achados das revisões anteriores | misto | Os 10 problemas altos de 04/11 continuam abertos; quatro correções agrupadas resolvem a maioria | 20 |
| 06 | Cores e temas | misto | Paleta adequada. Ênfase fraca e quatro falhas pontuais no tema escuro | 12 |
| 07 | Tipografia e hierarquia | misto | Tokens certos. Telas longas e sem regra de composição | 17 |
| 11 | UX do ciclo principal no celular | misto | Mecânica boa (alvos de 44 px, um toque). Prioridade e costura do ciclo falham | 15 |
| 14 | O que o cliente final vê | misto | Reserva em 4 passos está certa. Vitrine pobre, marca errada, 1,59 MB de JS | 15 |
| 15 | Arquitetura do frontend | misto | Esqueleto certo, sem camada comum; demonstração grande demais | 17 |
| 16 | Módulos do núcleo no frontend | misto | Tamanho adequado; os defeitos estão nas emendas (chave, telefone, dinheiro, data) | 16 |
| 21 | Banco | misto | Núcleo bem protegido e rápido. Dois defeitos de fluxo principal e rotinas sem isolamento | 13 |
| 22 | Segurança e privacidade | misto | Autorização forte por dentro. Borda pública e LGPD fracas | 12 |
| 25 | Testes | misto | Banco muito bem testado. Tela testada quase só contra a demonstração | 14 |
| 26 | CI e operação | misto | Antes do merge, verificação forte e rápida. Depois do merge falta portão, produção, publicação automática e alerta | 16 |

Ao todo: 182 achados. 2 críticos, 57 altos, 94 médios e 29 baixos. Por tipo: 46 defeitos, 44 reforços, 28 refatorações, 24 redesenhos, 16 simplificações, 8 para esconder e 16 decisões.

**Os relatórios 22 (segurança) e 26 (CI e operação) não estão nesta pasta.** O repositório é público; o 22 descreve fraquezas ainda abertas e o 26 descreve contas, ambientes e a configuração da homologação. Os dois foram entregues ao Felipe fora do repositório e entram aqui depois das correções ou quando o repositório for privado (decisão D37).

**Confiança.** Os verificadores independentes não rodaram. A sessão que consolidou a revisão conferiu no código 12 das 19 linhas da seção 4 (coluna "Conferido"); as 12 se confirmaram. O restante tem evidência `arquivo:linha` ou medida no relatório da área, sem segunda leitura.

## 3. O que não mexer

A refatoração não deve tocar nisto. Cada item tem a evidência no relatório indicado.

- **Autorização no banco**: RLS em tudo, escrita só por RPC, `app.is_member` em cada função, o cabeçalho de negócio como seleção e não como permissão (21, 22).
- **Idempotência no servidor** e os livros append-only com estorno único (21, 04). O defeito de duplicação está no front.
- **Contratos v1 em `@contracts`** com validação da resposta em tempo de execução; as 226 rotas chamadas pelo front batem com o registro (15).
- **Regra "módulo não importa módulo"**, o registro central `modules.ts` e a navegação num arquivo só (15, 01).
- **Porta como interface** entre tela e transporte (15).
- **Kit de formulário** (`Field`, `useFormErrors`) e CSS próprio com tokens. Nada de biblioteca de componentes nem de estado global (15, 07).
- **Paleta, contraste e ação principal preta**. Texto entre 5,38:1 e 18,88:1 nos dois temas, fora a tela da linha C. Tema seguindo o sistema, sem alternador (06).
- **Tipografia**: 8 papéis de fonte, 3 pesos, corpo de 16 px, alvo de 44 px, tudo travado por `css-system.test.ts` (07).
- **Reserva pública em 4 passos**, token no fragmento do link, frases "abrir esta página não aceita nada" (14).
- **"Recebi R$ 60,00 no Pix" em um toque** no Caixa. É a melhor peça do núcleo: reaproveitar, não reescrever (11, 01).
- **Separação concluir / cobrar / receber** no servidor (01).
- **pgTAP, integração sem mock e concorrência** como estão; Playwright sem retentativa (25).
- **Nenhum módulo é apagado.** Os 27 ficam no repositório com os seus testes; muda o que aparece.

## 4. Defeitos apontados (Onda 0)

Não dependem de decisão dos donos. São pequenos, de risco baixo, e vários estão no fluxo principal.

| # | Defeito | Onde | Achado | Conferido |
|---|---|---|---|---|
| A | **Crítico.** Nova tentativa depois de falha de rede grava em dobro (compra, mensagem, recebimento, despesa, conta mensal, plano) e a tela diz "tentar de novo é seguro". No Caixa, o relógio entra no pedido e a chave muda a cada toque | `materials/MaterialsPage.tsx:110`, `messaging/InboxPage.tsx:105`, `finance/FinancePage.tsx:454` e `:619`, `finance-advanced/AccountsPage.tsx:40`, `recurrence/RecurrencePage.tsx:39` | 04-01, 16-01 | sim |
| B | O mesmo valor digitado vira quantias diferentes conforme a tela: "10.50" é R$ 10,50 no Caixa e R$ 1.050,00 em Contas, Materiais e Configuração | 12 leitores de dinheiro; `finance/money.ts:13` é o correto | 15-01 | sim |
| C | O próximo passo de `/app/configurar` fica invisível nos dois temas (texto da cor do fundo) | `setup/setup.css:19` | 06-01, 04-07 | sim |
| D | Na Hoje, o valor em reais passa da borda do cartão em 375 px e a tela rola para o lado em 320 px | `app/pages/pages.css:20-23` | 04-10, 07-02 | sim |
| E | "Agendar às 15:40" a partir de um horário livre abre o Novo agendamento sem horário marcado | `scheduling/BookingFlowPage.tsx:101` | 11-04 | sim |
| F | Atendimento sem cobrança de mês anterior some da Hoje e do Caixa | `app/pages/Home.tsx:95`, `finance/FinancePage.tsx:134` | 11-03 | sim |
| G | "Me ajuda a configurar" nunca carrega com servidor: o guia valida com um schema próprio que rejeita o contrato | `agent/setupGuide.ts:9`, `agent/serverPort.ts:29` | 04-05 | não |
| H | Horários: bloquear, remover e bloquear de novo o mesmo período diz "Bloqueio criado" e não cria | `scheduling/HoursPage.tsx:50` | 16-03 | não |
| I | Reagendar com versão desatualizada: a explicação do conflito nunca aparece | `scheduling/BookingFlowPage.tsx:152` | 16-04 | não |
| J | Busca de cliente não ignora acento ("joao" não acha "João") e resposta antiga pode sobrescrever a nova | `p02_crm.sql:13`, `crm/CustomersPage.tsx:55` | 21-02, 16-06 | sim (banco) |
| K | O livro do caixa corta em 200 pelo vencimento mais antigo e esconde os recebíveis em aberto mais novos | `p07_finance.sql:797` | 21-01 | sim |
| L | O link público de reserva usa o fuso de Brasília fixo; o cadastro oferece nove fusos | `network/PublicProfileView.tsx:13` | 16-02 | não |
| M | Três analisadores de telefone divergem: "011 98765-4321" vale em Clientes e é recusado no link público | `crm/format.ts`, `scheduling/agenda.ts`, `network/PublicProfileView.tsx` | 16-10 | não |
| N | O Caixa desmonta as seis seções a cada ação: o foco cai no `body` e formulários abertos se perdem | `finance/FinancePage.tsx:180` | 16-05 | não |
| O | Tema escuro: selos de estado sem fundo, texto de exemplo a 3,70:1, barra de ocupação com o verde do navegador | `styles/global.css`, `scheduling` | 06-02, 06-04, 06-05 | não |
| P | Uma rotina periódica que falha derruba todas as outras do minuto (fila de eventos, lembretes, expirações) | `p45_insights.sql:1024` (`jobs_run`) | 21-03 | sim |
| Q | A agenda semanal do personal existe no servidor (`booking.create_series`) e nenhuma tela chama | `scheduling/handler.ts:60` | 01-04 | sim |
| R | As migrations dos PRs #91 e #92 tinham data anterior às que já estão na `main`, e os pgTAP repetiam os números 31 e 32. **Corrigido em 10/11** nos dois PRs | PRs #91 e #92 | 04 (seção 5) | sim |
| S | A `main` está vermelha desde 04/11: um teste de integração usa o relógio real e falha toda quarta depois das 11h. O mesmo caso é defeito do assistente: numa quarta à tarde, "na quarta às 11h" vira hoje, no passado | `tests/integration/20_f2_jornada.test.ts:61`, `_shared/domain/agent/parse.ts:56` | 26-01 | sim |

A linha Q é falta de tela, não defeito de código; entra na Onda 1. A linha P pede migration nova e vai com a Onda 6. A linha R já foi corrigida. As demais formam a Onda 0. A linha B adota em todo o app a regra que o Caixa já usa (decisão D13).

O item A tem causa única e correção única: um hook de chave em `src/lib` com a semântica do `identity/idempotency.ts` (mesma chave enquanto o conteúdo é o mesmo, mantida no erro, trocada só no sucesso), mais um teste em que a porta falha uma vez e a segunda tentativa sai com a mesma chave.

## 5. Plano em ondas

A ordem segue a dependência. A numeração de pacote é provisória; vale a que o integrador publicar no quadro (`coord.py advance`).

| Onda | Pacote proposto | O que entra | Tamanho | Depende de |
|---|---|---|---|---|
| 0 | P47 · Correções da revisão | Linhas A a O e S da seção 4, com o teste que faltava em cada uma | M | nada |
| 1 | P48 · Ciclo do atendimento na tela | Hoje com o dia primeiro; "Atendido" oferece "Recebi R$ X no Pix", "Cobrar depois" e "Usar crédito"; pendências sem filtro de mês; Caixa com Hoje, Semana e Mês e "Registrar" abrindo em "Recebi" | G | D6, D9 |
| 1 | P49 · Confirmação, lembrete e retorno | Avisar o cliente pelo WhatsApp ao criar o agendamento; "lembretes a mandar" na Hoje; última visita e filtro "sem voltar há 30 dias" em Clientes; "Repetir toda semana" no Novo agendamento | G | D2, D8 |
| 1 | P50 · Configuração com uma fonte só | Guia do assistente lendo o contrato; a demonstração gravando onde a Agenda lê; frase do negócio com negação e dois turnos | M | nada |
| 2 | P51 · Escopo visível do piloto | Nível de visibilidade em `ModuleDefinition`, chave de módulo por negócio no servidor, profissão e plano na sessão, navegação do piloto, texto dos planos sem promessa, periferia congelada | M | D1 a D4 |
| 3 | P52 · Camada comum do front, parte 1 | `src/lib`: dinheiro, chave e comando, datas, erros, telefone, link público. Troca das 159 chamadas de chave e regra de lint. Rede de proteção: teste das portas de servidor contra o registro de contratos | G | nada |
| 3 | P53 · Camada comum do front, parte 2 | Um cliente de API por sessão, contexto do negócio (fuso, papel, profissão) na sessão, leitura com cache e revalidação, rotas carregadas sob demanda, fronteira de erro por módulo, Caixa dividido em arquivos | G | P52, D5 |
| 4 | P54 · Regras de layout e telas longas | Padrão de abertura de tela, de seção, de lista, de resumo de número e de ações; ajustes de token; as telas do núcleo acima de duas alturas; preto só para ação; selo de estado com tom em todo o app | G | D11, D12, D14 a D17 |
| 5 | P55 · Página do cliente | Jornada do link (reenviar código, corrigir o número sem perder o horário, política e preço antes de confirmar); uma página pública só, com a marca do profissional; pagamento, orçamento e avaliação redesenhados; pacote de JS separado para as rotas públicas | G | D18 a D24 |
| 6 | P56 · Banco e operação | Rotinas periódicas isoladas (`job_ticks`), aviso de corte nas listas de 200, índices, FKs, privilégios do schema `app`, `docs/02` igual ao banco | M | D31 |
| 6 | P57 · LGPD e borda pública | Retenção, exportar e eliminar por negócio, limite de abuso da reserva pública, cabeçalhos de segurança, configuração de Auth conferida | G | D25 a D30 |
| 6 | P58 · Ambientes e publicação | CI obrigatório para o merge, conferência da ordem das migrations no CI, ambiente de produção, publicação por script único, captura de erro e alerta da fila | G | D36 a D39 |
| 7 | P59 · Testes do caminho real | Jornada do ciclo com servidor, contraste medido, varredura de rotas no lugar de listas fixas, smoke que falha quando falta variável, suíte mais rápida | M | D32 |

Ordem sugerida: P47 e P52 primeiro, em paralelo (não se tocam, salvo o hook de chave, que nasce em P47). Depois P48, P49 e P50. P51 assim que D1 sair. P53 a P55 em seguida. P56, P57 e P58 antes de passar de 10 profissionais. P59 acompanha todos.

O que cada onda resolve do pedido original:

- **"Muito exagerado"**: Onda 2 (o que aparece) e a parte de congelamento das Ondas 3 e 6.
- **"Muito simples"**: Onda 1.
- **"Design, cores, UI/UX"**: Ondas 4 e 5, mais as linhas C, D e O da Onda 0.
- **"Refatoração completa"**: Onda 3, com a rede de proteção antes.

### Desenho alvo do front (resumo; o completo está em 15, seção 5)

```
src/app/        casca: sessão com o contexto do negócio, um cliente de API, rotas sob demanda
src/lib/        dinheiro, datas, erros, telefone, chave e comando, leitura com cache
src/features/x  manifesto, telas, porta, porta de servidor, demonstração carregada à parte
```

Regras verificáveis por lint ou teste: módulo não importa módulo; `app` só importa o manifesto do módulo; `lib` não conhece módulo; `crypto.randomUUID` e `createApiClient` não aparecem em `features`; toda leitura de tela passa por um recurso com cache, toda gravação por um comando com chave; a demonstração nunca é import estático; o pedaço inicial tem teto de tamanho no CI.

### Regras de layout que faltam (resumo; o completo está em 07, seção 5)

1. **Abertura de tela**: rótulo, título, uma linha de apoio, uma ação principal, ajuda num ícone. Primeiro conteúdo até 280 px.
2. **Seção**: cartão só quando o bloco é um objeto. Nunca cartão dentro de cartão. Seção secundária nasce recolhida.
3. **Lista**: linha de 56 px com divisor, uma ação visível, cinco itens e "Ver todos".
4. **Número**: no celular, rótulo à esquerda e valor à direita; R$ 999.999,99 tem de caber em 320 px.
5. **Ações**: um botão principal por tela; botão de linha menor que botão de tela.
6. **Meta**: nenhuma tela de `/app` passa de duas alturas de celular com os dados da demonstração.

## 6. Decisões para os donos

Cada linha traz as opções e a recomendação da auditoria. As marcadas com ★ destravam pacote.

### Produto e escopo

| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| D1 ★ | O que o participante do piloto vê | (a) 10 módulos no primeiro dia, 6 por ativação, 11 guardados; (b) esconder só os 7 que dependem de integração; (c) manter os 27 | (a). A tabela módulo a módulo está em 01, seção 3 |
| D2 ★ | Quinta aba da barra | (a) manter Mensagens; (b) "Retorno": lembretes a mandar, quem não volta, lista de espera; (c) Assistente; (d) quatro abas | (b). Mensagens só funciona com provedor simulado no piloto. Um dos auditores prefere decidir depois de ver o uso; a troca é barata nos dois sentidos |
| D3 | O que cada plano libera | (a) aplicar diferenças de verdade; (b) piloto sem distinção, texto corrigido | (b) agora, (a) antes de cobrar. Hoje a tela promete diferenças que nada aplica |
| D4 ★ | Congelar a periferia | Módulo guardado não recebe função nova; as rotinas periódicas dele são desligadas; os e2e dele saem do PR e rodam só na `main` | Sim |
| D5 ★ | Demonstração offline | (A) manter a emulação dos 27 módulos; (B) congelar: gravação emulada só no ciclo central, fora do pacote de produção; (C) trocar por um negócio de exemplo no backend real | (B) agora, (C) depois da issue #74 |

### Telas do núcleo

| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| D6 ★ | O que a Hoje mostra primeiro | (a) como está; (b) o dia primeiro, configuração em uma linha quando há atendimento | (b) |
| D7 | Sub-abas no celular | (a) cinco por aba; (b) só as do ciclo, o resto no Menu | (b) |
| D8 ★ | Agenda do personal | (a) "Repetir toda semana" no Novo agendamento; (b) só em Assinaturas | (a). O servidor já tem a operação |
| D9 | Preço na hora de receber | (a) sempre o calculado; (b) valor editável em "Recebi", respeitando o piso | (b) |
| D10 | Encaixe fora da grade | (a) só horários livres da grade; (b) "Outro horário" com aviso de sobreposição validado no servidor | (b), depois do piloto começar |
| D11 | Aviso de demonstração | (a) bloco azul em cada tela; (b) só a faixa fixa do topo e "(simulação)" nos botões | (b) |
| D12 | Sugestões e resumo da semana | (a) em dois lugares; (b) um lugar para cada | (b) |
| D13 | Valor digitado com ponto | Regra do Caixa em todo o app: "10.50" vale R$ 10,50 e "1.234" sem vírgula é recusado | Sim |

### Marca e design

| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| D14 ★ | Laranja na interface | (A) só no logotipo; (B) um ou dois elementos que não são texto, botão nem estado (faixa do cartão "Próximo", linha do "agora" na Agenda); (C) botão principal | (B), com registro em `brand/DECISIONS.md`. (C) reprova contraste (3,34:1) |
| D15 | Cor dos estados do atendimento | "Concluído" verde e "Confirmado" neutro, no lugar de azul e verde | Sim |
| D16 | Alternador de tema | Ter ou não ter | Não ter no piloto; o tema segue o sistema |
| D17 | Assinatura visual das telas internas | (a) manter; (b) número grande tabular, rótulo em caixa-alta, linha do tempo do dia; (c) rever tipografia ou paleta | (b) |

### O que o cliente vê

| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| D18 ★ | De quem é a página do cliente | (a) nome e foto do profissional primeiro, Tinindo só no rodapé; (b) símbolo pequeno no topo; (c) como hoje | (a) |
| D19 ★ | Uma página pública ou duas | (a) `/p` absorve o site e `/s` redireciona; (b) manter as duas | (a) |
| D20 | Conta para o cliente final | (a) não: avaliar e ver a reserva por link com token; (b) código pelo WhatsApp; (c) e-mail e senha | (a) no piloto |
| D21 | Campos novos no perfil | Endereço ou "atende em domicílio", horário de funcionamento, política de cancelamento em texto curto | Incluir como opcionais (muda contrato) |
| D22 | Pix simulado | (a) esconder fora da demonstração; (b) manter em homologação sem link para o cliente; (c) como está | (a) |
| D23 | Política de cancelamento no link | Mostrar a antecedência e o preço antes de confirmar | Mostrar |
| D24 | Busca no Google | Agora só canonical, dados estruturados e imagem de prévia; sitemap depois | Sim |

### Dados, LGPD e segurança

| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| D25 ★ | Prazos de retenção | Idempotência 30 dias; eventos e webhooks 90 dias; mensagens e execuções do assistente 12 meses; código de verificação apagado ao fim do envio; pedido não confirmado 30 dias | Adotar e levar ao advogado |
| D26 ★ | Exportar e eliminar por negócio | Pacote próprio antes de passar de 10 profissionais | Sim |
| D27 ★ | Termos, política, CNPJ, encarregado e canal (issue #87) | Fechar o mínimo antes de ampliar o piloto | Sim |
| D28 | Senha e aprovação num toque (issue #90) | Manter 10 caracteres com confirmação de e-mail ligada; confirmar o toque único no assistente | Sim |
| D29 | Provedor de LLM e contrato | Escolher provedor com não treino e retenção curta antes de ligar o entendimento por modelo para mais negócios | Sim |
| D30 | Proteção da reserva pública | (a) limite por origem e teto de reservas provisórias no nosso código; (b) o mesmo mais Turnstile | (a) agora |
| D31 | Teto de 200 nas listas | (a) manter e avisar o corte; (b) paginar | (a); (b) só no Caixa, se alguém passar de 200 lançamentos no mês |

### Engenharia

| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| D32 | Teste da tela com servidor | (a) jornada do ciclo contra o Supabase local na `main` e à noite; (b) só as portas contra os handlers; (c) só o smoke manual | (b) agora, (a) em seguida |
| D33 | Avaliação do assistente com provedor real | Rodar semanalmente com teto de custo quando houver chave | Sim |
| D34 | PRs #91 e #92 | Integrar antes da refatoração, com as migrations e os pgTAP renumerados | Sim |
| D35 | Fuso fora de Brasília no piloto | (a) corrigir o link público; (b) tirar os outros oito fusos do cadastro até corrigir | (a), já na Onda 0 |

### Operação

| # | Decisão | Opções | Recomendo |
|---|---|---|---|
| D36 ★ | Ambiente de produção | (a) criar agora um projeto de produção em plano com backup diário, numa organização da empresa, e manter a homologação grátis; (b) os dois pagos; (c) seguir só com a homologação | (a). Sem isso não deve entrar dado real novo |
| D37 ★ | Repositório público | (a) tornar privado; (b) manter público sem o material comercial e de marca que o app não usa | (a), antes de dado real e de contrato com provedores |
| D38 | Portão de merge | (a) exigir os cinco jobs do CI verdes e manter zero aprovações; (b) exigir também uma aprovação do outro sócio em `supabase/migrations` e `.github` | (a) agora |
| D39 | Dados dos testadores de 28/10 que ficaram na homologação | Apagar ou anonimizar quando a produção existir, ou manter até uma data | Apagar ou anonimizar |

## 7. Como executar

- Cada pacote da seção 5 cabe, por estimativa, em uma a quatro sessões de agente, em worktrees separados, com PR próprio e handoff.
- Nesta rodada, uma janela de uso de cinco horas aguentou 12 auditores enxutos, dois por vez. A primeira tentativa, com 12 agentes ao mesmo tempo (de 27 planejados) e a janela já em parte gasta, parou no limite da conta em sete minutos. Para a execução, o ritmo que cabe na conta é de dois a quatro agentes por vez.
- A Onda 0 não espera decisão. As Ondas 1 a 5 esperam as decisões com ★.
- Nenhum merge sem o ok do Felipe ou do Gabriel. Migrations novas são append-only e passam pelo integrador.

## 8. O que esta rodada não cobriu

- **Quinze áreas sem auditoria**: navegação e arquitetura de informação, escrita e microcopy, referências de mercado, componentes do sistema visual, estados e movimento, acessibilidade, telas secundárias, desktop e responsivo, módulos de frontend dos grupos B e C, desempenho do front, Edge Functions, contratos da API, assistente e IA, documentação e processo.
- **Verificação independente** dos achados (um segundo agente tentando refutar cada um) não rodou.
- **Nada foi executado contra servidor real.** Homologação, Safari do iPhone, leitor de tela real, o Worker da Cloudflare em produção e o assistente com provedor ligado continuam sem teste.
- **Uso real do piloto**: não há telemetria no repositório. A frequência de uso por módulo é estimativa a partir de `docs/00_PRODUTO.md` e do roteiro do UAT.

## 9. Arquivos desta pasta

| Arquivo | Conteúdo |
|---|---|
| `01-escopo-produto.md` | Os 27 módulos classificados, a proposta de escopo do piloto e o custo de carregar tudo |
| `04-achados-anteriores.md` | Situação de cada item das revisões de outubro e de 04/11, e as correções agrupadas |
| `06-design-cores-tema.md` | Inventário de tokens, contraste medido em 51 telas e nos dois temas |
| `07-design-tipografia-hierarquia.md` | Medidas de 49 telas, as dez piores e as regras de layout propostas |
| `11-ux-nucleo-celular.md` | Oito tarefas do barbeiro contadas em toques, e o redesenho tela a tela |
| `14-ux-cliente-final.md` | As páginas públicas, a jornada da reserva e o redesenho das quatro principais |
| `15-fe-arquitetura.md` | Padrão de porta, custo da demonstração, desenho alvo e ordem das refatorações |
| `16-fe-modulos-a.md` | Agenda, Clientes, Caixa, Conta e Perfil lidos arquivo a arquivo |
| `21-be-banco.md` | Catálogo do banco, planos de consulta com volume e os defeitos de SQL |
| `25-testes.md` | Números de cada suíte, por que os defeitos de 04/11 escaparam e os portões mínimos |
| `achados/*.json` | Todos os achados com evidência, recomendação, esforço e risco, um arquivo por área |
| `sql-propostos/*.sql` | SQL das correções de banco, testado pelo auditor num Postgres local. Proposta: não foi aplicado em lugar nenhum |

Nos relatórios, caminhos que começam por `auditoria-local/` apontam para capturas, logs e scripts de medição que ficaram fora do repositório.
