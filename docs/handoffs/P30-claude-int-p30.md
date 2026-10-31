# Handoff · P30 Materiais e custos

Sessão: `claude-int-p30` (Claude Code na nuvem, para @fffalleiros) · 2026-10-27
Branch: `claude/pensive-allen-kdu6np` (reiniciada a partir da `main` depois do merge do P28) → PR para `main`. Decisões em `docs/adr/0032-materiais-e-custos.md`.

## Resultado

- **Banco** (`20261027223200_p30_materials.sql`, aditiva): `material_items` (saldo e valor só pelo razão), `material_service_usage` (ficha), `material_purchases`, `material_consumptions` (um ativo por atendimento), `material_movements` (razão append-only, estorno único). São 12 RPCs do dono. A migration não substitui nenhuma função existente; ela escreve em `expense_entries` (P07) e lê `bookings` (P03) e `sales_quotes` (P11).
- **Edge Function `materials`** (12 rotas) sobre o `rpc-handler`.
- **Contratos** aditivos em `_shared/contracts/materials.ts`, no registro v1 (`ModuleId` `materials`), em docs/03, em docs/10 (MAT-01) e no release/CHECKLIST (26 funções).
- **Tela** `/app/materiais` (Negócio → Materiais), com seis blocos:
  - margem real dos últimos 30 dias, com cobertura;
  - atendimentos concluídos, com registro do uso pela ficha e estorno;
  - estoque, com item novo, edição e contagem;
  - fichas de uso;
  - compras, com estorno;
  - nova compra com várias linhas e despesa no Caixa.
  
  A demonstração usa as mesmas regras e é rotulada. Ícone `material` novo, no padrão da ADR-0024.

## Aceite do pacote (tasks/P30.md)

| Critério | Evidência |
|---|---|
| Consumo e estorno não duplicam estoque | **pgTAP 27:** o segundo consumo é recusado (`consumed`), a repetição devolve a mesma resposta, o estorno acontece uma vez e devolve o valor exato. **Concorrência `26_materials`:** 5 consumos simultâneos do mesmo atendimento resultam em 1; 5 estornos simultâneos resultam em 1; 10 consumos com estoque para 6 resultam em 6 e o estoque nunca fica negativo; com compras e consumos misturados, saldo e valor batem com o razão. **Integração** `43_p30_materiais` passo 1 e **e2e** `materials` |
| Compras | **pgTAP/integração:** total calculado no servidor, custo médio recalculado e despesa `supplies` no Caixa. O estorno da compra é recusado quando parte já foi usada; depois do estorno do uso, sai pelo custo médio e estorna a despesa uma vez |
| Uso por serviço | **pgTAP/integração/e2e:** a ficha por serviço é a fonte do consumo padrão. Consumo manual aceita casas decimais. Serviço sem ficha é recusado. Falta de estoque recusa tudo, sem consumo parcial |
| Margem real | **pgTAP/integração/e2e:** a margem é calculada só sobre atendimentos com consumo; os demais aparecem como não cobertos |
| Conta não depende de texto livre | Contrato e SQL: só fichas, quantidades e razão. O motivo do ajuste fica fora da auditoria e da leitura direta. O custo do orçamento (P11) vem da ficha e do custo médio, com cobertura por linha |
| Isolamento | **pgTAP/integração:** dono B recebe 403 e RLS com 0 linhas; o cliente com login recebe 403/0. Item ou atendimento de A usado no negócio B dá 404. Anon não executa nada |

## Comandos e resultados (local, Postgres 16 + pgTAP)

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npm test` | unit 452 · contratos 593 (novo `tests/contracts/materials`) |
| `npm run db:test:local` | tudo ok (P30: 62 asserções) |
| `npm run db:test:concurrency` | tudo ok (novo `26_materials`, 14 verificações) |
| `npm run test:integration` | 20 arquivos, 118 testes (novo `43_p30_materiais`) |
| `deno check --frozen` (26 funções) | ok |
| `npx playwright test` | 184 passaram, 32 fixme preexistentes (novo `tests/e2e/materials`, desktop + Pixel 7) |
| Mutação: sem o `FOR UPDATE` dos itens e sem o índice de consumo ativo | o teste de concorrência falha (5 consumos do mesmo atendimento, atualizações de saldo perdidas) |

Não executado aqui: `supabase test db` e `supabase db lint` no PG 17, porque não há Docker. Os dois rodam no CI.

## Decisões tomadas sem consulta (pedido do dono: "decida pelos docs")

- Custo médio ponderado, em centavos inteiros, com a última unidade levando o valor restante.
- Unidades `un`, `ml` e `g`, com até 3 casas. A unidade fica fixa depois do primeiro movimento.
- Estoque negativo é proibido: falta de estoque recusa o comando inteiro.
- Só atendimentos concluídos do P03 consomem. Reservas da equipe (P28) e venda de produto ao cliente ficam para depois.
- A despesa no Caixa vem ligada por padrão na compra (pode desligar). O consumo não gera despesa.
- A margem é "sobre materiais", não DRE: taxas, comissão e rateio são do P31.
- O custo do orçamento é só leitura. Desde 31/10 a tela de Orçamentos (P11) mostra, em "Ver versões", o custo estimado de materiais e a margem da versão atual, dizendo quais itens estão sem ficha.

## Quadro (coord.py)

O P30 não estava no quadro. A liberação foi recusada pelo controle de permissões desta sessão (ver handoff do P28). O integrador registra P28 e P30 com PR e SHA de merge, como no `reconcile` de P10–P24.

Registrado no quadro em 31/10 pelo integrador (ação `reconcile`, autorização do dono): P28 `done` com PR #60 e merge `27316a7`; P30 `done` com PR #61 e merge `7e032ff`.

## Mocks e pendências

- A demonstração offline usa dados de exemplo: shampoo, pomada, toalha, uma compra, um corte e uma barba de ontem. Ela é rotulada como exemplo.
- Nenhuma migration foi aplicada em banco compartilhado. A homologação (piloto de 28/10) não foi tocada.
- Próximos passos possíveis:
  - consumo nas reservas da equipe (P28);
  - venda de produto baixando o estoque;
  - alerta de estoque mínimo no lembrete do dono.

## Recuperação

A migration é aditiva. Para desligar a tela, basta tirar a linha do módulo em `src/app/modules.ts`/`navigation.ts`. As despesas lançadas pelas compras ficam no Caixa (P07) com o estorno vinculado, como qualquer despesa.
