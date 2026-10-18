# Handoff · P15 Planos e serviços assistidos

Sessão: `claude-int-p15` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-18
Branch: `claude/p15-servicos-assistidos` → PR para `main`. Decisões em `docs/adr/0014-planos-e-servicos-assistidos.md`.

## Resultado

- **Banco** (`20261018190000_p15_service_ops.sql`): operadores (só backend), catálogo versionado, assinaturas com versão fixada, pedidos, histórico, minutos, entregas e revisões (append-only), concessões de acesso (só revogação muda). RLS: catálogo legível por quem está logado; o resto, só o dono. Operadores leem por RPC.
- **Edge Function `service-ops`**: 16 operações (dono e operação). O handler genérico ganhou rota sem negócio (`tenant: false`) para a fila.
- **Contratos** (`_shared/contracts/service-ops.ts`).
- **Telas**: `/app/servicos-tinindo` (plano, franquia e uso do assistente, troca de plano, serviços com escopo, pedido com aceite do escopo, revisão da entrega, concessão e revogação de acesso, histórico e registro de acesso) e `/app/servicos-tinindo/operacao` (fila, assumir, começar, ver dados concedidos, minutos, entrega). A demonstração offline usa as mesmas regras e é rotulada.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Escopo versionado | pgTAP: assinar/pedir exige o hash visto (409), versão antiga não aceita adesão, versões append-only |
| Entitlement preserva compromisso histórico | pgTAP: nova versão do plano (R$99, 300/mês) não muda o preço (R$79) nem a franquia (200) de quem já assinou; nova adesão recebe 300 |
| Quota | pgTAP: franquia do plano aplicada em `agent_quotas`; minutos acima da franquia → 429, repetição não soma; concorrência: 10 × 20 min com teto 120 → 120 exatos, 4 recusados |
| Tempo humano | pgTAP: humano, automação e retrabalho somados à parte; só o responsável registra |
| Acesso delegado auditado | pgTAP: sem concessão não começa nem lê; outro operador não usa a concessão; escopo fora da lista e prazo > 30 dias recusados; concessão não amplia escopo; leitura gera `access.read` e aparece no registro do dono; revogar, trocar o responsável e aprovar a entrega encerram o acesso |
| Entre tenants | pgTAP: dono B → 403/404 e RLS 0 linhas; cliente com login → 403; dono não acessa a fila |
| Replay e recuperação | chaves repetidas devolvem a mesma resposta; troca de plano simultânea (5 rodadas) sem deadlock e com uma assinatura ativa |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npx vitest run` | 606/606 |
| `npm run build` | ok |
| `npx playwright test` | 107 passaram, 31 fixme (novo: `tests/e2e/service-ops`, desktop + mobile) |
| `deno check --frozen` | ok |
| `npm run db:test:local` | tudo ok (P15: 65 asserções) |
| `npm run db:test:concurrency` | todos ok (P15 incluído) |

Mutação conferida: voltar o lock do tenant para `FOR UPDATE` derruba o teste de concorrência (deadlock).

## Decisões tomadas sem consulta (pedido do dono: "decida pelos docs")

- O P15 não estava no manifesto (mesmo caso do P11); o quadro não foi alterado.
- Catálogo: só os planos públicos (Grátis, Completo R$79). Serviço assistido real não publicado; o seed de local/CI tem um serviço sintético. A hipótese de R$690 do doc15 não foi adotada ("sem adotá-la automaticamente").
- Franquia do assistente: 200/mês nos dois planos (padrão atual), até haver decisão.
- O pedido nasce com o escopo aceito (sem estado "solicitado" separado).
- Escopos de acesso: catálogo, agenda (sem nomes) e nomes de clientes (sem contato). Financeiro fica fora.

## Limitações e próximos passos

- Cobrança da Tinindo manual; gateway e conciliação no P14.
- Sem cofre de credenciais externas (Google, domínio): fora deste pacote (P17).
- Operadores são cadastrados direto no banco por quem tem `service_role`; não há tela de administração.
- Staging: rodar a jornada no projeto hospedado depois do gate de ambiente.
- Rollback: migration aditiva; o único efeito em módulo existente é atualizar `agent_quotas.monthly_limit` ao trocar de plano.
