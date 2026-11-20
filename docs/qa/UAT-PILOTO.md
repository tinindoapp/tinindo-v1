# Testes com pessoas · piloto

Duas sessões: um **cabeleireiro** e um **personal trainer** (decisão do Felipe de 19/11, recado #109). Na homologação, com a pessoa usando o **próprio celular**. Quem conduz observa e não toca na tela. Cada sessão dura de 30 a 40 minutos.

Versão de 20/11/2026. O que mudou desde o roteiro de outubro está no fim deste arquivo.

## Regras combinadas (entram no convite)

- **É ambiente de teste.** Os dados são apagados ao fim do piloto.
- **Nenhuma mensagem sai sozinha.** O app prepara o texto e abre o WhatsApp; quem envia é a própria pessoa, se quiser. Lembretes ficam em "Lembretes a mandar", para mandar à mão.
- **Não mandar link de Pix a cliente.** "Recebi R$ 60,00 no Pix" só registra o que já entrou; o app não cobra ninguém.
- **O código da reserva pelo link é ditado por quem conduz.** Ele não chega ao celular de ninguém: sai num telefone simulado (ver "Antes de cada sessão").
- **Clientes só com o primeiro nome ou fictícios.** Nada de sobrenome, telefone real de terceiros, e-mail ou dado de saúde.

## Antes de cada sessão

- [ ] A homologação está com a `main` do dia (recado #109). Anotar o SHA no registro.
- [ ] Convite enviado com as cinco regras acima.
- [ ] A pessoa cria a própria conta em `/criar-conta`. Quem conduz não digita senha por ela.
- [ ] Cronômetro pronto e este registro aberto numa cópia por pessoa: nome curto e profissão, nunca telefone ou e-mail.
- [ ] **Reserva pelo link (passo do código):** depois que a pessoa criar o negócio, quem opera a homologação liga Mensagens para aquele negócio, só durante o teste (Mensagens fica guardado no piloto, P51), e conecta o número simulado:
  - `select app.module_admin_set('<id do negócio>', 'messaging', true);` no SQL do Supabase da homologação, com a chave de serviço;
  - em Mensagens, "Conectar número" com o provedor simulado;
  - ao fim da sessão, `select app.module_admin_set('<id do negócio>', 'messaging', false);`.
  Sem isso, pular o passo do link e anotar.

## Regras de quem conduz

- Pedir que a pessoa **fale em voz alta** o que está pensando.
- Só ajudar depois de 60 segundos travada. Cada ajuda é uma linha em "Suporte", com o motivo.
- Não explicar a tela antes. A pergunta é "o que você faria agora?".
- Se aparecer dado de outro negócio ou reserva dupla: parar, anotar a hora e avisar o Felipe na hora (gatilho de reversão).
- Se a pessoa procurar algo que não existe no piloto (Mensagens, Pix, nota fiscal, estoque, equipe), anotar o que ela procurou. A tela "Não disponível no piloto" é esperada.

## Primeiro acesso (cronometrado, igual para os dois)

Meta do docs/10: até 20 minutos.

O app abre na **configuração guiada**: na Hoje, "Deixe seu negócio pronto · N de 7" mostra o próximo passo. A pessoa pode descrever o negócio numa frase (Configuração › "Descreva seu negócio") e revisar o rascunho de horários e serviços, ou seguir passo a passo. Nada é gravado sem ela confirmar.

| Passo | Início | Fim | Ajudou? |
|---|---|---|---|
| Criar conta e confirmar o e-mail | | | |
| Nome do negócio e profissão | | | |
| Frase do negócio ou modelos de serviço (opcional) | | | |
| Horários da semana | | | |
| Primeiro serviço com duração e preço | | | |
| Antecedência para cancelar | | | |
| Publicar o perfil | | | |
| Primeiro cliente (só primeiro nome) | | | |
| **Total** | | | |

Conferir: a contagem chega a 7 de 7 ou só faltam opcionais, e a linha some da Hoje quando tudo está feito ou dispensado.

## Cabeleireiro

1. Criar "Corte" de 45 minutos com 10 minutos de intervalo depois, por R$ 80.
2. Agendar uma cliente para amanhã (primeiro nome). Na tela do atendimento, tocar "Avisar no WhatsApp": o WhatsApp abre com o texto pronto e **não envia sozinho**. A pessoa decide se envia (para o próprio número, de preferência).
3. Tentar encaixar outra cliente num buraco menor que 55 minutos. Esperado: não cabe, e a tela diz por quê.
4. Abrir o próprio link público numa aba anônima e pedir um horário como cliente. Quem conduz dita o código que aparece em Mensagens › Simulador. O pedido aparece na Agenda.
5. Reagendar a cliente do passo 2 para outro horário livre. O preço combinado não muda.
6. Quando o horário de um atendimento chegar (ou com um atendimento de hoje já começado), tocar **"Atendido"** no cartão "Próximo" da Hoje e escolher **"Recebi R$ 80,00 no Pix"**. Conferir no Caixa: o valor aparece em "Hoje".
7. Marcar outro atendimento como "Atendido" e escolher **"Cobrar depois"**. Conferir que ele aparece em Pendências na Hoje e no Caixa.
8. Abrir a aba **Retorno**: lembretes a mandar, quem não volta há 30 dias e lista de espera. Mandar um lembrete pelo WhatsApp (à mão).
9. Cancelar um agendamento futuro. A tela oferece a lista de espera, se houver alguém.
10. Perguntar ao Assistente "o que tenho amanhã?".

## Personal trainer

1. Criar "Sessão individual" de 60 minutos por R$ 120.
2. Cadastrar um aluno fictício e vender um **pacote de 10 sessões** no Caixa, registrando o pagamento.
3. **Repetir toda semana:** Novo agendamento › marcar "Repetir toda semana" › terça e quinta, às 7h, por 8 semanas. Conferir a **prévia das 16 datas** antes de confirmar. Se alguma estiver ocupada, ela aparece marcada como "fica de fora". Nada é criado até tocar "Confirmar repetição".
   - Esperado: "16 agendamentos criados" (ou o número livre, com a lista do que ficou de fora). Na Agenda, cada atendimento mostra "Repete toda semana · N de 16".
   - Se a pessoa quiser cancelar uma aula: "Cancelar só este". Ainda não há "cancelar os próximos" de uma vez (pendência no handoff do P51).
   - O horário de início precisa estar dentro do expediente: se o expediente começa às 9h, o passo 3 dá conflito em todas as datas. Ajustar os horários antes, se for o caso.
4. Concluir duas sessões com **"Atendido" › "Usar crédito do pacote"**. O saldo fica em 8.
5. Cancelar a terceira dentro da regra. O caixa não duplica nada.
6. Ligar **Assinaturas** em Conta › Mais recursos e abrir a tela. Anotar se a pessoa entende para que serve. Desligar de novo, se ela não for usar.
7. Abrir a aba **Retorno** e conferir quem não volta há 30 dias.
8. Conferir que nenhum campo pede dado de saúde.

## Registro da sessão

| Campo | Anotação |
|---|---|
| Profissão / nome curto | |
| SHA da homologação | |
| Aparelho e navegador | |
| Tempo do primeiro acesso | |
| Passos concluídos sem ajuda | de |
| Suporte (hora · passo · motivo) | |
| Onde travou ou desistiu | |
| O que procurou e não existe no piloto | |
| Frase que a pessoa disse sobre valor | |
| Pagaria? Quanto? (só anotar, sem insistir) | |
| Bugs (passo · o que viu · captura) | |

## Depois das duas sessões

- Desligar Mensagens dos negócios de teste (se foi ligado) e anotar.
- Tabela-resumo no handoff do P42: tempo de primeiro acesso, passos sem ajuda e suporte por motivo.
- Cada bug vira issue `para-felipe` ou PR, conforme o dono do pacote.
- Os dados dos dois negócios de teste são apagados ao fim do piloto, como dito no convite.
- Critério para seguir para os 14 dias do piloto: zero dupla reserva, zero vazamento e as duas pessoas fecharam o primeiro acesso. Se ninguém viu valor além da agenda, rever a promessa antes de abrir mais módulos (docs/10).

## O que mudou desde o roteiro de outubro

| Mudou | Onde | Pacote |
|---|---|---|
| Barbeiro e cabeleireira viraram **cabeleireiro e personal** (duas sessões) | todo o roteiro | decisão de 19/11 |
| O menu mostra **10 módulos**; 6 ligam em Conta › Mais recursos; o resto diz "Não disponível no piloto" | menu e Conta | P51 |
| A Hoje abre no **dia** (Próximo, lista, pendências); a configuração vira uma linha | Hoje | P48 |
| **"Atendido" leva a receber**: Recebi no Pix, Cobrar depois ou Usar crédito, no mesmo lugar | Hoje, Agenda | P48 |
| Aba **Retorno**: lembretes a mandar, quem não volta, lista de espera; "Avisar no WhatsApp" ao agendar | Retorno, Agenda | P49 |
| **Configuração guiada** com a frase do negócio e o guia do Assistente lendo o mesmo estado | Hoje, Configuração, Assistente | P44, P50 |
| **Repetir toda semana** no Novo agendamento, com prévia das datas | Agenda | D8 (a) |
| O texto dos planos diz que, no piloto, Grátis e Completo dão as mesmas funções | Plano e serviços | P51 (D3 b) |
