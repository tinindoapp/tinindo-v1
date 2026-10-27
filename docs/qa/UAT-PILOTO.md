# Testes com pessoas · piloto (P42)

Três sessões, uma por arquétipo do docs/10: barbeiro, cabeleireira e personal. Na homologação, com a pessoa usando o **próprio celular**. O condutor (Gabriel) observa e não toca na tela. A sessão dura de 30 a 40 minutos.

## Antes de cada sessão

- [ ] Convite com o aviso: ambiente de teste, dados apagados ao fim do piloto, nenhuma mensagem real sai para clientes.
- [ ] A pessoa cria a própria conta em `/criar-conta`. O condutor não digita senha por ela.
- [ ] Cronômetro pronto. Este registro aberto numa cópia, uma por pessoa: nome curto e arquétipo, nunca telefone ou e-mail.
- [ ] Combinar com o Felipe a decisão 1 do `release/P42-LIBERACAO.md`, o código da reserva pelo link.

## Regras do condutor

- Pedir que a pessoa **fale em voz alta** o que está pensando.
- Só ajudar depois de 60 segundos travada. Cada ajuda é uma linha em "Suporte" com o motivo.
- Não explicar a tela antes. A pergunta certa é "o que você faria agora?".
- Se aparecer dado de outro negócio, ou uma reserva dupla: parar, anotar a hora e avisar o Felipe na hora (gatilho de reversão).

## Onboarding (cronometrado, igual para os três)

Meta do docs/10: até 20 min.

| Passo | Início | Fim | Ajudou? |
|---|---|---|---|
| Criar conta e confirmar o e-mail | | | |
| Nome do negócio e profissão | | | |
| Primeiro serviço com preço | | | |
| Horário de atendimento da semana | | | |
| Primeiro cliente | | | |
| **Total** | | | |

## Barbeiro

1. Criar "Corte" de 30 min, R$ 60 e piso R$ 45.
2. Importar cinco clientes da própria lista (ou da lista de exemplo do condutor).
3. Agendar um deles para amanhã.
4. Abrir o próprio link público e mandar para o condutor. O condutor escolhe um horário pelo link.
5. Criar uma oferta para terça com piso.
6. Cancelar um agendamento e ver a lista de espera sugerir alguém.
7. Concluir um atendimento e marcar como recebido.
8. Perguntar ao assistente "o que tenho amanhã?".

## Cabeleireira

1. Criar um serviço de 90 min com 15 min de intervalo.
2. Tentar encaixar num buraco de 60 min. Esperado: não cabe, e a tela diz por quê.
3. Mudar a duração para 75 min. As reservas antigas continuam com 90 e as novas usam 75.
4. Reagendar um cliente para outra faixa permitida. O preço combinado não muda.

## Personal

1. Vender um pacote de 10 sessões e registrar o pagamento.
2. Agendar recorrência de 8 semanas. Uma data dá conflito: resolver.
3. Concluir duas sessões. O saldo fica em 8.
4. Cancelar a terceira conforme a regra. O caixa não duplica.
5. Conferir que nenhum campo pede dado de saúde.

## Registro da sessão

| Campo | Anotação |
|---|---|
| Arquétipo / nome curto | |
| Aparelho e navegador | |
| Tempo de onboarding | |
| Passos concluídos sem ajuda | de |
| Suporte (hora · passo · motivo) | |
| Onde travou ou desistiu | |
| Frase que a pessoa disse sobre valor | |
| Pagaria? Quanto? (só anotar, sem insistir) | |
| Bugs (passo · o que viu · captura) | |

## Depois das três

- Tabela-resumo no handoff do P42: tempo de onboarding, passos sem ajuda e suporte por motivo.
- Cada bug vira issue `para-felipe` ou PR, conforme o dono do pacote.
- Critério para seguir para os 14 dias do piloto: zero dupla reserva, zero vazamento e as três pessoas fecharam o onboarding. Se ninguém viu valor além da agenda, rever a promessa antes de abrir mais módulos (docs/10).
