# 04 · Situação dos achados das revisões anteriores

Auditoria geral do Tinindo · 10/11/2026 · `main` em `8e113c4` · somente leitura.

## Resumo

- **Veredito: misto.** O que foi corrigido antes continua corrigido (auditoria de UX de 27/10: 74 de 74 itens marcados, amostra conferida). O que a revisão de 04/11 achou continua **todo aberto**: `git log b7b58fc..HEAD -- src supabase` sai vazio; o único commit novo é o de documentação.
- **Os 10 problemas altos do consolidado: 10 abertos, 0 corrigidos.** Dos médios, 12 abertos e 1 que não reproduzi (R-05, foco do chip do assistente).
- **Os PRs #91 e #92 não resolvem nenhum deles.** Resolvem os quatro pedidos que ficaram "em parte" na onda 3 de UX (itens 60, 46, 39 e 43). Os dois entram na `main` sem conflito, mas com migrations datadas antes das mais novas da `main` e com números de pgTAP repetidos (detalhe na seção 5).
- **Simples demais na prevenção:** os testes cobrem listas fixas de rotas. Por isso P44, P45 e P46 reintroduziram defeitos já corrigidos (rolagem em 320 px, "selecionado" sem cor de texto, alvos de 24 px).
- **Exagerado em cópias, raso no essencial:** três helpers iguais de chave de idempotência, 18 cópias de `newKey`, 145 chamadas `newKey()` em 30 arquivos, e mesmo assim 7 pontos duplicam dado em nova tentativa.
- **Quatro correções agrupadas resolvem 9 dos 10 altos e 7 dos médios** (seção 2). O décimo alto (Home em 320 px) é uma regra de CSS.
- O mais grave continua sendo a duplicação em nova tentativa (compra, mensagem, recebimento, despesa, conta mensal, plano) com a tela dizendo "tentar de novo é seguro".

Base das medidas: a primeira tentativa desta auditoria (10/11, mesmo commit) deixou scripts, JSON e capturas em `trabalho/achados-anteriores/` (`repro1.json`, `repro2.json`, `repro-describe.log`). Nesta retomada conferi por amostra três capturas e todos os trechos de código citados nos achados altos, e rodei `repro3.cjs` (foco do chip). O que é leitura de código e o que é medida está dito em cada linha.

## 1. Os 10 problemas altos do consolidado de 04/11

