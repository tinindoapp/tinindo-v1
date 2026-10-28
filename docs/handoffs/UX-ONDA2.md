# Handoff · UX onda 2 (auditoria de 27/10/2026)

Pedido do Felipe em 27/10: implementar a onda 2 de `docs/qa/AUDITORIA-UX-DESIGN-2026-10-27.md`, em dois blocos, um PR por bloco para a `main`, com merge feito pela sessão depois do CI verde. Só frontend e testes.

- **Bloco 1:** padrões do sistema, itens 5 a 15 e 17.
- **Bloco 2:** fluxos de impacto A, itens 24, 25, 27, 35, 36, 37, 47, E1, E4 e E5.

Na auditoria, ✓ ao lado do número marca o item feito.

## Coordenação

- **Sem `claim` no `coord.py`.** Não existe pacote de UX no quadro. O P42 (piloto) está reservado pelo Gabriel (`gabriel-p42-ux`). O trabalho veio por pedido direto do Felipe, como na onda 1, e não toca em migrations, contratos nem Edge Functions.
- **Branch:** `claude/dazzling-gates-ucc4sn`. No bloco 2 ela é recriada a partir da `main` depois do merge do bloco 1.
- **Frentes paralelas no bloco 1.** Os componentes ficaram prontos primeiro (b75ca31). Depois quatro frentes aplicaram os padrões nas telas, cada uma em arquivos separados:
  - Agenda: agenda, lista de espera, preços e páginas.
  - Clientes: clientes, mensagens, orçamentos, avaliações e relacionamento.
  - Dinheiro: caixa, pagamentos, assinaturas, notas, resultado, assistente, metas, campanhas e indicações.
  - Público: perfil, conta, diretório, site e Google, plano e serviços.
  
  As quatro foram mescladas na branch sem conflito.

## Aviso para quem cria telas novas

A regra de CSS do CI (`src/app/css-system.test.ts`) vale para todo módulo novo. Por isso:

- **CSS:** use os papéis `--tn-text-*`, sem `font: inherit` e com o hover dentro de `@media (hover: hover)`.
- **Classes de layout:** use `.tn-muted`, `.tn-actions` e `.tn-stack`, sem criar `-muted`, `-actions` ou `-stack` próprios.
- **Componentes:** use `Field`, `toast` e `ConfirmAction` de `src/components/ui`.

Equipe (P28) e Materiais (P30) entraram na `main` durante o bloco 1 e foram ajustados neste PR.

## Bloco 1 · padrões do sistema

### Componentes novos em `src/components/ui`

| Arquivo | O que faz | Itens |
|---|---|---|
| `feedback.tsx` | `toast()` e `<Toaster/>`: um aviso por vez, fixo acima da barra de abas e da área segura do iPhone, `role="status"`, 5 s (6 s com ação), pausa com ponteiro ou foco, botão "Desfazer" e "Fechar aviso". `<ConfirmAction>`: confirmação no lugar do botão, com pergunta, consequência e botão `danger` "Sim, …"; foca a pergunta e "Voltar" devolve o foco | 5, 6 |
| `IconButton.tsx` | Botão só de ícone, 44 × 44 (40 dentro de avisos), nome acessível obrigatório | 17 |
| `form.tsx` | `<Field as="input\|select\|textarea" hint error>` liga rótulo, dica e erro (`aria-describedby`, `aria-invalid`). `useFormErrors()` grava os erros no envio e foca o primeiro campo com erro | 12, 15 |
| `selection.tsx` | `Segmented` (rádios), `ChipNav` (links com `aria-current`) e `ChoiceCard` (cartão com ✓; aceita `invalid` para o erro de grupo) | 9 |
| `tone.tsx` | Ícone diferente por tom: i, ✓, ! no triângulo, × | 7 |
| `index.tsx` | `Button` com `variant="danger"`, `loading` (spinner e `aria-busy`) e `loadingText` | 11 |

Também entrou no sistema de ícones a seta `voltar`.

### Tokens e CSS

