# Handoff · P01 Identidade e onboarding

Sessão: `claude-p01-a` (Claude Code na nuvem, em nome de @fffalleiros) · 2026-10-18
Branch: `task/p01/claude-p01-a` → PR para `main` (link no PR e no quadro).

## Resultado

- **Criação do negócio atômica e idempotente** (`business.create`, contrato v1). Tenant, membership de dono, recurso inicial, onboarding vazio e aceite de políticas são criados numa transação só (`db/proposals/P01/001`). A mesma chave do mesmo login devolve a mesma resposta, e uma chave com outro payload dá 409. Quem perdeu o acesso não relê a resposta guardada. A cota é de 3 negócios ativos por dono (429), protegida contra concorrência por lock por ator.
- **Onboarding mínimo configurável**: objetivo (5 opções) e política de cancelamento (antecedência de 0 a 168 h e multa opcional em bps; a cobrança continua manual). A operação local `onboarding.save` usa `expected_version` e responde 409 a versão antiga. Os presets de beleza (barbearia, cabeleireiro) e de personal mudam a ordem dos objetivos, o vocabulário ("aluno(a)") e a antecedência sugerida. Não há score nem dado de saúde, e o onboarding não tem texto livre.
- **Vínculo de cliente por comprovação** (`002`): o dono gera um código de uso único para um cadastro e o entrega pelo contato que já tem. O cliente autenticado resgata o código por POST. O código tem 256 bits; o banco guarda só o sha256, ele vale 72 h, e gerar outro aposenta o anterior. Valem um login por cadastro e um cadastro por login em cada negócio. O cliente se desvincula, ou o dono revoga. `my_customer_links()` devolve ao cliente só o nome dos negócios, e `app.linked_customer_id(tenant)` fica pronto para P03/P09.
- **Edge Function `identity`**: `POST /functions/v1/identity/{business.create, onboarding.save, customer_link.issue, customer_link.redeem, customer_link.revoke}`. Valida pelo schema, exige `Idempotency-Key`, calcula o sha256 do corpo normalizado e chama uma RPC com o JWT do usuário (sem chave secreta). O log não leva tenant, token, corpo nem código.
- **Telas** (`/app/conta`): negócio ativo, onboarding, "Onde sou cliente", criar negócio (com retry seguro pela mesma chave), resgatar código e nova senha. Ficam exportadas, prontas para o roteador, as telas públicas `PublicSignUp` e `PublicRecoverPassword`, com mensagens neutras (não revelam se o e-mail existe).

## Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `npm run test` (unit + contratos) | 64 unit + 45 contratos; P01 contribui 26 (handler) + 16 (UI) + 19 (contratos) |
| `npm run build` | ok; bundle 666 kB (era cerca de 645 kB), mesmo aviso de chunk do P00 |
| `npm run test:e2e` | 6/6 (desktop + mobile), sem regressão |
| `deno check --frozen …/*/index.ts` (Deno 2.9.6) | ok, `context` e `identity` |
| `npm run db:test:local` (Postgres 16 + shim) | 33/33 da fundação |
| `bash db/proposals/P01/tests/run-local.sh` | banco limpo e banco migrado: fundação 33 + P01/001 45 + P01/002 37, tudo ok nas duas ordens |
| `bash db/proposals/P01/tests/concurrency.sh` | 7/7: 10× mesma chave dão 1 negócio e 10 respostas iguais; 10 chaves em paralelo respeitam a cota de 3; 2 logins no mesmo código dão 1 vínculo |
| `npm run test:coord` | 22/22 |
| Mutações | política de `customer_links` aberta → falhou; repetição sem revalidar o dono → falhou (o teste foi acrescentado depois que a primeira rodada não pegou); resgate sem uso único → 2 falhas; chave nova a cada retry na UI → falhou; sem lock por ator → 6 negócios com cota 3 |
| Navegador (vite preview, Pixel 7 e 1280 px) | `/app/conta`, `/novo-negocio` e `/vincular` sem rolagem horizontal |

**Não executado:** `supabase db start/test db/db lint` e o fluxo real de e-mail (cadastro e recuperação): sem Docker nesta sessão. As propostas não rodam no CI enquanto não virarem migration. Recuperação de conta em ambiente real ainda **não verificada**: depende dos itens 2 a 4 da proposta e de SMTP em homologação.

## Mocks, fixtures e conexões pendentes

- `tests/000_stub_p02_customers.sql` é um stub de `customers` **só para teste**. A tabela real é do P02 e a 002 depende dela.
- Na demonstração offline, a Conta mostra a fixture do tenant A só para leitura, com os botões desabilitados.
- Versões de política `termos-piloto-v0` e `privacidade-piloto-v0` são **provisórias** (gate 5 do P00). O texto final precisa existir antes de dados reais.
- Não há UI do dono para emitir código: ela entra na ficha do cliente (P02), chamando `customer_link.issue`.

## Contratos e migrations

- Contrato v1 sem mudanças. `business.create` usa `BusinessCreateInput/Output`.
- Operações e schemas locais em `supabase/functions/identity/schemas.ts`, candidatos a `_shared/contracts`. A proposta está em `db/proposals/P01/PROPOSTA_INTEGRADOR.md` (item 5).
- Migrations propostas: `db/proposals/P01/001_identity_onboarding.sql` e `002_customer_links.sql`. Ordem, decisões e testes em `NOTAS.md`.

## Flags

Nenhuma nova. `VITE_APP_ENV ≠ production` continua ligando o banner. Sem Supabase, tudo fica só leitura.

## Limitações conhecidas

- **Bloqueios do integrador** (`PROPOSTA_INTEGRADOR.md`):
  1. incluir as migrations;
  2. AppShell: hoje o shell esconde o `<Outlet>` de quem não tem membership, então o login novo não chega a "Criar negócio" e o cliente não chega à Conta;
  3. rotas públicas `/criar-conta` e `/recuperar-senha`;
  4. redirect URLs, senha mínima de 10 caracteres e SMTP.
- Repetição de `customer_link.issue` devolve `code: null`, para não guardar o código em texto (desvio documentado).
- Sem rate limit próprio no resgate de código. A entropia de 256 bits torna adivinhar inviável, mas o abuso de chamadas fica com o limite da plataforma.
- Sem e2e das telas novas: `tests/e2e` é do integrador. A cobertura está em testes de componente.

## Próximo passo preciso

1. Integrador revisa o PR e aplica os itens 1 a 3 da proposta (migrations 001 e, depois do P02, 002; AppShell; rotas públicas).
2. Com `supabase start`: criar conta → criar negócio → concluir onboarding → recuperar a senha pelo Mailpit (porta 54324). Registrar o resultado no PR.
3. P02: botão "convidar para vincular" na ficha do cliente → `POST identity/customer_link.issue`. P03/P09: usar `app.linked_customer_id` nas políticas de cliente.
