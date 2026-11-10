# 16 · Código dos módulos maiores: Agenda, Perfil público, Clientes, Conta e Caixa

Auditor: fe-modulos-a · 10/11/2026 · `main` em `8e113c4` · somente leitura

## Resumo

**Veredito: misto.** Os cinco módulos (scheduling, network, crm, identity, finance; 14,8 mil linhas com testes) são o núcleo do produto e o tamanho deles é adequado ao objetivo. A base é boa: portas com contrato validado, dinheiro em centavos inteiros, fuso do negócio na Agenda e no Caixa, nenhum `any` e um único `eslint-disable` em todo o conjunto.

O problema é que cada módulo resolveu sozinho as mesmas quatro coisas: chave de idempotência (5 variantes), telefone (3 analisadores que divergem), dinheiro (2 cópias) e data (3 kits, um sem fuso). Os defeitos reais estão nessas emendas:

- **Caixa**: despesa e recebimento de hoje levam o relógio dentro do pedido, então no servidor a chave muda a cada tentativa. A demonstração e os testes usam relógio fixo e por isso nunca mostraram a duplicação (é a causa do item 1 do consolidado de 04/11).
- **Link público**: mostra e pede horários sempre no fuso de Brasília, embora o cadastro ofereça nove fusos e o contrato devolva o fuso do negócio.
- **Horários**: bloquear, remover e bloquear de novo o mesmo período diz "Bloqueio criado" e não cria nada (reproduzido).
- **Reagendar**: com versão desatualizada, a explicação nunca aparece e a escolha some (reproduzido).
- **Caixa**: cada ação desmonta a página inteira; o foco cai no `body` (medido).

Nenhum desses pede reescrita. Pedem uma camada comum pequena (`src/lib`: idempotência, telefone, dinheiro, datas, recurso assíncrono) e a quebra de quatro arquivos grandes. Caixa e Perfil público são os dois módulos rasos para o papel que têm.

## 1. Nota de saúde por módulo

| Módulo | Nota | Justificativa |
|---|---|---|
| scheduling (Agenda) | **B** | Melhor estrutura do conjunto: `port.ts`, `time.ts` com fuso do negócio, catálogo de erros, `useAsync` com guarda de ordem, 72 testes. Perde nota por dois defeitos reproduzidos (achados 03 e 04), quatro jeitos de gerar chave no mesmo módulo e três arquivos de tela com várias telas dentro. |
| network (Perfil e link público) | **C** | O fluxo que o cliente final usa mora num componente com 18 `useState`, fuso fixo de Brasília e um pedido fabricado para satisfazer o tipo. `api.ts` junta interface, porta HTTP e demonstração em 451 linhas. Três dos dez problemas de alto impacto de 04/11 estão aqui. |
| crm (Clientes e Serviços) | **B** | Menor e mais regular: `createKeyRing` com reset, `format.ts` testado, importação por CSV testada. Perde nota pela busca sem guarda de ordem (achado 06) e por ser somente leitura na demonstração (ux-nucleo-celular-15). |
| identity (Conta) | **B** | Tem o hook de idempotência correto do repositório (18 linhas), erros de autenticação neutros e formulários curtos. Perde nota por `services.tsx` misturar leitura direta ao Supabase com chamadas de contrato (fe-arquitetura-15) e por um arquivo único de teste com 470 linhas. |
| finance (Caixa) | **C** | A conta de dinheiro está certa e os conceitos estão bem separados, mas tudo vive num arquivo de 883 linhas com 14 componentes, 4 testes de tela, porta do servidor sem teste, relógio dentro do pedido idempotente e remontagem total a cada ação. É o módulo onde erro custa dinheiro e é o menos protegido. |

Medidas de apoio: `any` = 0 nos cinco módulos; `eslint-disable` = 1 (`finance/FinancePage.tsx:147`); `useEffect` = 32; 271 exportações, 55 sem uso em produção fora do próprio arquivo (`trabalho/fe-modulos-a/exports.out`).

## 2. Achados

Os 16 achados com evidência e correção estão em `achados/fe-modulos-a.json`. Resumo na ordem de impacto:

| Id | Gravidade | O que é | Onde |
|---|---|---|---|
| 01 | crítica | Relógio dentro do pedido idempotente: chave nova a cada tentativa no servidor; a demonstração esconde | `finance/FinancePage.tsx:454`, `:619`, `:84-91`; `finance/serverPort.ts:31`; `finance/demoPort.ts:96` |
| 02 | alta | Link público com fuso de Brasília fixo | `network/PublicProfileView.tsx:13-17`; `network/useNetworkApi.ts:68-78` |
| 03 | alta | Bloqueio recriado diz "criado" e não cria | `scheduling/HoursPage.tsx:50-58`, `:332-335` |
| 04 | alta | Reagendar com versão antiga: explicação nunca aparece | `scheduling/BookingFlowPage.tsx:43-53`, `:152-159` |
| 05 | alta | Caixa desmonta tudo a cada ação; foco no `body` | `finance/FinancePage.tsx:180`, `:198-212` |
| 06 | média | Busca de Clientes: resposta antiga sobrescreve a nova | `crm/CustomersPage.tsx:55-75` |
| 07 | média | Cinco variantes de chave de idempotência | ver seção 3, padrão 1 |
| 08 | média | `FinancePage.tsx` com 883 linhas, 14 componentes, 4 testes | ver seção 4 |
| 09 | média | Reserva pública: 18 `useState` e pedido fabricado | `network/PublicProfileView.tsx:205-234`, `:341-345` |
| 10 | média | Três analisadores de telefone divergem | `crm/format.ts:10-26`; `scheduling/agenda.ts:241-251`; `network/PublicProfileView.tsx:52-58` |
| 11 | média | Dinheiro e data copiados entre módulos | ver seção 3, padrões 3 e 4 |
| 12 | média | Testes com relógio parado e resposta imediata | `finance/useKeyFor.test.tsx`; `scheduling/SchedulingFlow.test.tsx:94-98` |
| 13 | média | Quatro arquivos de tela com várias telas dentro | ver seção 4 |
| 14 | baixa | Recebimento de um toque usa o instante da montagem | `finance/FinancePage.tsx:334` |
| 15 | baixa | Cadastro rápido engole o erro | `scheduling/BookingFlowPage.tsx:454-455` |
| 16 | baixa | Ponto de extensão sem provedor, classe sem uso, 55 exportações sobrando | `scheduling/parts.tsx:125-131`; `scheduling/port.ts:99-105` |

### O que foi reproduzido na demonstração

Scripts e saídas em `trabalho/fe-modulos-a/` (`check2.cjs`, `check2.out`, `check3.cjs`, `check3.out`), em 390×844, contra `http://127.0.0.1:4173`.

- **Achado 03** (`check3.out`): criar o bloqueio "Medico" em 31/10 das 20:00 às 21:00 (1 item na lista), remover (0 itens), criar igual de novo. O aviso é "Bloqueio criado. Esse período não aparece mais como livre." e a lista fica com 0 itens. A porta da demonstração emula a idempotência do servidor (`scheduling/fixturePort.ts:117-127`, `:352-354`) e o servidor faz o mesmo (`supabase/migrations/20261018130000_p03_scheduling.sql:992-993`).
- **Achado 04** (`check2.out`, bloco b): em `/app/agenda/atendimento/…0006/reagendar?simular=versao`, depois de Confirmar aparece "Carregando atendimento…" aos 87 ms; a partir de 198 ms a tela volta sem a mensagem "Este atendimento mudou enquanto você editava", sem nenhum `role=alert` e sem horário marcado.
- **Achado 05** (`check2.out`, bloco c): com "Ver mais" aberto em Recebimentos, tocar em "Cobrar depois" faz o botão "Ver mais" voltar e deixa `document.activeElement` em `BODY`. Na demonstração a troca dura menos de 82 ms; o salto de rolagem com latência real é inferência pelo JSX.

### O que é leitura de código (não executado em servidor)

Achados 01, 02, 06 e 14. Em todos a causa é determinística pelo código citado; o que não foi observado é o efeito final num servidor real, porque o ambiente não tem `.env`.

