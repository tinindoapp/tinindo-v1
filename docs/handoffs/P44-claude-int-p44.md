# Handoff · P44 Configuração guiada ("Deixe seu negócio pronto")

Sessão: `claude-int-p44` (Claude Code na nuvem, para @fffalleiros) · 2026-11-03
Branch: `claude/p44-onboarding-setup-8bdcm1` → PR para `main`. Decisões em `docs/adr/0035-configuracao-guiada.md`.

## Resultado

- **Banco** (`20261103134122_p44_setup.sql`, aditiva):
  - `setup_service_templates`: modelos por profissão (barbearia 3, cabeleireira 4, personal 3, outra 1), com duração, intervalos e faixa de preço; append-only, só por migration.
  - `setup_dismissals`: passos opcionais dispensados ("agora não"); a `check` recusa obrigatório.
  - `setup_step_completions` (backend-only): primeira conclusão de cada passo, com a data real do dado e os segundos desde o cadastro.
  - `app.setup_steps()` (catálogo dos 8 passos), `app.setup_state()` (estado calculado pelas tabelas do P01, P02, P03, P07, P09 e P12), `app.setup_ready_at()`, `app.setup_record_completions()` (evento uma vez por passo, sob lock por negócio).
  - RPCs do dono: `setup_progress`, `setup_dismiss`, `setup_templates`, `setup_services_apply`, `setup_draft_apply`. Serviços e expediente passam pelas RPCs do P02 (`crm_service_save`) e do P03 (`scheduling_rules_save`), tudo ou nada, idempotentes.
  - P18: `analytics_cost_to_serve` ganha `setup_ready_24h` (negócios criados no período, prontos e prontos em 24 h), pela data real dos dados.
- **Evento** `setup.step_completed.v1` (passo, obrigatório, data real, segundos desde o cadastro, pronto).
- **Edge Function `setup`** com 5 rotas sobre o `rpc-handler`.
- **Contratos** aditivos em `_shared/contracts/setup.ts` (`SetupProgress`, `SetupStep`, modelos, rascunhos e `SetupDescribeDraft`), módulo `setup`, operações `setup.*`; `CostToServeOutput.setup_ready_24h`. Também docs/01 (evento), docs/03 (operações), docs/10 (SETUP-01) e release/CHECKLIST (29 funções).
- **Analisador por regras** `_shared/domain/setup/describe.ts`: profissão, quantas pessoas, dias (intervalos, dias soltos, "dias úteis", "todo dia", "fim de semana"), horário (com "da manhã/tarde/noite" e fim menor que o início), pausa e serviços de um vocabulário fixo; o que não entendeu volta em `unknown`.
- **Telas** (`src/features/setup/`):
  - **Cartão da Home** "Deixe seu negócio pronto · N de 8" (`SetupCard`, ligado em `src/app/pages/Home.tsx` e exportado pelo módulo): barra de progresso, próximo passo com por quê e o botão para a tela que resolve, "Agora não" só nos opcionais (com Desfazer), "Ver os 8 passos" e o atalho "descreva seu negócio em uma frase" enquanto faltam horários ou serviços. Some quando os 8 estão feitos ou dispensados; falha de leitura não derruba a Home.
  - **`/app/configurar`** (Negócio → Configuração): os 8 passos com por quê, link e dispensa; "Descreva seu negócio em uma frase" → rascunho revisável campo a campo (profissão, dias, início/fim, pausa, serviços com duração e preço) → confirmação que resume o que vai ser gravado → `setup.draft_apply`; modelos de serviço como `ChoiceCard` marcável (já no catálogo fica desabilitado, marcar pede o preço com a faixa como sugestão) → confirmação → `setup.services_apply`.
  - **Estados vazios com dica e botão** (`SetupHint`, em `src/components/ui`): Agenda (dia sem expediente → Horários), Serviços (→ modelos), Clientes, Caixa (→ Agenda) e Mensagens (→ passos).
  - A demonstração emula as mesmas regras e é rotulada; o perfil só fica "feito" quando publicado na aba.
- **`ConfirmAction`** ganhou `beforeOpen` (validação do formulário de origem antes de abrir a confirmação), aditivo.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Estado calculado pelos dados, cada passo com done, why e link | pgTAP 31: negócio novo 0 de 8 com por quê e link em todos; `done_at` = data real da regra, não da leitura; int `46_p44_configuracao` passo 0–3 |
| Cartão na Home com o próximo passo em destaque; opcionais dispensáveis; some quando tudo feito | unit `SetupCard.test`, e2e `setup` (celular 375 px e desktop): 5 de 8 → publicar perfil → 6 de 8 e "já recebe reservas" → dois "Agora não" → cartão some |
| Modelos por profissão só por migration, sugestão marcável, nada criado sem confirmação | pgTAP 31 (append-only, sem escrita pela Data API, 11 semeados, pacote não vira serviço); contrato `setup-contracts`; unit `SetupPage.test` (confirmação lista nome e preço; a porta só é chamada depois de confirmar); e2e |
| "Descreva seu negócio em uma frase" por regras, rascunho revisado campo a campo | unit `describe.test` (6 casos, inclusive o do docs/12 e o que não entende); unit e e2e do rascunho (campos preenchidos, erro embaixo do campo, confirmação resume expediente e serviços) |
| Nenhum serviço, horário ou preço gravado sem confirmação; tudo ou nada | pgTAP 31: lote com nome repetido não cria nada, rascunho com expediente inválido não muda profissão nem cria serviço; conc `29_setup`: 10 lotes com o mesmo nome → um entra, os outros falham inteiros; int 46 |
| Evento `setup.step_completed.v1` uma vez por passo | pgTAP 31 (duas leituras → um evento; ordem hours, service, cancellation_policy, profile; `ready` no último); conc `29_setup` (8 leituras simultâneas → um evento por passo) |
| Indicador "negócios prontos em 24 h" no P18 | pgTAP 31 e int 46 (`setup_ready_24h`; dono comum recebe 403); `CostPage` mostra |
| Negócio novo chega ao link público em < 10 min pela Home, no celular | e2e `setup` (celular): Home → cartão → Perfil → publicar → `/p/<slug>` aberto; int 46: negócio criado pelo `identity` → horários → serviços → política → perfil → `public.profile` 200 e `public.slots` com vagas, `ready_in_24h = true` |
| Isolamento | pgTAP 31 e int 46: dono B 403 em leitura, dispensa e criação; cliente 403; anon 401; RLS 0 linhas |

