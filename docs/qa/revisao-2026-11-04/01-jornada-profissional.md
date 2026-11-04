# Revisão de UX · Jornada do profissional novo (cadastro → primeiro mês)

Build: `main` b7b58fc, `vite preview` na porta 4301, modo demonstração (sem Supabase). Playwright 1.56 com Chromium em 375×812 (toque, `isMobile`) e 1280×800. Scripts e screenshots ficam em `scratchpad/a1/`. Os nomes de arquivo citados abaixo (`p1_*.png`, `p2_*.png`…) estão nessa pasta. Nada foi alterado no repositório.

## 1. Resumo

1. A demonstração **não deixa viver o "profissional novo"**. Cadastro e "Criar negócio" ficam desabilitados, e o app abre numa "Barbearia Exemplo A" com 21 dias de uso e 5 de 8 passos feitos. Cabeleireira e personal só existem trocando a profissão pela frase, e o resto do app continua sendo uma barbearia.
2. Na demonstração, a configuração guiada **não grava no resto do app**. O expediente e os serviços salvos em "Deixe seu negócio pronto" dizem "substitui o atual da agenda principal", mas não aparecem em Horários, Serviços, Novo agendamento nem no link público.
3. O analisador da frase erra em casos comuns e não avisa: inverte negação ("não atendo domingo e segunda" vira dom+seg), perde o segundo turno (padrão do personal: 6–12 e 17–21) e perde o sábado com horário diferente. Também lê "pacote com 4 sessões" como "4 pessoas atendem".
4. Há falhas visíveis no caminho principal:
   - o próximo passo em `/app/configurar` aparece preto sobre preto, sem título nem botão legíveis;
   - o assistente diz "4 de 8" quando a Home diz "5 de 8", e o botão "Já fiz, conferir" não muda nada;
   - a política de cancelamento é passo obrigatório "porque aparece para o cliente antes de reservar", mas o link público nunca a mostra.
5. O que funciona bem: da Home ao link publicado são 2 toques mais o bairro (cerca de 30 s). A reserva pelo link tem 4 passos claros, com código. "Atendido" deixa claro que não registra pagamento. "Recebi R$ X no Pix" no Caixa resolve com 1 toque e mostra o aviso de confirmação. As confirmações dos rascunhos resumem o que vai ser gravado.

## 2. Linha do tempo por persona

Os tempos são do Playwright (cliques automáticos) mais uma estimativa humana para digitar e ler. "Cliques" conta toques em botões e links, sem contar digitação.

### Persona 1 · Barbeiro sozinho, terça a sábado