Sobre o 01, o encadeamento é: `port.now()` no servidor é `new Date()`; o instante entra em `received_at` ou `paid_at`; a chave sai de `JSON.stringify(payload)`; pedido com milissegundo diferente é pedido diferente e ganha chave nova. Para despesa, a segunda tentativa cria outra despesa. Para recebimento, cria outro recebimento quando o valor é parcial; quando é total, o servidor recusa por exceder o saldo e a tela mostra erro depois de sucesso. A linha 76 do mesmo arquivo afirma o contrário ao usuário.

## 3. Os cinco padrões que mais vale extrair

A regra de não importar outro módulo foi respeitada, e o preço foi cada módulo copiar o seu kit (fe-arquitetura-08). Para estes cinco módulos, de onde para onde:

**1. Chave de idempotência** → `src/lib/idempotency.ts`

Origem a promover: `identity/idempotency.ts:5-18` (`useIdempotencyKey` com `keyFor` e `reset`). Substitui:

- `finance/FinancePage.tsx:84-91` (`useKeyFor`, sem reset) e `newKey()` no toque em `:471`, `:557`, `:658`, `:774`;
- `crm/api.ts:234-247` (`createKeyRing`, mesma lógica em closure);
- `scheduling/HoursPage.tsx:50-58` (`useAttemptKey`, sem reset), `BookingFlowPage.tsx:83`, `:139-140`, `:434`, `:447-448` (estado inline), `attendance.tsx:34` e `BookingDetailPage.tsx:132` (chave fixa por montagem);
- `network/NetworkHome.tsx:156-158`, `:340`, `ProfileMedia.tsx:24`, `PublicPages.tsx:127`, `:212`, `PublicProfileView.tsx:216`, `:314`, `:360` (estado trocado à mão);
- `identity/AccountPage.tsx:202` (chave montada como texto).

Duas regras no arquivo: o payload não contém leitura de relógio; `reset()` em todo sucesso.

**2. Telefone** → `src/lib/phone.ts`

Origem: `crm/format.ts:10-45` (`normalizePhoneBR`, `formatPhone`, `telHref`, `whatsappHref`) com a tabela de `crm/format.test.ts`. Substitui `scheduling/agenda.ts:241-262` (`phoneToE164`, `formatPhoneBR`, `whatsAppDigits`), `network/PublicProfileView.tsx:36`, `:52-58` (`whatsappLink`, `toE164`) e `network/useNetworkApi.ts:72-75`.

**3. Dinheiro** → `src/lib/money.ts`

Origem: `finance/money.ts:4-19`. Substitui a cópia idêntica em `crm/format.ts:47-67`, `scheduling/agenda.ts:229` e `network/PublicProfileView.tsx:32`. Resolver junto com o fe-arquitetura-01 (o mesmo valor digitado vale quantias diferentes conforme a tela).

**4. Datas no fuso do negócio** → `src/lib/dates.ts`

Origem: `scheduling/time.ts` inteiro, mais `monthPeriod`, `noonOfLocalDay` e `endOfLocalDay` de `finance/money.ts:23-76`. Substitui `network/PublicProfileView.tsx:13-17`, `:41-50` e `network/useNetworkApi.ts:68-78`, o que resolve o achado 02.

**5. Recurso assíncrono com guarda de ordem** → `src/lib/data/useResource.ts`

Origem: `useAsync` de `scheduling/SchedulingLayout.tsx:95-116` (chave, guarda contra resposta antiga, `keepWhileReloading`). Substitui os pares `useEffect` + `alive` escritos à mão em `finance/FinancePage.tsx:121-148`, `crm/CustomersPage.tsx:55-75`, `network/NetworkHome.tsx:30-57`, `network/PublicProfileView.tsx:236-281`, `identity/AccountPage.tsx:132-195` e `identity/MyBookingsPage.tsx:50`. Resolve os achados 05 e 06 e é o lugar natural para o cache pedido no fe-arquitetura-04.

Fica como sexto, se houver fôlego: mensagem de erro por código. Hoje há `explain` em `finance/FinancePage.tsx:54-80`, `explainError` em `scheduling/errors.ts:52`, `errorMessage` em `crm/api.ts:227` e em `network/useNetworkApi.ts:59`, `bookingError` em `network/PublicProfileView.tsx:61` e `identity/errors.ts`. O catálogo da Agenda é o mais completo.

