# ADR-0014 · Planos e serviços assistidos (P15)

Status: aceita · 2026-10-18 · integrador (implementou o P15 por pedido direto do dono do projeto)

## Decisões

1. **Catálogo da Tinindo separado do catálogo do profissional.** `platform_offerings` + `offering_versions` (append-only, com hash do escopo) não se misturam com `provider_services`. Uma versão traz preço, cobrança (mensal ou única), o que inclui e o que não inclui, franquia (perguntas ao assistente para planos, minutos humanos para serviços) e prazo de referência.
2. **Publicar é decisão de backend.** `app.svc_publish_offering` só roda com `service_role`; repetir o mesmo conteúdo não cria versão. A migration publica apenas os planos já prometidos em público (Grátis e Completo de fundador a R$79/mês, docs/00). A franquia do assistente fica em 200/mês nos dois, que é o padrão atual do P08, até o dono definir franquias por plano. Serviços assistidos reais (preço, minutos) **não** foram publicados: o seed local/CI tem um serviço sintético “(exemplo)”.
3. **Compromisso histórico.** Assinatura e pedido copiam preço, hash do escopo e franquia da versão aceita. Só a versão mais recente aceita novas adesões, e assinar/pedir exige o hash visto (409 se mudou). Uma versão nova não muda quem já aderiu.
4. **Franquia aplicada no servidor.** Trocar de plano atualiza `agent_quotas.monthly_limit` (P08) na mesma transação. A troca trava o tenant com `FOR NO KEY UPDATE`: `FOR UPDATE` dava deadlock com o `KEY SHARE` que as FKs da idempotência já tomam (achado no teste de concorrência e coberto por ele).
5. **Pedido de serviço.** O pedido já nasce com o escopo aceito (o dono aceita a versão ao pedir). Estados: escopo aceito → aguardando acesso → em execução → revisão do cliente → entregue, mais bloqueado e cancelado. Toda transição vai para `service_order_events` (append-only); pedir ajustes reabre com registro.
6. **Minutos medidos, com teto.** `work_logs` (append-only) separa trabalho humano de automação e marca retrabalho. A soma não passa da franquia do pedido: acima disso, 429 `QUOTA_EXCEEDED` e nada é gravado (o pedido fica travado durante o registro).
7. **Operador sem acesso global.** `platform_operators` só é preenchida pelo backend (nenhuma RPC concede o papel). O operador vê a fila (sem dados de clientes) e só começa ou lê com `access_grant` do dono: pessoal (o responsável do pedido), com escopos fechados (`catalog`, `agenda`, `customers`), justificativa e prazo de até 30 dias. A concessão só pode ser revogada depois de criada. `ops.snapshot` devolve dados mínimos (sem telefone, e-mail ou observações) e cada leitura vira `access.read` na auditoria, visível ao dono em `access.log`. Trocar o responsável, cancelar ou aprovar a entrega revoga os acessos.
8. **Cobrança manual.** `billing_source = 'manual'`: registrar plano ou pedido não é pagamento nem gera recebível. Gateway é o P14.
9. **Rota sem negócio.** O handler genérico ganhou `tenant: false`, usado só por `ops.queue`; comandos sem negócio são proibidos na definição da rota (a idempotência é por tenant).

## Contrato (aditivo)

Módulo `service-ops`: `plan.current`, `plan.subscribe`, `order.request`, `order.list`, `order.cancel`, `order.review_delivery`, `access.grant`, `access.revoke`, `access.log`, `ops.queue`, `ops.assign`, `ops.start`, `ops.log_work`, `ops.deliver`, `ops.block`, `ops.snapshot`.

## Pendências do dono do projeto

Catálogo real de serviços assistidos (preço, minutos e prazo), franquias por plano, quem são os operadores (inserção em `platform_operators` em cada ambiente) e o processo de cobrança manual.
