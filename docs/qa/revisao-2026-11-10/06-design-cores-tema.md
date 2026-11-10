# 06 · Cores e temas claro e escuro

Auditoria de 10/11/2026 sobre a `main` em `8e113c4`, app em demonstração (`http://127.0.0.1:4173`).

## Resumo

**Veredito: misto.** A paleta está adequada ao público e não precisa mudar. A aplicação dela tem um defeito grave, quatro falhas pontuais e uma hierarquia de ênfase simples demais.

- **As cores estão apropriadas? Sim, a paleta está.** Em 51 telas e nos dois temas (2.177 trechos de texto por tema), o texto fora de controle desabilitado fica entre 5,38:1 e 18,88:1 no claro e entre 7,62:1 e 17,60:1 no escuro. A exceção é uma tela, `/app/configurar`.
- **Defeito grave ainda aberto:** o passo "próximo" da configuração guiada tem título e link a 1,00:1 nos dois temas (`src/features/setup/setup.css:19`). É o item 2 da revisão de 04/11. A classe de erro foi procurada em todo o CSS: só existe ali.
- **Ênfase simples demais:** o preto preenchido marca ação, navegação, valor escolhido, progresso e estado positivo. Na primeira dobra da Agenda há 4 elementos pretos preenchidos e só 1 é ação.
- **O laranja não existe na interface.** Os tokens `--tn-brand-accent` e `--tn-accent-text` têm zero uso; o laranja só aparece no logotipo. Tirando a faixa âmbar de demonstração, a tela Hoje não tem nenhum elemento com cor.
- **O tema escuro é um tema de verdade**, não uma inversão: três níveis de superfície, bordas mais fortes que no claro e camada flutuante mais clara. Falhas: selos de estado sem fundo, texto de exemplo a 3,70:1 e a barra de ocupação em verde do navegador.
- **Página pública:** a marca ali é da Tinindo; o profissional entra só com o nome. É decisão dos donos.
- Entrega: 12 achados no JSON (1 alto, 8 médios, 3 baixos), 2 deles marcados como decisão de marca ou produto.

## Como foi medido

| O quê | Como | Onde está |
|---|---|---|
| Inventário de tokens | script sobre `brand/tokens/tokens.css` e todo CSS e TSX de `src` | `trabalho/design-cores-tema/inventario.cjs`, `inventario.json` |
| Classe de erro (fundo forte sem cor de texto) | script sobre as regras de CSS | `classe-erro.cjs` |
| Contraste em tela | Playwright, 51 telas × claro e escuro, 390×844, estilos computados com composição de opacidade | `contraste.cjs`, `inpage.js`, `contraste-m.json`, `resumo.cjs`, `resumo2.cjs` |
| Estados (menu aberto, selecionado, perigo, toast, perfil e site públicos, foco) | Playwright com interação | `estados.cjs`, `estados.json`, `capturas/` |
| Contas das correções, cores cromáticas por tela, pixels da barra | Node e Playwright | `extra.cjs`, `extra.log`, `extra2.cjs`, `extra2.log` |

Tudo em `auditoria-local/trabalho/design-cores-tema/`. As quatro primeiras linhas vieram da tentativa anterior desta auditoria; conferi os dados por amostra contra o `contrast-report.md` da marca (mesmas razões: 17,60, 8,30, 18,88, 6,13) e contra as capturas.

## (a) Inventário de tokens

- 30 primitivos de cor, 28 semânticos em `brand/tokens/tokens.css` e 11 semânticos a mais definidos em `src/styles/global.css:23-48`.
- **Cor fora de token: nenhuma.** `grep` por HEX, `rgb()` e `hsl()` em `src` não retorna nada. Os 7 `color-mix` partem de tokens. `tokens.json` e `tokens.css` têm os mesmos valores HEX.
- **Mais usados:** `--tn-border` (87 usos em 27 arquivos), `--tn-text-muted` (72 em 24), `--tn-text` (42), `--tn-surface` (38), `--tn-border-control` (32), `--tn-action-subtle` (27), `--tn-action` (20).
- **Órfãos (zero uso):** `--tn-color-laranja-200`, `--tn-color-laranja-100`, `--tn-shadow-md`, `--tn-brand`, `--tn-brand-accent`, `--tn-accent-text`.
- **Primitivo usado direto:** véu a 45% em `src/app/shell.css:323` e `src/components/ui/sheet.css:20`, véu a 55% em `src/features/identity/identity.css:100`, e as cores do site em `src/features/presence/presence.css:26-33`.
- **Opacidade solta:** `scheduling.css:129` (.75), `setup.css:20` (.8), `presence.css:28, 31, 38` (.75 a .85) e `--tn-opacity-disabled` (.5).
- **Fora do lugar:** os tokens `--tn-selected-*`, `--tn-danger-action`, `--tn-opacity-disabled`, `--tn-elevation-*` e `--tn-surface-float` vivem em `global.css`, e `global.css:45-48` troca `--tn-surface-sunken` no escuro. O `tokens.json` e o `contrast-report.md` não os conhecem (achado 10).

