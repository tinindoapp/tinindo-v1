# ADR-0010 · Preço por regras, cotação e aprovação (P05)

Status: aceita · 2026-10-18 · integrador (implementou o P05)

## Decisões

1. **Uma conta, dois lugares, as mesmas fixtures.** A regra do doc06 roda em inteiros no banco (`app.price_compute`, numeric com `ceil` e half-up) e no domínio TS (`_shared/domain/pricing/price.ts`, BigInt) para o simulador e a prévia. `PRICE_FIXTURES` é conferido nos dois (vitest e pgTAP), e um teste de contrato garante que todo caso TS também está no pgTAP.
2. **Piso > base bloqueia**, nunca eleva preço em silêncio. Isso vale na proposta (422 `floor`) e de novo na publicação (422 `preview`, se o serviço mudou). Na cotação, uma regra cujo piso passou da base deixa de valer (preço base). Taxa + margem ≥ 100% é configuração inválida.
3. **Proposta → aprovação → publicação.** A proposta é inativa, tem prévia e `payload_hash` (sha256 do payload normalizado em jsonb) e vale 24 h. A aprovação (`pricing.approve_rule`, no formato de `action.approve`) fica presa a hash e versão, vale 15 min e é de uso único (backend-only). A publicação confere tudo de novo, trava o serviço (serializa publicações) e troca a regra ativa. Há uma regra ativa por serviço (índice parcial único), sem empilhar descontos.
4. **Cotação** (`pricing.quote`): preço base ou regra ativa cuja janela semanal (horário local do tenant, fim exclusivo) contém o início do horário e cuja validade o cobre. O resultado fica sempre ≥ piso e ≤ base (CHECK), vale 10 min e não segura o horário.
5. **Reserva com cotação** (P03 estendido por `create or replace` nesta migration): a cotação precisa ser do mesmo serviço, recurso e horário, estar no prazo (`clock_timestamp`) e não ter sido usada; ela é consumida (`used_by_booking`). O hold dura no máximo até o fim da cotação, e a confirmação congela o preço cotado. Reagendar sem cotação mantém o combinado; com cotação nova, o preço muda de forma explícita. Regras novas nunca alteram reservas existentes nem pacotes vendidos.
6. **Acesso só do dono** para cotar, propor, aprovar, publicar e ler.

## Contrato (aditivo)

Novas: `pricing.approve_rule`, `pricing.deactivate_rule`, `pricing.list_rules`. `pricing.publish_rule` passou de `unknown` para `{rule}`. `PricingProposeRuleInput.target_margin_bps` (padrão 0) e campos opcionais na proposta (`payload_hash`, `windows`, `valid`, detalhes da prévia).

## Consequências

- A agenda (P04) cota pelo servidor. A emulação offline continua com a regra de exemplo própria.
- O P08 pode criar propostas (`pricing.propose_rule` está em `AgentTool`). A aprovação continua sendo do dono, pela mesma RPC.
