# 01 · Escopo do produto: simples demais ou exagerado

Auditoria de 10/11/2026 sobre a `main` em `8e113c4`. Somente leitura. Evidências em `arquivo:linha`, medidas no preview em demonstração (`http://127.0.0.1:4173`) e contagens em `auditoria-local/trabalho/escopo-produto/`.

## Resumo

**Veredito: misto. Exagerado na largura, raso em pontos básicos do núcleo.**

- O app mostra os **27 módulos a todo negócio**: 30 links no menu (2,5 telas de rolagem no celular) e 20 sub-abas. Não existe mecanismo de ativação por plano, profissão ou módulo.
- **10 módulos** formam o que o piloto precisa (48,9% das linhas por módulo). **6** são úteis logo depois. **7** são prematuros: seis dependem de integração ou portão externo que não existe (WhatsApp oficial, PSP, NFS-e, Google, moderação) e Domicílio vai além do "buffer manual de deslocamento" de `docs/00_PRODUTO.md`. **4** estão fora do público e do limite escritos em `docs/00_PRODUTO.md` e no `AGENTS.md` (equipe, estoque, contas a pagar, diretório).
- O ciclo que é a métrica do piloto (agendar → confirmar → atender → receber → retornar) tem cinco buracos: a Hoje não abre no atendimento do dia; concluir não leva a receber; não há aviso de confirmação ao cliente; a agenda recorrente do personal existe no servidor e não tem tela; "quem não volta" não aparece em Clientes.
- A única coisa que o plano (Grátis ou Completo de R$ 79) aplica é a franquia do assistente, igual nos dois. O texto dos planos promete diferenças que não existem.
- A engenharia do que existe é sólida e não deve ser apagada. A recomendação é **esconder por configuração, congelar a periferia e aprofundar o núcleo**. Toda proposta de esconder é decisão dos donos.
- Ponto de ligação no código: um campo novo em `ModuleDefinition` e um filtro em `buildNavigation` (`src/app/AppShell.tsx:102`). O servidor já tem plano por negócio (`service_plan_current`) e profissão (`tenants.profession`); falta levá-los ao contexto da sessão.

## 1. Os 27 módulos

Legenda. **Frequência** é estimativa a partir de `docs/00_PRODUTO.md` e do roteiro de `docs/qa/UAT-PILOTO.md` (não há telemetria no repositório). **Ponta a ponta** vem da leitura de `serverPort.ts`, handlers e migrations, não de execução contra servidor. **Linhas** e **operações** vêm de `custo.json` (tela, função, contrato, SQL e testes do módulo).

