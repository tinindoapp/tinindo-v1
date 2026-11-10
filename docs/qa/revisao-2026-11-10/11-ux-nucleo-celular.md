# 11 · UX das telas do ciclo principal no celular

## Resumo

- **Veredito: misto.** A mecânica das telas do núcleo está no tamanho certo para o celular; a prioridade e a costura do ciclo não estão; a navegação em volta está exagerada.
- **O que está certo:** alvos de 44 px, campos de 16 px, teclado decimal no dinheiro, "Recebi R$ 60,00 no Pix" em um toque, "Faltou" com Desfazer, barra "Confirmar" fixa com resumo, remarcar em 6 toques sem digitar.
- **Hoje prioriza errado:** a primeira tela inteira é configuração ("Deixe seu negócio pronto · 5 de 8") e três sugestões. "Atendimentos de hoje" começa em y=1107 de uma tela de 844 px.
- **O ciclo quebra entre atendimento e recebimento:** depois de "Atendido" a pessoa sai para outra aba, rola e escolhe entre dois botões iguais (5 toques, 2 rolagens, 1 decisão).
- **Dinheiro que some:** atendimento concluído sem cobrança de mês anterior não aparece nem no Hoje nem no Caixa (as duas telas filtram pelo mês corrente).
- **Defeito no caminho mais rápido de encaixar:** "Agendar às 15:40" abre o formulário sem horário marcado, porque 15:40 não está na grade de 15 min.
- **Retorno, um dos cinco pilares, não aparece em Clientes:** a lista não mostra última visita nem filtra quem sumiu.
- **Largura demais:** 5 sub-abas por aba (a quinta cortada em 390 px), com Espera, Domicílio, Orçamentos, Avaliações, Contas, Pagamentos, Assinaturas e Notas fiscais ao lado das telas do ciclo; menu de 30 links.
- Das 8 tarefas do barbeiro, 3 saem bem (falta, remarcar, bloquear com atrito), 3 saem com tropeço (encaixar, receber, preço) e 2 não se respondem onde a pessoa procura (quem não volta há 30 dias, recebido na semana).

Tudo foi dirigido na demonstração offline, em 390×844, tema claro, com Playwright (toque, sem recarregar entre telas). Scripts, registros e capturas estão em `auditoria-local/trabalho/ux-nucleo-celular/` (abaixo, "trabalho/"). Os registros `log-*.txt` são a saída dos scripts `*.cjs` de mesmo nome.

## 1. As 8 tarefas do barbeiro

Área útil da tela: de y=84 (fim da barra do topo) a y=778 (começo da barra de abas). "Rolagem" = cerca de 600 px.

| # | Tarefa | Caminho dirigido | Toques | Digitação | Rolagens | Onde trava | Registro |
|---|---|---|---|---|---|---|---|
| 1 | Encaixar um cliente às 15h | Agenda → rolar até "Horário livre 15:40" (y=1490) → Agendar → buscar cliente → marcar → rolar até os horários → 15:45 → Confirmar | 6 | 3 letras | 4 | 15:00 está ocupado e não há como encaixar; "Agendar às 15:40" chega sem horário marcado; os horários ficam em y≈1129 | `log-t1-encaixar.txt` |
| 2 | Marcar que o das 9h faltou | Agenda → "Faltou" no cartão | 2 | 0 | 0 | Nada. Aviso com "Desfazer" | `log-t2-faltou.txt` |
| 3 | Registrar R$ 60 em Pix pelo corte | Hoje → rolar → Abrir → Atendido → "Sim, foi atendido" → "Cobrar no Caixa" → rolar até o 3º item (y=1036) → "Recebi R$ 60,00 no Pix" | 5 | 0 | 2 | Troca de aba; dois botões iguais para a mesma cliente (19/10 e 20/10) | `log-t3-receber.txt` |
| 4 | Ver quem não volta há 30 dias | Clientes: não há. Sub-aba "Lembretes" → rolar até y=2895 "Reativação (campanha)" | 2 | 0 | 4 a 5 | Não responde: a seção é envio de campanha, não uma lista | `log-t4-clientes.txt` |
| 5 | Ver quanto recebeu na semana | Dinheiro: só mês. Menu → Crescer → Resultado → "Últimos 7 dias (até ontem)" | 3 | 0 | 1 a 2 | A aba Dinheiro não responde; Resultado abre em 28 dias e exclui hoje | `log-t5-semana.txt` |
| 6 | Bloquear a tarde de sexta | Agenda → Horários → rolar até y=1218 → Dia, Das, Até (3 seletores) → Motivo → Bloquear | 6 | motivo (obrigatório) | 2 | Formulário escondido depois do expediente; sem atalho "tarde"; a Semana continua mostrando "Livre" | `log-t6-t8.txt` (T6) |
| 7 | Trocar o preço do corte | Clientes → Serviços → Editar → Preço base → Salvar | 4 | valor | 1 | "Preços" (sub-aba da Agenda) leva a regras de desconto; formulário de 8 campos. Não dirigido: botão desabilitado na demonstração | `log-t6-t8.txt` (T7) |
| 8 | Remarcar um cliente para amanhã | Agenda → cartão → Reagendar → "Próximo dia" → 09:00 → Confirmar | 6 | 0 | 0 a 1 | Nada | `log-t6-t8.txt` (T8) |