| # | Achado | Origem | Situação | Arquivo:linha hoje | Como conferi | Correção | Esf. |
|---|---|---|---|---|---|---|---|
| 1 | Nova tentativa duplica dado e a tela diz que é seguro | 03 (A1 a A5) | **Aberto** | `materials/MaterialsPage.tsx:85` e `:110-111` (troca a chave no `catch`); `messaging/InboxPage.tsx:105-106` e `:165`; `finance/FinancePage.tsx:454`+`:459` e `:619`+`:624` (horário de agora dentro do conteúdo da chave), mensagem em `:76`; `finance-advanced/AccountsPage.tsx:40-41`; `recurrence/RecurrencePage.tsx:39` | Leitura | Grupo G1 | P (7 pontos) |
| 2 | Próximo passo da configuração invisível | 01 (A2), 02, 04 (R-01) | **Aberto** | `setup/setup.css:19` (`--tn-selected-bg` sem `--tn-selected-text`) | Medida: claro, fundo e título `rgb(17,17,17)`; escuro, ambos `rgb(247,247,245)`. Captura `c2_passo_light.png` | Borda de destaque em vez de fundo cheio, ou declarar a cor do texto | P |
| 3 | "Me ajuda a configurar" nunca carrega com servidor | 06 | **Aberto** | `agent/setupGuide.ts:9-24` (schema próprio); `agent/serverPort.ts:29-32` (valida com ele e engole o erro); contrato em `_shared/contracts/setup.ts:15-49` | Executado: "schema do guia aceita a resposta do contrato: false" (`repro-describe.log`) | Grupo G2 | P |
| 4 | Frase do negócio erra e salva com "Salvo" | 01 (A4) | **Aberto** | `_shared/domain/setup/describe.ts:76` ("com N" vira equipe), `:86` (única menção a negação é "sem folga"), `:136-138` (um intervalo só); `setup/SetupPage.tsx:112` ("Salvo: …") | Executado com o analisador real: 4 de 6 frases erradas sem aviso (`repro-describe.log`) | Grupo G2 | M |
| 5 | Cliente bloqueado depois de 5 códigos errados | 05 | **Aberto** | `20261026164500_p43_public_booking.sql:235`; `20261029033000_p43_replace_pending_request.sql:155` (herda `attempts`); emulador `network/api.ts:395` e `:404` | Reproduzido na demonstração (`repro2.json`, `c5_codigo_certo_bloqueado.png`) | Grupo G3 | P |
| 6 | Corrigir o WhatsApp perde o próprio horário | 05 | **Aberto** | `20261029033000…:121` (procura pendente só pelo telefone novo); `network/PublicProfileView.tsx:634-646` e `:320` | Reproduzido (`repro2.json`, `c6_corrigir.png`: "Este horário acabou de ser reservado por outra pessoa") | Grupo G3 | M |
| 7 | "Enviamos um código" mesmo com falha; sem reenviar | 05 | **Aberto** | `network/PublicProfileView.tsx:630` (texto fixo); `delivery` só em `:343`; contrato em `contracts/network.ts:182` | Medida: `diz_enviamos` true, `tem_reenviar` false | Grupo G3 | P |
| 8 | "Minhas reservas" e "Avaliar" inalcançáveis | 05, 02 (F4) | **Aberto** | `customer_link.issue` sem chamada em `src` (só `redeem` e `revoke` em `identity/services.tsx:175` e `:181`); `app/pages/SignIn.tsx:16`; `app/AppShell.tsx:146` | Leitura (grep) | Grupo G4 | M |
| 9 | Home rola em 320 px; valor passa do cartão em 375 px | 04 (R-02) | **Aberto** | `app/pages/pages.css:20` (3 colunas fixas) e `:23` (`nowrap`) | Medida: 320 px, `scrollWidth` 330; 375 px, valor termina em 367 e o cartão em 359 | Cartão de dinheiro em linha própria abaixo de 400 px, ou `clamp()` no valor | P |
| 10 | Na demonstração, a configuração guiada não muda o resto do app | 01 (A1) | **Aberto** | `setup/demoPort.ts:40-53` e `:106-122` (estado próprio) | Leitura; divergência medida entre Home ("5 de 8") e guia ("4 de 8") | Grupo G2 | M |

## 2. Correções que resolvem vários de uma vez

**G1 · Um hook único de chave de idempotência.** Resolve o alto 1 e o médio "erro depois de sucesso" (A7).
- Fato: existem três implementações equivalentes e corretas (`identity/idempotency.ts:5`, `crm/api.ts:234`, `finance/FinancePage.tsx:84`), usadas só em identity, crm e finance. O resto da base usa `newKey()` no toque: 145 ocorrências em 30 arquivos, com `export const newKey` repetido em 18 `port.ts`. Os maiores: `resources/ResourcesPage.tsx` (13), `messaging/InboxPage.tsx` (11), `finance-advanced/AccountsPage.tsx` (10), `presence/PresencePage.tsx` (9).
- Caminho: `src/lib/idempotency.ts` com `useIdempotencyKey()` (`keyFor(payload)`, `reset()`); primeiro os 7 pontos que duplicam (P), depois a base módulo a módulo (G), com regra de lint que proíbe `newKey()` e `crypto.randomUUID()` como argumento de port. O texto "Tentar de novo é seguro" (23 arquivos) só fica onde a chave é estável.
- Atenção no Caixa: usar o hook não basta, porque o conteúdo inclui o horário de agora (`FinancePage.tsx:454`). Fixar o horário ao abrir o formulário, como `:334` já faz.
- Teste que faltou: port falhando uma vez com `PROVIDER_UNAVAILABLE` e o segundo envio com a mesma chave. O `useKeyFor.test.tsx` de hoje usa um payload sem `received_at` e por isso passa.