| # | Módulo (rótulo no menu) | O que entrega | Quem usa e quando | Ponta a ponta com servidor? | Classe | Profundidade | Linhas / operações |
|---|---|---|---|---|---|---|---|
| 1 | scheduling (Agenda, Horários) | Agenda dia e semana, novo agendamento, reagendar, cancelar, falta, bloqueios e horários | Todos, diária | Sim | Núcleo | Adequada, com dois buracos (série recorrente sem tela; sem aviso de confirmação) | 7.767 / 16 |
| 2 | crm (Clientes, Serviços) | Cadastro, ficha com histórico, catálogo de serviços, importação de planilha | Todos, diária | Sim | Núcleo | Adequada; falta retorno na lista | 4.506 / 7 |
| 3 | finance (Caixa) | Cobrança do atendimento concluído, recebimento manual por forma, despesas, pacotes de sessões | Todos, diária | Sim (registro manual) | Núcleo | Adequada; tela de 3.553 px | 3.706 / 14 |
| 4 | identity (Conta) | Login, negócio, onboarding, "Minhas reservas" do cliente | Todos, rara | Sim | Núcleo | Adequada | 4.363 / 5 |
| 5 | setup (Configuração) | Oito passos guiados, frase do negócio, modelos de serviço | Todos, primeira semana | Sim, com os defeitos 2, 3, 4 e 10 do consolidado de 04/11 | Núcleo | Adequada | 2.401 / 5 |
| 6 | network (Perfil) | Perfil público, reserva pelo link com código, convite de colega | Todos, semanal | Sim; o código depende do envio (defeitos 5 a 7 do consolidado) | Núcleo | Adequada | 7.146 / 14 |
| 7 | lifecycle (Relacionamento / Lembretes) | Réguas de confirmação, lembrete, orçamento parado e cobrança vencida; texto para compartilhar; reativação | Todos, diária se o lembrete é manual | Só o modo "para você compartilhar"; o automático depende do canal oficial | Núcleo (retorno) | Funda na configuração, rasa na entrega (fora do fluxo da agenda) | 2.787 / 9 |
| 8 | pricing (Preços) | Simulador de margem, regras de oferta por horário, aprovação e publicação | Barbeiro e cabeleireira, mensal | Sim | Núcleo do contrato do piloto; mostrar por ativação | Funda para o primeiro dia (2.387 px) | 2.093 / 6 |
| 9 | waitlist (Lista de espera) | Fila por serviço e faixa, oferta a uma pessoa por vez por link | Beleza, semanal ou rara | Sim; o envio é manual | Núcleo do contrato do piloto; mostrar por ativação | Adequada | 2.603 / 11 |
| 10 | agent (Assistente) | Perguntas sobre agenda e caixa, propostas com aprovação | Todos, semanal | Sim por regras; a camada de linguagem (P46) depende de chave e termos | Núcleo do contrato do piloto | Adequada | 3.518 / 4 |
| 11 | growth-advice (Metas e sugestões) | Sugestões diárias por regra, metas, conteúdo por profissão | Semanal, depois de semanas de dados | Sim | Útil logo depois | Funda demais (4.530 px; maior SQL de todos, 1.716 linhas) | 4.401 / 12 |
| 12 | analytics (Resultado) | Indicadores com conta visível e ponto de partida | Mensal | Sim | Útil logo depois | Adequada | 1.673 / 4 |
| 13 | service-ops (Plano e serviços) | Plano Grátis e Completo, serviços assistidos, registro de acesso da equipe Tinindo | Rara | Sim; não cobra | Útil logo depois | Adequada, mas o plano não libera nada | 3.112 / 16 |
| 14 | referrals (Indicações) | Acompanha convites de colega e benefício em franquia | Rara | Sim | Útil logo depois | Rasa, suficiente | 1.170 / 2 |
| 15 | recurrence (Assinaturas) | Plano mensal do profissional: cada ciclo abre pacote e cobrança | Personal, mensal | Sim; cobrança manual no Caixa; ciclo depende do agendador de jobs | Útil logo depois (personal) | Adequada | 1.880 / 7 |
| 16 | sales (Orçamentos) | Orçamento versionado aceito por link | Rara; barbeiro quase nunca | Sim; o dono compartilha o link | Útil logo depois | Adequada | 2.994 / 9 |
| 17 | messaging (Mensagens) | Caixa de entrada do canal oficial, estados de entrega, modelos, humano assume | Nunca no piloto | **Não**: exige WhatsApp Cloud API por negócio | Prematuro | Funda | 3.661 / 12 |
| 18 | payments (Pagamentos) | Cobrança Pix por link, estorno, conferência com extrato | Nunca no piloto | **Não**: PSP real é esqueleto | Prematuro | Funda | 3.163 / 8 |
| 19 | fiscal (Notas fiscais) | NFS-e para MEI por provedor, pasta do contador | Nunca no piloto | **Não**: provedor homologado e credencial do profissional | Prematuro | Funda | 2.221 / 7 |
| 20 | presence (Site e Google) | Site padronizado, domínio próprio, Perfil da Empresa no Google | Rara | Parcial: o site sai do perfil; domínio e Google dependem de DNS e conta Google | Prematuro (serviço assistido) | Funda | 2.750 / 11 |
| 21 | campaigns (Campanhas) | Segmento, público com consentimento, grupo de controle, resultado por braço | Nunca no piloto | Depende do canal para enviar | Prematuro | Funda demais para 40 a 200 atendimentos por mês | 1.766 / 5 |
| 22 | reputation (Avaliações) | Avaliação com vínculo verificado, resposta, denúncia | Rara | Depende do vínculo do cliente (item 8 do consolidado: inalcançável) e de moderação humana | Prematuro | Adequada | 1.889 / 7 |
| 23 | field-service (Domicílio) | Zonas por bairro e CEP, deslocamento que ocupa a agenda, roteiro do dia | Personal a domicílio, rara | Sim | Prematuro (docs/00 fala em "buffer manual de deslocamento") | Funda | 2.178 / 9 |
| 24 | discovery (Diretório) | Opt-in do dono e busca pública por cidade e categoria | Nunca no piloto | Sim, mas sem densidade nem moderação | Fora do objetivo declarado ("marketplace amplo") | Rasa | 1.407 / 4 |
| 25 | resources (Equipe) | Profissionais, salas, cadeiras, turmas, comissões | Nunca no piloto (atendimento individual) | Sim | Fora do público do piloto | Funda | 3.228 / 15 |
| 26 | materials (Materiais) | Estoque com custo médio, compras, ficha de uso, margem real | Nunca no piloto | Sim | Fora do objetivo declarado ("ERP") | Funda | 2.455 / 12 |
| 27 | finance-advanced (Contas) | Contas a pagar, demonstrativo do mês, conferência | Rara | Sim | Fora do objetivo declarado ("ERP") | Funda | 2.741 / 13 |

