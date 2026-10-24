# ADR-0028 · Avaliações e verificação (P24)

Status: aceita · 2026-10-24 · integrador (onda 3, PR 5; `docs/plano-onda-3.md`)

## Decisões

1. **Só avalia quem foi atendido e é verificável.** Avaliação exige atendimento `completed` cujo cadastro está vinculado ao login de quem avalia (customer_links do P01, vínculo ativo), em até 30 dias depois do fim, uma por atendimento. "Não existe" e "não é seu" dão o mesmo 404: ninguém descobre atendimentos alheios. Sem atendimento verificável não há avaliação; a indicação informal do P09 continua separada e nunca vira nota.
2. **O profissional responde, não edita.** Uma resposta pública (pode corrigir com versão); nota e texto do cliente não mudam (teste de contrato varre a RPC). O profissional não avalia o próprio atendimento.
3. **Denúncia não esconde sozinha.** Qualquer pessoa com login denuncia (motivos fechados, uma aberta por pessoa); só a moderação (backend, `review_moderate`, com motivo) oculta. O autor pode retirar a própria avaliação.
4. **Selos que não se confundem** (`app.rep_summary`): identidade verificada pela equipe (`identity_verifications`, só backend, sem guardar documento); atendimentos concluídos na Tinindo (contagem real); avaliações de clientes atendidos (média só com 3 ou mais); competência certificada = `false` até existir o P39 (o contrato só aceita falso).
5. **Autor nunca aparece.** Público e dono veem "cliente com atendimento verificado", o serviço e o mês; nenhuma leitura devolve usuário, nome ou contato do autor.
6. **Nada comprável.** Nenhuma função de avaliação toca pagamento, plano, benefício ou franquia (teste de contrato); o benefício de indicação (P21) já não compra avaliação.
7. **Perfil público (P09) passa a refletir** identidade verificada e quantidade de avaliações (`app.network_profile_json` substituído por `create or replace`, aditivo).
8. **Cliente sem negócio selecionado:** as rotas do cliente (`review.pending/submit/withdraw/report`) vão sem tenant, exigem login e Idempotency-Key; a idempotência é natural no banco (uma por atendimento, uma denúncia aberta por pessoa), como o aceite de convite do P09.

## Contrato (aditivo)

Módulo `reputation`: `review.pending`, `review.submit`, `review.withdraw`, `review.report`, `review.owner_list`, `review.reply`, `review.public_list`. Evento `review.published.v1`. Backend: `review_moderate`, `identity_verify_set`.

## Pendências do dono do projeto

Fila de moderação (responsável, prazo, contestação), processo de verificação de identidade, política de avaliação publicada aos clientes, e a certificação de competência (P39) antes de qualquer selo nesse sentido.