## (b) Contraste WCAG 2.2 dos pares em uso

### Texto

| Par | Claro | Escuro |
|---|---:|---:|
| Texto sobre fundo | 17,60 | 17,60 |
| Texto sobre cartão | 18,88 | 15,91 |
| Secundário sobre fundo | 8,30 | 10,00 |
| Secundário sobre cartão | 8,90 | 9,04 |
| Texto sobre a cor de ação | 18,88 | 17,60 |
| Texto sobre o botão de perigo | 6,54 | 8,52 |
| Selo de sucesso | 5,38 | 8,83 |
| Selo e faixa de atenção | 6,12 | 10,09 |
| Menu aberto, item | 18,88 | 13,41 |
| Site do profissional, aparência clara | 17,60 (apoio 8,20) | igual |
| Site do profissional, aparência escura | 17,60 (apoio 10,09) | igual |

### Abaixo do mínimo

| Onde | Par | Razão | Achado |
|---|---|---:|---|
| `/app/configurar`, passo "próximo": título e link | #111111 sobre #111111 (claro); #F7F7F5 sobre #F7F7F5 (escuro) | 1,00 | 01 |
| Mesmo passo, texto de apoio | #4A4A46 sobre #111111; #BDBDB7 sobre #F7F7F5 | 2,12 e 1,76 | 01 |
| Texto de exemplo dos campos, escuro | #757575 sobre #1C1C1A | 3,70 | 05 |
| Etiqueta "opcional" em passo concluído | #6E6E6B sobre #F1F1EE | 4,49 | 11 |
| Descrição de opção desabilitada | #A5A5A3 sobre #FFFFFF | 2,48 | 11 |
| Botões desabilitados (isentos pelo WCAG) | opacidade .5 | 3,54 a 3,62 | 11 |

A falha do toast que aparece em `estados.json` (4,42 e 2,42) é a animação de entrada pega no meio; com o toast parado o par é 18,88 e 13,41. Não é defeito.

### Não textual

- **Borda de campo:** 6,13 (claro) e 5,05 (escuro). Passa com folga.
- **Anel de foco:** 3 px, igual nos 48 elementos percorridos com Tab em Hoje, Novo agendamento e Entrar; 6,39 no claro e 8,98 no escuro.
- **Ícones:** mínimo 5,38 fora do defeito do achado 01.
- **Barra de ocupação da Agenda:** `<meter>` nativo, preenchimento `rgb(16,124,16)` no claro e `rgb(116,179,116)` no escuro, cores do navegador (achado 04).
- **Bordas de pílula neutra** (subnavegação, trilho do alternador, sugestões do assistente): #DEDED9, 1,26:1 sobre o fundo. Não reprova, porque o rótulo identifica o controle, mas convive com o botão secundário, que usa a borda de controle a 6,13. Fica só neste relatório.

### A classe de erro do achado de 04/11

`classe-erro.cjs` procura regra com fundo forte (`--tn-action`, `--tn-selected-bg`, `--tn-danger-action`, primitivo) sem `color` na mesma regra. Resultado: 3 ocorrências. Só `setup.css:19` tem texto dentro; as outras duas são barras sem texto (`shell.css:280` e `setup.css:6`). Na medição em tela, nenhuma outra das 51 telas tem texto ativo abaixo de 4,5:1. Capturas: `capturas/configurar-proximo-passo__light.png` e `__dark.png`.

## (c) A paleta serve ao público e ao produto?

**Sóbria na medida no texto; apagada na ênfase.**

O que funciona: ação preta, texto quase preto sobre papel e estados em cores próprias dão leitura rápida para quem olha o celular entre dois atendimentos. Não recomendo clarear nada nem trocar a cor de ação.

O que não funciona:

