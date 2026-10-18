# ADR-0006 · Ambientes, hosting, Lovable e segredos

Status: aceita com pendências de credencial · 2026-10-17 · P00

## Ambientes

| Ambiente | Supabase | Frontend | Dados | Quem escreve |
|---|---|---|---|---|
| Local / worktree | `npx supabase start` (Docker) ou demonstração offline | `npm run dev` (5173) | Seed sintético | Sessão da tarefa |
| CI | `supabase db start` efêmero | `vite preview` | Seed sintético | Pipeline |
| Homologação | **Projeto Supabase próprio, a criar** | Preview por commit da `main` | Sintéticos | Pipeline / integrador |
| Produção (piloto) | **Outro projeto Supabase, a criar** | Tag aprovada | Reais autorizados | Release aprovado |

Branch Git não separa banco. Homologação e produção nunca compartilham projeto, chaves ou usuários.

## Frontend e segredos

- Só `VITE_APP_ENV`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` vão para o bundle. `parseEnv` recusa chave `sb_secret_`/`service_role` e falha em produção sem Supabase. O ESLint barra literais de chave secreta no código.
- Fora de produção, o banner "Demonstração" fica sempre visível. Sem Supabase configurado, o app roda offline com fixtures (`DEMO_MODE` implícito) e não grava nada.
- Segredos de backend ficam no secret store de cada projeto Supabase e no GitHub Environments (deploy), nunca no repositório, em prompts ou no preview.

## Hosting e Lovable

- Hosting do app: a escolher no primeiro deploy de homologação, entre provedores com build Vite, preview por commit, logs e domínio próprio (ex.: Vercel, Netlify, Cloudflare Pages). O site comercial continua onde está. O app usa subdomínio próprio.
- Lovable: não há projeto ligado. Se for usado para visualizar, criar um projeto conectado a **este** repositório, fixado na `main`, apontando só para homologação, sem edição automática no fluxo diário (docs/08). Não criar um segundo repositório espelho.

## Gates de ambiente ainda abertos (registrados no handoff)

1. Criar os projetos Supabase `tinindo-homolog` e `tinindo-prod` (região `sa-east-1`) com MFA nas contas.
2. Escolher o hosting e configurar as variáveis públicas por ambiente.
3. Configurar `ALLOWED_ORIGINS` nas Edge Functions de cada projeto.
4. Política de privacidade final antes de qualquer dado real (COMECE_AQUI).
