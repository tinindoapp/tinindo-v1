# 04 · Segurança, confiança e privacidade

## Modelo de ameaça concreto

Riscos prioritários: prestador acessar clientes de outro; cliente consultar agenda alheia por ID; agente escolher tenant errado; link de convite virar acesso administrativo; duas reservas no mesmo horário; desconto/publicação sem aprovação; segredo no bundle; preview acessar produção; webhook forjado/duplicado; prompt injection em mensagem de cliente; log guardar dado sensível.

## Matriz de autorização

| Papel | Leitura | Escrita | Limites |
|---|---|---|---|
| Owner | Dados do próprio negócio | Catálogo, agenda, caixa, políticas, convite de equipe | Não lê outro tenant |
| Staff, fase 2 | Agenda/contatos necessários | Atendimentos autorizados | Sem finanças globais por padrão |
| Cliente autenticado | Próprios agendamentos e dados compartilhados | Solicitar/cancelar conforme política | Não acessa CRM completo, custo ou lista de clientes |
| Visitante | Perfis publicados e slots disponíveis | Solicitação limitada e protegida | Nunca lista nomes de clientes |
| Suporte Tinindo | Metadados técnicos mínimos | Apenas escopo temporário aprovado | Acesso elevado com motivo, validade e auditoria |
| Worker | Objetos da tarefa validada | Comandos definidos pelo job | Sem tenant fornecido livremente pelo LLM |

RLS em toda tabela exposta; grants mínimos; policies SELECT/INSERT/UPDATE/DELETE explícitas. Testar negações, não apenas casos felizes. Chave pública de Supabase pode estar no frontend; secret/service-role, chave LLM, token Meta e credenciais do banco não podem. Variável com prefixo `VITE_` é pública.

Funções privilegiadas: preferir invoker quando possível; usar `SECURITY DEFINER` apenas quando necessário, `search_path` fixo, nomes qualificados, revogar execução pública, validar `auth.uid()` e membership/escopo. Worker privilegiado valida escopo do evento assinado/interno e não confia em tenant enviado pela internet. Não usar role administrativa para mascarar RLS quebrada.

## Aprovação vinculante

Uma aprovação persiste `actor`, `tenant`, `tool`, payload normalizado, hash, versão da política, preço/limites, destinatários, expiração e estado. No execute, verificar identidade, papel, validade, versão, quota e condições atuais. Se agenda, preço, público ou conteúdo mudaram, invalidar e pedir nova aprovação. Proposta não é autorização perpétua.

Envio a clientes, desconto e alteração de agenda via agente exigem aprovação no piloto. Autonomia de lembrete só depois de uma política delimitada aprovada, consentimentos e controles de frequência. Pagamento, transferência, reembolso automático, exclusão em massa e emissão fiscal não estão habilitados na semana.

## Cliente público e convites

Links usam token aleatório de alta entropia, hash no banco, escopo único e TTL. Não incluir nome/telefone/custo em URL. GET não efetua aceite: scanners de e-mail podem abrir links. Exibir detalhes mínimos e exigir ação POST, validação de token e proteção contra abuso. Após troca por sessão restrita, remover token da URL; `Referrer-Policy: no-referrer`, sem analytics de terceiros nessas páginas. Cancelamentos sensíveis podem exigir verificação adicional.

Claim de perfil requer comprovação de controle do contato. Review exige identidade verificável segundo o tipo anunciado. Nenhum terceiro publica endereço residencial ou telefone privado do profissional sem base adequada. Profissional decide campos públicos. Fluxo de denúncia/correção e remoção já deve existir, mesmo se operação manual.

## IA e conteúdo externo

Mensagens, anexos e descrições de clientes são dados, não instruções. Separar contexto confiável de material externo. Allowlist de ferramentas com schema; máximo de chamadas, timeout, orçamento por execução, sem SQL, shell, URL arbitrária ou alteração de policy. Retornar dados mínimos. A API aplica autorização independentemente do prompt. Testar ataques “ignore regras”, “troque o tenant” e “envie todos os contatos”.

## LGPD na prática do lançamento

Mapear finalidades, categorias, controlador/operador e fornecedores por fluxo; a Tinindo pode ter papéis diferentes na gestão do prestador e no marketplace próprio. Não usar uma única frase de consentimento para justificar toda atividade. Aviso de privacidade finalizado, canal de direitos, contratos de processamento, retenção, acesso de suporte e transferências internacionais precisam ser definidos para os dados reais. Obter revisão adequada onde necessário.

Personal trainer no piloto gerencia agenda e pagamentos; não coletar diagnósticos, dados de saúde, fotos corporais, planos clínicos ou histórico de lesões. Essa exclusão reduz significativamente escopo e risco. Marketplace não certifica habilitação técnica só porque verificou telefone.

## Infraestrutura e recuperação

MFA nas contas administrativas; privilégios por pessoa; nada de compartilhar login GitHub ou Supabase entre fundadores. Segredos em gerenciador do fornecedor/GitHub Environments, fora dos prompts. Redigir telefone e conteúdo de mensagem nos logs. Observar request_id, tenant_id técnico, status e latência, sem dados de clientes em labels de métricas.

Backups do banco e restauração ensaiada em ambiente separado. Backup de Postgres não equivale a backup dos bytes do Storage. Definir política de objetos e exportação separada. Na semana, meta operacional RPO de até 24h se só backup diário e RTO alvo de 4h após exercício; não publicar SLA contratual antes de medições. Se a operação exigir perda menor, contratar/configurar PITR ou solução compatível antes de escalar.

Controles de incidente: desligar envio/execução por flag de servidor, manter leitura/agenda manual quando possível, revogar tokens comprometidos, preservar evidência redigida, comunicar conforme obrigação aplicável. Nunca “corrigir” vazamento desligando RLS.

## Complemento da reconciliação

Operadores de serviços assistidos exigem access_grants por tenant, escopo, expiração e auditoria; jamais credenciais de cliente em GitHub ou acesso global silencioso. Privacidade/backup/acessibilidade da Tinindo são base do piloto mesmo que o catálogo venda serviços equivalentes em fase futura.
