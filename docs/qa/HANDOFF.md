# Handoff · QA (UAT e2e, acessibilidade, avaliação do assistente)

Sessão: claude/dazzling-fermi-ajqsf1 · Base: `main` em `b7719a7` · Data: 18/10/2026.
Escopo pedido pelo responsável do projeto: escrever **somente** em `tests/e2e/qa/`, `tests/agent-evals/` e `docs/qa/`. Nada em `src/`, `supabase/`, `package.json`.

## Coordenação

- No quadro não há pacote de QA. `tests/e2e/` pertence ao P10, que segue `pending` e bloqueado por dependências. Não fiz `claim` (nenhuma tarefa reservável cobre esses caminhos). O trabalho foi feito por pedido direto do responsável e não toca em caminho de nenhum pacote ativo.
- Este handoff fica em `docs/qa/` porque `docs/handoffs/` está fora do escopo autorizado. O integrador pode mover o arquivo.

## Entregue

1. **`tests/e2e/qa/`**: os quatro roteiros UAT de `docs/10` em Playwright, sobre a demonstração offline.
   - `uat-barbeiro.spec.ts`: 15 testes (8 rodam, 7 em fixme).
   - `uat-cabeleireira.spec.ts`: 9 testes (4 rodam, 5 em fixme).
   - `uat-personal.spec.ts`: 7 testes (3 rodam, 4 em fixme).
   - `uat-cliente-dois-profissionais.spec.ts`: 6 testes (3 rodam, 3 em fixme).
   - `helpers.ts`: motivos padronizados de fixme (`PENDING`) e utilitários.
   - Todo `test.fixme` diz o pacote e o motivo: CRM só leitura na demo (P02), oferta (P05), lista de espera (P06), caixa/pacote (P07), assistente (P08), reserva pelo link e recorrência (P03/P09), multi-tenant/RLS (P01/P09). O corpo de cada fixme já descreve o passo esperado; ao conectar o backend, basta tirar o `fixme` e ajustar os seletores.
2. **`docs/qa/acessibilidade.md`**: auditoria WCAG 2.1 AA com 15 achados (1 alta, 5 médias, 7 baixas, 2 informativos), dono e correção sugerida para cada um. O código não foi alterado.
3. **`tests/agent-evals/`**: 40 casos (`cases.json`) sobre um mundo de fixtures (`fixtures.json`), com o formato e os critérios descritos no `README.md` e um validador (`validate.ts`) que confere a coerência com `contracts/agent.ts`.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run test:e2e` (também com `CI=1`) | 64 passaram, 38 ignorados (fixme), 0 falhas — desktop + mobile, suíte inteira |
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `node tests/agent-evals/validate.ts` | `ok: 40 casos, 7 categorias`; quebrando de propósito (ferramenta inexistente), o validador falha |
| axe-core 4.10.2 injetado via Playwright (fora do package.json) | 0 violações A/AA em 20 rotas × 2 temas + 7 estados; aviso `region` |

## Observações para os pacotes

- **Integrador/P00:** A11Y-01 (reflow em 320 px) tem correção de 1 regra em `ui.css`, conferida no navegador. Itens A11Y-02, 03, 04, 09, 12, 14 e 15 são do shell e dos componentes base.
- **P04:** reagendar recalcula o preço pelo horário novo (R$ 51 → R$ 60 ao sair da regra de terça) e avisa de forma explícita antes de confirmar. **Decisão de produto (fundador, 2026-10-18):** o preço segue o horário novo. Se o cliente muda para um horário mais caro, paga mais; se muda para um mais barato, paga menos. Os testes 4a e 4b da cabeleireira registram esse comportamento e ficam como estão.
- **P08:** o catálogo `AgentTool` não tem leitura de CRM nem de pacote. AE-17, AE-27 e AE-36 aceitam "consulta indisponível". Ao acrescentar ferramentas, atualizar `tools_allowed` desses casos.
- **P10:** os UAT daqui devem rodar contra o ambiente com banco no aceite; `PENDING` em `helpers.ts` lista o que falta conectar.

## Mocks e limitações

- Tudo roda sobre fixtures do contrato v1 e a emulação local do P04 (expediente, regra de terça v3, política de cancelamento). Nenhum fluxo usa servidor.
- Os testes "que rodam" provam comportamento da interface em demonstração, **não** regras no servidor (docs/10: "Tela renderizou não satisfaz regra de agenda").
- Não foram testados leitor de tela real nem iPhone Safari (UX-01 continua aberto).

## Próximo passo

1. Integrador aplica A11Y-01 a A11Y-04 (shell) e acrescenta ao smoke o teste de largura em 320 px.
2. P08 implementa o harness que lê `cases.json` e roda os 40 casos no CI do módulo.
3. À medida que P02/P03/P05/P06/P07 entram com servidor, remover os `test.fixme` correspondentes.