### Releitura para as outras duas personas (inferência, não percurso)

- **Cabeleireira (serviços de 2 a 3 h, preço que varia):** a grade de 15 min funciona, mas o valor da revisão é sempre o calculado ("R$ 51,00 (de R$ 60,00) · Desconto de horário aprovado") e não há campo para o preço combinado; coloração e mechas raramente fecham no preço de tabela. Em serviço longo, o cartão "Horário livre" da Agenda é ainda mais usado para encaixar, então o defeito do achado 04 pesa mais. A ficha de 3093 px piora com cliente antiga (dezenas de visitas).
- **Personal (sessões recorrentes, pacote):** o Novo agendamento cria um atendimento por vez; não há "repetir toda semana" (`grep -n "recorr\|recurr\|Repetir"` em `BookingFlowPage.tsx` e `BookingDetailPage.tsx` não retorna nada). A recorrência mora em Dinheiro → Assinaturas (`src/features/recurrence/module.tsx:36-37`), que não percorri. O pacote aparece bem no recebimento ("Usar crédito do pacote (4 restantes)" no item sem cobrança), e isso deve ficar. Vender o pacote está no "Registrar" do Caixa, terceira opção.

## 2. Achados (os 15 do JSON, em ordem de impacto)

### 01 · Hoje abre com configuração e sugestões; os atendimentos ficam na segunda dobra (alta, redesenhar)

Fato medido (`trabalho/log-01-home.txt`): cartão de configuração top 168 h 235; "Para você esta semana" top 427 h 412; resumo top 839; ações rápidas top 970; "Atendimentos de hoje" top 1107; "Pendências" top 1767; página de 2084 px. Capturas `trabalho/home-01-dobra1.png` (nenhum atendimento visível) e `trabalho/home-02-dobra2.png`. Ordem no código: `src/app/pages/Home.tsx:146` (SetupCard), `:148` (InsightsCard), `:155-157` (resumo), `:160-164` (ações rápidas), `:166` (atendimentos), `:202` (pendências).

O que o profissional precisa às 8h: quem é o próximo, quantos tem hoje, o que ficou sem cobrar ontem. Nada disso está na primeira tela.

### 02 · "Atendido" não leva ao recebimento (alta, redesenhar)

Fato (`trabalho/log-t3-receber.txt`, capturas `t3-01-confirmar-atendido.png`, `t3-02-atendido-toast.png`, `t3-04-caixa-item.png`): depois de "Sim, foi atendido" o aviso manda ir ao Caixa; "Cobrar no Caixa" é um link fixo para `/app/caixa` (`src/features/scheduling/BookingDetailPage.tsx:290`); o Caixa abre no topo e o atendimento de hoje é o último da lista (y=1036), com dois botões de mesmo nome para a mesma cliente. Pelo cartão da Agenda não há nem o link (já apontado como médio no `00-CONSOLIDADO.md`: "Depois de Atendido nada leva à cobrança").

É o passo "atendimento → recebimento" da métrica principal do produto. A confirmação "Sim, foi atendido" hoje não decide nada; a decisão útil nesse momento é "como recebeu".

