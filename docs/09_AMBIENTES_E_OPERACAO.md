# 09 · Ambientes, entrega e operação

## Separação de ambientes

| Ambiente | Dados | Escrita | Objetivo |
|---|---|---|---|
| Local/worktree | Sintéticos, seeds reproduzíveis | Desenvolvedor da tarefa | Implementar e testar |
| Homologação | Sintéticos; voluntários só com processo próprio | Pipeline/integrador | Lovable, PRs integrados, QA |
| Piloto/produção | Dados reais autorizados | App + release aprovado | Operação dos profissionais |

Supabase separado para homologação e produção. Não tratar branches Git como separação de banco. Preview não recebe secret key; funções de homologação guardam seus próprios segredos. Só variáveis públicas de URL/chave pública no frontend. O arquivo `.env.example` entregue é mapa, nunca credencial.

Hosting: começar com provedor que compile Vite e tenha preview por commit, logs e domínio. Reutilizar hosting existente se adequado. Não condicionar sistema ao sandbox Lovable estar aberto. Salvar SHA do frontend e das funções, versões de migrations e configuração por release. Backend deve tolerar o frontend anterior durante transição.

## Pipeline obrigatório do app, a implementar no P00

1. Checkout do PR sem segredos de produção, instalação determinística com lockfile.
2. Lint, typecheck e build.
3. Testes de domínio (preço, transições, créditos, permissões de comando).
4. Banco local: aplicar migrations do zero, seeds sintéticas, pgTAP/RLS e concorrência.
5. Testes de contrato e fluxo e2e principal.
6. Secret scan e dependências: corrigir findings críticos relevantes.
7. Artefato e evidência, sem logs contendo PII.

Não usar `|| true`, `--passWithNoTests` ou mock no caminho de teste que deveria verificar banco real. Checks de documentação/coordenador não valem como CI do aplicativo. Se um teste só existe no papel, registrar pendência.

## Checks obrigatórios do CI

O workflow `app-ci` (`.github/workflows/ci-app.yml`) roda em todo PR para a `main` e em todo push na `main`. São cinco checks, e os cinco têm de estar verdes para o merge (decisão D38 (a): zero aprovações exigidas, CI obrigatório). Para exigir no GitHub: Settings › Branches › regra da `main` › "Require status checks to pass", marcando exatamente estes nomes:

| Check | O que prova |
|---|---|
| `lint · typecheck · unit · contratos · build` | ESLint sem aviso, TypeScript, Vitest (unit e contratos), build de produção, testes do coordenador e `npm audit` crítico |
| `edge functions (deno check)` | As 29 funções compilam no Deno com o lock |
| `banco (migrations do zero · seed · pgTAP/RLS)` | Ordem das migrations, banco do zero com seed, pgTAP, lint de schema, concorrência, integração handler ↔ banco, dicionário igual às migrations, ensaio de restore e o `release/publicar.sh` aplicando as migrations num banco descartável |
| `e2e smoke (desktop + mobile)` | Playwright sobre a demonstração (no PR, sem os módulos guardados; na `main`, todos) e a jornada do ciclo com servidor (P59) |
| `varredura de segredos` | gitleaks nos commits do PR |

CodeQL e o build de prévia da Cloudflare também aparecem no PR, mas não fazem parte da regra.

O e2e contra a homologação (`npm run test:staging`, `tests/e2e-staging`) não roda no CI: precisa do ambiente no ar e da senha da conta técnica. Roda depois de cada publicação (abaixo).

## Publicação em um comando

`npm run publicar -- <ambiente>` (`release/publicar.sh`, passo a passo em `release/PUBLICAR.md`). Os ambientes ficam em `release/ambientes/<nome>.env`, só com dados públicos (projeto, endereço, arquivo do Worker). Ordem fixa, parando no primeiro erro: conferências (commit da `main`, ordem das migrations no repositório e no ambiente) → migrations → segredos das funções (gerados no terminal, nunca impressos) → funções → cron (quatro agendamentos; as rotinas dos módulos rodam pelo `job_ticks`) → Worker com o commit em `/version.json` → smoke (`release/smoke.sh`). `--conferir` só mostra o que faria. O ambiente `local` aplica as migrations num Postgres descartável com o mesmo `supabase db push`, e é como o CI testa o script.

