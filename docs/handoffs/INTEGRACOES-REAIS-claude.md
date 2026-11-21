# Handoff · Integrações reais prontas para ligar (WhatsApp oficial e Pix por parceiro)

Sessão: Claude Code na nuvem, para @fffalleiros · 2026-11-21
Branch: `claude/kind-allen-m9zju9`. Um PR por bloco, nesta ordem: 1 camada de provedor; 2 WhatsApp oficial (Meta Cloud API); 3 Pix por parceiro (Asaas); 4 testes sem rede e o teste opcional com credencial real; 5 `release/WHATSAPP.md` e `release/PIX.md`.
Nenhuma credencial foi configurada e nenhum provedor real foi chamado. Nada foi aplicado na homologação.

## Bloco 1 · Camada de provedor única, escolhida só por segredo

`supabase/functions/_shared/providers/selection.ts`:

| Segredo | Valores | Nome no banco | Chaves exigidas |
|---|---|---|---|
| `MESSAGING_PROVIDER` | `simulado` (padrão) · `meta` | `simulated` · `whatsapp_cloud` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |
| `PSP_PROVIDER` | `simulado` (padrão) · `asaas` | `simulated` · `asaas` | `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` |

- Segredo ausente ou vazio vale simulado. Valor desconhecido também vale simulado, com o motivo no log da partida (`{"fn":"messaging","startup":…}`, sem valor de segredo).
- **Provedor real sem as chaves não cai para o simulado.** Ele fica escolhido e "não configurado", e conectar número ou criar cobrança responde 503 antes do banco. Cair sozinho no simulado mandaria cliente de verdade para telefone ou Pix de mentira.
- **O servidor decide; a tela não escolhe.** `channel.connect` e `payment.charge_create` trocam o `provider` do corpo pelo provedor ativo, e o campo ficou opcional no contrato, para clientes antigos. `payment.reconcile` sem `provider` concilia o ativo.
- **O que já existe segue no provedor em que nasceu.** Webhook, consulta, cancelamento e estorno usam o provedor gravado na linha.
- `channel.status` e `payment.charges` ganharam `provider: { active, real, configured }`, opcional no contrato. As telas trocaram o seletor por "Provedor: …" / "Como receber: …" e, com provedor real sem chaves, avisam e desabilitam o botão.
- Trocar de provedor = `npx supabase secrets set MESSAGING_PROVIDER=meta …` e reiniciar a função. Nenhum deploy de código.
- O esqueleto genérico `psp` do P14 continua no código e no banco (nenhuma linha usa), mas nenhum segredo o escolhe. `asaas` entrou no enum do contrato; o adaptador e a migration vêm no bloco 3.

Testes: `selection.test.ts` (padrão, desconhecido, real sem chaves, troca do corpo), handler de `messaging` (503 com `meta` sem chaves, corpo ignorado, estado sem segredo) e de `payments` (503 com `asaas` sem chaves, corpo ignorado). A integração `31_p14` agora espera a regra de cobrança repetida, porque o `psp` do corpo é ignorado. Os e2e de Mensagens, Pagamentos e a jornada do servidor conferem a linha do provedor no lugar do seletor.

Recado: #190 (`release/smoke.sh` reprova `PSP_*` e não vê `ASAAS_*`/`MESSAGING_PROVIDER`).
