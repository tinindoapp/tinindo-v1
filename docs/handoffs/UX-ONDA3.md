# Handoff · UX onda 3 (auditoria de 27/10/2026)

Pedido do Felipe em 03/11: implementar o que faltava em `docs/qa/AUDITORIA-UX-DESIGN-2026-10-27.md`.

O pedido nomeia o item 18 (Chip), o `share.tsx` compartilhado, o botão de ação assíncrona compartilhado, a lista de espera recebendo o horário pela URL, os plurais "(s)" do item 58 e os demais itens sem marca.

Condições:
- só frontend e testes;
- PRs pequenos para a `main`, com o merge feito pela sessão depois do CI verde;
- a auditoria marcada e este handoff escrito.

Com isso, os 74 itens da auditoria estão marcados com ✓. Os da onda 1 (1, 2, 3, 4, 16, 26, 38, 48 a 53, E2, E3 e E6) estavam feitos desde os PRs #53 a #57, mas sem marca: foram conferidos no histórico e marcados agora. Os itens feitos em parte estão na seção "O que ficou em parte".

## Coordenação

- **Sem `claim` no `coord.py`.** Não há pacote de UX no quadro. O trabalho veio por pedido direto, como nas ondas 1 e 2.
- **Sem mudança em `supabase/`, `src/contracts`, `brand/` e `.github/`.** Nenhuma migration, contrato ou Edge Function mudou.
- **Durante a onda entrou o P31 (#80, contas a pagar).** A tela nova dele passa nas regras de CSS e nos e2e de padrões.

**PRs**, todos mergeados com o CI verde (lint, typecheck, unit, contratos, build, banco, e2e desktop e mobile, segredos):

| PR | Branch | O que entrou |
|---|---|---|
| #78 | `claude/ux-onda3-base` | Componentes da onda: Chip, Share, ActionButton e `plural()` |
| #79 | `claude/ux-onda3-sistema` | Itens 21 e 22 |
| #81 | `claude/ux-onda3-publico` | E7 a E14 |
| #82 | `claude/ux-onda3-dinheiro` | 19 (Dinheiro e Crescer) e 54 a 60 |
| #84 | `claude/ux-onda3-clientes` | 20 e 39 a 46 |
| #85 | `claude/ux-onda3-agenda` | 19 (agenda), 28 a 34 e a lista de espera com a vaga pela URL |
| este | `claude/ux-onda3-final` | 23, elevação nos módulos, auditoria e handoff |

**Modo de trabalho.** A base (#78) entrou primeiro. Quatro frentes paralelas trabalharam, cada uma no seu worktree, a partir dela: Agenda, Clientes e Mensagens, Dinheiro e Crescer, Páginas públicas. Cada frente foi rebaseada na `main` depois do merge da anterior. Antes de cada PR, a suíte completa rodou local. O único conflito foi uma linha no `AppShell.tsx`, entre o selo de não lidas e a rolagem do menu.

## Aviso para quem cria telas novas

Vale tudo o que está em `UX-ONDA2.md`, e mais o que segue.

**Componentes para usar** (todos em `src/components/ui`, exportados por `index.tsx`):

| Componente | Para quê |
|---|---|
| `ChipGroup` | Várias opções curtas em linha. Para dias da semana, use `WEEKDAY_CHIPS` e `WEEKDAY_SHORTCUTS` |
| `ShareActions` e `CopyButton` | Compartilhar e copiar. Também `whatsappHref` e `copyText` |
| `ActionButton` | Ação de um toque que chama o servidor |
| `Sheet` e `FormPanel` | Folha inferior no celular e cartão rolado até a vista no desktop |
| `ActionsMenu` | Menu "⋯" |

**Plural.** Use `plural(n, "cliente")` de `src/lib/text/plural.ts`. Não escreva "(s)".

**Regras novas no CI** (`src/app/css-system.test.ts`):
- **Larguras.** Só `(max-width: 30rem)` (compacto), `(min-width: 900px)` e `(max-width: 899.98px)` (largo).
- **Sombras.** Só `var(--tn-elevation-1)` (cartão e lista) e `var(--tn-elevation-2)` (camada flutuante), além de `inset` para realce.

## Base (#78)

### Item 18 · Chip

- **`ChipGroup` em `selection.tsx`.** Os chips têm 44 px, ✓ quando marcados, texto sem quebra ("1 h" não quebra mais) e caixa de seleção nativa por baixo. O nome inteiro do dia é o que o leitor de tela lê ("Seg" → "Segunda").
- **Atalhos.** Ficam marcados quando batem com a seleção.
- **Erro de grupo.** Liga ao `useFormErrors`: foco no primeiro chip e mensagem no `aria-describedby`.
- **Onde entrou:**
  - dias da lista de espera e de Preços, com "Dias úteis", "Seg a sáb" e "Todos os dias";
  - lembretes do Relacionamento, com "1 dia" e "2 dias" no lugar de "24 h" e "48 h", e o atalho "1 dia e 2 h antes".

### `share.tsx` compartilhado

- **Um arquivo só.** `src/components/ui/share.tsx` substitui as quatro cópias de sales, lifecycle, network e payments.
- **`ShareActions`.** Oferece "Enviar pelo WhatsApp", "Compartilhar…" (quando o aparelho tem) e copiar, com o retorno escrito ("Copiado ✓"). `onShared` só roda depois que deu certo.
- **`CopyButton`.** Mostra "Copiado ✓" no botão e, se falhar, diz onde copiar à mão.
- **Correção.** A oferta da lista de espera marcava "compartilhado" mesmo quando a cópia falhava. Agora usa o mesmo componente.
- **Mudança de texto.** O link do perfil dizia "Mandar no WhatsApp" e agora diz "Enviar pelo WhatsApp", como no resto do app.

### Botão de ação assíncrona

`ActionButton` fica em "carregando" enquanto a promessa roda, ignora o segundo toque e volta ao normal mesmo se a ação falhar. Substituiu os `ActButton` locais de Notas, Metas e Campanhas.

### Item 58 · Plurais

- **Sem "(s)".** `plural()` e `pluralWord()` tiraram todos os "(s)" das telas, em 16 arquivos.
- **Indicações.** O progresso aparece como "1 de 3 clientes" e "0 de 2 atendimentos concluídos", com barra (`<progress>`).
- **Datas.** As de Pagamentos e do Caixa já vinham da onda 1. A de Metas e a da pasta do contador entraram no #82.

### Testes

O Playwright passou a aceitar `E2E_PORT`, para rodar duas cópias do repositório ao mesmo tempo sem uma testar o build da outra.

## Sistema visual (#79 e este PR)

- **21 · Elevação.**
  - Três níveis documentados em `global.css`: página, cartão e lista (`--tn-elevation-1`) e camada flutuante (`--tn-elevation-2`).
  - Cartão e lista agrupada ficaram iguais.
  - No tema escuro, a camada flutuante usa `--tn-surface-raised`, e `--tn-surface-sunken` passou a ser tinta-800. Antes ela era igual ao fundo da página.
  - Folha, menu, botão flutuante e avisos da agenda passaram a usar os tokens.
- **22 · `theme-color`.** Uma meta por tema, com `media`: papel-50 no claro e tinta-950 no escuro. O manifest usa a cor clara. Um teste confere com os tokens da marca.
- **23 · Pontos de quebra.** Ficaram dois: compacto (30rem) e largo (900 px). 560 px, 599,98 px, 720 px e 40rem viraram um dos dois.

## Páginas públicas e entrada (#81)

- **E7 · Cadastro e entrada.**
  - Subtítulo de valor.
  - Dica da senha embaixo do campo.
  - "Mostrar senha" no cadastro, em "Nova senha" e em /entrar.
  - Texto neutro para e-mail já usado, com "Entrar" e "Recuperar a senha".
- **E8 · Termos e privacidade.**
  - Os links abrem uma folha.
  - A frase de saúde virou um aviso separado do aceite.
- **E9 · Onboarding.**
  - Só nome e profissão.
  - Fuso detectado no aparelho, com a troca recolhida.
  - Endereço do perfil sugerido pelo nome, com prévia.
  - Categoria vinda da profissão.
  - Um único "Primeiros passos", na Conta.
- **E10 · Confirmação da reserva.**
  - Telefone formatado.
  - "Número errado? Corrigir".
  - "Adicionar à agenda" (`.ics` gerado no navegador, em UTC, sem dados de quem reservou).
  - "Falar com o profissional".
- **E11 · Diretório.** Usa o `PublicLayout`, agora em `src/app`. O cartão não repete dados, há "N profissionais" e "Ver horários" com 44 px.
- **E12 · Perfil público.** "Ver horários livres" vem primeiro; os links secundários foram para o rodapé.
- **E13 · Sua conta.** Os primeiros passos ficam no topo. Saiu o texto técnico, e "Criar outro negócio" ficou discreto.
- **E14 · Site e Google.** As caixas de seleção viraram `ChoiceCard` de linha inteira, e Diretório e "O que aparece no perfil" seguem o mesmo padrão.

## Dinheiro e Crescer (#82)

- **19 · Avisos.** Nas nove telas, no máximo um aviso de uma linha; as explicações foram para "Como funciona". O e2e `finance/avisos.spec.ts` mede isso no tema escuro.
- **54 · Resultado.**
  - Faixa Recebido, Gasto e Sobrou no topo.
  - Delta com seta e palavra, sabendo quando subir é ruim.
  - "Ainda sem dados suficientes" agrupado.
- **55 · Alinhamento.** Já estava resolvido na onda 2. Entrou um e2e de alinhamento.
- **56 · Caixa.**
  - Ordem Pendências → Resumo → Histórico.
  - "+ Registrar" abre um painel com foco no primeiro campo.
  - Atalho "Recebi R$ 60,00 no Pix ▾", com as mesmas operações e chaves de antes.
  - O Histórico mostra os 5 mais recentes e "Ver mais". A página no celular caiu de 6.485 para 3.480 px.
- **57 · Assistente.** Valor em destaque, ressalvas em "Detalhes", a tela rola até a resposta, e aprovar e executar viraram um toque. Ver "Decisões".
- **59 · Atalhos nas lacunas.** "Cobrar N atendimentos →" e "Marcar “Atendido” ou “Faltou” em N atendimentos", com 44 px.
- **60 · Custo por cliente.** Vira cartões no celular. Sem permissão, mostra só o aviso, e a tela saiu do menu do profissional. O menu lateral rola até o item ativo.

## Clientes, Mensagens, Avaliações e Orçamentos (#84)

- **20 · `Sheet` e `FormPanel`.**
  - `Sheet` é um `<dialog>` com `showModal`: foco preso, Esc e Fechar devolvem o foco, fundo travado e o botão principal fixo no rodapé.
  - `FormPanel` abre a folha abaixo de 900 px. No desktop, rola até o cartão e foca o primeiro campo.
  - Entrou em Clientes, Serviços e "Enviar modelo aprovado".
- **39 · Mensagens na barra de abas.**
  - A barra fica Hoje · Agenda · Clientes · Mensagens · Dinheiro. O grupo Mensagens inclui o Assistente, na sub-aba e no menu.
  - O selo tem o número escrito ("Mensagens, 3 não lidas").
- **40 · Três estados nas listas.** Carregando, vazio e busca vazia, com "Cadastrar" já preenchido.
- **41 · Modelos legíveis.** Campos com nome, prévia, todos os vazios apontados de uma vez e o rótulo "Sua resposta".
- **42 · Campos numéricos.** Guardam o texto, validam a faixa do contrato e têm − / + de 44 px.
- **43 · Avaliações.** Resumo "4,7 ★ · 3 avaliações", só selos positivos e "Verifique sua identidade" como tarefa.
- **44 · Responder avaliação.** Foco, contador e prévia. "Denunciar…" fica no menu "⋯", com motivo e confirmação.
- **45 · Serviços.** Modelos só com a lista vazia; preço à direita.
- **46 · Orçamento.** Cliente escolhido com busca, título sugerido e todos os erros de uma vez.

## Agenda e lista de espera (#85)

- **28 · Horários.**
  - Cartão-resumo por dia.
  - "Usar o horário de segunda nos dias úteis".
  - Barra "Salvar" só com mudança.
  - "Sair sem salvar?" (`useBlocker` e `beforeunload`).
- **29 · Novo agendamento.**
  - Ordem Cliente → Serviço → Horário.
  - Busca, "+ Novo" (pela rota `crm/customer.upsert`, que já existia) e "Sem cadastro" (o contrato aceita `customer_id` nulo).
  - Barra fixa "Confirmar · Corte · 13:00 · R$ 51,00".
- **30 · Selos.** Um mapa só de rótulos. "Confirmado" saiu das listas.
- **31 · Hoje.** Cartão "Próximo", passados em cinza e "Ver os N de hoje".
- **32 · Semana.** "Seg 19" sem quebra, "2 · 9%" e chevron, "Hoje" e "Livre".
- **33 · Jargão.** "Menor preço que você aceita", "Desconto máximo", "livres para agendar" e "Sobra depois dos custos". Saiu o "v3".
- **34 · Fuso.** O aviso só aparece quando o fuso do aparelho é diferente: "Horários de Brasília (UTC−03:00)".
- **19 · Avisos da agenda.** Uma linha nas 5 telas; a explicação foi para "Como funciona".
- **Vaga pela URL.**
  - O atendimento cancelado leva a `/app/lista-de-espera?vaga=<início>`.
  - A vaga aparece no topo ("Vaga liberada agora"), com rolagem e foco em "Preparar oferta".
  - Se ninguém aceita, a tela diz com o horário escrito.
  - Enquanto o job do servidor não gerou os candidatos, a tela usa a mesma regra de `wl_candidates_for`. Quem decide continua sendo o `prepare_offer`.

## Decisões

1. **E8, termos fora do app.**
   - `docs/legal` é rascunho marcado "NÃO PUBLICAR" (`docs/legal/PENDENCIAS.md`). O texto não entra no app nem no pacote publicado: a folha diz que a versão final está em revisão e que o aceite registra a versão do piloto.
   - A frente pública chegou a carregar o Markdown; a integração tirou antes do PR.
2. **E7, senha com mínimo de 10.** A auditoria fala em 8, mas o servidor exige 10 caracteres, com letras e números. A tela segue o servidor.
3. **57, aprovar e executar num toque.**
   - O botão mostra o resumo e faz `approve` (com o código e a versão mostrados) e depois `execute(approval_id)`.
   - Proposta, aprovação e execução continuam registros separados (ADR-0012). Se a execução falhar, a aprovação fica e "Tentar executar de novo" não aprova outra vez.
   - Muda a tela, não o servidor. Pedi a confirmação do Felipe.
4. **39, juntar e não trocar.** O Assistente atende as mesmas conversas. Assim a barra fica com 5 abas legíveis.
5. **30, quais selos ficam.** Só "Confirmado" sai das listas; as exceções ficam. O detalhe do atendimento sempre mostra o estado.
6. **20, barra de abas sob a folha.** A folha fica por cima da barra de abas, que fica inerte enquanto ela está aberta.
7. **23, sem `@container`.** A proposta pedia `@container` nos formulários. Não entrou porque `container-type` faz do elemento o bloco de contenção dos `position: fixed` de dentro (botão flutuante da agenda, aviso de sair sem salvar). Os formulários usam o grid `auto-fit` do `.tn-form-grid` ou a regra de 30rem.
8. **56, Histórico com "Ver mais".** O Histórico mostra os 5 mais recentes, porque a demonstração tem muitos recebimentos.

## O que ficou em parte (depende do Felipe)

Os pedidos foram publicados como issues `[recado]` com a etiqueta `para-felipe`: #87 (termos), #88 (equipe Tinindo), #89 (telefone em Orçamentos, não lidas e verificação de identidade) e #90 (decisões).

- **E8:** texto final dos termos e da política e as versões que o aceite grava.
- **60:** sinal de "equipe Tinindo" na sessão, para bloquear a rota no cliente. Hoje quem bloqueia é a resposta FORBIDDEN do servidor.
- **43:** rota para pedir a verificação de identidade. Hoje a tela só explica.
- **46:** telefone do cliente na base de Orçamentos, para o WhatsApp abrir no contato e a busca achar por telefone.
- **39:** contador leve de não lidas. Hoje o shell chama `inbox.list` a cada troca de tela.
- **Decisões 2 e 3:** confirmação do Felipe.

## Testes

**Por PR:**
- `npm run lint`: ok.
- `npm run typecheck`: ok.
- `npx vitest run --project unit`: inteira.
- `npm run build`.
- `playwright test` completo, desktop (Desktop Chrome) e mobile (Pixel 7), com `--workers=2`.

**Último resultado local, na branch deste PR** (`main` com #85, mais o item 23):

| Comando | Resultado |
|---|---|
| lint e typecheck | ok |
| unit | 692 passaram |
| build | ok |
| e2e | 265 passaram, 33 pulados (os `fixme` que já existiam), 0 falhas |

**Tema escuro.** A spec de padrões e várias specs novas rodam com `colorScheme: "dark"`.

**Testes novos por área:**

| Área | Testes |
|---|---|
| Base | `ui/onda3.test.tsx`, `ui/share.test.tsx`, `lib/text/plural.test.ts` |
| Sistema visual | `app/theme-color.test.ts`; regras de largura e sombra em `css-system.test.ts` |
| Páginas públicas | `identity/cadastro.spec.ts`, `network/confirmacao.spec.ts` |
| Dinheiro | `finance/avisos.spec.ts`; alinhamento do Resultado |
| Clientes | `ui/sheet.test.tsx`, `messaging/modelo.spec.ts`; casos novos em navegação, relacionamento e avaliações |
| Agenda | `scheduling/hoje.spec.ts`, `app/pages/Home.test.tsx`; vaga pela URL em `waitlist/lista.spec.ts` |

**Falhas vistas no caminho:**
- Na base, cinco specs procuravam "(s)" em regex e foram corrigidas em c7f5b21.
- No celular, `messaging/modelo.spec.ts` media a folha no meio da animação de entrada. Agora espera a animação acabar.

**Ambiente local.** O `@playwright/test` 1.56 procura `chromium_headless_shell-1194`, e a máquina tem o 1243. Foi feito um link em `/opt/pw-browsers`. Isso é do ambiente da sessão e não mudou nada no repositório.

## Próximo passo

- Responder os recados `para-felipe` da onda 3. Quando o texto jurídico existir, a folha de termos volta a carregar o Markdown aprovado, num PR pequeno.
- Com o piloto, medir de novo as telas mais longas: Caixa, Horários e Novo agendamento.
