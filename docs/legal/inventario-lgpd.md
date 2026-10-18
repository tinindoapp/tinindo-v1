> **RASCUNHO PARA REVISÃO JURÍDICA.** Versão 0.1 · 18/10/2026.
> Inventário de dados pessoais (registro das operações de tratamento, art. 37 da LGPD) derivado de `docs/02_DADOS_E_INVARIANTES.md` e `docs/04_SEGURANCA.md`. Reflete o desenho do piloto, não um levantamento do banco em produção. Prazos marcados como **proposta** ainda não foram aprovados; `[a definir]` está em `PENDENCIAS.md`.

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
| 8 | Reservas: cliente, serviço, horário, status, preço (`bookings`, `price_quotes`) | Cliente final | Agendar, reagendar, cancelar; congelar preço | O | CTRL | Até o profissional excluir ou fim do contrato + `[N dias]` | SB-DB, BKP |
| 9 | Lista de espera: janelas aceitáveis, status (`waitlist_entries`, `waitlist_offers`) | Cliente final | Oferecer vaga liberada | O | CONS do cliente (coletado pelo fluxo, registrado em `consents`) | Até expirar a entrada ou revogação; ofertas expiradas `[definir, curto]` | SB-DB, BKP |
| 10 | Pacotes e créditos de sessões (`session_packages`, `session_entries`) | Cliente final | Controlar sessões vendidas e consumidas | O | CTRL | Até o profissional excluir ou fim do contrato + `[N dias]` | SB-DB, BKP |
| 11 | Recebíveis, pagamentos registrados, alocações (`receivables`, `payment_*`) | Cliente final | Controle de recebimentos do profissional (sem movimentar dinheiro) | O | CTRL | Decisão do profissional; ledger append-only até fim do contrato + `[N dias]` | SB-DB, BKP |
| 12 | Despesas (`expense_entries`) | Profissional | Visão de caixa do negócio | C | CONT | Conta ativa + `[N dias]` | SB-DB, BKP |
| 13 | Consentimentos: finalidade, canal, origem, datas, versão da política (`consents`) | Cliente final, profissional | Provar consentimento e revogação | C (marketing Tinindo) / O (lista de espera) | OL (art. 8º §2º, ônus da prova); LI | Vigência + `[prazo de prova a definir]` | SB-DB, BKP |
| 14 | Perfil público: slug, categoria, área, campos escolhidos (`public_profiles`) | Profissional | Rede Tinindo / divulgação | C | CONT (publicação opt-in) | Até despublicar ou encerrar conta | SB-DB, CF (cache), BKP |
| 15 | Indicações e convites: tipo, quem convidou, hash do token, contato informado (`referrals`) | Profissional, cliente indicante, indicado | Atribuição e convite pessoal; sem marketing automático | C | LI (teste de balanceamento `[a documentar]`) | Pendentes: `[definir, curto]`; aceitos: enquanto conta ativa | SB-DB, BKP |
| 16 | Avaliações `[fase posterior]` | Cliente final, profissional | Reputação verificada | C | LI / CONT `[a definir]` | `[a definir]` | SB-DB |
| 17 | Pedidos ao assistente e contexto mínimo enviado ao modelo | Profissional; dados de clientes citados | Interpretar pedido e redigir | O (dados de clientes) / C (uso) | CTRL / CONT | Contexto de sessão `[definir, curto]`; retenção no fornecedor `[confirmar zero/curta retenção]` | SB-DB, LLM |
| 18 | Execuções do agente: ator, modelo, versão do prompt, uso, status (`agent_runs`) | Profissional | Auditoria, custo e franquia | C | LI; CONT (franquia) | `[a definir]` | SB-DB, BKP |
| 19 | Propostas e aprovações: ferramenta, payload, hash, aprovador (`action_proposals`) | Profissional; clientes no payload | Aprovação vinculante e prova de autorização | C / O | LI; DIR | `[a definir]` | SB-DB, BKP |
| 20 | Idempotência: chave, hash, resposta (`idempotency_records`) | Indireto | Evitar operação duplicada | O / C | CONT; LI | `[definir, curto]` | SB-DB |
| 21 | Fila de eventos e jobs (`outbox_events`, `jobs`) | Indireto | Execução confiável de tarefas | O / C | CONT | Após conclusão `[definir, curto]`; dead-letter `[definir]` | SB-DB |
| 22 | Auditoria: ator, ação, objeto, antes/depois redigidos (`audit_events`) | Profissional, suporte, clientes (redigido) | Segurança, investigação de incidentes, acesso de suporte | C | LI; OL; DIR | `[a definir]` | SB-DB, BKP |
| 23 | Plano, período, limites, uso (`plan_entitlements`) | Profissional | Controlar plano e cota | C | CONT | Conta ativa + prazo fiscal se ligado a cobrança | SB-DB, BKP |
| 24 | Dados de cobrança da assinatura e notas fiscais da Tinindo | Profissional | Cobrar plano Completo e cumprir obrigação fiscal | C | CONT; OL | Prazo fiscal/contábil `[confirmar]` | `[meio de cobrança a definir]` |
| 25 | Registros de acesso à aplicação: IP, data/hora | Todos | Obrigação do Marco Civil, segurança | C | OL (MCI art. 15); LI | Mínimo 6 meses; máximo `[definir]` | LOG, CF |
| 26 | Logs técnicos: request_id, tenant técnico, status, latência (telefone e mensagem redigidos) | Todos (indireto) | Operação e diagnóstico | C | LI | `[definir, curto]` | LOG, CF |
| 27 | Fotos e anexos privados `[se houver]` | Profissional, cliente final | Operação do negócio | O | CTRL | Até exclusão; Storage tem backup próprio `[definir]` | SB-ST |
| 28 | E-mails transacionais enviados `[fornecedor a definir]` | Profissional, cliente | Login e avisos de reserva | C / O | CONT | Retenção do fornecedor `[confirmar]` | `[a definir]` |
| 29 | Backups do banco | Todos | Recuperação de desastre | C / O | LI; CONT | Rotação do fornecedor `[definir]`; dado excluído some ao fim do ciclo | BKP |

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
