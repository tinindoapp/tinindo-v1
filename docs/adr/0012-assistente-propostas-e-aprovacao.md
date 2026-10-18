# ADR-0012 · Assistente do dono: motor determinístico, propostas vinculadas e execução com recibo (P08)

Status: aceita · 2026-10-18 · integrador (implementou o P08)

## Decisões

1. **Sem LLM no piloto.** O assistente é um motor determinístico em pt-BR (`supabase/functions/_shared/domain/agent`). Ele reconhece a intenção por regras, consulta só pelas ferramentas e monta o texto com modelos fixos a partir dos números devolvidos. Assim ele não inventa valor, funciona sem provedor (AE-20) e tem custo previsível. Usar um provedor de LLM para entender pedidos mais livres é uma **decisão de produto e de credencial** (provedor, chave, orçamento e DPA) que fica com o dono do projeto. Se for adotado, o LLM só escolhe intenção e argumentos, e a execução continua passando pelas mesmas ferramentas, propostas e aprovações.
2. **Ferramentas: lista fechada, tenant da sessão.** Leituras: `agent_agenda_read` (expediente, bloqueios e reservas ativas, até 62 dias), `agent_directory` (serviços, clientes com origem declarada, regras de preço ativas, política de cancelamento e só a contagem da lista de espera) e `agent_finance_read` (só o dono: registros do período, contas em aberto e pacotes). As três exigem vínculo (`app.is_member`) e recebem o tenant do header validado, nunca do texto. No catálogo `AgentTool`, as leituras de agenda e cadastro contam como `agenda.read` e as de caixa como `finance.summary`. Não existe ferramenta de SQL.
3. **Portão antes de tudo.** `agent_run_start` confere o vínculo e debita a franquia mensal do negócio (`agent_quotas`, padrão 200 perguntas/mês) sob lock, antes de qualquer leitura. Sem vínculo a resposta é 403, e com a franquia esgotada é 429 `QUOTA_EXCEEDED`. A mesma `Idempotency-Key` não debita duas vezes. Uma execução tem teto de 8 chamadas de ferramenta, e a ocupação vai até 31 dias por pergunta. Nenhum texto de pergunta ou resposta é guardado.
4. **Proposta ≠ aprovação ≠ execução.** Um pedido inequívoco gera `agent_proposals` pendente com `payload_hash = sha256(payload jsonb normalizado | policy_version)`, versão e prazo de 30 minutos. O resumo humano mostra cliente, serviço, horário, valor e piso. Ambiguidade (duas Marias, serviço ou horário faltando, "mais tarde") vira pergunta, nunca proposta. Só o dono propõe, aprova e executa. A equipe consulta, mas não lê o caixa nem a lista de espera.
5. **Aprovação vinculante e única.** `action.approve` trava a proposta e confere versão, estado, hash e prazo. Ela grava `agent_approvals` (15 min, append-only, `unique (tenant, proposal)`), muda a versão da proposta e emite `agent.action.approved.v1`. Uma segunda aprovação da mesma versão recebe `STALE_VERSION`: nunca existem duas aprovações executáveis.
6. **Execução repete a checagem.** `action.execute` trava a aprovação e depois a proposta. Se já existe recibo, devolve o mesmo (retry e corrida, AE-38/39). Senão, executa pelas funções do módulo dono do dado:
   - `booking.create`: nova cotação P05 e `app.sched_insert_booking`, origem `agent`. Preço diferente do aprovado não executa.
   - `booking.reschedule` e `booking.cancel`: as RPCs do P03, com a versão da reserva.
   - `pricing.propose_rule`: cria propostas de regra no P05, que só valem depois da publicação na tela de Preços.
   Conflito de agenda, versão, preço ou prazo vira recibo `rejected_by_policy` com o motivo e invalida a proposta. Quem quiser tentar de novo precisa de uma nova proposta (AE-40).
7. **Dados são dados.** Nomes, recados e documentos aparecem como texto (sem HTML e com limite de tamanho) e nunca viram instrução. Recados da lista de espera nem são lidos. Pedidos de SQL, de instruções internas ou de chaves, de outro negócio, de nota fiscal, de envio de mensagem e de mover dinheiro têm recusa fixa.

## Avaliação

`tests/contracts/agent/evals.test.ts` roda os 40 casos de `tests/agent-evals` contra o motor real, com o portão emulado. Os casos AE-37 a AE-40 rodam no Postgres real (`08_agent.test.sql` e `tests/db-concurrency/08_agent.sh`). Resultado: 40/40, com blockers e majors passando.

## Contrato

Sem mudança: o P08 usa `agent.ask`, `action.approve` e `action.execute` como já estavam no registro. O transporte é `POST /functions/v1/agent/<operação>`. `agent.ask` aceita `Idempotency-Key` opcional.