- **Papéis de texto (item 10):** `--tn-text-title`, `section`, `group`, `body`, `support`, `label`, `number` e `number-lg` em `src/styles/global.css`. Todo `font-size` do app usa um desses papéis. `strong` tem peso 600.
- **Selecionado (item 9):** `--tn-selected-bg`, `-text`, `-border` e `-weight`.
- **Desabilitado (item 17):** `--tn-opacity-disabled`.
- **Perigo:** `--tn-danger-action`.
- **Tokens da marca:** nenhum valor novo de cor. Os tokens novos apontam para os de `brand/tokens`, e `brand/` não foi alterado.
- **Fonte dos controles (item 13):** um `font: inherit` global para controles. Os 20 que estavam nos módulos saíram. `tabular-nums` vem depois, em `.tn-num`, `time` e campos numéricos.
- **Hover e toque (item 14):** todo `:hover` está dentro de `@media (hover: hover)`. Há um `:active` comum para linhas, cartões-link, abas, chips e botões de ícone.
- **Avisos (item 7):** fundo `color-mix` do tom com a superfície (no tema escuro deixa de ser igual ao cartão) e barra de 4 px na cor do tom.
- **Utilitários (item 8):** `.tn-muted`, `.tn-stack`, `.tn-actions`, `.tn-form-grid` e `.tn-item-list` em `ui.css`. As classes `-muted`, `-actions` e `-stack` dos 22 módulos foram trocadas por eles.

### Regra de CSS no CI

Faz o papel do stylelint, sem dependência nova: `src/app/css-system.test.ts` falha quando um módulo tem:

- `font-size` fora dos papéis `--tn-text-*`;
- peso numérico;
- `font: inherit`;
- `:hover` fora de `@media (hover: hover)`;
- classe própria `-muted`, `-actions` ou `-stack`.

O `css-tokens.test.ts` ficou sem a lista de pendências: as duas reservas `var(--tn-x, valor)` que restavam foram corrigidas.

### Nas telas

- **Toast (item 5):** toda confirmação de sucesso saiu do topo da tela e virou Toast.
  - Erro de ação de um toque numa linha vira Toast de erro.
  - Ficam na tela: erro de formulário (perto do formulário), erro de carregamento e o que a pessoa precisa ler ou copiar (link gerado, código, Pix, relatório de importação).
- **Campos (itens 12 e 15):** todos os campos usam `Field`, e os wrappers próprios dos módulos foram removidos (`SelectField`, `FieldBox`, `.tn-*-field`).
  - O botão de enviar fica sempre ativo e só desliga enquanto envia (`loading`).
  - Continuam desligados: `readOnly` da demonstração do CRM e as regras de negócio. Exemplos: mensagem fora da janela de 24 h, modelo não aprovado, campanha sem público.
- **Cabeçalho (item 10):** as telas "Selecione um negócio" e as que abriam com cartão e `<h1>` usam `PageHeader`.
- **Seleção (item 9):**
  - Viraram `Segmented`: Dia/Semana da Agenda e nota de 1 a 5 em /avaliar.
  - Viraram `ChoiceCard`: serviço no novo agendamento, profissão e objetivo no onboarding.
  - O `crm-tabs`, que era CSS sem uso, saiu.
- **Botões de ícone (item 17):** ‹ e › da Agenda, do novo agendamento e do Caixa, e o fechar do menu, são `IconButton`.

### Ações destrutivas (item 6)

**Regra:** quando o port já tem a operação inversa e a ação não mandou mensagem, não mexeu em dinheiro nem invalidou um link de terceiro, ela executa na hora e o Toast oferece **Desfazer**. Nos outros casos, **ConfirmAction** com o verbo e a consequência concreta.

| Tela | Ação | Padrão |
|---|---|---|
| Clientes | Arquivar | Desfazer |
| Serviços | Arquivar e reativar | Desfazer nos dois sentidos |
| Horários | Remover bloqueio | Desfazer (recria o mesmo bloqueio) |
| Mensagens | Desvincular contato do cadastro | Desfazer |
| Mensagens | Desconectar número | Confirmar (diz o número e quantas mensagens ficam na fila) |
| Preços | Desativar regra | Confirmar (não há reativar: precisa de proposta nova) |
| Lista de espera | Retirar oferta, tirar da lista, "Não quero" (página pública) | Confirmar |
| Orçamentos | Cancelar, gerar novo link | Confirmar (o link do cliente para de funcionar) |
| Avaliações | Denunciar, retirar avaliação | Confirmar |
| Relacionamento | Cancelar passo, revogar consentimento | Confirmar (consentimento nunca volta por "Desfazer") |
| Caixa | Estornar recebimento, despesa e sessão de pacote; cancelar cobrança | Confirmar, com motivo quando o contrato guarda |
| Pagamentos | Estornar tudo, cancelar cobrança | Confirmar |
| Assinaturas | Cancelar no fim do ciclo | Desfazer (`resume`) |
| Assinaturas | Cancelar agora | Confirmar |
| Notas | Revogar autorização | Confirmar (é consentimento) |
| Notas | Cancelar nota | Confirmar (motivo com 15 letras ou mais) |
| Campanhas | Cancelar | Confirmar |
| Metas | Arquivar meta | Confirmar (não há desarquivar) |
| Metas | Remover apresentação do perfil | Desfazer (publica o mesmo texto) |
| Perfil | Tirar do ar | Desfazer (publica de novo com o mesmo endereço e campos) |
| Site | Tirar do ar | Desfazer (`restore` da mesma versão) |
| Site | Desligar domínio | Confirmar |
| Diretório | Sair (desmarcar e salvar) | Desfazer |
| Conta | Desvincular | Confirmar |
| Google e Plano e serviços | Revogar acesso; cancelar pedido | Confirmar |
| Equipe (P28, chegou na `main` durante o bloco) | Remover comissão por serviço, liberar vaga de turma | Desfazer (grava o mesmo percentual; inscreve a mesma cliente) |
| Equipe | Cancelar reserva, cancelar turma, estornar comissão | Confirmar |
| Materiais (P30, chegou na `main` durante o bloco) | Tirar item da ficha de uso | Desfazer (grava a mesma quantidade) |
| Materiais | Estornar uso, estornar compra | Confirmar |
| Agenda | Cancelar atendimento | Botão final `danger` e Toast. O fluxo é refeito no item 27 (bloco 2) |