| # | Passo | O que viu | Cliques | Tempo humano est. | Travou? |
|---|---|---|---|---|---|
| 0 | Cadastro `/criar-conta` e `/app/conta/novo-negocio` | "Demonstração sem servidor: cadastro desabilitado." O formulário aparece, mas não envia | 0 | — | **Sim.** Não dá para criar o negócio na demonstração |
| 1 | Home | Cartão "Deixe seu negócio pronto · 5 de 8", com "Próximo: Publicar seu perfil". Abaixo, 3 sugestões de insights | 0 | 10 s | O atalho "descreva seu negócio em uma frase" não aparece, porque horários e serviços já estão "feitos" |
| 2 | Publicar perfil (cartão) → `/app/perfil` | Formulário com endereço, categoria e "Bairro ou região" | 1 | 10 s | Tocar em Publicar sem bairro dá erro embaixo do campo. Funciona, mas o "porquê" do passo não avisa que o bairro é obrigatório (`p1_02b_publicar_sem_bairro.png`) |
| 3 | Bairro "Centro" → Publicar | "Perfil no ar", "Seu perfil está no ar!", "Enviar pelo WhatsApp / Copiar link" | 1 | 20 s | Não. Data "Publicado em 03/11/2026" (relógio real), enquanto a demo vive em 20/10 (`p1_02_perfil_publicado.png`) |
| 4 | Volta à Home | "6 de 8 · Seu link público já recebe reservas", com o próximo opcional "Pôr foto e WhatsApp". O insight "Perfil: 3 de 4" diz a mesma coisa logo abaixo | 1 | 5 s | Repetição: o cartão e o insight cobram o mesmo item (`p1_03_home_pos_publicar.png`) |
| 5 | Link público `/p/barbearia-exemplo-a` → Corte → 16:00 → nome/WhatsApp → código → Confirmar | 4 passos claros. O código aparece na tela ("O código seria 137718"). "Horário confirmado" | 6 | 60 s | O toast do dono "Perfil publicado." continua na página pública. **Sem preço e sem política de cancelamento** em nenhum passo (`p1_05_publico_dia.png`, `p1_07_publico_codigo.png`, `p1_08_publico_confirmado.png`) |
| 6 | Agenda (dono) | A reserva das 16:00 aparece como "**Sem cliente cadastrado**". No detalhe: "Pedido pelo link: João Teste · +55…" | 2 | 15 s | Não há "salvar como cliente" (`p1_09_agenda.png`, `p1_10_detalhe_link.png`) |
| 7 | Primeiro cliente: Clientes → Novo cliente | Botão desabilitado: "Os formulários ficam bloqueados" | 1 | — | **Sim.** Contornei por Agenda → Novo agendamento → "+ Novo cliente" (`p1_11_clientes_bloqueado.png`) |
| 8 | Novo agendamento com "+ Novo cliente" (Carlos) → Corte → 17:00 → Confirmar | "Carlos Barbosa foi cadastrado e escolhido" e depois o detalhe "Confirmado" | 5 | 45 s | Carlos **não aparece** em Clientes. Não há oferta de mandar a confirmação ao cliente (`p1_12…`, `p1_14_agendamento_confirmado.png`) |
| 9 | Atendimento concluído: Agenda → "Atendido" (09:00) → "Sim, foi atendido" | Confirmação inline "Isso registra que o atendimento aconteceu. Não registra pagamento." A linha vira "Concluído" | 2 | 10 s | Na linha da agenda não há atalho "Cobrar". É preciso saber ir em Dinheiro (`p1_15_atendido.png`, `p1_16_atendido_ok.png`) |
| 10 | Cobrança: Dinheiro → "Recebi R$ 60,00 no Pix" | Aviso de confirmação "Recebido R$ 60,00 (Pix)…" e "Estornar" na lista | 2 | 10 s | O primeiro da lista é o mais antigo (19/10), não o de hoje (`p1_17_caixa_recebido.png`) |
| 11 | Frase "Sou barbeiro, sozinho, de terça a sábado das 9 às 19" → Montar → Salvar → confirmar | O rascunho vem certo (ter–sáb, 09–19, Barbearia). A confirmação diz "substitui o atual da agenda principal". Toast "Salvo: expediente de 5 dias" | 3 | 40 s | **Sim.** Horários continua com segunda aberta e sábado das 9 às 14. A semana da agenda também não muda (`p1_18…`, `p1_19_horarios_pos_rascunho.png`) |
| 12 | Modelo "Corte e barba" R$ 85 → Criar | Confirmação "Entram no catálogo: Corte e barba (50 min, R$ 85,00)" | 3 | 20 s | **Sim.** Não aparece em Serviços nem no Novo agendamento (`p1_21…`, `p1_22_servicos.png`) |
| 13 | Assistente → "Me ajuda a configurar" | "4 de 8 passos prontos · Política de cancelamento" | 1 | 10 s | **Sim.** Contradiz a Home (5 de 8, política feita). "Já fiz, conferir" não muda nada (`p4_01_guia.png`) |
| 14 | Assistente: perguntas livres | "como publico meu link?", "qual meu link público?", "o que devo fazer esta semana?", "cadastra um serviço…", "muda meu horário de sábado…" → todas "Não entendi o pedido." "por que tenho faltas na quarta?" responde a agenda de amanhã | 9 | — | **Sim.** É um beco sem saída para quem está configurando (`p4_02_respostas.png`, `p4_03_nao_entendi.png`) |

Tempo até o link publicado, na demonstração: **2 toques e o campo bairro, cerca de 30 s**. Para um negócio realmente novo não consegui medir: o cadastro está bloqueado. Pelo código, depois de "Criar negócio" o app vai para `/app/conta?novo=1` (`CreateBusinessPage.tsx:54`), e não para a Home com o cartão. Sem frase, ainda seriam horários (Agenda → Horários, 7 dias com "Editar"), serviço (Clientes → Serviços), política (Conta) e perfil. A estimativa é de 6 a 10 min no celular, no limite da meta do P44 (menos de 10 min).

