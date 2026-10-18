# Handoff · P08 Assistente e aprovação

Sessão: `claude-int-p08` (integrador contínuo, para @fffalleiros) · 2026-10-18
Branch: `claude/p08-assistente` → PR para `main`. Decisões em `docs/adr/0012-assistente-propostas-e-aprovacao.md`.

## Resultado

- **Banco** (`20261018170000_p08_agent.sql`): franquia mensal e débito idempotente (`agent_run_start`), leituras das ferramentas (`agent_agenda_read`, `agent_directory`, `agent_finance_read`), propostas com hash/versão/prazo, aprovações únicas (append-only), execução com recibo pelas funções do P03/P05.
- **Motor** (`supabase/functions/_shared/domain/agent`): determinístico, pt-BR, sem LLM. Consulta agenda, horários livres, ocupação, próximo cliente, caixa registrado, a receber, retirada (cenário), margem, pacotes, clientes por origem, lista de espera e política de cancelamento. Propõe agendamento, remarcação, cancelamento e regra de preço.
- **Edge Function** `agent`: `agent.ask` (portão → motor → proposta), `action.approve`, `action.execute`.
- **Tela** `/app/assistente`: conversa com os cinco estados, fontes e horário dos dados, cartão de proposta (resumo, validade, código de conferência), "Aprovar" e depois "Executar agora". Na demonstração, o mesmo motor roda sobre dados de exemplo, com aviso.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Responde de ferramentas, não inventa valores | evals AE-01…08, 15…18 (valores, período, cobertura, "nenhum registro" ≠ zero) |
| Prompt injection negado | AE-21…27 (nome/documento/recado como dado, SQL, segredos, papel) |
| Troca de tenant | AE-28…32 + pgTAP (403 antes de ferramenta, leituras com vínculo) |
| Cotas | AE-33…36 + pgTAP + concorrência (12 perguntas com franquia 5 → 5 debitadas) |
| Aprovação desatualizada não executa | pgTAP AE-37/38/40 (STALE_VERSION, mesmo recibo, SLOT_CONFLICT → invalidada) + concorrência AE-39 |
| Falha do LLM preserva o app | sem LLM no piloto; banco fora → 503 explícito (teste da função) |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npx vitest run` | 522/522 (inclui 40 casos de avaliação e testes da função `agent`) |
| `npm run build` | ok |
| `npx playwright test` | 99 passaram, 31 fixme (UAT barbeiro 10b saiu do fixme) |
| `deno check --frozen` | ok (11 funções) |
| `npm run db:test:local` | tudo ok (P08: 70 asserções) |
| `npm run db:test:concurrency` | P01, P03, P05, P06, P07, P08 ok |
| `node tests/agent-evals/validate.ts` | ok: 40 casos |

Mutações conferidas: tirar o `for update` da proposta em `action_approve` derruba o teste de corrida, e contar a reserva provisória como ocupada ou desligar a recusa de SQL derruba AE-02/08/20/22.

## Decisões pendentes (dono do projeto)

- **LLM**: provedor, chave, orçamento e termos de dados. Sem isso, o assistente segue determinístico (escopo fechado de frases). Os pontos de integração estão no ADR-0012 §1.
- Franquia padrão de 200 perguntas/mês por negócio: ajustar em `agent_quotas.monthly_limit`.

## Limitações

- Entende um conjunto fixo de pedidos. Fora disso, diz o que sabe fazer.
- Desconto para um cliente específico não existe (só regra por dia e horário).
- Não há leitura de propostas pendentes depois de recarregar a página: a proposta vence em 30 min e uma nova pode ser pedida.

## Próximo passo

Fim da sequência P03 → P07 → P05 → P06 → P08. Próximo: gates de ambiente (projeto Supabase hospedado, SMTP, segredos e cron do `jobs`) e a decisão sobre o LLM.
