# Qualidade de ponta a ponta · iPhone, desempenho, acessibilidade, textos e tela grande · handoff

Sessão Claude Code (conta do Felipe), 21/11/2026. Branch `claude/consolidate-lib-migrate-modules-jbw7y4`, um PR por bloco.
Base: `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md` §8, que lista as quinze áreas sem auditoria. Este pacote cobre cinco delas:

- desempenho do front;
- acessibilidade;
- escrita e microcopy;
- desktop e responsivo;
- o Safari do iPhone (lacuna UX-01).

Também valem `brand/BRAND.md`, `docs/qa/acessibilidade.md`, `docs/qa/IPHONE-SAFARI.md` e os handoffs do P54.

Área: `tests/e2e/`, `playwright.config.ts`, o job de e2e do CI, `src/components/ui/`, `src/styles/`, e os textos e o CSS das telas de scheduling, crm, finance, lifecycle, setup, network e `src/app/pages`. Nada foi aplicado na homologação.

## Bloco 1 · Safari do iPhone (PR 1/6)

### O que entrou

- **Projeto `iphone` no Playwright** (WebKit, perfil do iPhone 13) para o ciclo principal. Pastas: `foundation`, `setup`, `scheduling`, `crm`, `finance`, `lifecycle`, `network`, `qa` e `iphone`, num total de 142 testes. O núcleo do piloto aparece como o participante vê. Os módulos por ativação e guardados continuam só no Chromium.
- **CI** (job `e2e smoke (desktop + mobile)`, nome mantido por ser check obrigatório): instala `chromium webkit` com as dependências do sistema. O limite de tempo subiu de 20 para 30 minutos. Medido aqui: o projeto `iphone` leva cerca de 4 minutos com 2 workers.
- **`tests/e2e/iphone/ciclo-iphone.spec.ts`:** percorre configurar, cada passo do novo agendamento, horários, atender, "Recebi no Pix" com toque duplo, o "Registrar" do Caixa, retorno e a reserva pelo link até o código. Em cada tela confere:
  - campo com 16 px ou mais;
  - `touch-action: manipulation` em botões e links;
  - data e hora com 44 px;
  - nenhuma barra fixa por cima do campo focado;
  - sem rolagem de lado;
  - `one-time-code` e teclado numérico no código.

  Roda também no celular do Chromium.

### Defeitos achados no WebKit e corrigidos

| Achado | Causa | Correção |
|---|---|---|
| `/app/conta` rolava de lado em 320 px (339 px) | No Safari, o texto da opção comprida de um `select` ("Até 2 h antes (comum para barbearia)") vaza da caixa no layout, mesmo com `width: 100%` | `.tn-field select { contain: paint }` (`ui.css`) e coluna `minmax(0, 1fr)` no `.tn-field`. O anel de foco continua |
| Toque rápido em "+"/"−" e nas setas podia ampliar a tela | Faltava `touch-action: manipulation` | Regra no kit para `a, button, input, select, textarea, label, summary, [role=button], [role=tab]`; o zoom de pinça continua |
| Data e hora vazios encolhem no iOS e o valor fica centralizado | Padrão do WebKit | `min-height` de toque e texto à esquerda (`ui.css`) |

### Testes ajustados (sem tirar verificação)

- **`qa/helpers.ts` `openFromNav`:**
  - **Problema:** corrida que falhava com a máquina carregada no WebKit e no Chromium; o `uat-barbeiro 1a` já tinha falhado uma vez no Chromium. O menu abria e a tela anterior, ao terminar de carregar, fechava a folha antes do toque.
  - **Correção:** abrir e tocar agora vão juntos na nova tentativa. Depois do toque, o helper espera a folha fechar, sem exigir; quando a tela segura a saída ("Sair sem salvar?"), a folha fica aberta de propósito.
- **`foundation/escopo.spec.ts`:** `page.reload()` trocado por `page.goto(page.url())`.
  - **Motivo:** no WebKit do Playwright no Linux, recarregar uma página que veio por `history.pushState` e depois navegar derruba a aba. O defeito aparece até na tela Entrar. É do motor de teste, não do app.
  - **O que o teste continua provando:** a escolha sobrevive a uma carga completa.
- **`payments/pagamentos.spec.ts`:** a permissão de área de transferência e a leitura dela só no Chromium. O WebKit não tem essa permissão, e o Safari só libera a área de transferência dentro de um toque. O "Copiado ✓" continua conferido nos dois.

### O que o emulador não prova

Ficam para o aparelho real, com a lista de `docs/qa/IPHONE-SAFARI.md`, seção 0 atualizada:

- o teclado virtual de verdade;
- a área segura (entalhe e barra inferior);
- o app instalado na tela inicial;
- o VoiceOver;
- o Texto maior.

### Ambiente desta sessão

O WebKit não baixava (403 em `cdn.playwright.dev`). Criei o ambiente pessoal `tinindo-v1` com esse endereço liberado e instalei as dependências do sistema com `npx playwright install-deps webkit`. Para rodar localmente:

```
PLAYWRIGHT_BROWSERS_PATH=<pasta> npx playwright install webkit
PLAYWRIGHT_BROWSERS_PATH=<pasta> npx playwright test --project=iphone
```
