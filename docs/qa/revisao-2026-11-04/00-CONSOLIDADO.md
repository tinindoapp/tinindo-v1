# Revisão geral · 04/11/2026

Seis agentes revisaram a `main` em b7b58fc (P00–P46 entregues), só testando e lendo, sem mudar código. Cada relatório completo está nesta pasta:

| # | Área | Relatório |
|---|---|---|
| 1 | Jornada do profissional (barbeiro, cabeleireira, personal) | `01-jornada-profissional.md` |
| 2 | Links, rotas e navegação | `02-links-e-navegacao.md` |
| 3 | Gravação no banco (152 comandos) | `03-escrita-em-banco.md` |
| 4 | Responsividade e acessibilidade (59 rotas × 6 tamanhos × 2 temas) | `04-responsividade-acessibilidade.md` |
| 5 | Experiência do cliente final | `05-cliente-final.md` |
| 6 | Assistente de IA por fluxo | `06-assistente-ia-por-fluxo.md` |

Screenshots e scripts ficaram fora do repositório (cerca de 28 MB), na pasta de trabalho da sessão de revisão.

## Veredito

- **Banco: sólido.** 1.779 testes pgTAP, 27 cenários de concorrência e 142 de integração passaram num Postgres limpo. As 152 operações levam ao banco exatamente os campos do contrato, e as RPCs autorizam antes de gravar.
- **Navegação: sólida.** Nenhum link aponta para rota inexistente; 163 cliques com "voltar" e 42 URLs inválidas ou profundas sem erro de console nem requisição falha.
- **Layout: bom.** Só a Home rola para o lado (em 320 px); nenhum campo dá zoom no iPhone; teclado virtual não cobre campos.
- **O que preocupa está nas bordas:** novas tentativas que duplicam dado no front, a configuração guiada e o assistente recém-entregues, e a jornada do cliente final quando algo sai do caminho feliz.

## Corrigir primeiro (alto impacto)

| # | Problema | Onde | Fonte |
|---|---|---|---|
| 1 | **Nova tentativa duplica dado** e a tela diz que é seguro: compra de materiais (estoque e despesa em dobro), mensagem ao cliente enviada duas vezes, recebimento parcial e despesa no Caixa (a chave inclui `now()`), conta a pagar mensal e plano de recorrência (série inteira duplicada) | `MaterialsPage.tsx:110`, `InboxPage.tsx:100/165`, `FinancePage.tsx:454/619`, `AccountsPage.tsx:40`, `RecurrencePage.tsx:39` | 3 (A1–A5) |
| 2 | **Próximo passo da configuração guiada invisível** (texto preto sobre preto, contraste 1:1) | `src/features/setup/setup.css:19` | 1, 2, 4 |
| 3 | **"Me ajuda a configurar" nunca carrega com servidor**: o guia valida com um schema diferente do contrato `setup.progress`; o teste só cobre a falha | `src/features/agent/setupGuide.ts` | 6 |
| 4 | **Frase do negócio erra e salva com "Salvo"**: "não atendo domingo e segunda" vira atendimento nesses dias; dois turnos perdem o segundo; "pacote com 4 sessões" vira "4 pessoas" | `supabase/functions/_shared/domain/setup/describe.ts` | 1 |
| 5 | **Cliente bloqueado depois de 5 códigos errados**: pedir de novo herda as tentativas e até o código certo é recusado; o horário fica preso | migrations P43 (`…164500:235`, `…033000:150`) | 5 |
| 6 | **Corrigir o WhatsApp no link faz perder o próprio horário**, e o código já foi para o número errado | P43 | 5 |
| 7 | **"Enviamos um código" mesmo quando o envio falhou**; não há "reenviar código" | `PublicProfileView.tsx` (ignora `delivery`) | 5 |
| 8 | **"Minhas reservas" e "Avaliar" inalcançáveis**: nenhuma tela gera o código de vínculo; login sempre leva a `/app` ("Criar meu negócio"); código de 43 caracteres à mão | `customer_link.issue` sem chamada; `SignIn.tsx:16` | 5, 2 (F4) |
| 9 | **Home rola para o lado em 320 px** e o valor passa da borda em 375 px | `src/app/pages/pages.css:20-24` | 4 |
| 10 | **Na demonstração, a configuração guiada não muda o resto do app** (horários e serviços salvos não aparecem na Agenda, Serviços e link) | `src/features/setup/demoPort.ts` | 1 |

## Corrigir em seguida (médio)