### 03 · Pendência de cobrança de mês anterior some (alta, defeito)

Fato (`trabalho/log-t5-semana.txt`, `t5-03-caixa-setembro.png`): em outubro o Caixa lista 2 atendimentos sem cobrança (R$ 100,00); em setembro aparece um terceiro (Bruno, 28/09, R$ 60,00) que não aparece em outubro. O Hoje mostra "A cobrar · 2 · R$ 100,00", sem período. Código: `src/features/finance/FinancePage.tsx:134` e `:139` (`port.uncharged(period)` com o mês da tela), `src/app/pages/Home.tsx:95-97` (mesma chamada com o mês corrente). O `serverPort` manda o mesmo período (`src/features/finance/serverPort.ts:54-55`).

Consequência: no dia 1º, o que ficou sem cobrar no dia 30 sai das duas telas. Inferência: com servidor acontece o mesmo, porque o período vai no pedido; não reproduzi em homologação.

### 04 · "Agendar às 15:40" chega sem horário (alta, defeito)

Fato (`trabalho/log-t1-encaixar.txt`, `t1-b1-agenda-livre-1540.png`, `t1-b2-novo-sem-horario-marcado.png`): o link leva a `/app/agenda/novo?data=2026-10-20&inicio=15:40`; a tela chega no topo, sem horário marcado e com "Corte · escolha o horário"; a grade só tem 15:45. O link das 13:00 chega com o horário marcado e a revisão aberta. Causa: `src/features/scheduling/AgendaPage.tsx:241-244` usa o começo do intervalo livre; `src/features/scheduling/BookingFlowPage.tsx:102` exige igualdade exata. Grade de 15 min na demonstração (`fixturePort.ts:46`) e no banco (`supabase/migrations/20261018130000_p03_scheduling.sql:24-25`).

Todo intervalo livre que começa depois de um serviço com intervalo de 10 min cai nisso, ou seja, a maioria dos encaixes do dia.

### 05 · Retorno não existe na aba Clientes (alta, reforçar)

Fato (`trabalho/log-t4-clientes.txt`, `t4-01-clientes.png`): a linha do cliente tem telefone, e-mail e origem (`src/features/crm/CustomersPage.tsx:209`); controles: busca e "Mostrar arquivados". Cada linha mede 143 a 164 px, então cabem dois clientes por tela. A resposta mais próxima está em "Lembretes" (que abre a tela "Relacionamento", 3310 px), seção "Reativação (campanha)" em y=2895, restrita a quem deu consentimento de marketing (`src/features/lifecycle/LifecyclePage.tsx:202-203`).

### 06 · Dinheiro só por mês (média, redesenhar)

Fato (`trabalho/log-t5-semana.txt`, `t5-02-caixa-resumo-mes.png`, `t5-05-resultado.png`): o Caixa só tem "Mês anterior/Próximo mês" (`FinancePage.tsx:194-196`); o resumo do mês começa depois das pendências (y=1642 a 1862 conforme o número de pendências); o Hoje mostra "Recebido no mês" (`Home.tsx:157`). A semana existe em Resultado, com "até ontem", e a tela abre em 28 dias (`src/features/analytics/ResultPage.tsx:85`). O valor "R$ 1.740,00" passa 3 px da borda do cartão do Hoje (`t5-01-hoje-resumo.png`): é o item 9 do `00-CONSOLIDADO.md`.

### 07 · Sub-abas e menu largos demais (média, remover ou esconder, decisão)

Fato (`trabalho/log-02-agenda.txt`, `t4-01-clientes.png`, `x-02-caixa-dobra1.png`, `t5-04-menu.png`): 5 sub-abas na Agenda, 5 em Clientes, 5 em Dinheiro; a quinta fica fora da tela ("Domicílio" começa em x=386 de 390). Definição em `src/app/navigation.ts:26-33`, `:36-43`, `:50-51`. Rótulos que não batem: "Lembretes" abre "Relacionamento"; "Espera" e "Lista de espera". O menu tem 30 links em 1895 px para 743 px visíveis.

### 08 · Bloqueio escondido e sem atalho (média, redesenhar)

