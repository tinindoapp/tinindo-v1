# 13 · Decisões, fontes e limites

Pesquisa e inspeção em 17/10/2026. Especificações são recomendações de arquitetura; capacidades/preços externos podem mudar. Revalidar durante P00 e antes de contratar/publicar integrações.

## Decisões já propostas

| ID | Decisão | Motivo | Reversão |
|---|---|---|---|
| ADR-001 | Postgres/Supabase | Domínio transacional/relacional e velocidade | Reavaliar se backend existente maduro |
| ADR-002 | Monólito modular | Menos operação e contratos claros | Separar carga/time quando houver evidência |
| ADR-003 | Web primeiro | Prazo e distribuição sem instalação | Mobile posterior pela mesma API |
| ADR-004 | Preço por regras | Poucos dados, explicabilidade | Modelos de demanda só validados |
| ADR-005 | Cadastro cliente por tenant | Privacidade multi-profissional | Não flexibilizar fronteira |
| ADR-006 | Branch/worktree + quadro CAS | Coordenação entre máquinas | Ferramenta dedicada se equipe crescer |
| ADR-007 | Lovable em homologação | Preview útil, segredos de produção separados | Hosting adicional para PRs |
| ADR-008 | Aprovação de ação exata | Evita desconto/envio indevido | Autonomia apenas por política delimitada |
| ADR-009 | Rede pública separada do CRM | Reputação e gestão têm autorizações distintas | Nunca publicar CRM por conveniência |

## Perguntas que faltam, sem impedir o desenho

1. Qual projeto/repositório contém o site e a área `/cliente/`? `fffalleiros/tinindo` foi localizado, mas não tem `package.json` na raiz. Confirmar repositório canônico antes de importar o kit.
2. Já há contas reais/dados reais/backend/Auth? Se sim, P00 vira auditoria e migração incremental, sem recriar identidades nem perder dados. Mostrar fonte, não senha.
3. Quem será integrador no primeiro ciclo? Proposta: Felipe nas regras/infra e Gabriel em UX/UAT, revisão cruzada.
4. Números WhatsApp e conta Meta já existem? Sem isso o piloto continua no web e compartilhamento manual, e a integração ganha prazo próprio.
5. Qual orçamento mensal e quais seis a dez testadores estarão disponíveis? Proposta: limite técnico inicial separado dos planos de desenvolvimento; datas de UAT combinadas antes de prometer uma semana.

## Fontes primárias

| Fonte | Link | Uso e limite |
|---|---|---|
| Site Tinindo | [Abrir fonte](https://tinindoapp.com.br) | Inspeção pública de home, soluções e planos; não comprova backend |
| Privacidade Tinindo | [Abrir fonte](https://tinindoapp.com.br/privacidade) | Observado rascunho com campos por definir |
| Claude Code: memória | [Abrir fonte](https://code.claude.com/docs/en/memory) | CLAUDE.md é contexto, imports e memória local; não é lock distribuído |
| Claude Code: fluxos | [Abrir fonte](https://code.claude.com/docs/en/common-workflows) | Worktrees permitem sessões isoladas |
| Lovable: GitHub | [Abrir fonte](https://docs.lovable.dev/integrations/github) | Uma branch ativa; vinculação cria repo; verificar projeto existente |
| GitHub: proteção | [Abrir fonte](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | Reviews/checks; disponibilidade em planos para repo privado |
| GitHub: Contents API | [Abrir fonte](https://docs.github.com/en/rest/repos/contents) | SHA obrigatório para atualizar arquivo; conflito de concorrência |
| Supabase: preço | [Abrir fonte](https://supabase.com/pricing) | Base Pro, projetos, compute e backups; não inclui todos os custos |
| Supabase: RLS | [Abrir fonte](https://supabase.com/docs/guides/database/postgres/row-level-security) | Isolamento por linha; atenção a views e chaves privilegiadas |
| Supabase: migrations | [Abrir fonte](https://supabase.com/docs/guides/local-development/database-migrations) | Schema versionado e ambiente local |
| Supabase: queues | [Abrir fonte](https://supabase.com/docs/guides/queues) | Fila durável disponível; usar uma estratégia inicial |
| Supabase: background | [Abrir fonte](https://supabase.com/docs/guides/functions/background-tasks) | Trabalho em background continua sujeito a limites |
| PostgreSQL: ranges | [Abrir fonte](https://www.postgresql.org/docs/current/rangetypes.html) | Exclusão de intervalos sobrepostos e btree_gist |
| Firebase: transações | [Abrir fonte](https://firebase.google.com/docs/firestore/manage-data/transactions) | Firestore oferece transações; não é incapaz de consistência |
| Firebase: SQL Connect | [Abrir fonte](https://firebase.google.com/docs/sql-connect) | Alternativa relacional atual no ecossistema Google |
| WhatsApp: política | [Abrir fonte](https://whatsappbusiness.com/policy/) | Opt-in, templates, janela de 24h e escalonamento humano |
| WhatsApp: preços | [Abrir fonte](https://whatsappbusiness.com/products/platform-pricing/) | Estrutura de cobrança; tarifa Brasil/BSP deve ser confirmada |

Fontes consultadas para tecnologia, não certificação de conformidade. Tarifas detalhadas de BSP, elegibilidade contratual específica do produto de IA e emissão fiscal por município não foram homologadas. Esses itens são gates da integração comercial, não dependências ocultas do piloto web.

## Evidência e incerteza

Fato observado: conteúdo público do site e README remoto. Fato documental: capacidades descritas nos links oficiais. Inferência: stack recomendada e potencial de realizar piloto. Hipóteses: horas de trabalho, volume, custo variável, preço posterior, conversão e disposição a pagar. O kit não valida capacidade do backend atual, porque não houve acesso autenticado nem fonte identificada desse backend.