### Decisões

- **Erro sem asterisco.** O campo obrigatório não tem marca visual: o `required` nativo e o erro no envio bastam. O asterisco quebrava os rótulos que os testes leem.
- **Erro sem `role="alert"`.** O erro do campo é lido pelo `aria-describedby` quando o foco chega nele. Com `role="alert"`, todos os erros seriam anunciados de uma vez.
- **Toast que não bloqueia o toque.** No celular, o Toast fica 5 a 6 s acima da barra de abas e pode ficar por cima do botão logo acima dela. O corpo do aviso deixa o toque atravessar para o que está embaixo; só "Desfazer" e "Fechar aviso" recebem toque. O e2e `foundation/toast.spec.ts` confere isso. O problema apareceu no CI: o aviso cobria "Cobrar no Caixa".
- **Aviso depois de mudar de tela.** No novo agendamento e no reagendar, o Toast sai depois que a tela do atendimento carrega. Voltar no histórico para essa entrada pode mostrar o aviso de novo.
- **Segmented com 44 px.** A opção tem 44 px e o rádio fica por cima, então o toque e o `check()` do Playwright caem no rádio.

### Testes do bloco 1

- **Unitários.** Os componentes são cobertos por `src/components/ui/ui.test.tsx`. Por tela, os testes cobrem três coisas: Desfazer chama a operação inversa, ConfirmAction não executa sem o "Sim" e o foco vai para o primeiro erro. Arquivos novos:
  - Caixa, Pagamentos, Assinaturas, Metas;
  - Orçamentos, Mensagens, Avaliações;
  - Espera, Preços, Entrar;
  - Diretório, Site, Plano e serviços.
- **e2e.** `tests/e2e/foundation/padroes.spec.ts` percorre todas as telas do menu e /entrar, /criar-conta e /diretorio. Roda em 375 px nos temas claro e escuro, e no desktop. Confere:
  - sem rolagem horizontal;
  - nenhuma fonte menor que 12 px;
  - todo botão com nome acessível;
  - botão de ícone com 40 px ou mais.
- **Specs ajustadas,** porque a ação agora pede confirmação ou o botão deixou de ficar desligado: caixa, pagamentos, assinaturas, notas, campanhas, orçamentos, avaliações, site, serviços, agenda e uma linha de `qa/jornada-integrada`.
- **Resultado local:**

  | Comando | Resultado |
  |---|---|
  | `npm run lint` | ok |
  | `npm run typecheck` | ok |
  | `npm run test:unit` | 499 passaram |
  | `npm run test:e2e` | desktop e mobile, 0 falhas; os 33 pulados são os `fixme` que já existiam |

  Na suíte completa com a máquina carregada, os testes da agenda e o novo de Orçamentos falharam uma vez por timeout de 1 s e passaram de novo isolados. Vale observar no CI.

### Para o bloco 2 e a onda 3

- **Fica para o E4:** os horários do perfil público e os horários livres do novo agendamento ainda são botões com `aria-pressed`. Usam os tokens de selecionado, mas não um componente.
- **Fica para a onda 3:**
  - item 18: Chip para dias da semana;
  - `share.tsx`, que está duplicado em vendas e relacionamento;
  - o `ActButton` local de Notas, Metas e Campanhas, que pode virar um botão compartilhado de ação assíncrona.