## 4. Arquivos grandes: onde cortar

**`finance/FinancePage.tsx` (883 linhas)**

- `FinancePage.tsx`: casca, período e provedor (hoje 111-227).
- `useMonthData.ts`: base e dados do mês, mantendo o último valor durante a recarga.
- `labels.ts` e `errors.ts`: rótulos (34-51) e `explain` (54-80).
- `sections/Summary.tsx` (247-295), `sections/Uncharged.tsx` (309-414), `sections/Receivables.tsx` (416-519), `sections/Packages.tsx` (762-835).
- `sections/History.tsx`: um `HistoryList` para Recebimentos e Despesas, que hoje repetem a mesma lista (550-598 e 650-696), com `ReverseButton` e `MoreButton`.
- `forms/ExpenseForm.tsx` (601-648), `forms/PackageForm.tsx` (699-760), `forms/ReceivableForm.tsx` (838-883).

**`network/PublicProfileView.tsx` (691 linhas)**

- `PublicProfileView.tsx`: cabeçalho do perfil (83-153).
- `booking/useBookingRequest.ts`: reducer das etapas no lugar dos 18 `useState` (206-226).
- `booking/StepService.tsx`, `StepSlot.tsx`, `StepContact.tsx`, `StepCode.tsx`, `BookingDone.tsx`.
- Funções de data e telefone saem para `src/lib`.

**`network/api.ts` (451 linhas)** → `port.ts` (interface), `serverPort.ts` (100-170) e `demoPort.ts` (175-451), no formato dos outros módulos (fe-arquitetura-14).

**`scheduling/BookingFlowPage.tsx` (526 linhas)** → `BookingFlow.tsx` (63-334), `CustomerPicker.tsx` com `NewCustomer` (336-479), `PriceLine.tsx` (481-526). Separar `confirm()` em criar e reagendar elimina os dois `as Parameters<…>` de `:146-147`.

**`scheduling/HoursPage.tsx` (427 linhas)** → `WeeklyHours.tsx` (101-294) e `Blocks.tsx` (296-427); não dividem estado.

**`scheduling/BookingDetailPage.tsx` (436 linhas)** → `BookingDetail.tsx` (113-335) e `AfterCancel.tsx` (337-436).

**`network/NetworkHome.tsx` (416 linhas)** → `ProfileEditor.tsx` (133-313) e `InvitePeer.tsx` (334-416).

**`scheduling/fixturePort.ts` (545 linhas)**: não cortar agora. O tamanho dele é a questão do fe-arquitetura-05 (a demonstração como segundo backend), e foi a emulação fiel de idempotência e de versão que permitiu reproduzir os achados 03 e 04.

**`crm/CustomersPage.tsx` (345 linhas)**: tamanho aceitável. `CustomersPage` e `ServicesPage` repetem a mesma estrutura (lista, formulário, arquivar com Desfazer em `CustomersPage.tsx:76-113` e `ServicesPage.tsx:100-104`); vale um `useArchiveWithUndo` só se um terceiro caso aparecer.

## 5. Demonstração contra servidor

Diferenças que o usuário ou o teste percebe, nestes módulos:

| Diferença | Onde | Efeito |
|---|---|---|
| Relógio fixo na demonstração, `new Date()` no servidor | `finance/demoPort.ts:96`, `:196`; `finance/serverPort.ts:31`; `scheduling/serverPort.ts:45` | Esconde o achado 01 e o 14; todo teste de tela do Caixa roda com relógio parado |
| Clientes somente leitura na demonstração, mas a Agenda cria cliente | `crm/api.ts:158-214`; `scheduling/fixturePort.ts` (`createCustomer`) | O cliente criado no Novo agendamento não aparece em Clientes (ux-nucleo-celular-15) |
| Entrega do código: `queued` na demonstração | `network/api.ts:390` | A tela afirma "Enviamos um código" nos dois casos (achados-anteriores-04) |
| Primeiro dia do link público fixo em 20/10 na demonstração | `network/PublicProfileView.tsx:12`, `:208` | Só demonstração; some quando as datas forem para `src/lib/dates.ts` com relógio injetável |
| Idempotência de bloqueio emulada igual ao servidor | `scheduling/fixturePort.ts:117-127` | Positivo: a demonstração reproduz o achado 03 |

