# Testes com pessoas · piloto

Duas sessões: um **cabeleireiro** e um **personal trainer** (decisão do Felipe de 19/11, recado #109). Na homologação, com a pessoa usando o **próprio celular**. Quem conduz observa e não toca na tela. Cada sessão dura de 30 a 40 minutos.

Versão de 21/11/2026. O que mudou desde o roteiro de outubro e desde 20/11 está no fim deste arquivo. A ficha de registro, uma por sessão, está em "Ficha da sessão".

## Regras combinadas (entram no convite)

- **É ambiente de teste.** Os dados são apagados ao fim do piloto.
- **Nenhuma mensagem sai sozinha.** O app prepara o texto e abre o WhatsApp; quem envia é a própria pessoa, se quiser. Lembretes ficam em "Lembretes a mandar", para mandar à mão.
- **Não mandar link de Pix a cliente.** "Recebi R$ 60,00 no Pix" só registra o que já entrou; o app não cobra ninguém.
- **O código da reserva pelo link é ditado por quem conduz.** Ele não chega ao celular de ninguém: sai num telefone simulado (ver "Antes de cada sessão").
- **Clientes só com o primeiro nome ou fictícios.** Nada de sobrenome, telefone real de terceiros, e-mail ou dado de saúde.

## Antes de cada sessão

- [ ] A homologação está com a `main` do dia (recado #109). Anotar o SHA no registro.
- [ ] Convite enviado com as cinco regras acima.
- [ ] A pessoa cria a própria conta em `/criar-conta`. Quem conduz não digita senha por ela. A senha pede **10 caracteres, com letras e números** (D28). Com "Confirm email" ligado, o e-mail chega em português (`release/EMAIL-RESEND.md`); se não chegar em 2 minutos, olhar o spam e usar "Reenviar o link de confirmação" na tela de entrar.
- [ ] Cronômetro pronto e uma **Ficha da sessão** (fim deste arquivo) copiada por pessoa: nome curto e profissão, nunca telefone ou e-mail.
- [ ] **Reserva pelo link (passo do código):** depois que a pessoa criar o negócio, quem opera a homologação liga Mensagens só naquele negócio, durante o teste (Mensagens fica guardado no piloto, P51). Um comando, do computador que publica (`release/PUBLICAR.md`, "Depois de publicar"):
  ```bash
  npm run preparar:uat -- homolog --cabeleireiro <id do negócio>   # ou --personal <id>; os dois de uma vez também servem
  ```
  O id está no Table Editor › `tenants`. Depois, na tela da pessoa, Mensagens › "Conectar número" com o provedor simulado. Ao fim da sessão, o mesmo comando com `--desligar`. Sem isso, pular o passo do link e anotar.

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

Conferir: a contagem chega a 7 de 7 ou só faltam opcionais, e a linha some da Hoje quando tudo está feito ou dispensado. Em Conta, o cartão "Primeiros passos" leva à mesma lista (não tem contagem própria).

Também observar, sem cronometrar: a pessoa entende as frases de Conta › "Mais recursos" (cada módulo diz para que serve e o que acontece ao ligar) e acha "Seus dados" em Conta.

## Cabeleireiro

1. Criar "Corte" de 45 minutos com 10 minutos de intervalo depois, por R$ 80.
2. Agendar uma cliente para amanhã (primeiro nome). Na tela do atendimento, tocar "Avisar no WhatsApp": o WhatsApp abre com o texto pronto e **não envia sozinho**. A pessoa decide se envia (para o próprio número, de preferência). "Mandar link da reserva" faz o mesmo com o link que a cliente usa para ver o horário e, depois, avaliar.
3. Tentar encaixar outra cliente num buraco menor que 55 minutos. Esperado: não cabe, e a tela diz por quê.
4. Abrir o próprio link público numa aba anônima e pedir um horário como cliente. Antes de confirmar, a tela mostra **preço, duração, local e a regra de cancelamento** (P55). Quem conduz dita o código que aparece em Mensagens › Simulador (a mensagem começa com "Código de <negócio>"). Se o código não chegar, "Reenviar código" aparece depois de 30 s. A confirmação leva a "Ver minha reserva". O pedido aparece na Agenda.
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
   - Esperado: "16 agendamentos criados" (ou o número livre, com a lista do que ficou de fora). Terça e quinta formam **uma série só** (#143). Na Agenda, cada atendimento mostra "Repete toda semana · N de 16", lido do servidor: abrir em outro aparelho mostra o mesmo.
   - Cancelar uma aula: "Cancelar só este". Parar a série: **"Cancelar os próximos"** no detalhe, com confirmação; passados e concluídos ficam como estão.
   - O horário de início precisa estar dentro do expediente: se o expediente começa às 9h, o passo 3 dá conflito em todas as datas. Ajustar os horários antes, se for o caso.
4. Concluir duas sessões com **"Atendido" › "Usar crédito do pacote"**. O saldo fica em 8.
5. Cancelar a terceira dentro da regra. O caixa não duplica nada.
6. Ligar **Assinaturas** em Conta › Mais recursos e abrir a tela. Anotar se a pessoa entende para que serve. Desligar de novo, se ela não for usar.
7. Abrir a aba **Retorno** e conferir quem não volta há 30 dias.
8. Conferir que nenhum campo pede dado de saúde.

## Registro da sessão

Uma **Ficha da sessão** por pessoa (modelo no fim deste arquivo). Copiar o modelo para o handoff do P42 ou para um arquivo fora do repositório; sem telefone, e-mail ou sobrenome. Ao fim, a tabela-resumo do handoff do P42 sai das fichas.

## Depois das duas sessões

- `npm run preparar:uat -- homolog --cabeleireiro <id> --personal <id> --desligar` e anotar na ficha.
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

## O que mudou desde 20/11

| Mudou | Onde | Pacote |
|---|---|---|
| **Mensagens liga por comando** (`npm run preparar:uat`), não por SQL à mão | Antes de cada sessão | P58 |
| **Série do servidor:** terça e quinta numa série só, "N de 16" igual em qualquer aparelho e **"Cancelar os próximos"** | Agenda (personal, passo 3) | #143 |
| **Link da reserva:** preço, local e regra antes de confirmar; "Reenviar código"; "Ver minha reserva"; "Mandar link da reserva" no atendimento | Página pública, Agenda | P55, #143 |
| **Layout novo:** ação principal única por tela, números grandes com rótulo, linha do tempo na Hoje, Concluído em verde | Hoje, Clientes, Retorno, Caixa | P54 |
| **Conta:** senha de 10 com letras e números, "Reenviar o link de confirmação", entrar volta à tela de onde veio, aviso de sessão terminada, "Sair" apaga o que estava no aparelho | Entrar, Criar conta | Primeiro acesso |
| **Termos e política** abrem no cadastro, marcados como rascunho, com a versão que o aceite registra | Criar conta, Criar negócio | Primeiro acesso (#87) |
| **Seus dados** em Conta: baixar e pedir eliminação | Conta | P57 |

## Ficha da sessão

Copiar uma por pessoa. Horas no relógio do celular de quem conduz.

```text
FICHA · UAT do piloto
Data: ____/____/2026        Início: ____:____   Fim: ____:____
Quem conduz: ______________   Profissão: cabeleireiro | personal   Nome curto: __________
SHA da homologação (version.json): ________________________
Aparelho e navegador: __________________   Wi-Fi | dados móveis
preparar:uat ligado às ____:____   desligado às ____:____   Número simulado conectado? sim | não
Confirm email ligado? sim | não   E-mail chegou em ____ min   Caiu no spam? sim | não

PRIMEIRO ACESSO (meta: 20 min)
Passo                                     Início  Fim   Ajuda? (motivo)
Criar conta e confirmar o e-mail          ____    ____  ______________
Nome do negócio e profissão               ____    ____  ______________
Frase do negócio ou modelos (opcional)    ____    ____  ______________
Horários da semana                        ____    ____  ______________
Primeiro serviço com duração e preço      ____    ____  ______________
Antecedência para cancelar                ____    ____  ______________
Publicar o perfil                         ____    ____  ______________
Primeiro cliente (só primeiro nome)       ____    ____  ______________
Total: ____ min   Contagem final na Hoje: ___ de 7

ROTEIRO DA PROFISSÃO (número do passo · ok | com ajuda | não fez · observação)
1 ____  2 ____  3 ____  4 ____  5 ____  6 ____  7 ____  8 ____  9 ____  10 ____
Reserva pelo link: código ditado às ____:____   pedido apareceu na Agenda? sim | não
"Recebi no Pix" apareceu no Caixa? sim | não     Retorno abriu com dados? sim | não

SUPORTE (hora · passo · o que perguntou · o que foi dito)
-
-

ONDE TRAVOU OU DESISTIU:
O QUE PROCUROU E NÃO EXISTE NO PILOTO:
FRASE SOBRE VALOR (literal):
PAGARIA? QUANTO? (só anotar):
BUGS (passo · o que viu · captura sem dado pessoal · issue):
-
GATILHO DE PARADA? (dupla reserva, dado de outro negócio, mensagem que saiu sozinha): não | sim às ____:____
```