1. **O preto preenchido não quer dizer uma coisa só.** Contagem de elementos com o fundo de `--tn-action` na primeira dobra (`extra2.log`): Agenda 4 (pílula "Agenda", opção "Dia", aba ativa e o botão "Novo agendamento"), Hoje 3, Caixa 4, Clientes 3, Novo agendamento 3. Captura `capturas/agenda-topo__light.png`. Convivem ainda três aparências de "selecionado": preenchido, sutil com borda e ✓ (`capturas/novo-agendamento-horario__light.png`: "Corte" sutil e "13:00" preenchido na mesma tela) e sutil com barra lateral (menu). Achado 03.
2. **Onde o laranja aparece de fato:** no símbolo de 32 px da barra (`src/app/AppShell.tsx:174`), na palavra das telas de entrada e públicas e no favicon. No CSS do app, em lugar nenhum. Em Hoje, fora a faixa de demonstração, há 0 elementos cromáticos; em Caixa, Clientes, Mensagens, Pagamentos e Metas, 1 ícone azul (`extra.log`). Capturas `shots/home__m-light.png` e `shots/home__m-dark.png`. Achado 07, decisão.
3. **Estado na Agenda:** os cartões de atendimento confirmado e de reserva provisória são idênticos em fundo e borda; a diferença é um selo pequeno. "Concluído" usa azul, a mesma cor do anel de foco. Achado 06.
4. **Estado fora da Agenda:** fiscal, site e diretório mostram estado positivo como pílula preta, igual a botão. Achado 09.

**Faz falta cor por categoria na agenda? Não.** Com um profissional e poucos serviços, cor por serviço vira ruído. O que falta é marcar o estado no próprio cartão.

## (d) Tema escuro

Funciona como tema próprio:

| Nível | Cor | Razão contra o nível abaixo |
|---|---|---:|
| Fundo | #111111 | |
| Cartão | #1C1C1A | 1,11 (no claro, branco sobre papel: 1,07) |
| Camada flutuante (menu, folha) | #2A2A28 | 1,19 |
| Borda | #3A3A37 | 1,50 sobre o cartão (no claro: 1,35) |

- As sombras somem no escuro (`rgba(17,17,17,…)`), e isso está previsto: `global.css:45-48` sobe a camada flutuante para a superfície elevada. Captura `capturas/menu-aberto__dark.png`.
- `color-scheme: dark` cuida dos controles nativos e há uma meta `theme-color` por tema.
- Falhas: selos sem fundo (achado 02), texto de exemplo a 3,70:1 (05), barra nativa (04) e o passo da configuração (01).
- O tema escuro está escrito duas vezes em `tokens.css` para um atributo `data-theme` que o app nunca define, e o logotipo só obedece ao sistema (achado 10).

## (e) Página pública do profissional

- **Perfil `/p/:slug`** (`capturas/perfil-publico__light.png`): palavra Tinindo no topo (`src/app/PublicLayout.tsx:12`), nome do negócio, botão preto. Nada do profissional além do nome.
- **Site `/s/:slug`** (`capturas/site-publico__light.png`): duas aparências fixas, "Clara" e "Escura", que são papel e tinta da Tinindo. A Tinindo aparece só no rodapé (`PublicSitePage.tsx:28`).
- As duas páginas tratam a marca de modos opostos. Todos os pares passam (mínimo 8,20:1). Achado 08, decisão.

## Achados

| # | Gravidade | Tipo | Achado | Onde |
|---|---|---|---|---|
| 01 | alta | defeito | Passo "próximo" de `/app/configurar` ilegível nos dois temas (1,00:1) | `setup.css:19` |
| 02 | média | defeito | Selos de estado sem fundo no escuro | `tokens.css:146-152`, `scheduling.css:158-161` |
| 03 | média | redesenhar | Preto preenchido com cinco significados | `ui.css:245, 265`, `shell.css:205` |
| 04 | média | defeito | Barra de ocupação em verde do navegador; três jeitos de desenhar barra | `AgendaPage.tsx:152` |
| 05 | média | defeito | Texto de exemplo a 3,70:1 no escuro | `ui.css` (falta `::placeholder`) |
| 06 | média | redesenhar | Estado na lista da Agenda depende só do selo | `scheduling.css`, `agenda.ts:35-41` |
| 07 | média | decisão | Laranja com zero uso na interface | `brand/BRAND.md:23-24` |
| 08 | média | decisão | Marca da página pública é toda da Tinindo | `PublicLayout.tsx:12` |
| 09 | média | refatorar | Selo com tom só existe na Agenda; outros módulos usam pílula preta | `fiscal.css:19`, `presence.css:7`, `discovery.css:8` |
| 10 | baixa | refatorar | Onze tokens semânticos fora de `brand/tokens` | `global.css:23-48` |
| 11 | baixa | defeito | Opacidade usada como cor (4,49:1 e 2,48:1) | `setup.css:20`, `scheduling.css:128-129`, `ui.css:290` |
| 12 | baixa | simplificar | Seis tokens órfãos e sete usos de primitivo direto | `tokens.css`, `shell.css:323` |