## 6. Testes

- 17 arquivos de teste nos cinco módulos. Rodei só `npx vitest run --project unit src/features/finance`: 5 arquivos, 17 testes, todos passam em 2,3 s.
- Não encontrei teste que só renderiza: os quatro arquivos de tela têm de 13 a 73 interações cada.
- A fraqueza é de cenário, não de asserção. Faltam os quatro casos do achado 12: nova tentativa no Caixa com relógio que avança, versão no reagendar, bloqueio recriado e busca fora de ordem.
- `finance/serverPort.ts` (91 linhas) não tem teste; `scheduling/serverPort.test.ts` (8 casos) é o modelo.
- `finance/FinancePage.test.tsx` tem 4 casos para 883 linhas de tela com dinheiro.

## 7. Tipos frouxos

Não há `any`. Os pontos em que o tipo esconde caso real:

- `finance/FinancePage.tsx:55`: erro lido com `as { code?; field? }`; `:368` lança objeto solto que cai em mensagem genérica; `:109` `usePage()` com `!`.
- `scheduling/BookingFlowPage.tsx:146-147`: `payload as Parameters<typeof port.create>[0]`.
- `network/PublicProfileView.tsx:341-345`: `BookRequest` montado com horário e entrega inventados.
- `scheduling/SchedulingLayout.tsx:48-50`, `:60`: `as SchedulingPort & FixturePublicLink` e `hold_expires_at!` na ponte da demonstração.

## 8. O que manter intacto

- `scheduling/time.ts`, `scheduling/errors.ts` e o `useAsync` da Agenda: promover, não reescrever.
- `identity/idempotency.ts`: é o hook único que o consolidado pede.
- Conta de dinheiro em centavos inteiros (`parseBRL`) e a separação do Caixa entre concluído, cobrado e recebido.
- Estorno com `ConfirmAction` e consequência escrita (`finance/FinancePage.tsx:522-540`).
- Simulações `?simular=conflito|versao` e a idempotência emulada no `fixturePort`.
- `CustomerPicker` do Novo agendamento e o foco por etapa da reserva pública.

## 9. Decisões para os donos

1. **Fuso fora de Brasília no piloto.** Corrigir o link público para usar o fuso do negócio (achado 02, meio dia) ou tirar os outros oito fusos do cadastro até corrigir. Recomendo corrigir.
2. **Indicação entre profissionais** (convite e "recomendar colega", cerca de 500 linhas em `network/PublicPages.tsx` e `InvitePeer`). Manter visível no piloto ou esconder até o núcleo fechar. Recomendo esconder da navegação e manter o código; a decisão de escopo é a do relatório `escopo-produto`.

## 10. O que não foi coberto

- Nada foi executado contra servidor real: os achados 01, 02, 06 e 14 são leitura de código.
- `knip` e `ts-prune` não foram rodados; a lista de exportações vem de `trabalho/fe-modulos-a/exports.cjs`, que não enxerga reexportação nem uso dinâmico.
- Lidos só por estrutura e busca, não linha a linha: `scheduling/AgendaPage.tsx`, `BookingDetailPage.tsx`, o miolo de `fixturePort.ts`, `agenda.ts`; `network/NetworkHome.tsx`, `ProfileMedia.tsx`, `PublicPages.tsx`, `photo.ts`, `ics.ts`; `crm/ServicesPage.tsx`, `ImportPage.tsx`, `CustomerPage.tsx`, `csv.ts`; todas as telas de `identity`.
- Os cinco `.css` dos módulos e a acessibilidade do JSX não foram auditados de forma sistemática.
- Testes avaliados por contagem, nomes e buscas dirigidas; só a suíte de `finance` foi rodada.
- Regras de preço, disponibilidade e lista de espera do `fixturePort` não foram comparadas com o SQL.
- Nenhuma captura da galeria foi aberta; a evidência visual é a medição de DOM dos scripts.
