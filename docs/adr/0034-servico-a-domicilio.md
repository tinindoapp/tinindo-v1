# ADR-0034 · Serviço a domicílio: área por zona, deslocamento na agenda, janela de chegada e roteiro (P29)

Status: aceita · 2026-11-03 · integrador (sessão `claude-int-p29`, pedido do dono: "decida pelos docs")

## Contexto

O P29 pede área, deslocamento, janela de chegada e roteiro para quem atende na casa do cliente. O aceite do pacote é: "viagem entra na disponibilidade; localização tem finalidade e precisão limitadas". A agenda (P03) já tem expediente, bloqueios (`availability_blocks`), reservas com intervalo (`occupied_range`) e um lock por recurso (`app.sched_lock_resource`). A contratação pelo marketplace (P25) ainda não existe.

## Decisões

1. **Localização com finalidade e precisão limitadas.**
   - A área é feita de **zonas**: um nome (bairro ou região) e prefixos de CEP de 5 dígitos (setor postal, não rua). Um CEP fica numa zona ativa só.
   - A **distância** da base até a zona é declarada pelo dono, em km. Não há geocodificação, mapa nem API externa.
   - A visita guarda a zona e, se o dono quiser, os 5 primeiros dígitos do CEP. Nunca endereço, número, complemento, coordenada nem posição em tempo real. Um teste de contrato e um pgTAP impedem colunas desse tipo nas tabelas `field_*`.
   - `field.zone_for` recebe o CEP inteiro, usa os 5 primeiros dígitos e não guarda nada.
   - A auditoria registra zona e minutos, nunca o CEP da visita.
   - Finalidade: decidir se a visita está na área, calcular o deslocamento e montar o roteiro. Nada mais usa esses dados.

2. **Área = zona ativa dentro da distância máxima.** As regras do negócio (`field_settings`) têm a distância máxima (opcional). Zona inativa ou mais longe que isso fica "fora da área", e marcar visita nela é recusado (`POLICY_REJECTED/area`).

3. **O deslocamento é um bloqueio da agenda do P03.**
   - Cada visita ativa do dia ganha um `availability_blocks` "Deslocamento até <zona>" que termina quando o atendimento começa.
   - A duração é: da base para a zona, na primeira visita do dia; o tempo cadastrado entre as duas zonas (`field_travel_times`, simétrico); o tempo da mesma zona; ou o padrão.
   - Como é bloqueio comum, ele some das vagas (pública e do dono) e impede reserva por cima, sem mudar o motor da agenda.
   - Marcar, tirar e recalcular travam o recurso com o mesmo `app.sched_lock_resource` do P03. Por isso reserva e deslocamento nunca ficam os dois com o mesmo horário (teste de concorrência).
   - O dia é refeito inteiro, em ordem. Se um deslocamento bate com reserva ou bloqueio, sai `SLOT_CONFLICT/travel` e a transação é desfeita: o roteiro anterior continua.

4. **Mudança na agenda pede recálculo, sem job.** Um gatilho em `bookings` solta o deslocamento da visita que foi cancelada ou remarcada. As outras visitas do dia mantêm o bloqueio, para a agenda continuar protegida, mas ficam sem tempo calculado. O roteiro mostra "recalcular", e o dono decide.

5. **Janela de chegada** = início do atendimento menos N minutos (regra do negócio, padrão 30). A tela monta a mensagem "Chego entre X e Y" para WhatsApp ou copiar. Nada é enviado sozinho.

6. **Só o dono** opera, com RLS só do dono e escrita só por RPC `security definer`. Os comandos são idempotentes por chave (`field.*`).

## Fora deste pacote

- **Contratação pelo marketplace (P25):** cliente escolhendo domicílio, informando CEP na reserva pública e vendo a janela. Depende do fluxo de contratação do P25.
- **Execução da visita** além do que o P03 já faz (concluir, falta). Check-in por localização foi descartado pela regra de privacidade.
- **Preço de deslocamento.** Taxa por zona ou por km entraria pelo P11 (orçamento) ou pelo P04 (preço), com regra própria.
- **Mais de uma agenda:** o deslocamento usa a agenda principal do negócio. Equipes (P28) com deslocamento por profissional ficam para depois.

## Consequências

- O motor da agenda não muda. Desligar o domicílio (regra `enabled = false`) só impede novas visitas; os bloqueios existentes continuam até o dono tirar as visitas ou recalcular.
- A distância é declarada, e por isso pode estar errada. O dono ajusta minutos e km por zona.