Base da classificação:

- `AGENTS.md:5`: "agenda, clientes, preço, retorno e recebimentos... Não construir ERP completo, marketplace amplo".
- `docs/00_PRODUTO.md:23`: "atendimento individual, pagamentos majoritariamente fora do aplicativo, comunicação pelo WhatsApp... Evitar inicialmente salões com múltiplas cadeiras/assistentes simultâneos, turmas de treino".
- `docs/00_PRODUTO.md:43`: operacional de verdade no piloto = login, serviços e clientes, disponibilidade, reserva, preço congelado, ofertas por regras aprovadas, lista de espera, créditos de sessões, recebido e a receber, perfil, convite, assistente.
- `docs/00_PRODUTO.md:49` ("Depois"): WhatsApp integrado por negócio, campanhas em escala, cobrança Pix por PSP, NFSe, Google Business, marketplace de busca, múltiplos recursos, produtos e estoque.
- O roteiro do UAT (`docs/qa/UAT-PILOTO.md:32-56`) usa 10 dos 27 módulos.

A onda que trouxe fiscal, site, diretório e avaliações foi aprovada pelo dono (`docs/plano-onda-3.md:3`), com a ressalva de que "liberar código não é liberar operação real". O código existir é decisão tomada. O que não foi decidido é o que o participante do piloto vê.

## 2. Onde o núcleo está raso

### 2.1 A Hoje não abre no atendimento do dia (achado 02)

Medida em 390×844 (`home2.cjs`): cartão de configuração em y=168, "Para você esta semana" em y=437, ações rápidas em y=970, "Atendimentos de hoje" em y=1107, próximo atendimento em y=1137. A tela tem 844 px. A primeira tela mostra configuração e três sugestões (`home-viewport-m.png`). Ordem no código: `src/app/pages/Home.tsx:146` (SetupCard), `:148` (InsightsCard), resumo e lista só a partir de `:152`.

### 2.2 Concluir não leva a receber (achado 03)

