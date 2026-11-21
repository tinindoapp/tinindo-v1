# Runbook · cinco incidentes (docs/09)

Primeiro: **quando o alerta acende**, siga a seção logo abaixo; ela diz para qual incidente ir.

Ordem fixa em todos: **conter** (flag ou pausa) → **preservar** (não apagar nada; exportar evidência) → **avaliar afetados** → **corrigir** → **testar regressão** (teste automatizado novo) → registrar no handoff. O dono do negócio continua operando agenda e caixa pela tela quando assistente ou canal caem.

## Quando o alerta acende (P58)

O alerta é o estado "precisa de atenção" que a rotina `ops_watch` (linha do `job_ticks`) calcula a cada minuto. Ele aparece em três lugares:

- no painel **Saúde da operação** (`/app/servicos-tinindo/operacao/saude`, só a equipe Tinindo);
- no `npm run smoke -- <ambiente>`, que reprova;
- no log da função `jobs`, com `level: error` e `ops_attention`.

O e-mail é opcional e vem desligado; para ligar, veja "Aviso por e-mail" no fim desta seção.

Os limites ficam em `public.ops_alert_settings` e só mudam por migration:

| Motivo | Limite |
|---|---|
| fila atrasada | 15 min |
| rotina falhando | 3 falhas seguidas |
| erros 5xx das funções | 20 por hora |

1. **Abra o painel** ou rode `npm run smoke -- <ambiente>`. Anote a hora, o motivo e o SHA da "Versão publicada".
2. **Veja se começou com uma publicação.** Compare a hora de "Versão publicada" (`public.ops_releases`) com a hora em que o alerta acendeu (`since` em `public.ops_alert_state`).
   - Se acendeu até 30 minutos depois de publicar e o motivo é erro 5xx ou rotina falhando, volte para o commit anterior: `npm run reverter -- <ambiente> <sha anterior> --conferir` e, se o plano estiver certo, sem `--conferir`. A reversão leva o frontend e as funções; o banco fica como está.
   - Depois da reversão, o smoke tem de passar. Se não passar, siga o passo 3.
3. **Vá pelo motivo:**

   | Motivo no painel ou no smoke | O que fazer |
   |---|---|
   | **Fila de eventos atrasada** | Incidente 3 (fila parada), abaixo. Confira primeiro "Respostas ao cron" no smoke: 401 quer dizer que o segredo do Vault é diferente do da função. Nesse caso, publique de novo. |
   | **Rotina com 3 falhas seguidas** | O painel mostra o `last_error` da rotina. Erro de dado ou de código: corrija para frente, com migration ou PR. A rotina com defeito não segura as outras (P56): a fila e as demais seguem. Não desligue a rotina à mão; desligar é `update public.job_ticks set enabled = false` em migration. |
   | **Erros 5xx acima do teto** | Ache a função na lista "Erros na última hora". Para ver o pedido, use o `request_id` de `public.ops_errors` e procure-o no log da função, no painel do Supabase (Edge Functions › Logs). 503 `PROVIDER_UNAVAILABLE` em várias funções ao mesmo tempo é o banco ou o provedor: incidente 4. Uma função só, logo depois de publicar: passo 2. |
   | **Rotina do alerta parada** | O cron do `jobs` parou: o projeto foi pausado (plano grátis), o `pg_cron` está desligado ou o segredo mudou. Reative o projeto e publique de novo; o passo 5 do publicar refaz o cron. |

4. **Gatilhos de reversão imediata** (`ENSAIO-ROLLBACK.md`): dupla reserva, dado de um negócio visível em outro, fila parada há mais de 15 minutos, 5xx acima de 2% por 10 minutos. Quem decide é o Felipe. Sem resposta em 15 minutos, quem estiver de plantão reverte o frontend e avisa.
5. **Feche o incidente.**
   - O alerta volta a "Tudo certo" sozinho na rodada seguinte.
   - Anote a hora, o motivo, o que foi feito e o SHA no handoff do incidente.
   - Crie um teste de regressão, como pede a ordem do topo deste arquivo.

**Aviso por e-mail.** O aviso sai uma vez, na passagem de "Tudo certo" para "precisa de atenção". Vai pelo Resend e leva só os motivos e o link do painel. Para ligar, coloque nos segredos das funções do ambiente:

- `OPS_ALERT_EMAIL=on`;
- `OPS_ALERT_EMAIL_TO=<endereços separados por vírgula>`;
- `OPS_ALERT_RESEND_KEY=<chave só de envio>`;
- `OPS_ALERT_EMAIL_FROM`, opcional; o padrão é `nao-responda@mail.tinindoapp.com.br`, que já está verificado (`EMAIL-RESEND.md`).

