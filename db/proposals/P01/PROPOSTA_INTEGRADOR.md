# P01 · Mudanças globais propostas ao integrador

> **Incluído pelo integrador em 18/10/2026** (ADR-0007). Migrations em `supabase/migrations/20261018120000_p01_identity_onboarding.sql`, `…120100_p02_crm.sql`, `…120200_p01_customer_links.sql` e `…120300_p09_network.sql`; testes em `supabase/tests/database/` e `tests/db-concurrency/`. Este arquivo fica como registro das decisões.

O P01 não edita arquivos globais (ADR-0005). Para o fluxo funcionar de ponta a ponta, o integrador precisa aplicar os itens abaixo. Os itens 1 a 3 bloqueiam o uso real; os demais endurecem o fluxo.

## 1. Migrations (bloqueia)

Incluir `001_identity_onboarding.sql` e, depois da tabela `customers` do P02, `002_customer_links.sql`. Ordem e testes em [`NOTAS.md`](NOTAS.md).

## 2. AppShell: login sem negócio precisa chegar à Conta (bloqueia)

Hoje `src/app/AppShell.tsx` troca o `<Outlet />` por uma frase quando `memberships.length === 0`. Assim, quem acabou de criar a conta não alcança `/app/conta/novo-negocio`, e o cliente vinculado (que não é membro) não alcança `/app/conta`. Proposta mínima:

```tsx
// src/app/AppShell.tsx
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
// ...
const { pathname } = useLocation();
const accountArea = pathname === "/app/conta" || pathname.startsWith("/app/conta/");
// ...
<main className="tn-shell__main" id="conteudo">
  {memberships.length === 0 && !accountArea ? (
    <p>
      Sua conta ainda não está ligada a um negócio.{" "}
      <Link to="/app/conta/novo-negocio">Criar meu negócio</Link> ou{" "}
      <Link to="/app/conta/vincular">usar um código de vínculo</Link>.
    </p>
  ) : (
    <Outlet />
  )}
</main>
```

Isso não abre dado nenhum: as telas da Conta só leem pelo servidor (RLS/RPC).

## 3. Rotas públicas de cadastro e recuperação (bloqueia)

O módulo exporta `PublicSignUp` e `PublicRecoverPassword` de `src/features/identity/module.tsx`. Elas precisam ficar fora do `AppShell`, porque o shell redireciona quem não tem sessão para `/entrar`:

```tsx
// src/app/router.tsx
import { PublicRecoverPassword, PublicSignUp } from "../features/identity/module.tsx";
// ...
{ path: "/entrar", element: <SignIn /> },
{ path: "/criar-conta", element: <PublicSignUp /> },
{ path: "/recuperar-senha", element: <PublicRecoverPassword /> },
```

Em `src/app/pages/SignIn.tsx`, abaixo do botão, adicionar os links `<Link to="/criar-conta">Criar conta</Link>` e `<Link to="/recuperar-senha">Esqueci minha senha</Link>`. A tela de nova senha já existe em `/app/conta/nova-senha`: o link do e-mail abre uma sessão de recuperação, e o shell deixa entrar (com o item 2).

## 4. Supabase Auth (`supabase/config.toml` e projetos hospedados)

- `[auth] additional_redirect_urls`: incluir `http://127.0.0.1:5173/**` e `http://localhost:5173/**`. Os links de confirmação e de recuperação voltam para `/app/conta/novo-negocio` e `/app/conta/nova-senha`.
- `minimum_password_length = 10` e `password_requirements = "letters_digits"`. O app já exige 10 caracteres.
- Homologação e produção: Site URL e redirect URLs do domínio do app, `enable_confirmations = true` e **SMTP próprio**. O SMTP padrão do Supabase tem limite baixo de envio e não serve para recuperação de conta real. Sem isso, o aceite "recuperação de conta funciona no ambiente" não fecha em homologação.
- Local: o Mailpit/Inbucket do `supabase start` recebe os e-mails (porta 54324).

## 5. Contratos: promover as operações locais do P01

`supabase/functions/identity/schemas.ts` define `onboarding.save`, `customer_link.issue`, `customer_link.redeem` e `customer_link.revoke` (mais `Onboarding` e `MyCustomerLink`). Proposta compatível, só aditiva:

1. Mover os schemas para `supabase/functions/_shared/contracts/identity.ts` e exportar em `index.ts`.
2. Registrar as quatro operações em `OPERATIONS` (`module: "identity"`, `owner: "P01"`, `kind: "command"`, `idempotent: true`).
3. Acrescentar as quatro linhas à tabela "Operações v1" do `docs/03_CONTRATOS.md`. O teste do registro compara as duas.
4. Trocar os imports relativos `../../../supabase/functions/identity/schemas.ts` do módulo por `@contracts`.

Consumidores: P02 (botão "convidar para vincular" no cadastro do cliente → `customer_link.issue`), P03/P09 (`app.linked_customer_id(tenant)` para o cliente ver só as próprias reservas), P05/P07 (política de cancelamento em `tenant_onboarding`).

## 6. CI

O job `database` roda só `supabase/tests/database/`. Enquanto as propostas não viram migration, `db/proposals/P01/tests/run-local.sh` e `concurrency.sh` não rodam no CI. Ao incluir as migrations, mover `tests/001_*.test.sql` e `tests/002_*.test.sql` para `supabase/tests/database/` (sem o stub) e, se quiser, adicionar o `concurrency.sh` ao job.

## 7. Seed (opcional)

Para a demonstração local, acrescentar ao `supabase/seed.sql` uma linha de `tenant_onboarding` para A e B. Não é obrigatório: `onboarding_save` cria a linha que faltar.
