# Handoff · roteiro de UAT para o cabeleireiro e o personal

Sessão: `claude-p51` (Felipe) · 2026-11-20
Branch: `claude/kind-allen-m9zju9`, terceiro PR da sessão. Só documentação: `docs/qa/UAT-PILOTO.md`.

## Entregue

- Roteiro com duas sessões (cabeleireiro e personal), no lugar das três de outubro.
- As cinco regras combinadas pelo Felipe no recado #109 no topo, para entrar no convite: ambiente de teste com dados apagados ao fim; nenhuma mensagem sai sozinha; não mandar link de Pix a cliente; código do link ditado por quem conduz; clientes só com o primeiro nome ou fictícios.
- Primeiro acesso pela configuração guiada (7 passos no piloto, frase do negócio).
- Cabeleireiro: "Avisar no WhatsApp" ao agendar, encaixe que não cabe, reserva pelo link com o código ditado, reagendar sem mudar o preço, "Atendido" com "Recebi no Pix" e "Cobrar depois", aba Retorno, cancelar com lista de espera, Assistente.
- Personal: pacote de 10, "Repetir toda semana" terça e quinta às 7h por 8 semanas com a prévia, "Atendido" com crédito do pacote, cancelar sem duplicar, Mais recursos › Assinaturas, Retorno, nenhum dado de saúde.
- Tabela "O que mudou desde o roteiro de outubro".

## Atenção para quem conduz (efeito do P51)

O código da reserva pelo link sai pelo canal **simulado** e só é lido em Mensagens › Simulador. Mensagens ficou **guardado** no piloto (P51). Para o passo do link, quem opera a homologação liga Mensagens no negócio de teste durante a sessão, pelo backend:

```sql
select app.module_admin_set('<id do negócio>', 'messaging', true);  -- antes
select app.module_admin_set('<id do negócio>', 'messaging', false); -- depois
```

Está no roteiro, em "Antes de cada sessão". Isso é operação na homologação, do Gabriel (recado #109); nada foi aplicado por esta sessão.

## Pendências

- O "Cancelar os próximos" da série não existe ainda (handoff `P51-repetir-toda-semana.md`). O roteiro diz isso.
- A decisão de longo prazo do código pelo link (WhatsApp oficial, opção (b) de `release/P42-LIBERACAO.md`) continua aberta.