- **Política de cancelamento** é obrigatória "porque o cliente vê", mas o link público não mostra; reserva sem preço nem endereço com o padrão "Mostrar preços" desligado (1, 5).
- **Login não guarda o destino**: `/avaliar?…`, "Minhas reservas" e `/app/metas?insight=…` caem em "Hoje" (2, F4).
- **Âncoras da configuração** (`#modelos`, `#descrever`) não rolam até o trecho; foco perdido depois de "Agora não" e de sugestões do assistente (2, 4).
- **Assistente** responde errado com confiança ("por que tenho faltas na quarta?" → agenda de amanhã) e diz "Não entendi" para "como publico meu link?"; progresso do guia (4 de 8) contradiz a Home (5 de 8) (1, 6).
- **Prévia do link no WhatsApp** fora de `/p/` e `/s/` mostra o slogan para profissionais — num link de Pix parece golpe; página do Pix sem prazo e com texto que pode induzir pagamento duplo (5).
- **Mensagens ao cliente** (código, lembrete, cobrança, orçamento) não dizem o nome do negócio (5).
- **Contas a pagar**: "-R$ 1.235,00" quebra o sinal sozinho na linha (4).
- **Menu do celular** não prende o foco (4).
- **`channel.verify`** repetido com código errado dá 500 em vez de 422 (3, A6, reproduzido).
- **Erro depois de sucesso** em ~80 telas que trocam a chave a cada toque (o banco barra, mas a pessoa vê erro) (3, A7).
- **Depois de "Atendido"** nada leva à cobrança; reserva pelo link fica "Sem cliente cadastrado" sem botão para salvar; personal a domicílio sem caminho no link público (1).
- **Diretório da demonstração** leva a perfis inexistentes; páginas públicas de "não encontrado" sem saída (2).

## Correções que resolvem muitos achados de uma vez

1. **Um hook único de chave de idempotência por conteúdo** (mantém a chave no erro, troca só no sucesso — o `createKeyRing` do CRM já faz isso), aplicado em toda a base, e texto "tentar de novo é seguro" só onde for verdade. Resolve 1 e o erro depois de sucesso.
2. **Configuração guiada com uma fonte só**: o assistente lê `setup.progress`/`setup.dismiss` do contrato oficial, a demonstração usa o mesmo `demoPort` e grava no resto do app, e a frase passa por testes com as frases reais das três personas.
3. **Jornada do cliente no link**: liberar o pedido anterior ao corrigir o número, zerar tentativas ao trocar (com limite por contato contra abuso), mostrar o estado real do envio com "reenviar", e mostrar preço base e política antes de confirmar.
4. **Vínculo do cliente**: botão "Mandar link de acesso" na ficha do cliente (gera o código e abre o WhatsApp com o link completo), login que volta ao destino, e entrada própria para quem é só cliente.

## Assistente de IA (P46): o fluxo proposto

Três gestos dentro de cada tela, sempre terminando no formulário ou confirmação que já existe — o modelo nunca grava:

- **"Por quê?"** (EXPLAIN) explica um número, passo ou erro com os dados já calculados.
- **"Faz comigo"** (SETUP) abre a tela de sempre preenchida, com selo em cada campo sugerido; quem salva é o botão de sempre.
- **"Escreve pra mim"** (DRAFT) devolve o texto ao campo de onde veio.

O chat fica como atalho. No máximo uma sugestão proativa por tela por dia; "Agora não" silencia por 30 dias. O relatório 6 tem um bloco por fluxo (25), a primeira semana de cada persona e 16 lacunas técnicas.

Ordem sugerida (sessões de ~6 h):

| Ordem | Entrega | Esforço |
|---|---|---|
| 1 | Consertar o guia e unificar a configuração (item 3 acima) | 0,5 |
| 2 | Ligar o provedor em homologação com medição de custo por negócio e CEP na redação de dados pessoais | 1 (depende de chave e termos) |
| 3 | Frase do negócio pelo servidor (`setup.describe`) | 1 |
| 4 | Padrão "Faz comigo" (`assist.form_draft`) nos 4 primeiros formulários: lembretes, horários, serviço, assinatura | 2 |
| 5 | Explicação dos insights com cache | 1 |
| 6 | Chat que entende "por quê" e "configurar" | 1,5 |
| 7 | Segunda onda de formulários | 2–3 |
| 8 | Painel de qualidade do assistente | 0,5 |

Custo estimado (não medido) com Claude Haiku 5.5: cerca de US$ 0,02 por negócio por mês na franquia de 200 perguntas.

## O que não foi testado

Servidor real (tudo foi em modo demonstração, exceto os testes de banco), Safari/WebKit e iPhone real, leitores de tela reais, o Worker da Cloudflare servindo a prévia do link, e o assistente com provedor de IA ligado.