**G2 · Configuração guiada com uma fonte só.** Resolve os altos 3, 4 e 10 e os médios "progresso 4 de 8 contra 5 de 8" e "âncoras".
- O guia do assistente passa a usar `SetupProgressOutput` de `@contracts` e o `STEP_CATALOG` de `setup/labels.ts`; some o `DEMO_SETUP` fixo (`agent/setupGuide.ts:32`).
- O `demoPort` do setup grava nos dados da demonstração que Agenda, Serviços e link leem.
- `describe.ts` ganha negação, dois turnos e "com N" só com "pessoas"; o que sobrar sem entender vai para `unknown`. Teste com as frases reais das três personas (hoje são 6 casos, nenhum com negação nem dois turnos).

**G3 · Jornada do cliente no link.** Resolve os altos 5, 6 e 7 e os médios de política, preço e nome do negócio.
- Migration nova: pedido que substitui outro nasce com `attempts = 0` (o limite de 6 pedidos por hora por telefone, `…033000:111-114`, já contém abuso); ao bater 5 tentativas, liberar o hold; `replaces_request_id` para liberar o pedido anterior ao corrigir o número.
- Tela: texto conforme `delivery`, "Reenviar código", política e preço base antes de confirmar.

**G4 · Vínculo do cliente.** Resolve o alto 8 e o médio "login não guarda o destino".
- `AppShell` guarda a origem e `SignIn` volta a ela; botão "Mandar link de acesso" na ficha do cliente; `RedeemLinkPage` lê o código do fragmento do link (hoje só do campo, `:20`).

**G5 · Varredura de rotas no lugar de listas fixas.** Evita a volta de A11Y-01, UX 9 e UX 59.
- `tests/e2e/foundation/a11y.spec.ts:52` cobre 4 rotas. Um spec que lê as rotas do roteador e mede, em 320 e 375 px e nos dois temas, rolagem lateral, contraste e alvos de 44 px teria pego os altos 2 e 9 e os 12 alvos pequenos.

## 3. Médios e baixos da revisão de 04/11

Situação "Aberto (leitura)" quer dizer: o trecho de código citado continua igual e não refiz a medida. "Aberto (medido)" quer dizer que há medida de 10/11 em `repro1.json` ou `repro2.json`.