Bloco 1 entrou na `main` pelo PR #62 (merge f9c27ad), com o CI verde.

## Bloco 2 · fluxos de impacto A

Mesmo modo de trabalho do bloco 1. A base foi `wip/onda2-b2`, com a `main` depois do #62. Fiz o E1 e o 47. Três frentes paralelas fizeram 24, 25 e 27 (Agenda), 35, 36 e 37 (Clientes e Mensagens) e E4 e E5 (perfil público). Nada em `supabase/`: as operações novas do frontend chamam rotas que já existem no servidor e no contrato.

### E1 · Prévia do link no WhatsApp

- `worker/og.ts` e `worker/index.ts`: o Worker que serve o frontend passa a rodar código só em `/p/*` e `/s/*` (`run_worker_first` em `wrangler.jsonc` e `wrangler.homolog.jsonc`). Nessas rotas, troca o bloco de tags padrão do `index.html` (entre `og:start` e `og:end`) pelas tags do perfil (`network/public.profile`) ou do site publicado (`presence.public_site`). Só entram os campos que o dono publicou.
- Configuração: a URL do Supabase e a chave pública vêm de `dist/og-config.json`, que o build gera (plugin em `vite.config.ts`). São as mesmas que já vão no bundle, então não há configuração nova no painel da Cloudflare.
- Falha aberta: sem Supabase (demonstração), com o perfil fora do ar, com erro ou com mais de 1,5 s de espera, o Worker devolve o app com a prévia genérica. Cache de 5 min.
- Testes: `worker/og.test.ts` com 7 casos. Também conferido com `wrangler deploy --dry-run` e `wrangler dev`.
- **Atenção no deploy:** é o primeiro código de servidor no Worker do frontend. Se a prévia falhar em produção, o comportamento volta ao do SPA sozinho. Para desligar de vez, basta tirar `main` e `run_worker_first` do `wrangler.jsonc`.

### 47 · Base de exemplo única

- **Dados:** `src/lib/demo/dataset.ts` guarda o histórico de 21/09 a 22/10: atendimentos em todos os estados, recebimentos, despesas, valores em aberto e o funil (lembretes, orçamentos, ofertas). A semana de 19/10 é a mesma da Agenda.
- **Quem lê:** Caixa, Pagamentos, Resultado, Metas e Assistente derivam os números daqui, com a mesma conta (`demoCounts` e `demoMetrics`).
- **Período ao lado do número:**
  - Metas: "Em outubro até agora".
  - Resultado: cada indicador mostra "De 01/10 a 19/10" e há a opção nova "Este mês (até ontem)".
  - O Caixa já mostrava o mês; o Assistente já diz o intervalo.
- **Testes:** `src/lib/demo/dataset.test.ts` confere os portos lado a lado. `tests/e2e/qa/totais.spec.ts` lê as telas e compara:
  - recebido entre Caixa, Resultado, Metas e Assistente;
  - gasto entre Caixa, Resultado e Metas;
  - faltas (quantos de quantos) entre Resultado e Metas;
  - a receber entre Caixa e Pagamentos.
- **Decisão sobre os números da demonstração:** eles mudaram. Outubro tem R$ 1.740 recebidos, R$ 315 gastos e R$ 130,98 a receber, com 2 atendimentos sem cobrança (os de 19/10). As specs do piloto (`qa/jornada-integrada`, `qa/uat-barbeiro`) e as do Caixa, do Resultado e das Metas passaram a conferir esses valores. O que cada uma testa (concluir não é receber, recebimento único, estorno, saldo) ficou igual.

### 24 · Reserva provisória

- Tela do atendimento com status `held`:
  - "Confirmar reserva", que chama `booking.confirm` (já existia no servidor);
  - "Liberar horário", com confirmação e um motivo fixo enviado ao servidor;
  - "Vence às HH:MM".
- Em Hoje, cada reserva provisória vira uma pendência que leva direto a ela.
- A regra da demonstração ficou numa função só (`confirmHeld`), usada também pelo link público.

### 25 · Atendido e Faltou

- Depois do início do horário, o detalhe e o cartão da linha do dia mostram "Atendido" e "Faltou".
- "Atendido" é o concluir que já existia, com confirmação.
- "Faltou" executa na hora (`booking.no_show` com motivo fixo) e o Toast oferece Desfazer (`revert`). O detalhe também mostra "Desfazer falta".
- O rótulo de `no_show` agora é "Faltou".
- **Decisão (muda a onda 1):** no celular, o botão flutuante "Novo agendamento" virou redondo, só com o +. O nome acessível continua o mesmo. O botão largo cobria o "Faltou" do primeiro cartão.

