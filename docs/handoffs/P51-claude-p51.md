# Handoff · P51 Escopo visível do piloto

Sessão: `claude-p51` (Felipe) · 2026-11-20
Branch: `claude/kind-allen-m9zju9` → PR para `main` (merge autorizado pelo Felipe com o CI verde).
Reserva: o P51 não está no quadro do `coord.py` (o replanejamento de 10/11 diz que a numeração vale quando o integrador publicar; P48 e P49 também entraram sem reserva). Nenhuma reserva foi criada.
Decisões aplicadas: D1 (a), D3 (b), D4 (sim). Registradas em `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md`, seção 6 ("Decididas em 20/11"), junto com D8 (a), que vai no PR seguinte.

**Nada foi aplicado na homologação nem em produção** (recado #109 é do Gabriel). A migration nova entra na homologação quando o Gabriel rodar `release/homolog-setup.sh`.

## Entregue

### Servidor
- `supabase/migrations/20261120021000_p51_module_scope.sql` (append-only, depois de todas as da `main`):
  - `app.module_catalog()`: os 27 módulos com nível `pilot` (10), `activation` (6) ou `stored` (11), na tabela do relatório 01, seção 3.
  - `public.tenant_modules` (negócio, módulo, ligado): RLS ligada, leitura só para membros, nenhuma escrita pela Data API. Sem linha = desligado. Check impede chave para módulo do piloto ou inexistente.
  - `public.setup_scope(tenant)`: profissão, plano (código e nome) e os 27 módulos com nível e estado. Membros.
  - `public.setup_module_set(tenant, módulo, ligado, key, hash, request)`: só o dono, idempotente pela chave, auditado (`module.enable`/`module.disable` com antes e depois), lock por (negócio, módulo). Repetir o estado atual não grava nem audita. Piloto ou inexistente → 400 (`module`); guardado → 403.
  - `app.module_admin_set(...)`: backend-only (service role), liga e desliga também os guardados, auditado. É por onde um módulo guardado volta para um negócio quando o portão dele for cumprido.
  - **D4**: `app.cp_tick` (fechamento de campanhas, a única rotina periódica de módulo guardado em `jobs_run`) só pega campanhas de negócios com Campanhas ligado. As demais rotinas são de módulos do piloto ou por ativação e seguem como estão.
  - **D3 (b)**: nova versão dos planos Grátis e Completo (as versões publicadas são imutáveis). O texto diz que no piloto as funções e a franquia do assistente (200) são as mesmas; saiu "Ofertas de vaga e recuperação de agenda" do Completo. Preço, franquia e cobrança não mudam. Quem já tinha assinatura vê o aviso de versão mais nova (`plan_is_latest`), como já acontecia.
- Contrato `supabase/functions/_shared/contracts/scope.ts`: `ModuleCode`, `ModuleLevel`, `MODULE_LEVELS`, `BusinessScope`; operações `setup.scope` (consulta) e `setup.module_set` (comando, idempotente) no registro, na função `setup` e em `docs/03_CONTRATOS.md`.

### Front
- `ModuleDefinition.level` em cada `module.tsx` (igual ao contrato; teste compara).
- `src/app/scope.tsx`: `ScopeProvider` dentro do shell lê `setup.scope` na sessão. Enquanto carrega ou se falhar, só o piloto aparece (nunca um link a mais). Expõe profissão, plano, `isVisible`, `canOpen(path)`, `setModule`.
- Menu, sub-abas e barra: `buildNavigation(visibleModules(...))`. Grupo sem item visível some; grupo de um item fica sem título; Dinheiro fica sem faixa de sub-abas no piloto.
- `src/app/ModuleGate.tsx`: toda rota de módulo passa pela porta. Guardado → "Não disponível no piloto" com "Voltar para Hoje"; por ativação desligado → "X está desligado" com "Abrir Mais recursos" (só para o dono); falha ao ler o escopo → "Tentar de novo".
- Links fora do menu: a configuração guiada (cartão da Hoje, tela Configuração e "Me ajuda a configurar" do Assistente) tira o passo cuja tela não aparece ("Conectar e verificar seu número", enquanto Mensagens está guardado) e refaz a conta (7 passos no piloto); as sugestões (Hoje e Metas) escondem as que levam a tela escondida; a Hoje só mostra a sugestão com "Metas e sugestões" ligado; o selo de não lidas não lê nada sem Mensagens; "Texto de campanha" sai da redação do Assistente sem Campanhas. Não há busca global no app; a busca de Clientes só lista clientes.
- Conta › **Mais recursos** (`/app/conta/recursos`): os 6 por ativação, uma frase do que cada um faz, estado escrito, Ligar/Desligar (chave de `src/lib/idempotency.ts`) e Abrir. Para personal, Assinaturas vem primeiro. A equipe vê o estado; só o dono liga. Link na Conta.
- Demonstração offline: `src/app/scope-demo.ts` com as mesmas regras (piloto sempre, só por ativação liga, guardado 403), guardado na aba. `localStorage["tinindo.demo.modulos"]="todos"` liga os 27 (usado pelos e2e dos outros módulos).

### Testes e CI (D4)
- `playwright.config.ts`: projetos `desktop`/`mobile` (núcleo, como o participante vê), `*-recursos` (pastas dos 6 por ativação, com os módulos ligados) e `*-guardados` (pastas dos 11 guardados). Com `E2E_PILOTO=1` os guardados ficam de fora.
- `.github/workflows/ci-app.yml`: o job e2e passa `E2E_PILOTO=1` no PR; no push da `main` roda tudo.

## Testes, comandos e resultados

Rodados nesta máquina, depois do merge da `main` com o P52 (`b752d60`):

| Comando | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` | ok |
| `npm run test:unit` | 891 passaram (123 arquivos) |
| `npm run test:contracts` | 841 passaram, 2 falhas esperadas (do P52), 38 pulados |
| `npm run build` · `npm run test:coord` | ok |
| `deno check --frozen ... supabase/functions/*/index.ts` (Deno 2.9.6 via npm) | ok |
| `npm run db:test:local` (Postgres 16 + pgTAP, sem Docker) | todos passaram; `36_module_scope` com 53 asserções, `18_campaigns` com 50 |
| `npm run db:test:concurrency` | todos passaram |
| `npm run test:integration` | 142 passaram (24 arquivos) |
| `npm run db:restore:drill` | ok |
| `npx playwright test` (todos os projetos, como na `main`) | 293 passaram, 0 falharam, 33 pulados (`fixme` que já existiam) |
| `E2E_PILOTO=1 npx playwright test --list` (como no PR) | 286 testes; os 40 dos módulos guardados ficam de fora |

O `supabase test db` e o `supabase db lint` do CI precisam de Docker, que esta máquina não tem; ficam com o job `database` do CI.
O navegador fixado (Playwright 1.56.1) não está nesta máquina; os e2e rodaram com o Chromium pré-instalado, apontado por `PLAYWRIGHT_BROWSERS_PATH`.

Testes ajustados ao recorte (cada um com comentário): `padroes` (14 telas no menu do piloto), `navegacao` (Clientes sem Orçamentos e Avaliações; Assistente sem Mensagens), `smoke` (menu abre Preços no lugar de Campanhas), `avisos` (sem as telas guardadas, com as por ativação ligadas), `totais` (a comparação com Pagamentos virou teste à parte, só na `main`), `configuracao` (7 passos), e os testes de campanhas na integração e na concorrência ligam o módulo pelo backend antes da rotina.

## Pendências e próximos passos

- Plano por capacidade (D3 a) antes de cobrar: capacidades legíveis por máquina em `offering_versions` e recusa no servidor (achado 09).
- A chave decide só o que aparece. As RPCs dos módulos guardados continuam autorizando por papel, não pela chave; recusar no servidor operação de módulo desligado é trabalho do P56 ou do plano por capacidade.
- Publicar na homologação só as funções dos módulos visíveis (relatório 01, achado 10) fica para o P58.
- `tests/e2e/foundation/padroes.spec.ts` e `a11y.spec.ts` percorrem as telas do piloto; as telas dos guardados continuam cobertas pelos e2e deles na `main`.