| Achado | Origem | Situação | Arquivo:linha hoje | Correção | Esf. |
|---|---|---|---|---|---|
| Política de cancelamento obrigatória "porque o cliente vê", mas o link não mostra; confirmação sem preço nem local | 01 A3, 05 | Aberto (medido) | `setup/labels.ts:20`; nenhuma ocorrência em `network/PublicProfileView.tsx` | G3 | M |
| Login não guarda o destino | 02 F4 | Aberto (leitura) | `app/AppShell.tsx:146`; `app/pages/SignIn.tsx:16` | G4 | P |
| Âncoras `#modelos` e `#descrever` não rolam | 02 F1 | Aberto (medido: `scrollY` 0 com o alvo em 1.524 px) | `setup/SetupPage.tsx:274-280` (roda uma vez, antes de carregar) | Rodar o efeito depois que `progress` carrega | P |
| Foco perdido depois de "Agora não" | 02 F3 | Aberto (medido: `BODY`) | `growth-advice/Insights.tsx:68` | Focar o próximo cartão ou o título | P |
| Foco perdido ao usar sugestão do assistente | 04 R-05 | **Não reproduzido** em 10/11 (Chromium 153, teclado e clique: o foco fica no chip; `repro3.log`) | `agent/AgentPage.tsx:211` (`disabled={busy}` continua lá) | Conferir em aparelho real; trocar por `aria-disabled` é barato | P |
| Assistente responde errado com confiança; "Não entendi" para "como publico meu link?" | 01 A6, 06 | Aberto (medido) | `_shared/domain/agent/engine.ts:314`; 0 casos com "por que" em `tests/agent-evals/cases.json` | Classificador e casos de avaliação | M |
| Progresso do guia (4 de 8) contradiz a Home (5 de 8) | 01 A5 | Aberto (medido) | `agent/setupGuide.ts:32` | G2 | P |
| Prévia do link fora de `/p/` e `/s/` mostra o slogan para profissionais; página do Pix | 05 | Aberto (medido: `og:title` "Tinindo") | `index.html:27-29`; `worker/og.ts:36` | Prévia neutra para `/pagar`, `/orcamento`, `/oferta`, `/convite` | M |
| Mensagens ao cliente sem o nome do negócio | 05 | Aberto (leitura) | `20261026164500_p43_public_booking.sql:18-19` e `:329` | Modelo novo por migration | M |
| Contas a pagar: "-R$ 1.235,00" quebra o sinal | 04 R-03 | Aberto (medido: 2 linhas, 72 px) | `components/ui/ui.css:373-388`; `finance-advanced/AccountsPage.tsx:152` | Sinal U+2212 e `nowrap` no valor; grade cai para 1 coluna | P |
| Menu do celular não prende o foco | 04 R-04 | Aberto (medido: 30 de 60 Tabs fora) | `app/AppShell.tsx:112-126` e `:201-202` | `inert` no resto enquanto aberto | P |
| `channel.verify` repetido dá 500 | 03 A6 | Aberto (leitura; reproduzido em Postgres em 04/11) | `20261022120000_p12_messaging.sql:338` | Migration nova gravando o corpo do erro | P |
| Erro depois de sucesso em cerca de 80 telas | 03 A7 | Aberto (contado) | 145 `newKey()` em 30 arquivos; `materials/MaterialsPage.tsx:64` e `:74` (botão sem `loading`) | G1 | G |
| Depois de "Atendido" nada leva à cobrança | 01 A12 | Parcial: o detalhe tem "Cobrar no Caixa", mas leva ao Caixa genérico | `scheduling/BookingDetailPage.tsx:288-292` | Link com o atendimento e folha "Recebi" aberta | M |
| Reserva pelo link fica "Sem cliente cadastrado", sem salvar | 01 A11 | Aberto (medido) | `scheduling/AgendaPage.tsx:122`; `BookingDetailPage.tsx:135` e `:234` | "Salvar como cliente" | M |
| Personal a domicílio sem caminho na configuração nem no link | 01 A13 | Aberto (leitura) | `setup/labels.ts` (sem passo de domicílio) | Decisão de escopo: ver o relatório de escopo | M |
| Diretório da demonstração leva a perfis inexistentes | 02 F2 | Aberto (medido: "Perfil não encontrado") | `discovery/demoPort.ts` | Publicar os perfis de exemplo na demonstração ou tirar os links | P |
| Páginas públicas de erro sem saída | 02 F6 | Aberto (medido: 0 links e 0 botões em 7 rotas) | `network/PublicPages.tsx` e páginas de token | Um link "Ir para o início" ou "Falar com o profissional" | P |
| Reserva de equipe não emite evento | 03 A8 | Aberto (leitura: 0 `emit_event` na migration do P28) | `20261027220500_p28_team_resources.sql` | Decisão dos donos (achado 19 do JSON) | M |
| `link_token` em texto puro na idempotência | 03 A9 | Aberto (leitura) | `20261022130000_p14_payments.sql:299` | Gravar o corpo sem o token, como `quote.send` | P |
| Resposta fora do contrato depois do commit vira 500 permanente | 03 A10 | Aberto (suspeita, não conferido) | `_shared/http/rpc-handler.ts:142-143` | Sucesso mínimo com aviso de recarregar | P |
| Cinco RPCs sem nenhum teste | 03 A11 | Aberto (grep: 0 arquivos para `waitlist_withdraw`, `waitlist_cancel_offer`, `ops_block`, `lifecycle_step_cancel`, `resources_class_cancel`) | `supabase/tests/database/` | Um pgTAP mínimo por RPC | P |
| Rótulos da barra de abas no escuro (vidro 0,70) | 04 R-06 | Aberto (leitura) | `brand/tokens/tokens.css:153` e `:184` | Ver o relatório de design | P |
| Alvos de toque menores que 44 px nas telas novas | 04 R-07, A11Y-07 | Aberto (medido: 12 alvos de 17 a 24 px) | `/app/mensagens`, `/app/relacionamento`, `/app/site`, `/app/conta`, `/app/conta/reservas`, `/avaliar`, `/recuperar-senha`, `/criar-conta`, `/diretorio` | `min-height: var(--tn-size-touch)` nos links; G5 | P |
| "Mensagens" encurtado em 320 px | 04 R-08 | Aberto (medido: 67 px de texto em 64 px) | `app/shell.css` (barra de abas) | Rótulo de 11,5 px em 320 ou "Msgs" | P |
| Setas tipográficas no nome acessível | 04 R-09, A11Y-10 | Aberto (não reconferido) | diversos | `aria-hidden` na seta | P |
| Duas listas de "primeiros passos" | 01 A7 | Aberto (leitura) | `identity/AccountPage.tsx:79-94` e `setup/` | G2: manter só a do setup | P |
| Rascunho recusa tudo por nome repetido; serviços sem duração nem preço | 01 A8, A9 | Aberto (não reconferido) | `setup/demoPort.ts:102-122` | G2 | P |
| Na demonstração não se cadastra cliente em Clientes | 01 A10 | Aberto (leitura) | `crm/api.ts:165` (`readOnly: true`) | Demonstração gravável na aba, como a Agenda | M |
| Toast do dono aparece na página pública | 01 A18 | Aberto (visto em `c6_corrigir.png`: "Perfil publicado.") | `network/NetworkHome.tsx:171` | Limpar avisos ao entrar no layout público | P |
| Aviso de saúde para o personal é só proibição | 01 A20 | Aberto (leitura) | `identity/CreateBusinessPage.tsx:169` | Texto e campo próprios: decisão de produto e jurídica | P |
| "Abrir política de cancelamento" cai no topo da Conta | 02 F11 | Aberto (leitura) | `setup/labels.ts:20` (link `/app/conta`) | Link com âncora | P |
| 404 global fora do shell | 02 F8 | Aberto (medido: sem menu, 1 link) | roteador | Baixo | P |
| A14 a A17, A19, A21 (01); F5, F7, F9, F10 (02) | 01, 02 | Não reconferidos um a um; código inalterado desde 04/11 | ver relatórios de origem | Baixos | P |

