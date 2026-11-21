# P54, parte 2 · Regras de layout no resto do app do profissional · handoff

Sessão Claude Code (conta do Felipe), 21/11/2026. Branch `claude/gallant-shannon-drm4ff`, um PR por grupo de telas.
Base: `docs/handoffs/P54-regras-de-layout.md` (padrões do kit), docs 07 e 11 da revisão de 10/11.
Área: Agenda, Novo agendamento, atendimento e Horários (scheduling); Configuração (setup); Serviços (crm); Preços (pricing);
Lista de espera (waitlist); Mensagens (messaging); Orçamentos do dono (sales); Assinaturas (recurrence).
Nada aplicado na homologação. Nenhum contrato, migration ou flag mudou.

## Como foi medido

`docs/handoffs/P54-parte2/medir.cjs`: o medidor da parte 1 com as telas desta parte. Ele liga todos os módulos da
demonstração (`localStorage["tinindo.demo.modulos"] = "todos"`, como os e2e) para Orçamentos, Assinaturas e Mensagens
abrirem. Mede em 390×844, nos temas claro e escuro:
- altura da página;
- contraste WCAG de todo texto;
- alvos de toque menores que 44 px;
- preto preenchido que não é ação.

Os dados brutos ficam em `P54-parte2/medidas-grupo-*.json`. As capturas, `P54-parte2/<tela>-{antes,depois}-{dobra,inteira}.png`,
são a 2× e só do tema claro.

O navegador de medida roda em UTC. Por isso a Agenda, o atendimento, o Novo agendamento e Horários mostram a linha
"Horários de Brasília (UTC−03:00)". Quem está no fuso do negócio não vê essa linha, e essas telas ficam cerca de 24 px
mais curtas.

Limite: duas alturas de celular, 1.688 px.

## Grupo 1 · Agenda, Novo agendamento, atendimento, Horários (PR 1/3)

| Tela | Altura (antes → depois) | Telas | Contraste mín. claro / escuro (depois) | Falhas | Alvos < 44 | Preto que não é ação (claro) |
|---|---|---|---|---|---|---|
| Agenda (dia) | 1.690 → **1.543** | 2,00 → 1,83 | 6,12 / 7,62 | 0 | 0 | 0 |
| Agenda (semana) | 1.019 → 897 | 1,21 → 1,06 | 6,12 / 9,04 | 0 | 0 | 0 |
| Novo agendamento (celular) | 1.635 → **930** | 1,94 → 1,10 | 6,12 / 9,04 | 0 | 0 | 0 |
| Atendimento | 1.022 → 980 | 1,21 → 1,16 | 6,12 / 7,62 | 0 | 0 | 0 |
| Horários | 1.717 → **1.456** | 2,03 → 1,73 | 6,12 / 9,04 | 0 | 0 | 0 |

**Agenda**
- **Abertura:** `PageHeader` com o título; o fuso vem como linha de apoio, só quando o aparelho está noutro fuso. Dia/Semana e as setas vão no `filter`, e "Novo agendamento" em `actions`; no celular segue o botão flutuante "+".
- **O que saiu:** o bloco "Como funciona" acima da lista e o "(data da demonstração)" (D11 b).
- **Linha do dia:** curta, "Hoje · ter., 20/10"; o dia por extenso fica para o leitor de tela.
- **Ocupação:** numa linha, com o percentual, a barra e "Ver números do dia". Os minutos foram para dentro de "Ver números".
- **Resultado:** no celular, o terceiro atendimento do dia fica inteiro na primeira tela (`agenda-depois-dobra.png`). Antes, cabiam 1,3 cartão.

**Novo agendamento:** no celular, um passo por vez, na ordem Cliente → Serviço → Horário → Revisão (doc 11 §3.4).
- **Topo:** os quatro passos ficam como botões e levam a qualquer passo; o atual é fundo sutil com contorno (sem preto).
- **Avanço:** "Continuar" fica no pé, explica o que falta e não avança sem cliente nem sem horário.
- **Atalhos de entrada:**
  - vindo de um horário livre da Agenda (`?inicio=`), depois do cliente o fluxo vai direto à revisão;
  - com `?cliente=` (da ficha), começa no Serviço;
  - com os dois, abre na revisão.
- **Estado:** os passos fora da vez ficam montados e escondidos, e voltar a um passo mantém a busca de cliente e a repetição semanal.
- **Revisão:** no novo agendamento, só Cliente, Serviço, Quando e Valor; saíram a validade do valor e a política. O reagendamento continua como estava.
- **No largo:** tudo numa tela, como antes.

**Atendimento:**
- **Abertura:** o fuso vai para a linha de apoio do `PageHeader`.
- **Link da reserva para o cliente:** virou seção própria (h2), fora do cartão do atendimento, sem cartão dentro de cartão.

