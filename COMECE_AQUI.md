# Tinindo · arquitetura e execução

Versão 2.0 · 17 de outubro de 2026 · Para Felipe, Gabriel e sessões de Claude Code/Codex.

**Decisão recomendada:** construir um aplicativo web de operação de serviços, com um assistente que usa ferramentas confiáveis. Começar com profissionais de beleza e personal trainers conhecidos pelos fundadores. Entregar em sete dias um piloto privado, com agenda real, ofertas por horário, lista de espera, clientes e recebimentos básicos. Conquistar o direito de expandir com uso observado.

Este pacote é uma arquitetura executável como plano de trabalho, com especificações, protocolos e uma ferramenta de coordenação. **Não é o aplicativo implementado.** Os testes entregues validam a coordenação local; segurança, concorrência e integrações do aplicativo ainda precisam ser implementadas e homologadas. Não foi feito push, alteração do site, provisionamento ou contratação.

## O que abrir primeiro

1. `docs/17_MAPA_COMPLETO_DESENVOLVIMENTO.md`: sistema inteiro, oito fases e 42 pacotes.
2. `docs/00_PRODUTO.md` e `docs/15_RECONCILIACAO_GABRIEL.md`: produto e jornadas comerciais.
3. `docs/07_FASES_E_PACOTES.md`: primeira entrega, dependências e meta de sete dias.
4. `docs/08_DESENVOLVIMENTO_PARALELO.md`: reserva, branches, revisão e integração.
5. `prompts/00_BOOTSTRAP.md`: primeira sessão, conduzida por um integrador.
6. `CLAUDE.md` e `AGENTS.md`: instruções permanentes na raiz do repositório.

O PowerPoint entregue separadamente explica o processo ao Gabriel. A arquitetura detalhada está em `docs/01_ARQUITETURA.md`; as decisões ainda abertas, em `docs/13_DECISOES_E_FONTES.md`.

## O que já foi verificado

- Site público revisado em 17/10/2026: home, aba de agenda, acesso `/cliente/` e privacidade. O login existe; não houve acesso autenticado nem auditoria do backend.
- Repositório canônico do app: `tinindoapp/tinindo-v1` (confirmado no P00; ver `docs/adr/0001`). Ele não hospeda o site público atual.
- A documentação atual do Lovable descreve sincronização de uma branch ativa e criação de repositório ao vincular projeto. Confirmar o repositório canônico antes de distribuir trabalho.
- A política de privacidade publicada ainda exibe rascunho, CNPJ e prazo de retenção por definir. Resolver antes de importar dados reais de clientes.

## Instalação do kit

Não extrair cegamente sobre um projeto existente. Fazer uma branch `chore/architecture-kit`, comparar arquivos e preservar código, histórico, configurações e instruções já existentes. O nome deste arquivo evita substituir o README do aplicativo.

1. Definir o repositório canônico a partir do projeto Lovable, se já existir. Nunca operar dois espelhos bidirecionais.
2. Copiar este kit para a raiz por um PR de documentação. Resolver conflitos de `CLAUDE.md`/`AGENTS.md` explicitamente.
3. Rodar `python3 -m unittest discover -s tests_coordination -v`.
4. Executar P00 antes de abrir várias sessões. Ele adapta caminhos, cria o app mínimo, congela contratos, configura CI e ambientes.
5. Criar a branch exclusiva `coordination` a partir de `main`, uma única vez. Inicializar o quadro com `scripts/coord.py init` usando seu login GitHub como integrador. Ver guia e `--help`.
6. Só iniciar tarefas que o quadro remoto considere disponíveis. Começar com até quatro implementadores simultâneos e um integrador, mesmo que haja mais contas/modelos.

Os arquivos de CI do aplicativo e CODEOWNERS estão em `templates/`, intencionalmente. P00 deve adaptá-los e ativá-los; um template não é um controle já instalado.

## Estrutura do pacote

| Área | Finalidade |
|---|---|
| `docs/00` a `docs/18` | Produto, arquitetura, dados, contratos, segurança, IA, regras, fases, operação, testes, custos, fontes, expansão, reconciliação dos mapas do Gabriel e aplicação da marca |
| `tasks/P00.md` a `tasks/P10.md` | Briefings fechados por pacote, arquivos permitidos e critérios de aceite |
| `tasks/P11.md` a `tasks/P41.md` | Próximos pacotes planejados, ainda fora do quadro ativo |
| `coordination/manifest.json` | Definição inicial das tarefas; não é o estado vivo do trabalho |
| `scripts/coord.py` | Reserva, heartbeat, handoff, bloqueio e conclusão por PR no GitHub |
| `tests_coordination/` | Testes da coordenação, sem escrever no GitHub |
| `prompts/` | Início de sessão, revisão, integração e retomada |
| `templates/` | PR, issue, CI, ownership e ambiente, a adaptar no bootstrap |

## Cinco decisões que mudam o projeto

1. **Postgres/Supabase**, por transações, relações e isolamento, salvo backend existente que justifique preservação.
2. **Monólito modular**, com frontend React/TypeScript e funções de backend; sem microsserviços no piloto.
3. **Preço dinâmico por regras**, sem alegação de prever elasticidade com poucos dados.
4. **GitHub é a fonte de verdade**; o Lovable visualiza a branch integrada de homologação e não recebe credenciais de produção.
5. **Integração desde o primeiro dia**. O décimo pacote certifica a entrega; não é o primeiro momento em que as peças conversam.

## Revisão com os documentos do Gabriel

Antes de escolher tarefas, ler `docs/15_RECONCILIACAO_GABRIEL.md`. O anexo `docs/16_MATRIZ_228_SERVICOS.md` preserva todas as oportunidades. Os IDs do catálogo não são IDs do quadro. Fase P1 do PDF não autoriza incluir funcionalidades na semana 1. O doc15 define a reconciliação comercial; o doc17 define as macrofases atuais e a atribuição dos pacotes; os invariantes de segurança continuam obrigatórios.

## Mapa completo v2 e identidade visual

Ler `docs/17_MAPA_COMPLETO_DESENVOLVIMENTO.md` primeiro para entender as oito macrofases e os 42 pacotes. Ele substitui a numeração antiga das fases futuras, preservando P00–P18. A responsabilidade é definida na reserva da tarefa, sem dono permanente por pacote. Apenas o manifesto ativo libera implementação.

A marca vem de `brand/BRAND.md` e `brand/tokens/`. Usar os ativos originais. Não inventar outro logotipo, paleta ou promessa de integração. Marca visual não muda o estado real das funcionalidades.