Fato (`trabalho/log-t6-t8.txt` T6, `t6-02-bloqueio-form.png`, `t6-03-bloqueio-erro-motivo.png`, `t6-05-semana-com-bloqueio.png`): "Bloqueios" em y=1078, depois dos 7 dias do expediente; 4 campos, motivo obrigatório (`src/features/scheduling/HoursPage.tsx:322`); padrão hoje 14:00–16:00; depois de bloquear sexta 13:00–19:00 a Semana mostra "Sex 23 · Livre" (`AgendaPage.tsx:300-303`). O bloqueio em si funciona e o aviso é claro ("Esse período não aparece mais como livre").

### 09 · Preço do serviço fora de "Preços" (média, redesenhar; confiança média)

Fato (`trabalho/log-t6-t8.txt` T7, `t7-03-precos-dobra1.png`, `t7-01-servicos-dobra1.png`): `/app/precos` é "Descontos por horário" (simulador e regras, 17 campos, 2387 px). O preço base fica em Clientes → Serviços → Editar, com 8 campos (`src/features/crm/ServicesPage.tsx:306-316`). Não dirigido: "Editar" está desabilitado na demonstração.

### 10 · Agenda do dia: 541 px antes do primeiro atendimento (média, simplificar)

Fato (`trabalho/log-02-agenda.txt`, `agenda-01-dia-dobra1.png`): sub-abas, título, notas (86 px), barra de dia (54), título do dia (50), ocupação e link (69). Só 1,3 cartão cabe na primeira tela. Parte das notas é da demonstração ("Dados de exemplo"); o aviso de fuso e "Como funciona" são do produto.

### 11 · Revisão do agendamento com texto de cliente e sem preço ajustável (média, simplificar)

Fato (`trabalho/log-t1-encaixar.txt`, `t1-a3-revisao.png`, `t1-a3-revisao-inteira.png`): "Valor válido até 09:10. Ver o valor não segura o horário…" e "Política de cancelamento (exemplo)…" para o próprio profissional (`BookingFlowPage.tsx:308-312`); a página cresce de 1559 para 1989 px.

### 12 · "Registrar" abre em Despesa e não tem recebimento direto (média, redesenhar)

Fato (`trabalho/log-t3-receber.txt`, `x-03-caixa-registrar.png`): opções Despesa, Cobrança avulsa, Venda de pacote (`FinancePage.tsx:39-43`), aberto em Despesa (`:182`). "Registrar recebimento" do Hoje é só um link para `/app/caixa` (`Home.tsx:162`). Página de 3790 px com 9 blocos. Inferência: receber um valor avulso pede dois passos (criar a cobrança, depois receber em "A receber"); deduzido do formulário (`FinancePage.tsx:837-883`), não percorrido.

### 13 · Ficha do cliente longa, sem "Agendar" (média, reforçar)

Fato (`trabalho/log-t4-clientes.txt`, `t4-04-ficha-dobra1.png`): 3093 px; 19 visitas sem link; ações "Ligar" e "WhatsApp"; `src/features/crm/CustomerPage.tsx:67` é o único Link. O Novo agendamento só lê `data` e `inicio` da URL (`BookingFlowPage.tsx:74`, `:78`).

### 14 · Encaixe de verdade e sessão recorrente (média, decisão; confiança média)

Fato: não existe botão 15:00 nem campo de hora (`log-t1-encaixar.txt`: "botão 15:00 existe? 0"). Inferência sobre recorrência descrita na seção 1.

### 15 · A demonstração não deixa percorrer o ciclo (média, defeito)

Fato (`t4-01-clientes.png`, `t1-b2-novo-sem-horario-marcado.png`, `log-t6-t8.txt` T7): CRM bloqueado ("Os formulários ficam bloqueados"), enquanto Agenda, Horários e Caixa gravam na aba; Clientes lista "Cliente AB" e "Visitante sem login", e o agendamento oferece "Cliente Exemplo Ana" e "Bruno" ("2 clientes no cadastro"). Mesma raiz do item 10 do `00-CONSOLIDADO.md`.

## 3. Redesenho por tela, na ordem do ganho no ciclo

### 3.1 Hoje · `src/app/pages/Home.tsx` (+ `pages.css`)

Ordem nova dos blocos:

