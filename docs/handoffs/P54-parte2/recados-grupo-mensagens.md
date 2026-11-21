# P54 parte 2 · recados do grupo Lista de espera, Mensagens, Orçamentos e Assinaturas

Pedidos fora das pastas do grupo (`src/features/waitlist`, `messaging`, `sales`, `recurrence`). Nada aqui foi feito; cada
item vira issue.

## Kit (`src/components/ui`)

1. **`ActionRow` com conteúdo embaixo da linha e selo embaixo do título.** Lista de espera, Orçamentos e Assinaturas
   repetiram um `Row` local (`rows.tsx` em cada pasta), como o Caixa já tinha feito (`finance/shared.tsx`). Falta no kit:
   `below` (confirmação, formulário, ciclos), selo na linha do título em vez da coluna da direita e a ação descendo para
   baixo do texto no celular (`flex-wrap`). Com isso as quatro cópias somem.
2. **`ConfirmAction` aberto por item do "⋯" e com campo extra.** As três pastas têm um `InlineConfirm` local (o de
   Assinaturas aceita o campo "Motivo"). Mesmo pedido do Caixa no handoff da parte 1.
3. **`MenuAction` com `aria-expanded`/`href`.** "Enviar modelo aprovado" ficou visível na conversa porque abre um painel
   e precisa de `aria-expanded`; o simulador poderia entrar no "⋯" de Mensagens se o item aceitasse link.
4. **Espaço depois da abertura.** Com `help`, o `PageHeader` soma margem de baixo (16) + `gap` do `.tn-stack` (16) +
   `margin-top` da `Section` (32): 64 px entre "Como funciona" e a primeira seção. As telas do grupo baixaram a margem
   da seção para 16 px só dentro delas (`.tn-wl > .tn-section`, `.tn-rc > .tn-section`, `.tn-msg > .tn-section`). Vale
   decidir no kit (por exemplo, `.tn-stack > .tn-section { margin-top: var(--tn-space-4) }`).
5. **`Section` com `className`.** Mensagens envolveu a seção do resumo semanal num `div` só para poder estilizá-la.

## Metas e sugestões (`src/features/growth-advice`) e casca (`src/app/OwnerDigest.tsx`)

6. **Resumo da semana em Mensagens como seção, não cartão.** `WeeklyDigestCard compact` devolve um `Card` com h2
   próprio. Mensagens agora o mostra numa seção recolhida "Resumo da semana" e, por CSS local
   (`messaging.css`, `.tn-msg-digest`), tira a caixa e esconde o h2 de dentro (o nome da região continua vindo dele).
   Melhor: uma variante `section` do cartão (sem `Card`, sem h2) e um jeito de saber se há resumo, em vez do
   `:has(.tn-card)` que esconde a seção vazia.
7. O e2e `tests/e2e/growth-advice/insights.spec.ts` passou a abrir a seção antes de ler o resumo (só seletor).

## Medidor (`docs/handoffs/P54-parte2/medir.cjs`)

8. **"conversa" não mede nada na demonstração.** A caixa de Mensagens nasce sem número conectado e sem conversas, então
   o seletor `main a[href^="/app/mensagens/"]` não acha nada e a medida repete a de Mensagens. Não é seletor errado: não
   existe conversa até conectar o número simulado, verificar pelo código e escrever pelo simulador. Para medir, o
   script precisaria fazer esse caminho (o mesmo de `tests/e2e/messaging/helpers.ts`, `connectSimulated` e
   `clientWrites`). Medição avulsa deste grupo com esse caminho: conversa com 1 mensagem, 844 px; caixa com 2 conversas,
   861 px.

## Contratos

9. `sales_quote_list` corta em 200 **antes** do filtro por estado (`p_status`): com filtro, a lista pode vir menor sem
   `truncated` refletir o filtro. Hoje a tela não filtra, então não aparece; vale registrar no contrato.