Evidência e recomendação completas em `achados/design-cores-tema.json`.

## Correções que cabem nas regras atuais da marca

| Achado | Mudança | Token ou valor | Contraste calculado |
|---|---|---|---|
| 01 | Fundo do passo "próximo" | `var(--tn-action-subtle)` + borda `--tn-selected-border` de 2 px | claro 16,10 (título e link) e 7,59 (apoio); escuro 13,41 e 7,62 |
| 02 | Fundo do selo derivado como o do aviso | `color-mix(in srgb, var(--tn-tone) 12%, var(--tn-surface))` | claro 5,28 / 5,77 / 5,37 / 5,71; escuro 6,95 / 7,77 / 6,18 / 6,50 (sucesso, atenção, erro, informação) |
| 03 | Navegação selecionada sem preenchimento | fundo `--tn-action-subtle`, texto `--tn-text` peso 600, indicador `--tn-selected-indicator` | texto 16,10 e 13,41; indicador 17,60 |
| 04 | Barra única do sistema | trilho `--tn-surface-sunken`, preenchimento `--tn-action` | 16,10 e 13,41 |
| 05 | Texto de exemplo | `::placeholder { color: var(--tn-text-muted); opacity: 1 }` | 8,90 e 9,04 |
| 06 | Faixa lateral de 4 px por estado no cartão da Agenda | `border-left: 4px solid var(--tn-tone)` | cores de estado já aprovadas: 5,38 a 10,09 como texto |
| 11 | Cor no lugar de opacidade | `--tn-text-muted` | 8,90 e 9,04 |

O achado 01 pede também um teste: a regra do `classe-erro.cjs` dentro de `src/app/css-system.test.ts`, para a classe de erro não voltar.

## Propostas que mudariam a marca ou o produto (decisão dos donos)

1. **Laranja na interface (achado 07).**
   - A: manter só no logotipo e remover os tokens órfãos.
   - B (recomendo): liberar em um ou dois elementos não textuais, não clicáveis e que não sejam estado, como a faixa do cartão "Próximo" (`src/app/pages/pages.css:62`) e a linha de "agora" da Agenda. Contraste não textual: 3,12 sobre papel e 3,34 sobre branco (margem curta sobre o mínimo de 3:1); 6,64 e 6,00 no escuro. Exige registro em `brand/DECISIONS.md`.
   - C (não recomendo): laranja como botão principal. Branco sobre laranja dá 3,34:1 e a cor se confunde com atenção e erro.
2. **Marca na página pública (achado 08).**
   - A (recomendo agora): paleta neutra, nome do profissional primeiro e Tinindo no rodapé, como no site.
   - B (em seguida): foto ou logotipo do profissional.
   - C (depois do piloto): cor de destaque numa lista curta validada. Nunca seletor livre.
3. **Mapa de cor dos estados (achado 06):** "Concluído" verde e "Confirmado" neutro, ou manter azul e verde. Recomendo a primeira.
4. **Alternador de tema (achado 10):** recomendo não ter no piloto e remover o bloco `data-theme`.

## O que manter intacto

- Cor só por token e o teste `css-tokens.test.ts`.
- Texto #111111 sobre papel e secundário #4A4A46; no escuro #F7F7F5 e #BDBDB7.
- Ação principal preta; perigo em vermelho próprio com confirmação (`capturas/cancelar-confirmacao__light.png`).
- Estados separados da marca, sempre com ícone e texto.
- Anel de foco azul de 3 px.
- Os três níveis de superfície do escuro, a camada flutuante e `color-scheme: dark`.
- Tema seguindo o sistema.
- Site do profissional com duas aparências fixas.
- Sem cor por categoria de serviço.

## O que não foi coberto

- Contraste medido só em 390×844; o desktop usa os mesmos tokens, mas não foi medido tela a tela.
- Hover e pressionado. Os estados "Concluído", "Faltou" e "Cancelado" na lista da Agenda: o roteiro automático não mudou o estado do atendimento, então a aparência deles foi lida do CSS e de `agenda.ts`.
- Campo com erro em tela: o cenário de `/entrar` falhou no roteiro da primeira tentativa; só a regra `ui.css:101` foi lida.
- Safari do iPhone e Firefox (em especial o desenho de `<meter>` e `<progress>`), `prefers-contrast`, `forced-colors` e simulação de daltonismo.
- Aparelho real ao sol; preferência dos profissionais do piloto.
- E-mails, ícones do PWA, manifest e os arquivos de `brand/assets`.
- Páginas públicas com token (oferta, orçamento, pagamento): entraram só na medição geral.
- Orçamento curto: usei cerca de 30 chamadas de ferramenta e 11 imagens.