Depois, publique de novo a função `jobs`. Para desligar, `npx supabase secrets unset OPS_ALERT_EMAIL --project-ref <ref>`.

**O que a captura guarda.** Em `public.ops_errors` ficam só estes campos, por 14 dias:

- de onde veio (tela ou função) e o tipo do erro;
- a rota sem id, com uuid, número longo, e-mail e token trocados por `:id`;
- a função, o status e o código do catálogo;
- o SHA e o `request_id`.

Mensagem de erro, corpo, token, negócio e dado de cliente nunca entram. Para desligar a captura das funções, use o segredo `OPS_CAPTURE=off`.

## 1 · Reserva duplicada

- Sinal: dois `bookings` com `blocks_capacity` e `occupied_range` sobrepostos no mesmo recurso. Não deveria existir: `bookings_no_overlap` é a constraint final.
- Conter: nada a desligar; verificar se a constraint continua (`\d public.bookings`).
- Avaliar: `select * from public.bookings b1 join public.bookings b2 on b1.resource_id = b2.resource_id and b1.id < b2.id and b1.occupied_range && b2.occupied_range where b1.blocks_capacity and b2.blocks_capacity`.
- Corrigir: cancelar uma pela RPC (`scheduling_booking_cancel`), nunca por `update`. Abrir bug com o SQL que gerou.
- Regressão: `tests/db-concurrency/03_scheduling.sh` e `tests/integration/11_uat_cabeleireira`.

## 2 · Mensagem indevida (oferta, orçamento ou convite enviado a quem não devia)

- Hoje a Tinindo não envia: o link é compartilhado pelo profissional. Incidente = link gerado para a pessoa errada.
- Conter: `waitlist_cancel_offer` / `sales_quote_cancel` / revogar convite: o token para de funcionar na hora.
- Avaliar: `audit_events` por `object_id` (sem PII) e `delivery_state`.
- Corrigir: nova oferta/orçamento. Não reutilizar token.
- Regressão: pgTAP 07 (ofertas) e 10 (orçamentos).

## 3 · Fila parada (outbox)

- Sinal: `select min(occurred_at), count(*) from public.outbox_events where status in ('pending','processing')` com o mais antigo > 15 min.
- Conter: nada; comandos continuam válidos sem o worker (holds vencem sob lock, aceite confere prazo no banco).
- Avaliar: `select status, count(*) from public.outbox_events group by 1`; `last_error` dos `dead`.
- Corrigir: conferir cron e `JOBS_SECRET`; rodar `jobs` manualmente (POST com o segredo). Evento `dead` com causa corrigida: `update outbox_events set status='pending', attempts=0` só com `service_role` e registro no handoff.
- Regressão: `tests/db-concurrency/07_waitlist.sh` (três workers, lease e retry).

## 4 · Provedor indisponível (banco, LLM, canal, PSP)

- Sinal: 503 `PROVIDER_UNAVAILABLE` nas funções; tela mostra erro honesto, nunca sucesso inventado.
- Conter: flag do provedor para `simulated`/desligado quando existir (P12/P14); sem LLM no piloto, o assistente é determinístico.
- Avaliar: `request_id` nos logs ponta a ponta; quantas operações falharam por rota.
- Corrigir: esperar o provedor; comandos são idempotentes, o cliente pode repetir com a mesma chave.
- Regressão: testes de handler com `rpc` que lança (`PROVIDER_UNAVAILABLE`).

## 5 · Suspeita de vazamento entre negócios

- Sinal: dado de um negócio visível em outro, ou resposta 200 onde deveria ser 403/404.
- Conter: revogar acessos delegados abertos (`service_access_revoke`), despublicar perfil se envolvido, pausar deploys.
- Avaliar: reproduzir com `tests/integration/00_seguranca.test.ts` e `13_uat_cliente_dois` no SHA de produção; listar políticas (`pg_policies`) e grants das RPCs; `audit_events` do período.
- Corrigir: migration com a política/grant certo; nunca desligar RLS para "destravar". Comunicar afetados conforme a política de privacidade.
- Regressão: pgTAP de isolamento de cada módulo + `00_seguranca`.

## Restore (OPS-01)

`npm run ensaio:restore` (P58) faz o ensaio no banco do ambiente local:

1. backup;
2. restore num banco novo e isolado;
3. o smoke rodado no restaurado, mais as contagens comparadas;
4. uma gravação com o papel do app.

O tempo de cada parte fica anotado; no CI, vai para o resumo da execução.

`npm run db:restore:drill` reproduz: dump custom → restore em banco novo → contagens, RLS, políticas, FKs → comando real → idempotência preservada, com tempo medido. Em produção o mesmo roteiro usa o backup do Supabase restaurado num projeto isolado; nunca em cima do projeto vivo.
