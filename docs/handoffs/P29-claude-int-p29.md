# Handoff · P29 Serviço a domicílio

Sessão: `claude-int-p29` (Claude Code na nuvem, para @fffalleiros) · 2026-11-03
Reserva: `coord.py claim P29 --session claude-int-p29` · branch `task/p29/claude-int-p29` → PR para `main`. Decisões em `docs/adr/0034-servico-a-domicilio.md`.

## Resultado

- **Banco** (`20261103030000_p29_field_service.sql`, aditiva): quatro tabelas novas.
  - `field_settings`: regras do negócio.
  - `field_zones`: nome, prefixos de CEP de 5 dígitos, km declarados e minutos da base.
  - `field_travel_times`: tempo entre duas zonas.
  - `field_visits`: reserva, zona, CEP de 5 dígitos e o bloqueio de deslocamento.
  - 9 RPCs do dono e um gatilho em `bookings`. O motor da agenda (P03) não muda. O deslocamento é um `availability_blocks` comum.
- **Edge Function `field-service`**, com 9 rotas sobre o `rpc-handler`.
- **Contratos** aditivos em `_shared/contracts/field-service.ts`, módulo `field-service`, operações `field.*`. Também docs/03, docs/10 (FIELD-01) e release/CHECKLIST (28 funções).
- **Tela** `/app/domicilio` (Agenda → Domicílio), em três abas:
  - **Roteiro:** dia com anterior e próximo; visitas em ordem com saída, minutos e janela de chegada; "Avisar a janela" com mensagem pronta (WhatsApp, compartilhar ou copiar); "Tirar do domicílio" com `ConfirmAction` e toast **Desfazer**; aviso "Recalcular deslocamentos"; atendimentos do dia para marcar como domicílio, com CEP opcional que sugere a zona.
  - **Zonas:** dentro ou fora da área, criar e editar, tempo entre zonas.
  - **Regras:** padrão, mesma zona, janela e distância máxima.
  
  Os formulários usam `Field` e `useFormErrors`, com o erro embaixo do campo. A demonstração usa as mesmas regras e é rotulada.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Viagem entra na disponibilidade | **pgTAP 30:** o deslocamento vira bloqueio, some das vagas e a reserva por cima dá `SLOT_CONFLICT`.<br>**Integração `45_p29_domicilio`:** `availability.list` sem os horários do deslocamento e `booking.create` recusado.<br>**Concorrência `28_field_service`:** marcar visita × reservar no mesmo horário em 5 rodadas, nunca os dois e nenhum bloqueio sobre reserva ativa |
| Deslocamento entre atendimentos ocupa a agenda | Base → zona na primeira visita, zona → zona pelo tempo cadastrado, mesma zona e padrão (pgTAP/integração/demo).<br>Não cabe → `SLOT_CONFLICT/travel` e nada muda (pgTAP/integração/demo/e2e) |
| Janela de chegada para o cliente | `arrival_from`/`arrival_to` pela regra do negócio (pgTAP/integração).<br>**e2e:** mensagem pronta "Chego entre 08:30 e 09:00"; mudar a janela para 45 min muda o roteiro |
| Roteiro do dia em ordem | `field.route` em ordem de início, com saída e minutos (integração/e2e).<br>Cancelar no P03 solta o deslocamento e pede recálculo; recalcular refaz, inclusive com 5 recálculos simultâneos sem duplicar |
| Área por bairro e raio | Zona com CEPs de 5 dígitos e km declarados; fora da distância máxima ou inativa → `POLICY_REJECTED/area`; um CEP numa zona só (pgTAP/integração/e2e) |
| Localização limitada | Nenhuma coluna de endereço, coordenada ou rastreamento (pgTAP + teste de contrato); só a zona e 5 dígitos do CEP; `zone_for` não guarda o consultado; auditoria sem CEP (integração) |
| Idempotência e isolamento | Mesma chave → mesma resposta (pgTAP; concorrência com 10× a mesma chave → 1 visita).<br>Dono B → 403; cliente → 403; reserva de A usada no negócio B → 404; anon sem execução (pgTAP/integração) |

## Comandos e resultados (local, Postgres 16 + pgTAP)

| Comando | Resultado |
|---|---|
| Bateria completa, com a main de 03/11 (P31 incluído) | unit 602 · contratos 650 · pgTAP 30 arquivos ok · concorrência 28 scripts ok · integração 129 · deno 28 funções · e2e 219 passaram, 33 fixme que já existiam |
| `npm run lint` · `typecheck` · `build` | ok |
| pgTAP `30_field_service` | 41/41 |
| concorrência `28_field_service` | 9/9 |
| integração `45_p29_domicilio` | 5/5 |
| e2e `field-service` | desktop e celular (375 px), ok |

Não executado aqui: `supabase test db` e `db lint` no PG 17, porque não há Docker. Os dois rodam no CI.

## Decisões tomadas sem consulta (pedido do dono: "decida pelos docs")

- **Quadro:** o P29 foi liberado no quadro pelo integrador, com autorização do dono para escrever no branch `coordination`, e reservado pelo `coord.py`.
- **"Raio" é a distância declarada da zona até a base**, comparada com a distância máxima. Não há geocodificação nem API de mapas: não cabe no aceite de privacidade nem no custo.
- **CEP de 5 dígitos** (setor postal) é a maior precisão guardada. O CEP inteiro só passa pela consulta da zona.
- **Deslocamento como `availability_blocks`**, sem mudar o motor da agenda. O lock é o mesmo do P03.
- **Uma agenda:** a principal do negócio. O deslocamento por profissional de equipe (P28) fica para depois.
- **Recalcular é ação do dono.** Cancelar ou remarcar pede recálculo, sem refazer sozinho, porque o novo roteiro pode não caber e quem decide é o dono.
- **Concorrência em pasta temporária própria:** o `$TMP` do runner é o mesmo para todos os scripts, e arquivos de outros scripts entravam na contagem. A mesma correção foi feita no P31.
- **Hint `cep` (não `cep5`)** no erro de CEP fora da zona: o mapeador de erros só aceita `[a-z_.]` no campo.

## Fora deste pacote (anotado para o P25 e depois)

- **Contratação pelo marketplace (P25):** o cliente escolhe domicílio, informa o CEP na reserva pública e vê a janela. A reserva pública (P43) e o marketplace devem chamar `field.zone_for` e marcar a visita no mesmo comando da reserva, quando o P25 definir o fluxo.
- **Taxa de deslocamento** (P11/P04).
- **Execução da visita** além de concluir e falta (P03). Check-in por GPS foi descartado pela regra de privacidade.

## Pendências e próximos passos

- Homologação: nada aplicado. O projeto `kitdsdyydgutnbiwjblw` não foi tocado.

## Recuperação

A migration é aditiva. Para desligar novas visitas, use a regra "Atendo a domicílio" (`enabled = false`) ou tire a linha do módulo em `src/app/modules.ts`/`navigation.ts`. Os bloqueios de deslocamento são `availability_blocks` comuns: tirar a visita ou remover o bloqueio na agenda libera o horário.