### Persona 2 · Cabeleireira com coloração e pacotes

| # | Passo | O que viu | Cliques | Tempo est. | Travou? |
|---|---|---|---|---|---|
| 1 | Configurar → frase "Cabeleireira autônoma, trabalho com coloração, mechas e progressiva. Vendo pacote de hidratação com 4 sessões. Atendo de terça a sábado, 9h–19h" | "Não entendi o horário." e "**4 pessoas atendem.** A agenda principal é uma…". Serviços: Coloração, Hidratação, Progressiva, Luzes e **"Sessão individual"**, todos com minutos e preço vazios | 1 | 60 s | **Sim.** "com 4 sessões" vira equipe de 4. "sessões" vira serviço de personal. "9h–19h" com travessão não é lido (`p2_rascunho.png`) |
| 2 | Tocar em Salvar sem preencher | Erros embaixo dos campos: "Informe início e fim…" e "Cada serviço precisa de duração…" | 1 | — | Funciona, mas a cabeleireira digita 5 durações e 5 preços à mão, mesmo com modelos da profissão que já têm duração e faixa (Coloração 120 min, R$ 120 a 350) (`p2_salvar.png`) |
| 3 | Frase com corte, escova, coloração e hidratação, seg–sáb, 9–18, almoço 12–13 → preencher 4 durações e preços → Salvar → confirmar | A confirmação resume certo (pausa vira dois blocos) | 3 | 90 s | **Sim.** Erro "Já existe um serviço ativo com esse nome. Nada foi criado." Não diz qual serviço. O campo "Corte" não é marcado e o rascunho inteiro, expediente incluído, é recusado (`p2_01_salvo.png`) |
| 4 | Mesmo após a recusa | A profissão **mudou** para Cabeleireira(o) nos modelos (só depois de sair e voltar à tela). A categoria do Perfil continua "Barbearia" | 3 | — | "Nada foi criado", mas a profissão foi trocada (`demoPort.ts:162`) |
| 5 | Renomear para "Corte feminino" → Salvar | Toast "Salvo: expediente de 6 dias e 4 serviços criados." | 2 | 20 s | **Sim.** Coloração não aparece no Novo agendamento (`p2_03_salvo_ok.png`) |
| 6 | Pacote: Dinheiro → Vender pacote | Cliente, **um** serviço, sessões, valor, validade | 1 | 30 s | Só aparecem Corte e Barba (os serviços da barbearia). Não dá para montar um pacote com escova + hidratação. Não há preço "a partir de" para coloração por comprimento (`p2_04_vender_pacote.png`) |

### Persona 3 · Personal trainer a domicílio

| # | Passo | O que viu | Cliques | Tempo est. | Travou? |
|---|---|---|---|---|---|
| 1 | Frase "Sou personal trainer, atendo a domicílio de segunda a sexta das 6 às 12 e das 17 às 21" | Rascunho seg–sex **06:00 às 12:00**, **sem nenhum aviso** | 1 | 40 s | **Sim.** O turno da noite some. O formulário só aceita uma pausa, e a saída de digitar 06–21 com pausa 12–17 não é sugerida (`p3_01_rascunho_turno_perdido.png`) |
| 2 | Salvar → confirmar | "Expediente: segunda a sexta, 06:00 às 12:00" e "Salvo: expediente de 5 dias." | 2 | 10 s | Grava o horário errado, que o dono não percebe se só passar o olho |
| 3 | Modelos (após sair e voltar) | "Avaliação física", "Sessão individual" e o texto "Pacote de 10 sessões: vende-se no Caixa como pacote… depois de criar o serviço avulso." | 2 | 20 s | Não há link para o Caixa. O pacote é a principal forma de venda do personal (`p3_02_modelos_personal.png`) |
| 4 | Domicílio `/app/domicilio` | Roteiro com outros clientes (Ana Souza, Carlos Lima, Bia Rocha "Escova") e o título "Atendimentos do dia **no salão**" | 1 | 30 s | Domicílio não é passo da configuração nem é lido na frase ("atendo a domicílio"). O link público não pede bairro, CEP nem zona do aluno |
| 5 | Criar negócio (`/app/conta/novo-negocio`) | "Não cadastre dados de saúde de ninguém (diagnósticos, lesões, prescrições), nem nas observações." | — | — | O personal precisa anotar restrições do aluno. O aviso proíbe e não dá alternativa |
| 6 | Agenda, Caixa, Assistente, insights | É a mesma barbearia (Corte, Barba, "faltas na quarta", "sábado vazio 9h–14h", conteúdo "Barbearia… em Pinheiros") | — | — | A demonstração não representa a persona |