**Horários** (doc 11 §3.7):
- **Ordem:** "Bloqueios" vem antes do expediente.
- **Atalhos:** Manhã, Tarde e Dia inteiro, calculados pelo expediente do dia escolhido. O atalho escolhido fica marcado com `aria-pressed`, fundo sutil.
- **Motivo:** opcional. Sem motivo, o bloqueio leva "Compromisso" (o contrato pede um rótulo).
- **Lista de bloqueios:** usa `CappedList` do kit (5 e "Ver todos"), com "Remover" compacto por linha.
- **Expediente semanal:** virou seção, e "Usar o horário de segunda nos dias úteis" é fantasma. As explicações foram para a ajuda da abertura.

**Listas cortadas:** a agenda não tem lista com `truncated` no contrato (`booking.list` e `availability` não têm teto
que corte). Nada a mostrar.

**D9 (b) · valor editável em "Recebi":** não coube sem tocar em finance.
- `finance.charge_booking` só recebe `booking_id` e cobra o preço combinado; `finance.record_payment` recusa valor maior que o cobrado.
- Aceitar outro valor, respeitando o piso, muda o contrato e a RPC de finance.
- Ficou em recado (`para-felipe`). O botão "Recebi R$ X no Pix ▾" segue igual.

**D10:** fora, como pedido.

**e2e:**
- Os que passam pelo Novo agendamento ganharam `tests/e2e/scheduling/flow.ts` (`toStep`). Ele vai ao passo certo no celular e não faz nada no largo.
- Mudança de verificação, conforme o doc 11:
  - `agenda.spec` "cria, reagenda e cancela" e `uat-barbeiro` 3+5a: verificam que a revisão não mostra mais a validade nem a política.
  - `agenda.spec` "barra de resumo": o fim da página fica depois da revisão.
- Unidade: três casos novos do passo a passo (com `matchMedia`) e o bloqueio sem motivo com atalhos.

## Grupo 2 · Configuração, Serviços, Preços (PR 2/3)

Feito por subagente em worktree próprio, só nas pastas do grupo (`setup`, `pricing`, `crm/ServicesPage.tsx` e as regras de `crm.css` que só ela usa).

| Tela | Altura (antes → depois) | Telas | Contraste mín. claro / escuro (antes → depois) | Falhas (claro/escuro) | Alvos < 44 | Preto que não é ação (claro) |
|---|---|---|---|---|---|---|
| Configuração | 2.517 → **1.165** | 2,98 → 1,38 | 2,48 → 6,12 / 3,26 → 7,62 | 4/2 → 0/0 | 0 | 5 → 0 |
| Serviços | 844 → 844 | 1,00 | 6,12 / 9,04 | 0 | 0 | 0 |
| Preços | 2.389 → **844** | 2,83 → 1,00 | 6,12 / 9,04 | 0 | 0 | 0 |

**Configuração** (meta do doc 07 §4.9: 1.200 px):
- **Abertura:** `PageHeader` com a ajuda recolhida; saiu o aviso de demonstração (D11 b).
- **Passos:** uma lista, "Passos · N de M feitos":
  - o próximo passo vem primeiro, com o único botão principal da tela;
  - os outros pendentes ficam em linhas com uma ação compacta;
  - os feitos ficam atrás de "Ver os feitos (N)", com selo verde "Feito" no lugar da bolinha preta.
- **Frase e modelos:** "Descreva seu negócio" e "Modelos de serviço" viraram seções recolhíveis. Abrem na chegada enquanto falta horário ou serviço, ou pelas âncoras `#descrever` e `#modelos`.
- **Contraste:** as 4 falhas vinham do `ChoiceCard` desligado, usado para modelos que já estão no catálogo. Agora esses modelos são uma linha de texto: "Já no catálogo: Corte, Barba."
- **Cartão da Hoje:** o link do próximo passo virou fantasma compacto.

**Serviços** (doc 11 §3.8):
- **Lista:** linhas do kit sem cartão em volta.
- **Uma ação por linha:** o preço é o botão e abre um campo embaixo da linha. O piso igual ao preço acompanha a mudança; piso próprio acima do novo preço é recusado e manda para Editar.
- **Menu "⋯":** Editar e Arquivar/Reativar.
- **Formulário:** Nome, Duração e "Preço à vista"; o resto fica em "Mais opções". Piso em branco vale o preço.
- **Paginação:** "Carregar mais" quando o servidor devolve `next_cursor`. Antes, a segunda página sumia sem aviso.

**Preços** (meta do doc 07 §4.10: 1.200 px):
- **Ordem:** "Regras ativas" primeiro, com "Nova regra" como ação principal da abertura. A regra nova é feita num painel (folha no celular).
- **Aprovação:** a prévia vai para "Aguardando sua aprovação", com "Aprovar e publicar" compacto.
- **Simulador:** fica recolhido. O valor final aparece grande e base, piso e margem em linhas.

