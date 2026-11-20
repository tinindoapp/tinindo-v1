# Handoff · P57 LGPD e borda pública

Sessão: `claude/gallant-shannon-drm4ff` (uma das cinco sessões em paralelo de 20/11, para @fffalleiros) · 2026-11-20
Base: `docs/qa/revisao-2026-11-10/00-REPLANEJAMENTO.md` (linha P57, decisões D25 a D30), `docs/legal/` e `docs/handoffs/P56-P59-claude-banco-testes.md`.
Decisões aplicadas (adotadas pelo Felipe, **sujeitas à revisão do advogado**): **D25** prazos de retenção, **D26** exportar e eliminar por negócio, **D30 (a)** limite por origem e teto de reservas provisórias.
Área: migrations novas, `supabase/functions/privacy/` (nova), `src/features/privacy/` (novo), `worker/` (só cabeçalhos), `docs/legal/`. Também, por exigência dos testes: pgTAP novo (`41_p57_lgpd`), integração nova (`50_p57_privacidade`), duas linhas do pgTAP `36_job_ticks` (lista de rotinas) e o dicionário regerado (`docs/02_DICIONARIO.md`).

**Nada foi aplicado na homologação nem em produção.** Migration rodou só em bancos descartáveis locais.
Reserva: P57 não está no quadro do `coord.py` (igual a P56/P59). Trabalho autorizado na mensagem da sessão.

## Entregue

### 1. Retenção (D25) — `app.retention_tick` em `job_ticks`
- Migration `20261120130511_p57_lgpd_borda.sql`, seção 1.
- `public.retention_policies` (fechada, só leitura das funções): idempotência 30 d; eventos entregues/mortos 90 d (pendente nunca); webhooks do canal e do PSP 90 d; mensagens do canal 12 meses; execuções do assistente 12 meses (pergunta, proposta, aprovação, recibo); código de verificação 0 (apagado no fim do envio); pedido pelo link não confirmado 30 d; mais hash de origem 1 d, exportações 24 h e o próprio relatório 400 d. Mudar prazo = linha numa migration nova.
- `app.retention_tick(lote)`: apaga em lotes por categoria e grava em `public.retention_runs` só **categoria, quando e quantas linhas** (sem conteúdo, negócio ou titular). Entrou como linha nova em `job_ticks` (`retention`, depois da fila), sem reescrever `jobs_run`.
- "Código apagado ao fim do envio": `code` e `code_hash` (pedido pelo link e verificação do número) viram nulos quando o pedido não espera mais ou o código venceu. Enquanto espera, o código fica, porque o reenvio (P55) manda o mesmo código. As filas de despacho só pegam pedido esperando e no prazo, então não há envio de código nulo.
- Pedido não confirmado com 30 dias: some, e o horário liberado perde o nome digitado (`bookings.guest_ref`).
- Tabelas do assistente continuam "só acrescenta": o gatilho novo (`app.forbid_mutation_unless_retention`) só deixa passar DELETE dentro da retenção (flag local da transação).

### 2. Exportar (D26) — negócio e cliente final
- Banco: `privacy_export_start` (só o dono, até 5 por dia, idempotente), `privacy_export_data` (só quem pediu, só enquanto gera), `privacy_export_finish` (pronto por 24 h), `privacy_export_get`, `privacy_exports_list`. O conteúdo é montado pelo catálogo: toda tabela de `public` com `tenant_id` (ou com `customer_id`, para o cliente), sem colunas de segredo/código/hash de token/chave interna e sem tabelas internas (fila, idempotência, medição, limites, credenciais fiscais).
- Arquivo: bucket privado `privacy-exports`, caminho `<negócio>/<pedido>.json`. Políticas de Storage: gravar só quem pediu e enquanto gera; ler/apagar só o dono, pronto e no prazo. **Sem chave secreta**: a função grava e assina com o JWT do dono.
- Edge Function `privacy` (`supabase/functions/privacy/`): `privacy.export` (comando: pede → monta → grava → pronto → link assinado de 15 min; repetir com a mesma chave devolve o mesmo pedido com link novo), `privacy.export_link`, `privacy.exports`.

### 3. Eliminar (D26)
- **Cliente final** (`privacy.erase` com `scope: customer`, a pedido do dono): imediato. Cadastro sem nome, telefone, e-mail e origem; mensagens e contato do canal do mesmo telefone apagados; pedidos pelo link do mesmo telefone apagados (e o nome no horário); texto da régua e da avaliação limpo; vínculos de conta revogados; convites apagados; lista de espera retirada. **Ficam**: reservas, lançamentos e documentos fiscais (valores e datas), consentimentos (prova), sem o nome.
- **Negócio** (`scope: business`): carência de 7 dias, um agendado por vez, cancelável (`privacy.erase_cancel`). A rotina `privacy_erasure` (nova linha em `job_ticks`) executa: anonimiza todos os clientes como acima, apaga mensagens/contatos/pedidos restantes, tira o perfil do ar e limpa seus textos, retira do diretório, limpa nomes de indicados, desliga os acessos e fecha o negócio.
- A tela exige digitar ELIMINAR; o contrato também (`confirm: "ELIMINAR"`). Auditoria em `audit_events` sem dado pessoal (só escopo, estado e contagens).