## Comandos e resultados (local, Postgres 16 + pgTAP 1.3.5)

| Comando | Resultado |
|---|---|
| `npm run lint` · `npx tsc -b --noEmit` · `npm run build` | ok |
| `npx vitest run` (unit + contratos) | 141 arquivos, 1382 testes (P44: handler 5, analisador 6, demo 5, cartão 4, tela 4, contratos 15) |
| `npm run db:test:local` | 32 arquivos pgTAP ok (novo: `31_setup`, 71 asserções) |
| `npm run db:test:concurrency` | 29 scripts ok (novo: `29_setup`, 12 checagens) |
| `npm run test:integration` | 23 arquivos, 137 testes (novo: `46_p44_configuracao`, 8) |
| `deno check --frozen` (2.9.6) | 29 funções ok |
| `npx playwright test` | 271 passaram, 33 fixme que já existiam (novo: `tests/e2e/setup`, 3 cenários × desktop e celular, Pixel 7 e 375 px) |

Não executado aqui: `supabase test db` e `db lint` no PG 17 (sem Docker); rodam no CI. Nada aplicado na homologação.

## Decisões tomadas sem consulta

- **Oito passos fixos, quatro obrigatórios** (horários, serviço com preço, antecedência de cancelamento, perfil publicado). A política entrou como obrigatória porque o link público a mostra antes da reserva; é a decisão mais discutível (docs/12 diz "progressivamente"). Trocar é editar `app.setup_steps()` e `labels.ts`.
- **Faixas de preço dos modelos** são ponto de partida do piloto (ex.: corte de barbearia R$ 35 a 70). Revisar com o dono do produto; entram só por migration.
- **"Pacote de 10 sessões"** aparece como informação (vende-se no Caixa), não como serviço.
- **O rascunho pode mudar a profissão do negócio** (`tenants.profession`), porque a frase a declara; auditado.
- **Leitura que grava**: `setup.progress` registra a primeira conclusão de cada passo e emite o evento. A rota continua consulta (sem chave); a RPC não é `stable`.
- **Quadro (coord.py)**: o P44 não estava no quadro remoto. O commit que o libera na fase `expansao-1` está pronto no worktree local (`coordination`), mas o push para o branch `coordination` foi recusado pela política desta sessão (recurso compartilhado). Por isso **a reserva, o `review` e o `finish` não foram gravados**; o manifesto `coordination/manifest-expansao-1.json` e `tasks/P44.md` vão neste PR. Ver "Pendências".
- **Branch**: a plataforma fixou `claude/p44-onboarding-setup-8bdcm1`; o `coord.py` esperaria `task/p44/claude-int-p44`. Ao registrar no quadro, ajustar o campo `branch`.
- **pgTAP local** veio do fonte (`theory/pgtap` 1.3.5, SQL gerado por substituição de texto), porque o pacote `postgresql-16-pgtap` não está no apt desta imagem.
- A lista "Primeiros passos" da Conta (E9) foi mantida; recomenda-se consolidar no cartão numa passada de UX.

## Pendências e próximos passos

1. **Quadro remoto**: liberar o P44 na fase e registrar `claim`/`review`/`finish` com a sessão `claude-int-p44` (ou registrar o PR como reconciliação, como foi feito para P11–P24). Comando pronto: `python3 scripts/coord.py --repo tinindoapp/tinindo-v1 claim P44 --session claude-int-p44`, depois `review --pr <n>` e `finish --pr <n>`.
2. Homologação: `supabase db push` e `functions deploy setup` (checklist, 29 funções). Rodar `tests/e2e-staging` depois.
3. P45: o passo "perfil incompleto" lê `setup.progress`. P46: "Me ajuda a configurar" conduz pelos mesmos passos e devolve `SetupDescribeDraft` a partir de frases livres.
4. Revisar as faixas de preço dos modelos com o dono do produto (migration nova; nunca editar a atual).

## Recuperação

Migration aditiva. Para esconder o cartão e a tela: tirar `setupModule` de `src/app/modules.ts`, a linha em `navigation.ts` e a chamada `SetupCard` na Home. Os modelos e as medições ficam no banco sem efeito. Serviços e expediente criados pela Configuração são linhas comuns do P02/P03: arquivar o serviço ou editar os horários nas telas de sempre.