### 27 · Cancelar com próximo passo

- A confirmação pede o motivo e o botão é `danger` "Sim, cancelar".
- Depois de cancelar, a tela mostra a região "Atendimento cancelado" com:
  - o motivo digitado;
  - **Desfazer:** cota o mesmo horário e cria de novo, com o mesmo serviço e o mesmo cliente;
  - **Avisar no WhatsApp:** texto pronto, sem o motivo, quando há telefone;
  - **Oferecer à lista de espera (N pessoas).**
- **Decisão:** o Desfazer gera um atendimento novo, com id novo, porque `cancelled` é final no contrato. Se o valor de hoje for diferente, o Toast diz. Se o horário foi ocupado, a tela explica e oferece "Marcar outro horário".
- O motivo só aparece na sessão em que foi digitado: o contrato `Booking` não devolve o motivo (pedido ao Felipe).
- A lista de espera ainda não recebe o horário pela URL. O link abre a tela, que mostra a oferta.

### 35 · Clientes

- No cartão do cliente: "Ligar" (`tel:`) e "WhatsApp" (`wa.me`), com 44 px. Sem telefone, os botões não aparecem.
- "Editar" e "Arquivar" ficam no menu "⋯": `role="menu"`, teclado com setas, Esc fecha e o foco volta ao botão.
- O ícone `opcoes` entrou no sistema de ícones.
- Ficha nova em `/app/clientes/:customerId`, com contato, os mesmos botões e os atendimentos próximos e anteriores.
- **Limite no servidor:** a ficha lê o cliente pela lista do CRM e os atendimentos por `booking.list`, em ±60 dias. Atendimentos mais antigos não aparecem, e a tela diz isso (pedido ao Felipe).

### 36 e 37 · Mensagens

- Com o número conectado, a conexão vira uma linha de status com "Gerenciar", e as conversas vêm primeiro.
- Sem conexão, aparece um estado vazio guiado.
- A linha inteira da conversa leva a `/app/mensagens/:contactId`. O campo de escrever fica fixo acima da barra de abas, e a lista mostra "3 não lidas" escrito.
- **Decisão:** o aviso "Mensagem na fila…" sai dentro do campo de escrever, não no Toast, que cobriria o próprio campo.

### E4 · Reserva pelo link em etapas

- Etapas "Serviço · Dia e hora · Seus dados · Código", com "Passo N de 4" e `aria-current="step"`.
- Os dias aparecem numa fileira de chips antes da hora. Um resumo da escolha fica visível a partir do passo 2.
- Voltar não perde nada do que já foi escolhido.
- **Decisão:** tocar num horário já leva ao passo 3. O resumo não fica preso na tela, porque na prévia dentro do app colidiria com as barras.
- A demonstração passou a gerar os horários do dia pedido.

### E5 · Perfil só com selos positivos

- "Identidade não verificada" saiu. "Identidade verificada" só aparece quando é verdade. "Perfil novo · ainda sem avaliações" só aparece sem avaliações.
- Preço, foto e "Falar no WhatsApp" ficaram fora, porque o contrato público não tem esses campos (pedido ao Felipe).

### Pedidos de contrato (recado ao Felipe, issue `para-felipe`)

1. `Booking.status_reason`: o banco já guarda; falta devolver.
2. Leitura de cliente por id no CRM.
3. `booking.list_by_customer`, sem janela de 60 dias.
4. Campos opt-in no perfil público: foto, WhatsApp e preço dos serviços.
5. Liberar a própria reserva provisória ao editar o contato no link público. Hoje a pessoa colide com o próprio pedido.

### Testes do bloco 2

- **Unitários:** 558 passaram. Novos:
  - `worker/og.test.ts`, `src/lib/demo/dataset.test.ts`;
  - fluxos da agenda (provisória, Faltou e Desfazer, cancelar com próximo passo, Desfazer com id novo e com horário ocupado);
  - ficha e menu do cliente, caixa de entrada;
  - etapas do link público e selos.
- **e2e novos:**
  - `qa/totais.spec.ts`;
  - `scheduling/atendimento.spec.ts`;
  - `crm/clientes.spec.ts`;
  - `network/reserva-etapas.spec.ts`, que roda em claro, escuro, desktop e celular;
  - `messaging/canal.spec.ts`, reescrito.

## Próximo passo

Onda 3 da auditoria, com o que ficou de fora nas duas ondas: item 18 (Chip), `share.tsx` compartilhado, botão de ação assíncrona compartilhado, a lista de espera recebendo o horário pela URL e os plurais "(s)" (item 58).