### 4. Reserva pública (D30 a)
- `public.abuse_limits` (tabela de configuração): 10 reservas provisórias do link ao mesmo tempo por negócio; 10 pedidos por WhatsApp em 24 h em toda a Tinindo; 10 tentativas por origem em 10 min e 60 em 24 h.
- Gatilho `before insert` em `public_booking_requests`: teto de reservas provisórias e limite por contato em 24 h. Recusa desfaz tudo (o horário segurado também). Os limites por hora do P43/P55 continuam.
- Por origem: `public.public_origin_check(hash)` (anon) conta e recusa com 429; o banco só recebe `sha256(IP | dia | pimenta)`, apagado em 1 dia. Helper `originKey(req, pimenta)` em `supabase/functions/privacy/origin.ts`.
- **Falta ligar no handler da reserva** (`supabase/functions/network/handler.ts`, fora da área): recado (ver abaixo). Até lá, valem o teto e os limites por contato.

### 5. Cabeçalhos de segurança no Worker
- `worker/security-headers.ts`: CSP (`script-src 'self'`, Supabase só em `connect-src` e `img-src`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS e COOP. `worker/index.ts` aplica em **toda** resposta do Worker (prévia, arquivo, redirecionamento, queda segura).
- Os estáticos não passam pelo código do Worker (`run_worker_first` só em `/p/*` e `/s/*`). `headersFile()` gera o conteúdo de `_headers` da mesma fonte: **recado** para gerar `public/_headers` (fora da área).

### 6. Documentos legais
- `docs/legal/inventario-lgpd.md` v0.2: prazos D25 marcados, linhas novas (pedido pelo link, hash de origem, mensagens, verificação, exportações, pedidos de eliminação, relatório da retenção) e seção "Exportar e eliminar".
- `docs/legal/PENDENCIAS.md` v0.2: seção E com a situação de cada item e o que **continua dependendo do advogado** (a D25 inteira, E1–E5, auditoria e pedidos de eliminação em E6), F1/F2/F4 atualizados (F4 feito, ADV valida anonimizar + manter valores/fiscais), seção nova "Borda pública" (F5 hash de IP, F6 Turnstile).

### Tela (`src/features/privacy/`)
"Seus dados": baixar os dados do negócio ou de um cliente (link com prazo, lista das exportações, novo link), eliminar um cliente (escolher, digitar ELIMINAR) e pedir/cancelar a eliminação do negócio. Porta do servidor e emulação da demonstração (rotulada). **Não está no menu nem nas rotas**: `module.tsx` exporta `privacyModule`, e o registro depende do integrador (recado).

## Decisões tomadas nesta sessão (anotar ao advogado/integrador)
- **Eliminar = anonimizar + apagar o que não precisa ficar.** Ledgers são "só acrescenta" e documentos fiscais têm obrigação legal: ficam com valores e datas, sem nome. Fiscal (`taker_name`/`taker_document`) não é tocado.
- Cliente final é eliminado na hora (o dono confirma digitando); negócio tem 7 dias de carência.
- Erro de "já agendado" usa `POLICY_REJECTED` (campo `scheduled`): o catálogo de erros não tem `CONFLICT`.
- `privacy_export_object_ok` ficou em `public` (com grant explícito a `authenticated`) em vez de `app`, para não abrir a lista fechada de funções de `app` do pgTAP 38.
- Fotos e arquivos no Storage não são apagados pelo banco (a API do Storage é o caminho): recado.

## Testes, comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` | ok |
| `npm run test:unit` | 136 arquivos, 1029 passaram |
| `npm run test:contracts` | 842 passaram, 38 pulados |
| `npm run db:test:local` (PG 16 + pgTAP) | todos passaram, incluindo `41_p57_lgpd` (59) e os de trava do P56 (36, 37, 38) |
| `npm run db:test:concurrency` | todos passaram |
| `npm run test:integration` | 27 arquivos, 157 passaram (inclui `50_p57_privacidade`, com as políticas reais do bucket) |
| `deno check` de todas as funções | ok |
| `npx playwright test` (desktop + celular) | 316 passaram |
| `bash tests/e2e/servidor/run.sh` | 2 passaram |
| `node .github/workflows/check-migrations.mjs --base origin/main` | ok |
| `bash .github/workflows/db-dictionary.sh --check` | igual ao banco |

Mocks: no teste de integração, o Storage é simulado sobre `storage.objects` **com o papel e o JWT do usuário** (as políticas valem); a API real do Storage (upload/assinatura) não foi exercida. Sem e2e da tela de privacidade: ela ainda não tem rota (recado).

## Recados ao integrador (issue `para-felipe`)
1. **Ligar o limite por origem** em `network/public.book`: antes de `public_booking_request`, `const key = await originKey(req, Deno.env.get("ORIGIN_PEPPER") ?? ""); if (key) await call("public_origin_check", { p_origin_hash: key }, false);` e criar o segredo `ORIGIN_PEPPER` (homologação e produção).
2. **`public/_headers`** gerado de `headersFile()` (ou `run_worker_first: true` no `wrangler.jsonc`), para os estáticos levarem os mesmos cabeçalhos.
3. **Registrar o módulo**: `"privacy"` em `ModuleCode`/`MODULE_LEVELS` (`@contracts`, proposta `pilot`), `privacyModule` em `src/app/modules.ts`, link em Conta ("Seus dados") e e2e da tela.
4. **Registrar as operações** `privacy.*` em `OPERATIONS` e no doc03 (schemas em `supabase/functions/privacy/contract.ts`) e a função `privacy` no deploy das Edge Functions.
5. **Storage**: apagar pela API do Storage os arquivos de exportação vencidos e as fotos de negócios eliminados (por exemplo, na função `jobs`).
6. Pôr P57 no quadro.

## Próximo passo
Advogado: validar a D25, a anonimização como forma de eliminar e os itens marcados em `PENDENCIAS.md`. Integrador: recados 1 a 5 (1 e 2 fecham a borda pública).