`src/features/scheduling/attendance.tsx:55`: "Atendimento concluído. O pagamento não foi registrado: cobre e registre o recebimento no Caixa quando receber." `BookingDetailPage.tsx:288-292`: o caminho é um link para `/app/caixa`, sem o atendimento. O atalho "Recebi R$ 60,00 no Pix" só existe em `src/features/finance/FinancePage.tsx:385-397`. São quatro toques, duas telas e uma busca visual numa página de 3.553 px para a ação mais frequente do ciclo. A regra "concluir não é receber" é correta no servidor; a tela é que não acompanha.

### 2.3 A agenda recorrente do personal não tem tela (achado 04)

O servidor tem `booking.create_series` (`supabase/functions/scheduling/handler.ts:60-61`, `supabase/migrations/20261018130000_p03_scheduling.sql:482`, contrato em `_shared/contracts/scheduling.ts:111`). Nenhuma tela chama: a busca por `series|createSeries|create_series` em `src/features` só encontra as contas mensais de `finance-advanced`. O passo 2 do personal no UAT (`docs/qa/UAT-PILOTO.md:53`) não é executável. O módulo Assinaturas não agenda (`RecurrencePage.tsx:1-3`).

### 2.4 Confirmação e lembrete fora do fluxo (achado 05)

O único link de WhatsApp com texto pronto na agenda aparece depois de cancelar (`BookingDetailPage.tsx:389` e `:410-414`). Criar um agendamento não oferece avisar o cliente (`BookingFlowPage.tsx` não tem `wa.me` nem compartilhar). Os textos de confirmação e lembrete vivem em Relacionamento como "Para você compartilhar" (`lifecycle/labels.ts:16`), numa página de 3.310 px sob Clientes > Lembretes, e a Hoje não avisa que há lembrete a mandar (`Home.tsx` não lê o lifecycle). Sem canal oficial, o envio manual é o único caminho real do piloto.

### 2.5 Retorno não está em Clientes (achado 11)

`CustomersPage.tsx` não ordena nem filtra por última visita. A data só aparece em `LifecyclePage.tsx:201-211`, dentro de "Reativação (campanha)", restrita a quem deu consentimento de marketing. O dado existe no servidor (`supabase/migrations/20261022140000_p13_lifecycle.sql:690-695`).

### 2.6 Contraste com a periferia

Enquanto isso: Campanhas tem grupo de controle sorteado e resultado por braço com intervalo; Materiais tem custo médio e estorno exato; Equipe tem reserva composta, turmas e comissão congelada; Pagamentos tem conferência com extrato; Fiscal tem representação, credencial e pasta do contador. Tudo com contrato, pgTAP, concorrência e e2e. A profundidade foi para onde o piloto não vai usar.

## 3. Proposta de produto do piloto

Tudo por configuração, sem apagar código. Decisão dos donos.

### Primeiro dia (um barbeiro abre o app)

| Lugar | O que aparece |
|---|---|
| Hoje | Próximo atendimento com Atendido, Faltou e WhatsApp; lista do dia; pendências (a cobrar, lembretes a mandar); uma linha de configuração enquanto incompleta |
| Agenda | Agenda (dia e semana), Horários |
| Clientes | Clientes, Serviços, Lembretes |
| Dinheiro | Caixa, sem sub-abas |
| Quinta aba (decisão) | Recomendo "Retorno": lembretes a mandar, quem não volta há X dias |
| Menu | Assistente, Perfil e link, Configuração, Conta |

São 10 módulos: scheduling, crm, finance, identity, setup, network, lifecycle, agent, mais pricing e waitlist escondidos até a ativação.

### Depois (por ativação, plano ou profissão)

| Módulo | Quando aparece |
|---|---|
| Preços e ofertas | Barbeiro e cabeleireira, depois de concluir a configuração, ou quando houver horário vazio recorrente |
| Lista de espera | Depois do primeiro cancelamento, ou por pedido |
| Assinaturas | Personal, quando vender o primeiro pacote |
| Repetição semanal na agenda | Em destaque para personal; disponível para todos |
| Orçamentos | Por pedido |
| Metas e sugestões, Resultado | Depois de quatro semanas de dados |
| Indicações, Plano e serviços | Quando a cobrança do plano começar |