1. **Próximo** (o cartão que já existe), no topo, com "Atendido" e "Faltou" no próprio cartão quando o horário já começou, mais "Abrir".
2. **Hoje** (lista do dia), como está.
3. **Pendências**: "N atendimentos sem cobrança · R$ X" (em aberto, sem filtro de mês), reservas provisórias.
4. **Números** em uma linha de dois cartões: "Hoje: N atendimentos" e "Recebido na semana · R$ X (mês: R$ Y)".
5. **Configuração** em uma linha ("Configuração 5 de 8 · Publicar perfil"), expandida só quando não há atendimento no dia.
6. **Uma sugestão**, com "Ver todas".

Sai: a grade "Ações rápidas" (o "Novo agendamento" vira o FAB "+", igual ao da Agenda; "Registrar recebimento" já é a pendência; "Perguntar ao assistente" sai). Entra: ações de atendimento no cartão "Próximo". Muda de lugar: configuração e sugestões descem.

### 3.2 Atendimento e marcação · `src/features/scheduling/attendance.tsx`, `BookingDetailPage.tsx`, `AgendaPage.tsx`

- "Atendido" abre, no lugar da confirmação, as três saídas: **"Recebi R$ 60,00 no Pix ▾"**, "Cobrar depois", "Usar crédito do pacote". Um toque conclui e registra.
- O botão de receber vira componente compartilhado, extraído de `src/features/finance/FinancePage.tsx:385-409`.
- "Cobrar no Caixa" leva a `/app/caixa?atendimento=<id>` e o Caixa rola até o item.
- "Faltou" fica como está.

### 3.3 Caixa · `src/features/finance/FinancePage.tsx`

Ordem nova: (1) linha "Hoje · Semana · Mês" com os três valores e o período escrito; (2) "Sem cobrança" em aberto, o mais novo primeiro, com "há N dias"; (3) "A receber"; (4) recebimentos e despesas do período, 5 itens e "ver todos"; (5) pacotes, só se houver. Sai: a frase do cabeçalho. "Registrar" abre em "Recebi" (valor, forma, cliente opcional), depois Despesa, A receber, Pacote. O formulário de despesa fica como está.

### 3.4 Novo agendamento e Reagendar · `src/features/scheduling/BookingFlowPage.tsx`

- Aceitar `inicio` fora da grade (primeiro horário igual ou posterior) e os parâmetros `cliente` e `servico`.
- Vindo de um horário livre: horário já marcado, a tela pede só o cliente.
- Vindo do "+": manter a ordem Cliente → Serviço → Dia e horário, mas rolar até o próximo passo vazio depois de cada escolha.
- Revisão: só Cliente, Serviço, Quando, Valor. Saem a validade do valor e a política.
- Reagendar fica como está.

### 3.5 Agenda (dia e semana) · `src/features/scheduling/AgendaPage.tsx`, `SchedulingLayout.tsx`

- Uma linha de cabeçalho: "Hoje · ter., 20/10" com as setas e Dia/Semana; sem h1 "Agenda" no celular; "Como funciona" e fuso num ícone; ocupação em uma linha.
- Cartão "Horário livre" com duas ações: "Agendar" e "Bloquear".
- Semana: mostrar "Bloqueado 13:00–19:00" na linha do dia. A lista de 7 dias fica.

### 3.6 Clientes e ficha · `src/features/crm/CustomersPage.tsx`, `CustomerPage.tsx`

- Lista: linha compacta (cerca de 72 px) com nome e "Última visita há N dias" ou "Próximo: qui., 22/10"; chips "Todos", "Sem voltar há 30+ dias", "Com horário marcado", "Novos"; "Ligar" e "WhatsApp" vão para dentro do "…" ou para o deslize, exceto no filtro de sumidos, onde "WhatsApp" é a ação principal.
- Ficha: resumo de retorno no topo, "Agendar" como ação principal, "Anteriores" com 5 itens e "Ver todos", visitas com link.

### 3.7 Horários · `src/features/scheduling/HoursPage.tsx`

- "Bloqueios" sobe para antes do expediente ou ganha âncora no topo; chips "Manhã", "Tarde", "Dia inteiro"; motivo opcional. O expediente semanal recolhido por dia, com "Editar", fica.

### 3.8 Serviços · `src/features/crm/ServicesPage.tsx`

