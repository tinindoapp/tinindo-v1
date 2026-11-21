# P54 parte 2 · Configuração, Serviços e Preços · recados fora da área

Sessão do grupo "Configuração + Serviços + Preços". Só mexeu em `src/features/setup`, `src/features/pricing`,
`src/features/crm/ServicesPage.tsx` (e as regras de `crm.css` que só ela usa) e nos testes dessas telas.
O que precisa de outra área ficou aqui, sem implementar.

## 1. Kit (`src/components/ui`)

- **`ConfirmAction` com `size="compact"`.** Em Preços, "Desativar" de cada regra ativa é a ação da linha e abre a
  confirmação no lugar. O gatilho do `ConfirmAction` não aceita `size`, então a linha usa o botão fantasma normal
  (44 px, ok), não o compacto da regra 5.5.
- **`ActionRow` com conteúdo embaixo da linha e atributos no `<li>`** (mesmo pedido do Caixa). Serviços abre o campo
  de preço embaixo da linha e Preços abre a confirmação de "Desativar"; as duas telas montaram a linha com as classes
  do kit (`tn-list__row`, `tn-list__text`…) em vez do componente. A Configuração precisou de `data-next` e
  `data-done` no `<li>` e também montou à mão.
- **`Section` com título que recebe foco.** As âncoras `#descrever` e `#modelos` da Configuração focam o h2 da seção;
  a tela põe `tabindex="-1"` no h2 pelo DOM antes de focar. Um `focusable` no `Section` resolveria.
- **`Section` recolhida com estado inicial só.** `collapsed` vira `open` do `<details>` a cada render. A Configuração
  guarda o valor da chegada num `useState` para a seção não fechar na mão de quem está nela quando o passo fica feito.
- **`ChoiceCard` desligado:** a opacidade do cartão desligado derruba o texto para 2,48:1 (claro) e 3,26:1 (escuro).
  Era a causa das 4 falhas de contraste da Configuração. A tela deixou de usar o cartão desligado (o que já está no
  catálogo vira uma linha de texto), mas o kit continua com o problema para outras telas.
- **`LinkButton` com `size="compact"`.** O link do próximo passo na linha fina da Hoje (`SetupCard compact`) usa as
  classes `tn-button` com `data-variant="ghost" data-size="compact"` direto num `Link`.

## 2. Teste em `src/app` que trava o desenho

- `src/app/AppShell.test.tsx:276` exige uma lista `Passos da configuração` com os 7 passos e o h2
  `Passos · N de 7 feitos`. Para não mexer em `src/app`, a Configuração manteve uma lista única com os 7 passos e
  esconde os feitos atrás de "Ver os feitos (N)" (CSS `display: none` em `li[data-done]`), em vez de uma seção
  recolhida própria. Se preferirem a seção "Feitos · N" do kit, esse teste precisa mudar junto.

## 3. Listas cortadas (`truncated`)

Nenhum dado destas três telas vem com `truncated` no contrato:

| Tela | Leitura | Situação |
|---|---|---|
| Preços | `pricing.list_rules` (`rules` `.max(100)`, `proposals` `.max(20)`) | **Sem `truncated` no contrato.** Se o teto for atingido, a tela não tem como saber. Pedido para contratos: `truncatedFlags("rules", "proposals")` em `PricingListRulesOutput` (`supabase/functions/_shared/contracts/pricing.ts:105`). |
| Preços | serviços (`/crm/…listServices?limit=100`, `pricing/serverPort.ts`) | Pagina por cursor; a porta lê só a primeira página e descarta `next_cursor`. Com mais de 100 serviços ativos, o seletor da regra e o simulador não mostram o resto. Não foi mudado (é porta, não layout). |
| Serviços | `crm.listServices` (50 por página, `next_cursor`) | **Corrigido na tela:** antes lia só a primeira página e descartava `next_cursor`; agora mostra "Carregar mais", como Clientes. |
| Configuração | `setup.progress` (8 passos fixos), `setup.templates` (`.max(50)`) | Sem teto que corte na prática; sem `truncated`. |