### Guardado (código e testes ficam; não aparece)

Mensagens, Pagamentos, Notas fiscais, Site e Google, Campanhas, Avaliações, Domicílio, Diretório, Equipe, Materiais, Contas. Cada um volta quando o seu portão for cumprido, por negócio.

### Onde isso se liga no código

O que existe hoje:

- **Nada de ativação por módulo.** `src/app/module-types.ts:4-13` não tem campo de visibilidade; `src/app/router.tsx:49` e `src/app/AppShell.tsx:102` usam `MODULES` inteiro. A busca por `entitlement|featureFlag|enabledModules|module_enabled|isEnabled` em `src` e `supabase` não encontra nada. O teste `src/app/AppShell.test.tsx:65-69` exige que todo módulo esteja no menu.
- **Plano por negócio existe, mas só aplica a franquia do assistente.** `supabase/migrations/20261018190000_p15_service_ops.sql:99-106` publica Grátis e Completo com escopo em texto livre e a mesma franquia (200). `:369-375` (`app.svc_apply_plan`) grava só `agent_quotas.monthly_limit`. `service_plan_current` (mesmo arquivo, a partir de `:381`) devolve o plano do negócio.
- **Profissão existe, mas a sessão não a conhece.** `supabase/migrations/20261017120000_foundation.sql:56` (`tenants.profession`); `src/app/session.tsx:7-11` só carrega `tenant_id`, `tenant_name` e `role`.
- **Papel** `owner | staff` existe na sessão (`session.tsx:10`) e as telas de operador ficam fora do menu por decisão do banco (`analytics/module.tsx`, `service-ops/module.tsx`).

O que falta, em ordem:

1. Campo de nível em `ModuleDefinition` e função `visibleModules(MODULES, contexto)` usada por `buildNavigation`. Rotas continuam registradas. (Achado 01, esforço M.)
2. `profession` no contrato de contexto e na sessão. (Achado 13, M.)
3. Capacidades do plano legíveis por máquina em `offering_versions`, devolvidas por `service_plan_current`, com recusa no servidor nos módulos pagos. (Achado 09, G.)
4. Ativação por negócio para os guardados (tabela nova ou coluna em configuração do negócio), escrita só por operador.

Os passos 1 e 2 bastam para o piloto. O passo 1 sozinho, com a lista fixa no código, resolve as três sessões do P42.

## 4. Custo de carregar os 27 módulos

Contagem de `custo.cjs` (linhas de tela, função, contrato, SQL, pgTAP, concorrência, integração, e2e e testes de contrato atribuídas a cada módulo). Conferida por amostra: scheduling 4.062 linhas de tela, fiscal 681, migration do fiscal 626, 38 migrations.

| Classe | Módulos | Linhas | % | Operações | Comandos de escrita | Linhas de tela | Linhas de SQL |
|---|---:|---:|---:|---:|---:|---:|---:|
| Núcleo do piloto | 10 | 40.890 | 48,9 | 91 | 59 | 15.716 | 8.432 |
| Útil logo depois | 6 | 15.230 | 18,2 | 50 | 29 | 5.150 | 4.601 |
| Prematuro (integração ou portão externo) | 7 | 17.628 | 21,1 | 59 | 37 | 5.816 | 4.605 |
| Fora do objetivo declarado | 4 | 9.831 | 11,8 | 44 | 27 | 3.179 | 3.134 |
| **Total** | **27** | **83.579** | 100 | **244** | **152** | 29.861 | 20.772 |

Leitura:

- Um terço do código por módulo (27.459 linhas, 103 operações, 64 comandos de escrita) serve 11 módulos que o piloto não usa.
- Cada comando de escrita é superfície de segurança: RLS, idempotência e concorrência precisam continuar valendo. O consolidado de 04/11 achou o defeito de idempotência (item 1) justamente em Materiais, Contas e Assinaturas, além do Caixa.
- Cada módulo tem a sua Edge Function (29 pastas em `supabase/functions`), o seu pgTAP, o seu script de concorrência e a sua pasta de e2e. Toda mudança transversal (o hook único de idempotência, a troca de um componente de formulário, um token de cor) custa 27 vezes.
- O valor para o piloto dos 11 guardados é zero nas primeiras semanas; o valor futuro é preservado por não apagar.

Recomendação (achado 10): congelar os guardados; no CI, rodar e2e, concorrência e integração de um módulo guardado só quando o caminho dele ou os contratos compartilhados mudarem, mantendo pgTAP e contratos sempre; publicar na homologação só as funções dos módulos visíveis ou ativáveis.

## 5. Risco de promessa

O que parece funcionar e é simulação ou depende do que não existe:

| Tela | O que o profissional vê | O que há por trás | Evidência |
|---|---|---|---|
| Mensagens (aba fixa) | "Conecte o número do seu negócio", provedor "Simulado (sem envio real)" ou "WhatsApp (API oficial)" | O oficial exige token e segredo no ambiente; por negócio está em "Depois" | `InboxPage.tsx:16`, `:42-43`; `messaging/index.ts:37-39`; `shots/mensagens__m-light.png` |
| Pagamentos | "Como receber": "Recebimento simulado (demonstração)" ou "Pix de verdade (pelo banco)", com o simulado como padrão | PSP real é esqueleto | `PaymentsPage.tsx:24`, `:61-63`; `payments/providers.ts:4`, `:129` |
| Notas fiscais | Fluxo completo de emissão | Sem provedor configurado, a homologação usa o simulado | `fiscal/index.ts:25`; `FiscalPage.tsx:312` |
| Site e Google | Domínio próprio e Perfil da Empresa | DNS real e conta Google do cliente | `docs/plano-onda-3.md` (coluna "Gate externo") |
| Diretório | Busca pública em `/diretorio` | Sem oferta local nem moderação | `discovery/module.tsx:43-45` |
| Avaliações | Painel de avaliações | O cliente não consegue chegar a "Avaliar" (item 8 do consolidado) | `docs/qa/revisao-2026-11-04/00-CONSOLIDADO.md` |
| Campanhas | Público, teto, grupo de controle | O envio é pelo canal | `CampaignsPage.tsx:1-3` |
| Plano e serviços | Grátis "não inclui emissão fiscal"; Completo "inclui ofertas e recuperação de agenda" | Nada é aplicado; os dois têm 200 perguntas | `p15_service_ops.sql:99-106`, `:369-375`; `shots/servicos-tinindo__m-light.png` |
| Relacionamento | "Lembretes" | Sem canal, o passo fica "para você compartilhar"; não sai sozinho | `lifecycle/labels.ts:15-16` |

O que está certo: os botões de simulação (rodar o despacho, rodar a régua, consultar o banco) só existem na porta de demonstração; as portas de servidor de payments, lifecycle e messaging não os expõem. Os estados são escritos por palavra e não fingem entrega. O risco não é a tela mentir sobre um envio; é o menu inteiro sugerir um produto que o piloto não entrega.

Não conferido: se o servidor recusa o provedor simulado em produção ao criar cobrança ou conectar número.

## 6. O que manter intacto

- O registro de módulos e a navegação em um arquivo (`modules.ts`, `navigation.ts`).
- O padrão porta de demonstração + porta de servidor.
- A separação concluir / cobrar / receber no servidor.
- O atalho "Recebi R$ X no Pix" do Caixa (reaproveitar na tela do atendimento).
- Os rótulos de estado por palavra.
- As cinco abas e as sub-abas por contexto como estrutura.
- Todos os 27 módulos no repositório, com os seus testes.

