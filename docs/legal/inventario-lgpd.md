> **RASCUNHO PARA REVISÃO JURÍDICA.** Versão 0.2 · 20/11/2026 (P57).
> Inventário de dados pessoais (registro das operações de tratamento, art. 37 da LGPD) derivado de `docs/02_DADOS_E_INVARIANTES.md`, `docs/02_DICIONARIO.md` e `docs/04_SEGURANCA.md`. Reflete o banco do piloto, não um levantamento do banco em produção.
> Prazos marcados **D25** foram adotados pelo Felipe em 10/11/2026 e estão implementados (tabela `public.retention_policies`, rotina `app.retention_tick`); continuam **sujeitos à revisão do advogado** (`PENDENCIAS.md`, seção E). Prazos `[a definir]` também estão em `PENDENCIAS.md`.

# Inventário LGPD · Tinindo

## Legenda

- **Papel:** C = Tinindo controladora; O = Tinindo operadora (controlador é o profissional).
- **Bases (art. 7º):** CONS = consentimento (I); OL = obrigação legal (II); CONT = execução de contrato (V); DIR = exercício regular de direitos (VI); LI = legítimo interesse (IX); CTRL = base do controlador (profissional), em regra CONT entre ele e o cliente final.
- **Onde fica:** SB-DB = Supabase Postgres; SB-AUTH = Supabase Auth; SB-ST = Supabase Storage (buckets privados); CF = Cloudflare (hospedagem/borda); LLM = provedor de modelo de linguagem `[a definir]`; LOG = logs técnicos `[ferramenta a definir]`; BKP = backups do Supabase. Região do Supabase `[a confirmar]`.

## Inventário