## 3. Achados

**A1 · Na demonstração, a configuração guiada não chega ao resto do app.** Impacto: **alto**.
- Tela: `/app/configurar`, partes "Descreva seu negócio" e "Modelos de serviço".
- Código: `src/features/setup/demoPort.ts`. O estado `hours` e `services` fica só no módulo setup (linhas 43–60 e 150–172).
- O que acontece: o salvamento dá toast de sucesso, e a confirmação diz "substitui o atual da agenda principal". Horários, a semana da Agenda, Serviços, Novo agendamento e o link público seguem iguais.
- O que deveria acontecer: a emulação deveria escrever pela mesma ponte da demo (`lib/demo/journey.ts`), como já faz com o perfil publicado. Se isso não for feito, a confirmação deveria dizer "na demonstração, isto não muda a Agenda".
- Evidência: `p1_19_horarios_pos_rascunho.png`, `p1_22_servicos.png` e o passo 11/12 da persona 1.

**A2 · O próximo passo em `/app/configurar` fica ilegível (preto sobre preto).** Impacto: **alto**.
- Tela: `/app/configurar`, lista "Passos".
- Código: `src/features/setup/setup.css:19`. `.tn-setup-step[data-next]` usa `background: var(--tn-selected-bg)` (= `--tn-action`, #111) e não troca a cor do texto. Medido: fundo `rgb(17,17,17)`, título `rgb(17,17,17)`, link `rgb(17,17,17)`, contraste 1:1.
- O que acontece: justamente o passo em destaque (o título e o botão "Publicar perfil") some, nos dois tamanhos de tela.
- O que deveria acontecer: usar `--tn-action-subtle` como fundo (padrão do `.tn-choice[data-selected]`) ou definir `color: var(--tn-selected-text)` no título, no porquê e no link.
- Evidência: `crop_step4.png`, `p2_salvar.png`, `d_02_configurar.png`.

**A3 · A política de cancelamento é obrigatória "porque aparece antes de reservar", mas o link público não a mostra.** Impacto: **alto** (é uma promessa falsa ao dono, e o cliente reserva sem saber a regra).
- Tela: `/p/:slug`, nos 4 passos e na confirmação.
- Código: `src/features/setup/labels.ts:21` ("A política aparece para o cliente antes de reservar…"). Em `src/features/network/PublicProfileView.tsx` não há texto de política: só "Para remarcar ou cancelar, fale com o profissional" (linhas 392 e 414).
- O que deveria acontecer: mostrar "Cancelamento sem custo até 2 h antes; depois, 50%" no passo 2 ou 4. Se não, o passo não deveria ser obrigatório nem prometer isso (o docs/12 diz "progressivamente").
- Evidência: `p1_05_publico_dia.png`, `p1_07_publico_codigo.png`, `p1_08_publico_confirmado.png`.

**A4 · O analisador da frase erra sem avisar em frases típicas.** Impacto: **alto** (grava horário errado com um "Salvo" verde).
- Código: `supabase/functions/_shared/domain/setup/describe.ts`. Resultados obtidos rodando o próprio `describeBusiness`:

| Frase | Resultado | Problema |
|---|---|---|
| "Não atendo domingo e segunda. Sou barbeiro, das 9 às 20" | dias `[dom, seg]` | Negação ignorada: o inverso do pedido (dias soltos, linhas 104–107) |
| "…de segunda a sexta das 6 às 12 e das 17 às 21" (personal) | 06:00–12:00 | O 2º turno some (só o 1º `rangeRe`, linha 136). Não volta em `unknown` |
| "barbeiro, terça a sexta 10 às 20 e sábado 8 às 16" | ter–sex, 10–20 | O sábado some |
| "quarta a domingo das 10 ao meio-dia e das 14 às 20" | 14:00–20:00 | "meio-dia" não é lido. A manhã some |
| "…pacote de hidratação **com 4 sessões**" | `team_size: 4` → "4 pessoas atendem" | O regex `com (\d+)` (linha 76) pega qualquer número depois de "com" |
| "…sessões", "pacote de 10 sessões" | serviço "Sessão individual" (também para cabeleireira) | "Pacote" não é lido |
| "9h–19h" (travessão) | horário não entendido | Só o hífen é aceito |

- O que deveria acontecer: quando houver dois intervalos de horário, um "não" antes de um dia ou um "e sábado …", marcar o campo como "confira" e mostrar o trecho que não foi usado ("Não usei: 'e das 17 às 21'"). Também é preciso aceitar dois turnos como dois blocos, porque o personal vive disso.
- Evidência: `parse.mts`, `p3_01_rascunho_turno_perdido.png`, `p2_rascunho.png`.

**A5 · O assistente mostra um progresso de configuração fixo e diferente da Home.** Impacto: **alto**.
- Tela: `/app/assistente`, "Me ajuda a configurar".
- Código: `src/features/agent/setupGuide.ts:31-32` (`DEMO_SETUP`, 4 de 8). O handoff do P46 já indicava trocar pelo `setup.progress` do P44.
- O que acontece: o assistente diz "4 de 8 · Política de cancelamento", enquanto a Home e `/app/configurar` dizem 5 de 8, com a política feita. "Já fiz, conferir" relê o mesmo valor fixo e nada muda.
- O que deveria acontecer: ler a mesma porta do setup (`createDemoPort().progress()` na demo, `setup.progress` no servidor).
- Evidência: `p4_01_guia.png` e o passo 13 da persona 1.

**A6 · O assistente não entende nada sobre configuração e não oferece saída.** Impacto: **médio**.
- Tela: `/app/assistente`.
- O que acontece: "como publico meu link?", "qual meu link público?", "o que devo fazer esta semana?", "cadastra um serviço de corte e barba de 50 minutos por 85 reais" e "muda meu horário de sábado para 9 às 18" respondem "Consultado · Não entendi o pedido". O rótulo "Consultado" não faz sentido para um não entendimento. "por que tenho faltas na quarta?" responde "Amanhã (quarta) você não tem nenhum atendimento".
- O que deveria acontecer: com o provedor `none`, reconhecer pelo menos as palavras link, perfil, horário, serviço e configurar, e oferecer o botão do passo correspondente ou "Me ajuda a configurar". Faltas deveria levar ao insight.
- Evidência: `p4_02_respostas.png`, `p4_03_nao_entendi.png`.

**A7 · Duas listas de "primeiros passos" que se contradizem, e o cadastro cai na lista antiga.** Impacto: **médio**.
- Tela: `/app/conta`. Código: `src/features/identity/AccountPage.tsx:81-86` e `CreateBusinessPage.tsx:54` (`navigate("/app/conta?novo=1")`).
- O que acontece: a Conta mostra "Primeiros passos" com 5 itens, e serviços, horários e perfil **sem** check. O cartão da Home dá os mesmos como feitos e tem 8 itens. Quem acaba de criar o negócio vai para a Conta, não para o cartão do P44.
- O que deveria acontecer: depois de criar o negócio, ir para a Home ou para `/app/configurar#descrever`, e tirar ou trocar a lista da Conta por um link para o cartão (o handoff do P44 já recomendava).
- Evidência: `d_03_conta_primeiros_passos.png`.

**A8 · O rascunho recusa tudo por causa de um nome repetido e não diz qual.** Impacto: **médio**.
- Tela: `/app/configurar`, "Salvar expediente e serviços".
- O que acontece: com "Corte" já no catálogo, aparece "Já existe um serviço ativo com esse nome. Nada foi criado." Não há campo marcado, e o expediente também não é salvo. Na demo a profissão muda mesmo assim (`demoPort.ts:162` grava antes de validar). A lista de modelos não se atualiza para a nova profissão até sair e voltar.
- O que deveria acontecer: marcar "Corte · já no catálogo" no próprio rascunho (como os modelos fazem) e oferecer "Salvar sem os repetidos". Na demo, só trocar a profissão depois de validar. Depois de salvar, recarregar os modelos.
- Evidência: `p2_01_salvo.png`.

**A9 · Os serviços do rascunho vêm sem duração nem preço, mesmo havendo modelos da profissão.** Impacto: **médio**.
- Tela: `/app/configurar`. Código: `SetupPage.tsx:86` (`rowOf(n)` sem duração nem preço).
- O que acontece: a cabeleireira digita 4 a 5 durações e preços. A frase do barbeiro sem serviços não sugere Corte e Barba.
- O que deveria acontecer: preencher a duração pelo modelo (Coloração 120 min) e mostrar a faixa como dica no preço. Se a frase não cita serviços, sugerir os modelos da profissão marcáveis.

**A10 · Na demonstração não é possível cadastrar cliente na tela Clientes, mas é possível pela Agenda, e o cliente criado não aparece em Clientes.** Impacto: **médio**.
- Telas: `/app/clientes` ("Novo cliente" desabilitado) e `/app/agenda/novo` ("+ Novo cliente" funciona).
- O que acontece: o passo opcional "Cadastrar seu primeiro cliente" leva a um botão morto. Carlos, criado na Agenda, não aparece em Clientes.
- O que deveria acontecer: habilitar o cadastro emulado na aba (como a Agenda faz) ou, no botão desabilitado, dizer "na demonstração, cadastre pelo Novo agendamento".
- Evidência: `p1_11_clientes_bloqueado.png`, `p1_12_agendamento_novo_cliente.png`.

**A11 · A reserva pelo link entra como "Sem cliente cadastrado".** Impacto: **médio**.
- Telas: Agenda e detalhe do atendimento. Código: `AgendaPage.tsx:122`, `BookingDetailPage.tsx:135` e `232–241`.
- O que acontece: na lista aparece "Sem cliente cadastrado". O nome só aparece no detalhe ("Pedido pelo link: João Teste"), sem ação para cadastrar.
- O que deveria acontecer: na lista, "João Teste · pelo link". No detalhe, um botão "Salvar como cliente" (com confirmação), que também conclui o passo opcional "primeiro cliente".
- Evidência: `p1_09_agenda.png`, `p1_10_detalhe_link.png`.

**A12 · Depois de "Atendido", nada leva à cobrança.** Impacto: **médio**.
- Tela: a linha da Agenda depois de "Sim, foi atendido". O detalhe tem "Cobrar no Caixa" (`BookingDetailPage.tsx:288-292`).
- O que acontece: a linha só vira "Concluído". O profissional precisa saber ir em Dinheiro, e lá o primeiro "Recebi…" é o atendimento mais antigo, não o que acabou de concluir.
- O que deveria acontecer: logo depois de concluir, oferecer inline "Recebeu? Pix · Dinheiro · Cartão · Depois", ou levar ao Caixa com o atendimento em destaque.
- Evidência: `p1_16_atendido_ok.png`, `p1_17_caixa_recebido.png`.

**A13 · O personal a domicílio não tem caminho na configuração nem no link.** Impacto: **médio** (alto para a persona).
- Telas: `/app/configurar`, `/app/domicilio` e `/p/:slug`.
- O que acontece: "atendo a domicílio" é ignorado na frase. Domicílio não é passo. O link não pergunta o bairro do aluno. A tela Domicílio fala "Atendimentos do dia **no salão**" (`FieldPage.tsx:142`), tem clientes com "Escova" e não conversa com a Agenda.
- O que deveria acontecer: ler "domicílio" na frase e propor o passo opcional "Defina sua área de atendimento". No link, pedir bairro ou zona quando o serviço é a domicílio. Usar "no seu espaço" em vez de "no salão".

**A14 · Pacotes ficam escondidos e são de um serviço só.** Impacto: **médio** (cabeleireira e personal).
- O que acontece: o modelo "Pacote de 10 sessões" é só texto, sem link para o Caixa. "Vender pacote" está no fim do Caixa e aceita um serviço por pacote. Não há como montar "3 escovas + 1 hidratação". Coloração não tem preço "a partir de" por comprimento (o formulário de serviço tem um preço base e um "Piso", sem explicação).
- O que deveria acontecer: colocar no modelo o botão "Vender este pacote no Caixa →", explicar o "Piso" ("o menor preço que você aceita numa promoção") e indicar a limitação do pacote com um serviço só.
- Evidência: `p3_02_modelos_personal.png`, `p2_04_vender_pacote.png`.

**A15 · O insight "Ver" leva a uma tela sem contexto e cheia de jargão.** Impacto: **médio**.
- O que acontece: "Faltas concentradas na quarta → Ver" abre `/app/relacionamento` ("Rodar a régua (simulação)", "Adiado (teto diário)", "Réguas ligadas"), sem dizer por que a pessoa chegou ali. Em Metas e sugestões aparecem "grupo de controle", "o resultado sai por braço, com intervalo" e "termos congelados na adesão". Na mesma tela, as faltas aparecem como "5 de 12 na quarta; média 10 de 60" e como "16% (6 de 37)"; a ocupação aparece como 12% de 132 h, e a Agenda diz 31% hoje.
- O que deveria acontecer: abrir a tela com uma faixa no topo "Você veio da sugestão 'faltas na quarta': ligue o lembrete 2 h antes aqui". Trocar "régua" por "lembretes automáticos" e "braço" por "grupo". Usar um só número de faltas por período.

**A16 · Dados da demonstração que não batem entre telas.** Impacto: **médio** (quebra a confiança numa demo de vendas).
- Agenda e Caixa usam "Cliente Exemplo Ana/Bruno". Clientes usa "Cliente AB (exemplo)" e "Visitante sem login". Domicílio usa "Ana Souza, Carlos Lima, Bia Rocha". Relacionamento usa "Ana Beatriz (exemplo), Carlos (exemplo)".
- O negócio tem "21 dias" de cadastro (`demoPort.ts:18`), mas os insights falam de 21/08 a 20/10 e de 5 de 5 semanas desde 14/09.
- "Publicado em 03/11/2026" convive com a demo em 20/10.
- O conteúdo aprovado diz "em Pinheiros" mesmo depois de publicar com o bairro "Centro".

**A17 · O cartão da Home e o insight repetem a mesma cobrança.** Impacto: **baixo**.
- O que acontece: depois de publicar, aparecem "Próximo (opcional): Pôr foto e WhatsApp" e logo abaixo "Perfil: 3 de 4 itens prontos". O insight "Horário vazio…" é lido duas vezes por leitor de tela: o link "Ver" leva o título no nome, e os outros dois são botões com `aria-label`.
- O que deveria acontecer: esconder o insight `profile_incomplete` enquanto o cartão do P44 estiver visível.
- Evidência: `p1_03_home_pos_publicar.png`.

**A18 · O toast do dono aparece na página pública.** Impacto: **baixo**. "Perfil publicado." continua visível em `/p/barbearia-exemplo-a`. Limpar os avisos ao entrar no `PublicLayout`. Evidência: `p1_05_publico_dia.png`.

**A19 · O passo do perfil não avisa que o bairro é obrigatório.** Impacto: **baixo**. O porquê do passo ("O link público é como o cliente reserva…") deveria dizer "Você só precisa do bairro ou região". Evidência: `p1_02b_publicar_sem_bairro.png`.

**A20 · O aviso de saúde para o personal é só uma proibição.** Impacto: **baixo/médio**. "Não cadastre dados de saúde… nem nas observações" (`/app/conta/novo-negocio`). O personal precisa registrar restrições. Faltam a explicação ("porque são dados sensíveis pela LGPD") e uma alternativa ("anote só 'evitar impacto em joelho' sem diagnóstico", se o jurídico aprovar).

**A21 · A ordem dos passos não segue o docs/12.** Impacto: **baixo/médio**. O docs/12 propõe profissão → horário → serviços → cliente/reserva → link. Hoje a frase, o melhor atalho, aparece como um link pequeno embaixo do cartão e, em `/app/configurar`, **depois** da lista de 8 passos. A política é obrigatória antes do perfil. Para um negócio novo, a frase deveria ser o primeiro bloco da tela e o botão principal do cartão.

### O que não consegui testar

- O cadastro real, criar negócio e o estado "0 de 8": a demo bloqueia (`services.tsx:83-114`). Por isso não medi o tempo real até o link para um negócio novo, nem o atalho "descreva seu negócio" no cartão (que só aparece com horários ou serviços faltando).
- A edição de horários dia a dia (Horários → Editar) e o formulário de Serviços: os dois estão bloqueados ou foram vistos só por leitura.
- O primeiro mês (resumo semanal, "Avançar 30 dias", acompanhamento): vi a tela de Metas, mas não percorri.
- O P46 com provedor ligado: só existe `LLM_PROVIDER=none`, e "Redigir um texto" não foi testado.
- O canal de WhatsApp verificado: fora da demo.

## 4. Onde um assistente de IA (P46) mudaria a experiência

Princípio do plano: regra calcula e modelo redige. Abaixo, o texto que o assistente deveria dizer em cada ponto, usando só dados que o sistema já tem.

1. **Logo depois de criar o negócio** (hoje cai na Conta, A7). Abrir o assistente ou o cartão com:
   > "Oi! Para seu link de reservas funcionar, preciso de 4 coisas: seus dias e horários, pelo menos um serviço com preço, até quando o cliente pode cancelar e o bairro. Quer me contar numa frase? Por exemplo: 'sou barbeiro, sozinho, de terça a sábado das 9 às 19, faço corte e barba'. Eu monto o rascunho e você confere cada campo antes de salvar."

2. **Leitura da frase com dois turnos ou negação** (A4). Em vez de gravar errado:
   > "Entendi segunda a sexta das 6h às 12h **e** das 17h às 21h. Vou salvar como dois períodos por dia, com pausa das 12h às 17h. Confere?"

   > "Você disse que **não** atende domingo e segunda. Então marquei terça a sábado. Está certo?"

   > "Não usei este trecho: 'e sábado 8 às 16'. Quer que o sábado tenha um horário diferente?"

3. **Serviços sem preço no rascunho** (A9):
   > "Você citou coloração. Coloração costuma durar cerca de 2 horas, e o modelo de cabeleireira usa a faixa de R$ 120 a R$ 350 como ponto de partida, não como média de mercado. Qual é o seu preço? Se varia com o comprimento do cabelo, me diga o menor e eu deixo 'a partir de'."

4. **Nome repetido** (A8):
   > "Você já tem um serviço chamado 'Corte' (30 min, R$ 60). Quer manter o atual e criar só Escova, Coloração e Hidratação, ou criar um 'Corte feminino' separado?"

5. **Política de cancelamento** (A3, A21). Explicar o porquê no tom da profissão:
   > "Para barbearia, o mais comum é aceitar cancelamento até 2 h antes. Isso aparece para o cliente antes de confirmar a reserva. Se ele cancelar depois, a Tinindo não cobra nada sozinha: só registra, para você decidir. Quer usar 2 h e sem multa por enquanto?"

   Isso só vale se a política passar a aparecer no link. Se não aparecer, o assistente não pode dizer isso.

6. **Personal a domicílio** (A13):
   > "Você atende na casa dos alunos. Quer que eu reserve tempo de deslocamento antes de cada sessão e peça o bairro do aluno no link? Me diga os bairros que você atende."

   > "Pacotes: o seu 'Pacote de 10 sessões' é vendido no Caixa, depois que a 'Sessão individual' existir. Posso abrir a venda do pacote agora?"

7. **Depois de publicar o link**:
   > "Seu link está no ar: tinindo…/p/seu-nome. Uma boa primeira ação é colocar na bio do Instagram e no status do WhatsApp. Quer que eu prepare uma mensagem curta para você mandar aos seus clientes? Você revisa antes de enviar."

8. **Reserva pelo link sem cadastro** (A11):
   > "O João Teste reservou Corte hoje às 16h pelo link. Quer salvar o João como cliente? Assim o próximo atendimento já sai com nome e WhatsApp."

9. **Concluiu e não cobrou** (A12):
   > "Atendimento das 9h com a Ana concluído (Corte, R$ 60 combinados). Já recebeu? Pix · Dinheiro · Cartão · Cobrar depois."

10. **Explicar um insight** (A15, `explainInsight` do P46 ainda não ligado):
   > "Nas quartas, 5 de 12 atendimentos tiveram falta entre 21/08 e 20/10, bem acima dos outros dias. Ligar um lembrete 2 h antes costuma ajudar. Quer que eu abra os lembretes já nesse ponto?"

   Os números vêm do motor, não do modelo.

11. **Pergunta não entendida** (A6). Nunca terminar em "Não entendi":
   > "Ainda não sei fazer isso por aqui, mas te levo à tela certa: [Horários] [Serviços] [Perfil e link]. Ou toque em 'Me ajuda a configurar' para seguirmos passo a passo."

12. **Guia de configuração** (A5). Deve ler o mesmo estado da Home e, quando o dono disser "já fiz", conferir de verdade:
   > "Conferi: seus horários e serviços estão salvos. Falta só publicar o perfil. É o último passo obrigatório e leva menos de um minuto: informe o bairro e toque em Publicar."
