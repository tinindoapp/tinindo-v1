# Pendências jurídicas e de decisão · documentos legais

Versão 0.2 · 20/11/2026 (P57: retenção, exportar e eliminar, borda pública). Versão 0.1 · 18/10/2026. Os documentos em `docs/legal/` são **rascunhos para revisão jurídica**. Nada aqui foi revisado por advogado. Antes de publicar a política e os termos, ou de importar dados reais de clientes (`COMECE_AQUI.md`; `docs/10_TESTES_E_ACEITE.md` exige "política de privacidade final"), cada item abaixo precisa de resposta.

Legenda de responsável: **F** = fundadores; **ADV** = advogado; **ENG** = integrador/engenharia.

## A. Identificação da empresa

| # | Pendência | Resp. | Onde aparece |
|---|---|---|---|
| A1 | Razão social e CNPJ da pessoa jurídica que opera a Tinindo (a política publicada hoje ainda exibe CNPJ por definir) | F | Política §1, Termos §1 |
| A2 | Endereço completo da sede | F | Política §1, Termos §1 |
| A3 | Indicação do encarregado (DPO): nome ou função e canal. Avaliar dispensa para agente de pequeno porte (Resolução CD/ANPD nº 2/2022), mantendo canal de comunicação de qualquer forma | F + ADV | Política §1 |
| A4 | E-mail de suporte e e-mail dedicado de privacidade; formulário no app, se houver | F | Política §1/§9, Termos §1/§6 |
| A5 | Data de publicação e esquema de versionamento dos documentos (a versão aceita deve ser registrada em `consents.policy_version`) | F + ENG | Cabeçalhos |

## B. Papéis e contratos

| # | Pendência | Resp. |
|---|---|---|
| B1 | Validar a divisão controlador/operador por fluxo (gestão do profissional = Tinindo operadora; conta, rede e perfil público = Tinindo controladora) | ADV |
| B2 | Decidir se haverá acordo de tratamento de dados (DPA) entre Tinindo e profissional, anexo aos Termos ou aceite separado | ADV |
| B3 | Fluxo para atender pedidos de clientes finais sobre dados em que o profissional é controlador (encaminhar, prazos, o que a Tinindo faz se o profissional não responder) | ADV + F |
| B4 | Enquadramento da responsabilidade da Tinindo perante o cliente final e perante o profissional no CDC; se profissional PJ/MEI é consumidor | ADV |
| B5 | Cláusula de limitação de responsabilidade (Termos §11) | ADV |
| B6 | Foro (Política §13, Termos §14) | ADV |

## C. Bases legais

| # | Pendência | Resp. |
|---|---|---|
| C1 | Teste de balanceamento (LIA) documentado para legítimo interesse: indicações/convites, segurança e antifraude, estatísticas de produto, auditoria | ADV |
| C2 | Confirmar consentimento como base da lista de espera e o texto exato do pedido de consentimento (separado do transacional) | ADV + F |
| C3 | Confirmar que lembretes de reserva são transacionais (execução de contrato) e não marketing | ADV |
| C4 | Tratamento de contato de terceiro fornecido em indicação: o que pode ser feito antes de o indicado aceitar | ADV |
| C5 | Regra para atendimento de menores (cadastro em nome do responsável?) e redação da seção de menores | ADV |

## D. Fornecedores e transferência internacional

| # | Pendência | Resp. |
|---|---|---|
| D1 | Região do projeto Supabase de produção (impacta a seção de transferência internacional) | ENG |
| D2 | Escolha do provedor de LLM; confirmar DPA, retenção de entradas, não uso para treinamento e local de processamento | F + ENG |
| D3 | Fornecedor de e-mail transacional e de logs/observabilidade, se houver | ENG |
| D4 | Meio de cobrança da assinatura (link externo, PSP) e o que ele recebe de dados | F |
| D5 | Arquivar DPAs/termos de tratamento de Supabase, Cloudflare e demais; verificar adequação às cláusulas-padrão da Resolução CD/ANPD nº 19/2024 | ADV + ENG |
| D6 | Confirmar se o site/app usa cookies ou analytics de terceiros; se sim, aviso de cookies | ENG + ADV |

## E. Retenção

`docs/02_DADOS_E_INVARIANTES.md` proíbe inventar prazo legal universal. Em 10/11/2026 o Felipe adotou a **D25** (idempotência 30 dias; eventos e webhooks 90 dias; mensagens e execuções do assistente 12 meses; código de verificação apagado ao fim do envio; pedido não confirmado 30 dias). O P57 implementou esses prazos (`public.retention_policies`, `app.retention_tick` em `job_ticks`, relatório sem conteúdo em `retention_runs`). **Continuam dependendo do advogado:** a D25 inteira (ADV confirma ou ajusta; mudar prazo é uma linha numa migration nova) e os itens abaixo sem prazo.