| # | Dado / tabela lógica | Titular | Finalidade | Papel | Base legal | Retenção (proposta) | Onde fica |
|---|---|---|---|---|---|---|---|
| 1 | E-mail, telefone, identificador de login (`auth.users`) | Profissional, cliente com conta | Autenticação e segurança da conta | C | CONT; LI (segurança) | Conta ativa + `[N dias]` após encerramento | SB-AUTH, BKP |
| 2 | Nome do negócio, fuso, moeda, status (`tenants`) | Profissional | Prestar o serviço contratado | C | CONT | Conta ativa + `[N dias]` | SB-DB, BKP |
| 3 | Papel no negócio (`tenant_memberships`) | Profissional / equipe | Controle de acesso | C | CONT; LI (segurança) | Enquanto ativo + `[N dias]` | SB-DB, BKP |
| 4 | Cadastro de cliente: nome, telefone normalizado, e-mail, observações (`customers`) | Cliente final | Gestão do atendimento pelo profissional | O | CTRL | Até o profissional excluir ou fim do contrato + `[N dias]`; arquivado ≠ excluído | SB-DB, BKP |
| 5 | Vínculo conta ↔ cadastro, data de verificação (`customer_links`) | Cliente final | Permitir ao cliente ver as próprias reservas | C (conta) / O (cadastro) | CONT | Enquanto ambos existirem | SB-DB, BKP |
| 6 | Serviços, preços, custos, regras de preço (`services`, `price_rules`) | Profissional (dado do negócio) | Operar catálogo e ofertas | C | CONT | Conta ativa + `[N dias]` | SB-DB, BKP |
| 7 | Disponibilidade, bloqueios, férias (`availability_*`) | Profissional | Calcular horários livres | C | CONT | Conta ativa + `[N dias]` | SB-DB, BKP |
| 8 | Reservas: cliente, serviço, horário, status, preço (`bookings`, `price_quotes`) | Cliente final | Agendar, reagendar, cancelar; congelar preço | O | CTRL | Até o profissional excluir ou fim do contrato + `[N dias]`. Na eliminação, o nome digitado (`guest_ref`) é apagado; data, serviço e valor ficam | SB-DB, BKP |
| 8a | Pedido pelo link público: nome, WhatsApp, bairro, código de 6 dígitos (`public_booking_requests`) | Cliente final | Segurar o horário e confirmar pelo código | O | CTRL; LI (antifraude) | **D25:** código em claro e hash apagados no fim do envio (pedido sem espera ou código vencido); pedido não confirmado apagado em 30 dias; confirmado segue a reserva | SB-DB, BKP |
| 8b | Tentativas de reserva por origem: sha256 de IP + dia + pimenta (`public_origin_hits`) | Visitante do link | Limite de abuso da reserva pública (D30 a) | C | LI (segurança) | 1 dia (o banco nunca recebe o IP) | SB-DB |
| 9 | Lista de espera: janelas aceitáveis, status (`waitlist_entries`, `waitlist_offers`) | Cliente final | Oferecer vaga liberada | O | CONS do cliente (coletado pelo fluxo, registrado em `consents`) | Até expirar a entrada ou revogação; ofertas expiradas `[definir, curto]` | SB-DB, BKP |
| 10 | Pacotes e créditos de sessões (`session_packages`, `session_entries`) | Cliente final | Controlar sessões vendidas e consumidas | O | CTRL | Até o profissional excluir ou fim do contrato + `[N dias]` | SB-DB, BKP |
| 11 | Recebíveis, pagamentos registrados, alocações (`receivables`, `payment_*`) | Cliente final | Controle de recebimentos do profissional (sem movimentar dinheiro) | O | CTRL | Decisão do profissional; ledger append-only até fim do contrato + `[N dias]` | SB-DB, BKP |
| 12 | Despesas (`expense_entries`) | Profissional | Visão de caixa do negócio | C | CONT | Conta ativa + `[N dias]` | SB-DB, BKP |
| 13 | Consentimentos: finalidade, canal, origem, datas, versão da política (`consents`) | Cliente final, profissional | Provar consentimento e revogação | C (marketing Tinindo) / O (lista de espera) | OL (art. 8º §2º, ônus da prova); LI | Vigência + `[prazo de prova a definir]` | SB-DB, BKP |
| 14 | Perfil público: slug, categoria, área, campos escolhidos (`public_profiles`) | Profissional | Rede Tinindo / divulgação | C | CONT (publicação opt-in) | Até despublicar ou encerrar conta | SB-DB, CF (cache), BKP |
| 15 | Indicações e convites: tipo, quem convidou, hash do token, contato informado (`referrals`) | Profissional, cliente indicante, indicado | Atribuição e convite pessoal; sem marketing automático | C | LI (teste de balanceamento `[a documentar]`) | Pendentes: `[definir, curto]`; aceitos: enquanto conta ativa | SB-DB, BKP |
| 16 | Avaliações `[fase posterior]` | Cliente final, profissional | Reputação verificada | C | LI / CONT `[a definir]` | `[a definir]` | SB-DB |
| 17 | Pedidos ao assistente e contexto mínimo enviado ao modelo | Profissional; dados de clientes citados | Interpretar pedido e redigir | O (dados de clientes) / C (uso) | CTRL / CONT | O texto da pergunta não é guardado no banco; retenção no fornecedor `[confirmar zero/curta retenção]` | LLM |
| 18 | Execuções do assistente: quem perguntou e quando (`agent_runs`; sem texto) | Profissional | Auditoria, custo e franquia | C | LI; CONT (franquia) | **D25:** 12 meses | SB-DB, BKP |
| 19 | Propostas, aprovações e recibos: ferramenta, payload, hash, aprovador (`agent_proposals`, `agent_approvals`, `agent_receipts`) | Profissional; clientes no payload | Aprovação vinculante e prova de autorização | C / O | LI; DIR | **D25:** 12 meses, apagados junto com a execução | SB-DB, BKP |
| 20 | Idempotência: chave, hash, resposta (`idempotency_records`) | Indireto | Evitar operação duplicada | O / C | CONT; LI | **D25:** 30 dias | SB-DB |
| 21 | Fila de eventos (`outbox_events`) e dedupe de webhooks do canal e do PSP (`channel_webhook_events`, `payment_webhook_events`, sem payload) | Indireto | Execução confiável de tarefas | O / C | CONT | **D25:** 90 dias depois de entregue ou morto (pendente nunca é apagado); webhooks 90 dias | SB-DB |
| 21a | Mensagens do canal: corpo, estado, contato (`channel_messages`, `channel_contacts`) | Cliente final, profissional | Avisos e conversa pelo WhatsApp oficial | O | CTRL | **D25:** 12 meses; contato some na eliminação do cliente | SB-DB, BKP |
| 21b | Código de verificação do número do profissional (`channel_verifications`) | Profissional | Verificar o número do canal | C | CONT | **D25:** apagado quando usado ou vencido | SB-DB |
| 22 | Auditoria: ator, ação, objeto, antes/depois redigidos (`audit_events`) | Profissional, suporte, clientes (redigido) | Segurança, investigação de incidentes, acesso de suporte | C | LI; OL; DIR | `[a definir]` | SB-DB, BKP |
| 23 | Plano, período, limites, uso (`plan_entitlements`) | Profissional | Controlar plano e cota | C | CONT | Conta ativa + prazo fiscal se ligado a cobrança | SB-DB, BKP |
| 24 | Dados de cobrança da assinatura e notas fiscais da Tinindo | Profissional | Cobrar plano Completo e cumprir obrigação fiscal | C | CONT; OL | Prazo fiscal/contábil `[confirmar]` | `[meio de cobrança a definir]` |
| 25 | Registros de acesso à aplicação: IP, data/hora | Todos | Obrigação do Marco Civil, segurança | C | OL (MCI art. 15); LI | Mínimo 6 meses; máximo `[definir]` | LOG, CF |
| 26 | Logs técnicos: request_id, tenant técnico, status, latência (telefone e mensagem redigidos) | Todos (indireto) | Operação e diagnóstico | C | LI | `[definir, curto]` | LOG, CF |
| 27 | Fotos e anexos privados `[se houver]` | Profissional, cliente final | Operação do negócio | O | CTRL | Até exclusão; Storage tem backup próprio `[definir]` | SB-ST |
| 28 | E-mails transacionais enviados `[fornecedor a definir]` | Profissional, cliente | Login e avisos de reserva | C / O | CONT | Retenção do fornecedor `[confirmar]` | `[a definir]` |
| 29 | Backups do banco | Todos | Recuperação de desastre | C / O | LI; CONT | Rotação do fornecedor `[definir]`; dado excluído some ao fim do ciclo | BKP |
| 30 | Exportações a pedido do dono: o arquivo JSON (`privacy-exports`, bucket privado) e o pedido (`privacy_exports`: quem pediu, quando, estado; sem conteúdo) | Profissional; clientes finais (no arquivo) | Portabilidade e acesso (art. 18, II e V) | C (pedido) / O (conteúdo) | OL; CONT | Arquivo: 24 h, link assinado de 15 min; pedido: enquanto a conta existir `[confirmar]` | SB-ST, SB-DB |
| 31 | Pedidos de eliminação (`privacy_erasures`: quem pediu, carência, cancelamento, contagens do que foi tocado; sem conteúdo) | Profissional; cliente final (só o id) | Prova do atendimento ao titular (art. 18, VI) | C | OL; DIR | `[a definir, ADV]` | SB-DB, BKP |
| 32 | Relatório da retenção (`retention_runs`: categoria, quando, quantas linhas) | Nenhum (sem dado pessoal) | Prova de que a retenção roda | C | LI | 400 dias | SB-DB |