## 7. Achados

Os 15 achados, com evidência e recomendação, estão em `achados/escopo-produto.json`.

| Id | Gravidade | Tipo | Título curto | Decisão dos donos? |
|---|---|---|---|---|
| 01 | alta | esconder | 27 módulos visíveis a todos, sem ativação | sim |
| 02 | alta | reforçar | Hoje não abre no atendimento do dia | não |
| 03 | alta | reforçar | Concluir não leva a receber | não |
| 04 | alta | reforçar | Recorrência do personal sem tela | não |
| 05 | alta | reforçar | Confirmação e lembrete fora do fluxo | não |
| 06 | alta | esconder | Mensagens ocupa aba fixa e só roda simulado | sim |
| 07 | alta | esconder | Sete módulos dependem de integração inexistente | sim |
| 08 | média | decisão | Equipe, Materiais, Contas e Diretório contrariam docs/00 | sim |
| 09 | média | defeito | Plano promete diferença que nada aplica | sim |
| 10 | média | simplificar | Metade do código fora do núcleo; congelar | sim |
| 11 | média | reforçar | Retorno não está em Clientes | não |
| 12 | média | simplificar | Dinheiro com cinco sub-abas | sim |
| 13 | média | refatorar | Profissão não chega à sessão nem ao menu | não |
| 14 | média | decisão | Critério do UAT não é aplicável com tudo aberto | sim |
| 15 | baixa | simplificar | Metas e sugestões funda demais e no topo da Hoje | não |

Relação com a revisão de 04/11: os itens 1 (idempotência), 2, 3, 4 e 10 (configuração), 5 a 7 (link público) e 8 (vínculo do cliente) do consolidado continuam abertos e pesam sobre módulos do núcleo; não foram redescritos aqui. O item 1 atinge três módulos que esta auditoria propõe guardar, o que reduz a urgência dele nesses três, mas não no Caixa.

## 8. Decisões para os donos

1. **Escopo visível do piloto.** (a) 10 módulos no primeiro dia, 6 por ativação, 11 guardados; (b) esconder só os 7 que dependem de integração; (c) manter os 27. Recomendo (a).
2. **Quinta aba.** (a) Assistente; (b) "Retorno"; (c) quatro abas. Recomendo (b); Mensagens volta com o canal oficial contratado por negócio.
3. **O que cada plano libera.** (a) aplicar a direção de `docs/00_PRODUTO.md:57`; (b) piloto sem distinção e texto do plano corrigido. Recomendo (b) no piloto e (a) antes de cobrar.
4. **Equipe, Materiais, Contas e Diretório.** Guardar até F4/F5, ativar por perfil, ou manter. Recomendo guardar no piloto.
5. **Congelamento.** Nenhuma função nova em módulo guardado; as próximas duas semanas vão para os achados 02 a 05 e 11.

## O que não foi coberto

- Nenhum fluxo foi executado contra servidor. "Ponta a ponta com servidor" na tabela vem da leitura do código.
- Vi que o servidor marca o lembrete como "manual" (`p13_lifecycle.sql:321-322`), mas não li a condição completa nem executei a régua com servidor; o achado 05 fica com confiança média.
- Não conferi se o servidor recusa o provedor simulado em produção.
- `docs/15_RECONCILIACAO_GABRIEL.md`, `docs/plano-assistente-configuracao-e-insights.md` e os handoffs foram consultados por busca, não lidos inteiros (orçamento curto).
- Da galeria, abri quatro capturas (Hoje, menu, Mensagens, Plano e serviços) e usei as alturas de `shots/index.json` para as demais.
- Frequência por persona é estimativa; não há telemetria do piloto de 28/10 no repositório.
- O custo do CI em minutos por módulo não foi medido.
- Qualidade interna das telas periféricas ficou com os auditores de design e de código.