## 4. Auditorias de outubro

**Auditoria de UX e design de 27/10 (74 itens).** Todos marcados como feitos no documento. Conferi por amostra no código de hoje: Toast (`components/ui/feedback.tsx:47`), `IconButton`, `Segmented`, `ChipNav`, `ChoiceCard` (`components/ui/selection.tsx`), `FormPanel` (`sheet.tsx:147`), duas metas `theme-color` no `index.html`, "Faltou" no detalhe do atendimento, `DemoBanner` no `RouteFocus.tsx:67`, etapas da reserva pública (visíveis em `c6_corrigir.png`). As marcas "item N" aparecem para 46 itens distintos no código. Nada a refazer. O que voltou:

| Item | Situação hoje | Onde |
|---|---|---|
| 9 ("selecionado" com uma aparência só) | Regrediu no P44 | `setup/setup.css:19` |
| 1 e 7 (contraste nos dois temas) | Regrediu no P44 (mesmo ponto) | `setup/setup.css:19` |
| 59 (links de 44 px) | Regrediu em P45 e P46 | 12 alvos medidos |
| 3 (rótulo da aba legível) | "Mensagens" encurtado em 320 px | barra de abas |
| 60, 46, 39, 43 (feitos em parte) | Resolvidos nos PRs #91 e #92, ainda não integrados | seção 5 |
| E8 (termos) | Em parte: depende do texto final (issue #87) | `identity/LegalSheet.tsx` |
| 57 e E7 (um toque; senha de 10) | Feitos, à espera de confirmação do Felipe (issue #90) | `docs/handoffs/UX-ONDA3.md:180-205` |

**Acessibilidade (`docs/qa/acessibilidade.md`, 15 itens).** A11Y-01: corrigido nas 4 rotas originais, regrediu na Home (alto 9). A11Y-02, 03, 14: corrigidos. A11Y-04: em parte (foco depois de ações continua falhando em pontos novos: F3). A11Y-07 e A11Y-10: abertos. A11Y-08: resolvido, com o problema novo R-04. Os demais não reconferi.

**Auditoria da demonstração de 25/10.** Sem marcas de situação no documento. As duas lacunas do item 3 foram fechadas depois: reserva pelo link (P43) e "Minhas reservas" (ADR-0029). A segunda existe como tela, mas continua inalcançável na prática (alto 8).

**Handoff de QA de 18/10.** Dos 19 testes de UAT em `fixme`, restam 15 (`tests/e2e/qa/uat-*.spec.ts`: barbeiro 3, cabeleireira 5, cliente 3, personal 4). Os motivos em `helpers.ts:8-16` apontam para testes de integração com banco que cobrem a regra, não a tela. Na prática, nenhum roteiro de UAT roda de ponta a ponta na interface. O harness dos 40 casos do assistente: não conferi se roda no CI.

**Pendências jurídicas (`docs/legal/PENDENCIAS.md`).** Todas abertas (A1 a G); os rascunhos de política e termos ainda trazem "por definir" e estão marcados para não publicar. Decisão dos donos (achado 20 do JSON, issue #87).

## 5. O que os PRs abertos resolvem

| PR | Resolve | Não resolve | Observação |
|---|---|---|---|
| #91 `recado-88-sinal-operador` (8 arquivos, +195) | Item 60 da auditoria de UX: sinal `my_is_operator()` para esconder as telas da equipe no cliente | Nenhum dos achados de 04/11 | Merge sem conflito. Migration `20261103040000` é mais antiga que as duas últimas da `main` (`20261103134122`, `20261103150000`). pgTAP `31_my_is_operator` repete o número de `31_setup` |
| #92 `recado-89-contratos-onda3` (25 arquivos, +427) | Itens 46 (telefone em Orçamentos), 39 (`inbox.unread_count`) e 43 (`identity.request`) | Nenhum dos achados de 04/11. Não confundir `identity.request` (verificação do dono) com o vínculo do cliente (alto 8) | Merge sem conflito. Migrations `20261103050000` e `20261103051000`, também anteriores às da `main`. pgTAP `32` e `33` repetem `32_insights` |

Inferência (não testei): se a homologação já tiver as migrations de P44 e P45 aplicadas, o `supabase db push` recusa migrations com data anterior à última aplicada, a menos que se force. Recomendo renomear para depois de `20261103150000` e renumerar os pgTAP para 33, 34 e 35 antes de integrar.

## 6. O que está certo e deve ficar

- A idempotência no servidor e os três helpers por conteúdo que já existem.
- Os tokens `--tn-selected-*` e os 8 usos corretos.
- O contrato `setup.progress` e o port do módulo setup.
- A reserva pelo link com hold, código e limite por telefone.
- Os componentes criados pela auditoria de UX (Toast, IconButton, Field, Segmented, folha inferior).
- A regra "concluir não é receber".

## O que não foi coberto

- pgTAP, integração e concorrência não foram rodados nesta retomada. Os achados de banco se apoiam na leitura das migrations e, para os de reserva pelo link, na reprodução na demonstração.
- As medidas de tela são da primeira tentativa (10/11, mesmo commit); conferi por amostra, não refiz.
- Os 74 itens de UX e os 15 de acessibilidade não foram reconferidos um a um.
- Baixos da revisão de 04/11 marcados como "não reconferidos" na tabela.
- Servidor real, Safari do iPhone, leitor de tela, Worker da Cloudflare em produção e assistente com provedor ligado.
- Corpos dos PRs e das issues no GitHub (usei só o diff local).