## Exportar e eliminar (D26, P57)

- **Exportar:** o dono baixa um JSON com todas as tabelas do negócio (ou com tudo o que referencia um cliente final, mais mensagens, pedidos pelo link e avaliações dele). Ficam de fora segredos, códigos de verificação, hashes de token, chaves de idempotência e tabelas internas (fila, medição, limites). Só o dono pede; o arquivo vale 24 h e o link 15 min (tela `src/features/privacy`, função `privacy`).
- **Eliminar um cliente final** (a pedido do titular, feito pelo dono, que é o controlador): o cadastro fica sem nome, telefone, e-mail e origem; mensagens, contato do canal e pedidos pelo link do mesmo telefone são apagados; textos da régua e da avaliação são limpos; vínculos de conta e convites acabam; lista de espera é retirada. Lançamentos do caixa, reservas e documentos fiscais ficam, sem o nome (só acrescenta; obrigação legal). Imediato, com auditoria sem dado pessoal.
- **Eliminar o negócio:** carência de 7 dias, cancelável. Depois: todos os clientes anonimizados como acima, mensagens e pedidos apagados, perfil fora do ar e sem textos, avaliações sem texto, listagem do diretório retirada, nome dos indicados apagado, acesso encerrado (memberships) e negócio fechado. Fotos do perfil e arquivos de exportação no Storage precisam da API do Storage para sumir (recado ao integrador, `PENDENCIAS.md` E9/F4).
- **Eliminar ≠ apagar tudo:** valores, datas e documentos fiscais permanecem pela obrigação legal e pela trilha append-only. Validar com o advogado (PENDENCIAS F4).

## Dados que não entram

Dados de saúde (diagnóstico, lesão, prescrição, foto corporal, prontuário), dados bancários ou de cartão de clientes finais, histórico do WhatsApp pessoal, dados de menores como titulares de cadastro próprio `[validar]`. Campos livres devem orientar o profissional a não registrar esses dados.

## Fornecedores (suboperadores)

| Fornecedor | Função | Transferência internacional | Contrato / garantia |
|---|---|---|---|
| Supabase | Banco, auth, storage, backups | Depende da região do projeto `[confirmar]` | DPA do fornecedor `[verificar e arquivar]` |
| Cloudflare | Hospedagem do frontend, CDN, proteção | Sim (rede global) | DPA e cláusulas-padrão `[verificar]` |
| Provedor de LLM `[a definir]` | Assistente | Provável | DPA, política de retenção e de não-treinamento `[verificar]` |
| E-mail transacional `[a definir]` | Envio de e-mails | `[a verificar]` | `[a verificar]` |
| Cobrança da assinatura `[a definir]` | Pagamento do plano | `[a verificar]` | `[a verificar]` |
| GitHub | Código-fonte (sem dados de clientes) | Sim | Não recebe dados pessoais de clientes por regra do projeto |

## Manutenção

Atualizar este inventário a cada migration que crie tabela ou coluna com dado pessoal, a cada novo fornecedor e a cada nova finalidade. Responsável: `[a definir]`.
