# ADR-0013 · Orçamentos versionados e aceite pelo link (P11)

Status: aceita · 2026-10-18 · integrador (implementou o P11 por pedido direto do dono do projeto)

## Decisões

1. **Módulo `sales` separado de `pricing`.** A cotação do P05 (preço de um horário, 15 min) não é proposta comercial. O orçamento tem itens livres ou do catálogo, validade de até 90 dias e horário opcional.
2. **Versão = snapshot imutável com hash.** `sales_quote_versions` é append-only; o servidor normaliza os itens, calcula linhas e total (o cliente nunca envia total) e grava o sha256 do snapshot canônico. Revisar cria a versão N+1 com `expected_version` (409 `STALE_VERSION` se outra revisão passou na frente). Só rascunho, enviado ou vencido podem ser revisados.
3. **Link por token, como no P06.** `quote.send` gera 256 bits (só o hash no banco); a resposta mostra o token uma vez e a repetição devolve `null`. Gerar de novo troca o token (o link antigo para). Cancelar apaga o hash. A Tinindo não envia: o dono compartilha.
4. **Aceite vinculado ao que foi visto.** `quote.accept` recebe token + `version_no` + `snapshot_hash`, trava o orçamento e confere status, versão/hash (409) e validade (422) no banco. Uma decisão por orçamento (`unique(quote_id)`); repetir devolve a mesma decisão e a mesma reserva.
5. **Horário revalidado pela agenda.** Com horário proposto, o aceite chama `app.sched_insert_booking` (lock do recurso, expediente, bloqueios, constraint de sobreposição) e confirma na mesma transação, com a origem nova `quote` e preço combinado = total aceito. Sem vaga → `SLOT_CONFLICT` e nada é gravado. Na criação/revisão o horário é conferido sem reservar (propor não segura a agenda).
6. **Aceito ≠ pago.** Nada no caixa é tocado; a cobrança segue pelo P07 (`finance.charge_booking` ou recebível avulso). Um teste de contrato impede escrita em recebíveis/recebimentos no aceite.
7. **Expiração derivada.** `expired` não é gravado: é `sent` com validade vencida, calculado na leitura e conferido no aceite. Sem job.
8. **Eventos.** `sales.quote.accepted.v1` e `sales.quote.declined.v1` (payload só com IDs, versão e total) para o P13 encerrar o follow-up.

## Contrato (aditivo)

Operações `quote.create`, `quote.revise`, `quote.send`, `quote.cancel`, `quote.list`, `quote.get` (dono) e `quote.view`, `quote.accept`, `quote.decline` (anônimas). Tipos com prefixo `Sales*` (o nome `Quote` já é do P05). `BookingSource` ganha `quote`.

## Fora do escopo

Aceite autenticado pelo cliente vinculado (P01), PDF/assinatura, sinal/pagamento (P14), envio automático (P12) e follow-up (P13).