Depois de publicar: `npm run test:staging` (e2e com a jornada do UAT, cerca de 5 minutos) e, no UAT, `npm run preparar:uat` para ligar Mensagens só nos negócios do teste.

## Publicação

PR revisado → main → homologação → smoke → aprovação do responsável → release/tag → produção. Só deploy pode usar segredos do ambiente correspondente. Validação de produção começa por conta técnica sintética sem marketing ativo. Uma pessoa publica por vez; fila de deploy não cancela migration em andamento. Não usar `pull_request_target` para executar código não confiável com secrets.

Aplicar migration de expansão antes do código que depende dela. Falha de backend/DB pode exigir correção para frente; rollback de frontend não desfaz dados. Backup e plano de retorno fazem parte de mudança destrutiva. Nunca testar down migration em produção.

## Jobs e provedores

Monitorar backlog, mais antigo pendente, dead-letter, duplicações e uso/custo. Webhook valida assinatura sobre corpo bruto, timestamp/replay quando protocolo suportar, e dedupe de event_id. Responder rápido após persistir; processar em fila. Limites e backoff por provedor; não dormir dentro de requisição até o serviço voltar.

Nota fiscal é integração municipal/nacional com regras e credenciais próprias; não guardar certificado no navegador. Fase 2/4 seleciona um agregador homologável e um subconjunto de emissões. Pix via PSP licenciado evita a Tinindo custodiar saldo no início. Open Finance só via participante/parceiro e consentimentos adequados, depois de comprovar necessidade; não coletar senha de banco.

Google Calendar começa com uma única fonte de verdade e escopos mínimos. Sincronização bidirecional exige mapeamento de IDs, webhook/watch renovável, exclusão, timezone e loops; adiar até tratar conflitos. Google Business não permite garantir posição; preservar profissional como dono do perfil.

## Observabilidade e suporte

Painel interno mínimo: tenants ativos, erro de reserva, 409 esperado vs falha, jobs, cota, ações aprovadas/executadas, integrações desconectadas. Registrar `request_id` do começo ao fim. Erro de UI tem mensagem acionável e caminho para suporte. Instrumentação mede evento de resultado, não grava telas/inputs privados indiscriminadamente.

Runbook de cinco incidentes: reserva duplicada; mensagem indevida; fila parada; provedor indisponível; suspeita de vazamento. Primeiro conter a ação com flag, preservar dados, avaliar afetados, corrigir e testar regressão. Owner pode operar agenda e caixa visualmente quando IA/WhatsApp caírem.

## Escala inicial, em números de planejamento

Cenário hipotético: 50 profissionais × 200 clientes = 10 mil cadastros privados; 50 × 8 atendimentos × 22 dias = 8.800 reservas/mês. Um ano gera ~106 mil reservas, volume modesto para Postgres bem modelado. Se 10% desses clientes entrarem no mês, seriam ~1.000 consumidores ativos mais profissionais, não “só 50 usuários”. Pessoas que usam vários prestadores continuam com identidade global e registros isolados.

Teste inicial: 50 sessões concorrentes navegando e reservando; bursts de 20 tentativas no mesmo slot; 100 jobs de cancelamento; banco sintético equivalente a 12 meses. Alvos de engenharia, a medir: p95 de leitura <500ms servidor; comando de reserva <1s sem rede móvel; nenhuma dupla reserva. Definir device/rede no relatório. Otimizar índice/query/pool antes de escalar compute. Rate-limit endpoint público para evitar custo de abuso.

Não declarar capacidade validada só por conta de MAU incluído no plano. Realizar teste, observar limites de conexão/CPU, backups, egress e funções. Avaliar upgrade quando métricas sustentadas indicarem pressão ou requisito de recuperação mudar.