**Listas cortadas:** nenhum dado destas telas tem `truncated` no contrato. `PricingListRulesOutput` precisa dele (recado #169).

**Recados:** `P54-parte2/recados-grupo-configuracao.md`, juntos na issue #169.

## Grupo 3 · Lista de espera, Mensagens, Orçamentos, Assinaturas (PR 3/3)

Feito por subagente em worktree próprio, só nas pastas do grupo (`waitlist`, `messaging`, `sales`, `recurrence`).

| Tela | Altura (antes → depois) | Telas | Contraste mín. claro / escuro (depois) | Falhas | Alvos < 44 | Preto que não é ação (claro) |
|---|---|---|---|---|---|---|
| Lista de espera | 1.749 → **907** | 2,07 → 1,07 | 6,12 / 9,04 | 0 | 0 | 0 |
| Mensagens | 1.519 → **1.082** | 1,80 → 1,28 | 6,12 / 9,35 | 0 | 0 | 0 |
| Orçamentos | 844 → 844 | 1,00 | 6,12 / 9,35 | 0 | 0 | 0 |
| Assinaturas | 890 → 844 | 1,05 → 1,00 | 6,12 / 9,04 | 0 | 0 | 0 |

A conversa não aparece na tabela: a demonstração não tem conversa até conectar o número simulado, e o medidor mede a
caixa de novo. Medida avulsa pelo caminho dos e2e de mensagens: conversa com 1 mensagem, 844 px; caixa com 2
conversas, 861 px.

**Em todas as telas do grupo:**
- **Abertura:** `PageHeader` com título, apoio, uma ação principal e ajuda; saiu o aviso de demonstração por tela (D11 b).
- **Seções:** do kit, com contagem; as secundárias nascem recolhidas (Ofertas sem oferta aberta, Planos, Resumo da semana).
- **Linhas:** uma ação visível compacta e o resto no "⋯"; a confirmação abre embaixo da linha; 5 itens e "Ver todos".
- **Estados:** com `StatusBadge` (oferta, orçamento, assinatura, não lidas); a pílula preta de não lidas saiu.

**Por tela:**
- **Lista de espera:** "Adicionar à lista" abre uma folha no celular e um painel no largo.
- **Mensagens:** o simulador é apontado em "Como funciona", e o resumo da semana virou seção recolhida.

**Listas cortadas:** o `truncated` passou pelas portas que o perdiam (`sales_quote_list`, `recurrence_list`). Agora
aparece com `ListCutNote` nas cinco listas: espera (pedidos e ofertas), caixa de Mensagens, conversa, Orçamentos e
Assinaturas. Cada uma tem teste de unidade.

**e2e:** só seletores. `insights.spec` abre a seção "Resumo da semana" antes de ler; `canal`, `assinaturas`, `lista` e
`uat-barbeiro` seguem as linhas novas.

**e2e compartilhado:** no celular, `openFromNav` (`tests/e2e/qa/helpers.ts`) agora tenta abrir o Menu até ele ficar
aberto. Em `uat-barbeiro` 1a, o toque no Menu chegava antes de a rota de Clientes terminar de carregar, e a troca de
rota fechava a folha. Falhava em 2 de 10 execuções com este grupo e em 0 de 10 na `main`. É um caso de
tempo do teste; quem usa o app vê o menu fechar se tocar enquanto a tela carrega (casca, `src/app`, fora da área).

**Recados:** `P54-parte2/recados-grupo-mensagens.md`, juntos na issue #169.
- **Kit:** `ActionRow` com conteúdo embaixo e `ConfirmAction` aberto pelo "⋯". As quatro cópias locais de `rows.tsx` somem com isso.
- **Resumo da semana:** variante de seção do `WeeklyDigestCard`.
- **Contrato:** `sales_quote_list` corta antes do filtro.

## Testes deste PR

| Comando | Resultado |
|---|---|
| `npm run lint` | ok (com `--ignore-pattern '.claude/**'` localmente, porque os worktrees dos subagentes ficam dentro do repo; no CI não existem) |
| `npm run typecheck` | ok |
| `npm run test:unit` | 144 arquivos, 1073 passaram |
| `npm run test:contracts` | 846 passaram, 38 pulados |
| e2e completo, desktop e 375/412 px (cópia local do `playwright.config.ts` com o Chromium instalado) | 320 passaram, 34 pulados |
| Banco, integração, `deno check` | pelo CI (nenhuma função nem migration mudou) |

## Coordenação

- **Quadro:** o P54 não está no quadro do `coord.py`.
- **Merge:** pela sessão, com o CI verde, autorizado pelo Felipe.
- **Subagentes:** dois em paralelo, em worktrees próprios: um em Configuração, Serviços e Preços; outro em Lista de espera, Mensagens, Orçamentos e Assinaturas. Cada um só nas pastas do seu grupo. Os PRs 2 e 3 trazem os commits deles e completam este handoff.
