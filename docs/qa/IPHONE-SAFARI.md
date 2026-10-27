# iPhone real · Safari e tela inicial (P42)

Fecha a lacuna UX-01 do docs/10: até aqui o app só foi testado em Chrome desktop e em emulação Pixel 7 e iPhone. O teste é com o aparelho na mão, contra a **homologação**, com a conta técnica sintética.

Anotar: modelo do iPhone, versão do iOS e SHA de `/version.json`. Para cada linha, marcar ok ou descrever o problema com uma captura de tela.

## 1 · No Safari

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | Abrir o endereço da homologação | Tela "Entrar"; depois de entrar, faixa "Demonstração · homologação" no topo; nada cortado no entalhe nem na barra inferior |
| 2 | Entrar com a conta técnica | O teclado não cobre o botão Entrar; o e-mail não vem com a primeira letra maiúscula; o Safari oferece salvar a senha |
| 3 | Abrir Menu → Agenda → Hoje → Clientes | Sem rolagem para os lados; o menu abre e fecha com um toque |
| 4 | Criar um agendamento para amanhã | Os horários cabem na tela; ao tocar num campo, a tela não fica ampliada (fonte menor que 16 px dá zoom no iOS) |
| 5 | Girar o aparelho | Layout se ajusta; nada some |
| 6 | Abrir o link público `/p/<slug>` numa aba anônima | Serviços, dias e horários; ao pedir o horário, a tela do código aparece |
| 7 | Botão "WhatsApp" do pedido no detalhe do atendimento | Abre o WhatsApp com o número certo |
| 8 | Bloquear e desbloquear o celular depois de 5 min | Continua logado; a Agenda recarrega sem erro |
| 9 | Modo escuro do iPhone ligado | Texto legível em todas as telas acima |
| 10 | Ajustes → Acessibilidade → Texto maior no máximo | Botões não se sobrepõem; textos quebram linha |

## 2 · Na tela inicial (app instalado)

| # | O que fazer | O que esperar |
|---|---|---|
| 11 | Safari → Compartilhar → Adicionar à Tela de Início | Ícone da Tinindo (não uma captura da página), nome "Tinindo" |
| 12 | Abrir pelo ícone | Abre em tela cheia direto no `/app`, sem a barra do Safari; barra de status legível |
| 13 | Sair (Menu → Sair) e entrar de novo pelo ícone | Volta para Entrar; depois do login cai na Agenda/Hoje |
| 14 | Fechar o app pela troca de apps e abrir de novo | Continua logado |
| 15 | Modo avião e abrir o app | Mensagem honesta de sem conexão, nunca dado inventado |

## 3 · Resultado

| Item | Resultado | Captura | Observação |
|---|---|---|---|
| 1–10 Safari | | | |
| 11–15 Tela inicial | | | |

Problema encontrado vira issue com a etiqueta `para-felipe` (ou PR de correção do Gabriel, quando o arquivo é de pacote dele), com modelo, iOS e passo.