- Preço editável direto na lista; formulário com Nome, Duração e Preço à vista e o resto em "Mais opções" (piso igual ao preço por padrão).

### 3.9 Navegação · `src/app/navigation.ts`, `src/app/AppShell.tsx`

- Sub-abas só do ciclo; o resto no Menu, em "Mais recursos". Um rótulo por tela. Barra de abas fica.

## 4. Achados menores (só no relatório)

- **Aviso que atravessa telas e cobre conteúdo:** "Atendimento reagendado." ainda estava na tela dois toques depois, sobre o primeiro item do Caixa (`trabalho/x-02-caixa-dobra1.png`); o aviso de "Atendido" tem 4 linhas e cobre a base do cartão (`t3-02-atendido-toast.png`). Baixa. Encurtar o texto e fechar o aviso ao trocar de aba (`src/components/ui`).
- **Sub-aba "Agenda" dentro da aba Agenda** repete o título (pílula "Agenda" e h1 "Agenda", `agenda-01-dia-dobra1.png`). Some com o achado 10.
- **Importar planilha:** o campo de arquivo mede 26 px de altura, abaixo dos 44 px do resto (`log-t6-t8.txt`, X IMPORTAR). Baixa.
- **Linha de cliente em cartão dentro de cartão** (borda dupla, `t4-01-clientes.png`): gasta 34 px de margem lateral num celular de 390. Resolve junto com o achado 05.
- **Resultado "até ontem":** a semana não inclui hoje; para o profissional, "semana" é de segunda até agora. Resolve junto com o achado 06.

## 5. O que manter intacto

- "Recebi R$ 60,00 no Pix ▾" (`FinancePage.tsx:385-409`).
- "Faltou" imediato com "Desfazer"; "Atendido" e "Faltou" no cartão da Agenda depois do início (`AgendaPage.tsx:225-228`).
- Barra "Confirmar" fixa com resumo (`BookingFlowPage.tsx:324`).
- Reagendar (6 toques, sem digitar).
- Seletor de cliente com busca, "+ Novo" e "Sem cadastro"; erro com foco no campo.
- Alvos de 44 px, campos de 16 px, `inputMode` decimal e numeric.
- Barra de abas (5 itens de 78×64, rótulo visível) e o FAB "+" da Agenda.
- Semana como lista de 7 dias.
- Formulário de despesa (4 campos, foco no valor, data de hoje).
- Textos honestos sobre dinheiro e registro manual.

## 6. Decisões para os donos

1. Sub-abas do celular: manter 5 por aba, ou só as telas do ciclo e o resto no Menu. Recomendo só as do ciclo.
2. Cartão de configuração no Hoje: sempre no topo, ou no topo só quando não há atendimento no dia. Recomendo a segunda.
3. Encaixe: só horários livres da grade, ou "Outro horário" com aviso de sobreposição validado no servidor. Recomendo permitir.
4. Sessões recorrentes: "Repetir toda semana" no Novo agendamento, ou só em Assinaturas. Recomendo no fluxo.
5. Preço combinado na hora: sempre o calculado, ou ajustável ao receber respeitando o piso. Recomendo ajustável ao receber.
6. Quarta aba "Mensagens": manter ou trocar por "Mais". Recomendo decidir com o uso do piloto.

## 7. O que não foi coberto

- Novo cliente e edição de serviço: formulários desabilitados na demonstração; a análise veio do código.
- Tema escuro e larguras de 320 e 375 px (cobertos na revisão de 04/11).
- Teclado virtual real, área segura do iPhone e formato dos seletores nativos de data e hora (o Chromium sem tela mostra "10/20/2026" e "02:00 PM" pela localidade da máquina; não tratei como defeito).
- Importação de um arquivo de verdade.
- Assinaturas (recorrência) e venda de pacote do personal.
- Estados de carregamento, erro e sem conexão.
- Comportamento com servidor real: os achados 03 e 04 têm a causa conferida no código que fala com o servidor, mas não foram reproduzidos nele.
- Lista de espera, Domicílio, Orçamentos, Avaliações, Contas, Pagamentos e Notas fiscais (fora da missão).
- Não houve verificador separado nesta rodada: reabri arquivo e linha dos cinco achados de gravidade alta (01 a 05) antes de fechar.
