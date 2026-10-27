# P42 · Liberação do piloto: plano de execução

Preparado por `gabriel` em 27/10/2026, para o coordenador (@fffalleiros) executar. Meta: piloto no ar e testado no iPhone na quarta, 28/10/2026.
Este arquivo diz **quem faz o quê e em que ordem**. As caixas de cada etapa continuam no `CHECKLIST.md`. Os roteiros estão em:
- `tests/e2e-staging/`: e2e contra a homologação;
- `docs/qa/UAT-PILOTO.md`: testes com pessoas;
- `docs/qa/IPHONE-SAFARI.md`: aparelho real;
- `release/ENSAIO-ROLLBACK.md`: reversão e restore.

## Divisão

| Parte | Quem | Por quê |
|---|---|---|
| Projeto Supabase de homologação, SMTP, segredos, cron, deploy das funções, Worker de homologação | Felipe | Contas e segredos são do coordenador (docs/COORDENACAO.md) |
| Conta técnica sintética e perfil publicado nela | Felipe cria; Gabriel confere | Cria no ambiente hospedado; a senha não vai para arquivo |
| e2e contra a homologação, iPhone real, ensaio de rollback | Gabriel (com o ambiente no ar) | Roteiros prontos neste PR |
| Testes com 3 pessoas (barbeiro, cabeleireira, personal) | Gabriel conduz; Felipe aprova a lista de convidados | Precisa de dado real fora da conta técnica |
| Aprovação por escrito e `finish P42` no quadro | Felipe | Só o coordenador fecha |

## Ordem (cada passo só começa com o anterior verde)

1. **Ambiente** (estimativa: 1h30). Quem tiver a conta roda `bash release/homolog-setup.sh <project-ref> <endereço do app>`: link, migrations, segredos gerados sem aparecer na tela, deploy com `--no-verify-jwt` (cada função confere o login; com o JWT do gateway as rotas públicas, webhooks e cron seriam recusados) e cron no Vault. Itens que o script não faz:
   - Criar o projeto Supabase de homologação (região São Paulo). Auth por e-mail com SMTP próprio, porque o SMTP padrão do Supabase limita envios e quebra o cadastro dos testadores.
   - `npx supabase link --project-ref <ref>` e depois `npx supabase db push`. As migrations rodam antes de tudo.
   - Segredos das funções (`npx supabase secrets set …`):
     - `ALLOWED_ORIGINS` com o endereço do Worker de homologação;
     - `PUBLIC_APP_URL`;
     - `JOBS_SECRET`, `MESSAGING_DISPATCH_SECRET`, `PAYMENTS_SYNC_SECRET` e `FISCAL_SYNC_SECRET`, cada um com 32 ou mais caracteres (`openssl rand -hex 32`);
     - `MESSAGING_SIM_SECRET` e `PAYMENTS_SIM_SECRET`;
     - nenhum `WHATSAPP_*`, `PSP_*` nem `FISCAL_PROVIDER_*` no piloto.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase injeta sozinho.
   - `npx supabase functions deploy`: todas as pastas de `supabase/functions`, 24 em 27/10.
   - Supabase Cron, a cada 1 minuto, em `jobs`, `messaging/channel.dispatch`, `payments/payment.sync` e `fiscal/fiscal.sync`, com o cabeçalho de segredo de cada um (ADR-0011, 0017, 0018, 0026).
   - Worker de homologação na Cloudflare com `VITE_APP_ENV=staging`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Só a chave pública: o app recusa subir com chave secreta.
   - Conta técnica sintética: e-mail de teste do domínio da Tinindo, negócio "Barbearia Homologação", perfil publicado com `booking_link` e canal simulado ativo.
2. **Gabriel · e2e contra a homologação** (estimativa: 20 min). Rodar `tests/e2e-staging` com as variáveis do README. Anexar o relatório ao PR do P42. Qualquer falha em "funções" volta para o passo 1.
3. **Felipe · backup e restore** (estimativa: 40 min). Seguir `ENSAIO-ROLLBACK.md` (partes A e B) e anotar os tempos.
4. **Gabriel · iPhone real** (estimativa: 40 min). Seguir `docs/qa/IPHONE-SAFARI.md` e registrar as capturas.
5. **Gabriel · 3 testes com pessoas** (quarta, 30 a 40 min cada). Seguir `docs/qa/UAT-PILOTO.md`, com cronômetro e registro de suporte.
6. **Felipe · aprovação**: nome, data e SHA no `CHECKLIST.md` (seção 3), linha em `RELEASES.md`, `finish P42`.

## Decisões em aberto (precisam de resposta antes do passo 5)

1. **Código da reserva pelo link (P43) no piloto.**
   - Sem `WHATSAPP_*`, o código sai pelo canal simulado e não chega ao celular de ninguém.
   - Opções:
     - **(a)** no teste com pessoas, o condutor lê o código no telefone simulado e dita para o cliente;
     - **(b)** ligar o WhatsApp oficial antes de quarta (docs/10: sandbox não pode parecer atendimento comercial);
     - **(c)** deixar a reserva pelo link fora do piloto da quarta.
   - Sugestão: **(a)** na quarta e **(b)** depois.
2. **Domínio da homologação**: endereço `*.workers.dev` ou subdomínio próprio. O valor entra em `ALLOWED_ORIGINS` e `PUBLIC_APP_URL`.
3. **Quem são as 3 pessoas** e se o dado delas fica na homologação depois do teste (sugestão: apagar ao fim do piloto, com aviso no convite).

## O que este PR não faz

Não cria conta, não guarda segredo, não publica nada e não marca o P42 como feito. Só prepara roteiro, teste e checklist.
