# Handoff · Planos e cobrança da Tinindo (D3 a)

Sessão: Claude Code na nuvem, para @fffalleiros · 2026-11-21
Branch: `claude/public-client-journey-a4g596`; um PR por bloco para a `main`.

Pedido: o que cada plano libera, de verdade (D3 a), no lugar da D3 b do piloto. Base:
- `docs/00_PRODUTO.md` (Monetização);
- `docs/11_CUSTOS_E_LIMITES.md` (guardrails);
- `docs/legal/PENDENCIAS.md` (seção G);
- os handoffs do P15 e do P51 (pendência "plano por capacidade");
- `docs/qa/revisao-2026-11-10/01-escopo-produto.md` (achado 09).

## Bloco 1 · Capacidades legíveis por máquina em cada versão de plano

**Fonte única dos valores:** `supabase/functions/service-ops/planos.json`. Cada plano tem:

- **`capabilities`**:
  - módulos por ativação liberados;
  - clientes ativos (não arquivados);
  - agendamentos criados no mês;
  - perguntas ao assistente no mês;
  - lembretes no mês.
- **`terms`**:
  - dias de teste e dias de carência;
  - meses de preço travado;
  - janela de adesão (início e fim).
- **`a_confirmar_pelo_felipe`**: os campos que ainda dependem do Felipe. Hoje são todos os números e todas as datas.

**Migration `20261121132339_p15_planos_capacidades.sql`:**

- `offering_versions` ganha `capabilities` e `terms`.
  - As duas colunas vêm juntas e são validadas por check: exatamente as cinco capacidades, só módulos por ativação, sem repetição, inteiros de 0 a 1.000.000 e janela de adesão em ordem.
  - A coluna antiga `agent_questions_month` acompanha a capacidade.
- `app.svc_publish_plan(jsonb)` publica uma entrada de `planos.json`.
  - Só o backend chama.
  - É idempotente: o mesmo conteúdo devolve a mesma versão.
  - A lista de pendências não entra no hash nem no compromisso.
- Publica a **versão 3** do Grátis e do Completo (fundador), com cópia literal do JSON.
- `app.svc_version_json` passa a devolver `capabilities` e `terms`: `plan.current`, catálogo, pedidos.
- As versões 1 e 2 ficam como estavam, sem capacidades. Quem assinou uma delas continua nela (compromisso histórico).

**Contrato** (`_shared/contracts/service-ops.ts`):
- `PlanCapabilities`, `PlanTerms`, `PlanModule`, `PlanConfig` e `PLAN_LIMITS`;
- `OfferingVersion.capabilities` e `.terms`, nulos por padrão: servidor antigo continua válido.

**Demonstração:** `src/features/service-ops/demoPort.ts` monta os planos a partir de `planos.json`, sem cópia dos números.

**Valores iniciais.** São todos a confirmar pelo Felipe; para trocar, ver "Decisões que continuam abertas", no fim.

| | Grátis | Completo (fundador) |
|---|---|---|
| Preço | R$ 0 | R$ 79/mês |
| Recursos opcionais | Assinaturas, Orçamentos, Indicações, Plano e serviços | os 6 |
| Clientes ativos | 150 | 2.000 |
| Agendamentos/mês | 120 | 1.500 |
| Perguntas ao assistente/mês | 30 | 200 |
| Lembretes/mês | 120 | 1.500 |
| Teste | — | 14 dias |
| Carência no atraso | — | 7 dias |
| Preço travado | — | 12 meses a partir da adesão |
| Janela de adesão | — | aberta desde a publicação até 30/06/2027 |

### Decisões tomadas aqui (bloco 1)

- **Módulos do piloto não entram no plano: valem em todos.** O plano decide só os 6 "por ativação". Os 11 guardados continuam com o operador (P51). Esconder Agenda, Clientes ou o Assistente do Grátis mudaria o piloto inteiro. A diferença no assistente está na franquia.
- **"Plano e serviços" entra no Grátis.** É onde o dono vê o plano e os serviços assistidos.
- **Sem "ilimitado".** O doc 11 proíbe. O Completo tem números, só que maiores, e o teste de contrato barra as palavras "ilimitado", "garantido" e "sem limite" nos textos dos planos.
- **Condição de fundador é o próprio plano `founder`.** É a versão com preço travado por 12 meses e a janela de adesão. Não foi criado um "Completo" de preço cheio: o preço depois dos 12 meses é a pendência G2.

### Mudança fora da área (forçada pela D3 a)

Dois testes de outra área codificavam a D3 b ("no piloto as funções são as mesmas"):
- `supabase/tests/database/39_module_scope.test.sql`: as quatro checagens passaram a ler a versão 2, que continua publicada;
- `tests/e2e/foundation/escopo.spec.ts`: o teste do texto do plano agora confere o que o Completo libera a mais.

### Testes (bloco 1)

| Comando | Resultado |
|---|---|
| `npm run lint` / `typecheck` | ok |
| `npm run test:unit` | 1471 |
| `npm run test:contracts` | 859 ok, 38 pulados. Novo: `planos-config.test.ts` (JSON ↔ migration, só módulos por ativação, toda capacidade marcada como pendente, Completo ≥ Grátis, sem "ilimitado") |
| `npm run db:test:local` | todos. Novo: `51_planos_capacidades.test.sql` (30) |
| `npm run test:integration` | 174 |
| `npm run db:test:concurrency` | todos |
| dicionário (`--check`) e `check-migrations.mjs` | ok |
| e2e completo (desktop e Pixel 7) | 346 ok |

## Decisões que continuam abertas (Felipe e advogado)

| # | Decisão | Quem | Onde trocar |
|---|---|---|---|
| 1 | Limites do Grátis e do Completo (G4) | Felipe | `supabase/functions/service-ops/planos.json` → `planos[].capabilities`; publicar numa migration nova com `app.svc_publish_plan` (o teste de contrato mostra o que falta) |
| 2 | Quais recursos opcionais cada plano libera | Felipe | `planos.json` → `capabilities.modules` |
| 3 | Preço do Completo de fundador (R$ 79) | Felipe | `planos.json` → `price_cents` do `founder` |
| 4 | Marco inicial dos 12 meses (G1): adesão ou primeira cobrança | Felipe | `planos.json` → `terms.price_lock_months` (o marco hoje é a adesão; ver o bloco 3) |
| 5 | O que acontece depois dos 12 meses (G2) | Felipe + advogado | Plano novo em `planos.json`; a regra de troca fica no bloco 3 |
| 6 | Janela ou limite de vagas de fundador (G3) | Felipe | `planos.json` → `terms.available_from` / `available_until` |
| 7 | Dias de teste | Felipe | `planos.json` → `terms.trial_days` |
| 8 | Carência no atraso (G6) | Felipe | `planos.json` → `terms.grace_days` |
| 9 | Cancelamento, reembolso e arrependimento (G5, CDC art. 49) | Felipe + advogado | bloco 3 |
| 10 | Aviso prévio de mudança nos Termos (G7) | Felipe + advogado | `docs/legal/` (fora deste pacote) |