| # | Categoria | Situação (20/11) | Observação |
|---|---|---|---|
| E1 | Janela de exportação após encerramento de conta (`[N dias]`) | **Depende de ADV.** Hoje: o dono exporta até a carência de 7 dias da eliminação acabar; depois, o acesso termina | Decisão de produto + ADV |
| E2 | Dados do negócio do profissional após fim do contrato | **Depende de ADV.** Eliminação a pedido implementada (anonimiza; valores e fiscais ficam) | Tinindo é operadora; prazo deve constar no DPA |
| E3 | Registros de acesso (mínimo 6 meses pelo Marco Civil art. 15); prazo máximo | **Depende de ADV** e da ferramenta de log (D3) | ADV |
| E4 | Documentos fiscais e de cobrança da Tinindo | **Depende de ADV/contador.** Eliminação mantém `fiscal_documents` com nome e documento do tomador | ADV/contador |
| E5 | Consentimentos e revogações (prazo de prova) | **Depende de ADV.** Eliminação do cliente mantém `contact_consents` (prova), ligado ao cadastro anonimizado | ADV |
| E6 | Auditoria, propostas/aprovações, `agent_runs` | **Assistente: D25 (12 meses), implementado. Auditoria e pedidos de eliminação: depende de ADV** | ADV + ENG |
| E7 | Logs técnicos, idempotência, outbox/jobs, contexto do assistente | **D25 implementada** (idempotência 30 d; fila e webhooks 90 d). Logs técnicos da plataforma: depende de D3 | ENG (curto) |
| E8 | Indicações pendentes e ofertas de lista de espera expiradas | **Aberto** (fora da D25) | F + ENG |
| E9 | Ciclo de backups (banco e Storage separadamente) e como exclusões se propagam | **Aberto.** Arquivos de exportação vencidos e fotos de negócio eliminado precisam da API do Storage para sumir (recado ao integrador) | ENG |

## F. Direitos do titular e incidentes

| # | Pendência | Resp. |
|---|---|---|
| F1 | Prazo de resposta a pedidos de titular (LGPD prevê 15 dias para a declaração completa de acesso; confirmar regulamentação vigente) | ADV · **depende de ADV**; a exportação sai na hora |
| F2 | Procedimento de verificação de identidade do solicitante | ADV + ENG · **depende de ADV**: hoje o dono (controlador) atende o cliente e confere quem pede; a Tinindo não verifica |
| F3 | Procedimento e prazo de comunicação de incidente à ANPD e aos titulares (Resolução CD/ANPD nº 15/2024) e responsável | ADV + F |
| F4 | Implementar exportação CSV/JSON por negócio e exclusão com trilha (já previsto em doc02) antes de dados reais | ENG · **feito no P57** (JSON por negócio e por cliente; eliminação com carência e trilha). **ADV valida** que anonimizar e manter valores/fiscais atende ao art. 16 e ao art. 18, VI |

## Borda pública (P57)

| # | Pendência | Resp. |
|---|---|---|
| F5 | Limite de abuso da reserva pública (D30 a) usa o IP só como hash diário com pimenta, apagado em 1 dia; confirmar base (LI, segurança) e citar na política | ADV |
| F6 | Turnstile (D30 b) fica para depois; se entrar, é suboperador novo (Cloudflare) e muda a seção de cookies/terceiros | F + ENG + ADV |

## G. Condições comerciais (Termos §8)

A promessa pública (grátis + Completo R$79/mês de fundador por 12 meses) foi preservada. Faltam:

| # | Pendência | Resp. |
|---|---|---|
| G1 | Marco inicial dos 12 meses: adesão ou primeira cobrança | F |
| G2 | O que acontece depois dos 12 meses (manter, novo preço com aviso de N dias, etc.) | F |
| G3 | Janela ou limite de vagas da condição de fundador | F |
| G4 | Franquias e limites dos planos Grátis e Completo (obrigatório antes de ativar cobrança, doc00) | F + ENG |
| G5 | Efeito do cancelamento (fim do período pago ou imediato), reembolso e direito de arrependimento (CDC art. 49) | F + ADV |
| G6 | Prazo de tolerância para atraso antes de voltar ao plano grátis | F |
| G7 | Prazo de aviso prévio para mudanças nos Termos (`[N dias]`) | F + ADV |

## H. Publicação

| # | Pendência | Resp. |
|---|---|---|
| H1 | Substituir a política provisória em `tinindoapp.com.br/privacidade` (repositório do site é outro; ver `docs/13_DECISOES_E_FONTES.md`) só após revisão | F |
| H2 | Registrar aceite dos Termos e versão da Política no cadastro (profissional e cliente com conta) | ENG |
| H3 | Aviso no app orientando profissionais a não registrarem dados de saúde em campos livres | ENG |
| H4 | Remover os avisos de RASCUNHO apenas após aprovação do advogado | F |

## Nota de processo

Esta entrega foi feita a pedido direto do usuário, com escopo restrito a `docs/legal/`. Não houve reserva no quadro de coordenação (`scripts/coord.py claim`) porque a tarefa não corresponde a um pacote `Pxx` do manifesto e a reserva exigiria escrever fora de `docs/legal/`. O integrador pode vincular este trabalho ao pacote de privacidade quando for aberto.
