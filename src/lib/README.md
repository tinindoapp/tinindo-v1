# src/lib · camada comum do front

Um só de cada. Módulo (`src/features/<módulo>`) não copia nada daqui: importa. O lint barra a cópia nova
(`eslint.config.js`, grupos `NO_MONEY_COPY`, `NO_KEY_GENERATOR`, `NO_LOOSE_CLOCK`).

| Assunto | Arquivo | O que usar |
|---|---|---|
| Dinheiro (D13, regra do Caixa) | `money.ts` | `parseBRL` (vazio → `null`, inválido → `undefined`), `formatCents`, `centsToInput` |
| Chave e comando idempotente | `idempotency.ts` | `useCommand` (ação de um toque), `useIdempotencyKey` (formulário), `useAttemptValue` (instante dentro do pedido), `newIdempotencyKey` (chave fixa da tela aberta) |
| Datas e fuso | `time.ts` | `now`, `today`, `localDate`, `startOfLocalDay`, `endOfLocalDay`, `noonOfLocalDay`, `formatDate`, `formatDateTime`, `formatFullDateTime`, `formatSlot`, `formatWeekdayDayMonth` e os demais; sempre com o fuso do negócio |
| Erros de API | `errors.ts` | `errorExplainer({ "CODIGO.campo": "frase" })`, `errorInfo`, `serverMessage`, `SAFE_RETRY` |
| Telefone | `phone.ts` | `normalizePhoneBR`, `phoneToE164`, `formatPhone`, `telHref`, `whatsappHref` |
| Link público | `public-link.ts` | `takeLinkToken(chaveDaSessão)`, `forgetLinkToken(chaveDaSessão)` depois de usar |
| Cliente da API | `api/client.ts` | `createApiClient`, `ApiError` |

## Regras

1. `lib` não importa `app` nem `features`.
2. Dinheiro trafega em centavos inteiros. Texto digitado só vira centavos por `parseBRL`: "10.50" vale R$ 10,50 e
   "1.234" sem vírgula é recusado.
3. Todo comando leva chave. A chave fica a mesma enquanto o pedido for o mesmo e ainda não deu certo; depois do
   sucesso, ou quando o pedido muda, é outra. Nada de relógio dentro do pedido idempotente: se o corpo leva
   "agora", o instante sai de `useAttemptValue`.
4. Tela não chama `new Date()` sem argumento nem `Date.now()`. "Agora" é `now()`; "hoje" é `today(fuso)`.
5. Frase de erro do domínio fica no módulo (`labels.ts`), numa tabela para `errorExplainer`. Ler o erro e
   escolher a frase é daqui.

## Como usar a chave

```tsx
// Ação de um toque (cancelar, estornar, marcar): a intenção identifica o pedido; sem relógio nela.
const command = useCommand();
await command({ cancel: booking.id, version: booking.version }, (key) => port.cancel(booking, key));

// Formulário: a chave acompanha o corpo; reset() só no sucesso.
const idem = useIdempotencyKey();
await port.save(body, idem.keyFor(body));
idem.reset();
```

`useCommand` guarda a chave no componente. Se o erro desmonta o componente (a lista recarrega e a linha é
recriada), a chave se perde e a nova tentativa sai com chave nova, como era antes. Manter a árvore montada
durante a recarga é da parte 2 (`useResource`).

## Rede de proteção

`tests/contracts/server-ports/` chama cada método de cada `serverPort.ts` e confere rota, corpo, schema de saída
e chave com o registro de contratos (`OPERATIONS`). Método novo na porta sem caso no teste falha.
