# ADR-0033 · Financeiro ampliado: contas a pagar, categorias, conciliação e demonstrativo de caixa (P31)

Status: aceita · 2026-11-03 · integrador (sessão `claude-int-p31`, pedido do dono: "decida pelos docs")

## Contexto

O Caixa (P07) registra recebimentos e despesas append-only, com estorno por linha nova. O P14 traz recebimentos pelo PSP (`source = provider`) e a sua própria conciliação com o relatório do provedor. O P16 emite notas sem mexer no caixa. O P31 pede contas a pagar, categorias, conciliação por parceiro e um demonstrativo gerencial. O aceite do pacote é: "cobertura e reconhecimento definidos antes de chamar relatório de DRE".

## Decisões

1. **Nada do P07, P14 ou P16 muda.** As tabelas novas (`fin_*`) ficam por cima do Caixa. Pagar uma conta grava uma `expense_entries` comum (o Caixa vê a saída como sempre). O estorno usa a mesma regra do P07 (`reversal_of`, único). A categoria própria é uma classificação do lançamento (`fin_classifications`, uma por lançamento), não uma coluna nova no P07.

2. **Pagar duas vezes não baixa duas vezes.** A conta é travada (`FOR UPDATE`) e a versão vista é conferida. Por baixo, um índice único garante "um pagamento vivo por conta" (`fin_payable_payments` com `reversal_expense_id` nulo), e a idempotência por chave completa a proteção. Repetir com a mesma chave devolve a mesma resposta; com outra chave, `POLICY_REJECTED/paid`. O pagamento só aceita uma mudança, o estorno, e uma vez só (gatilho). Depois do estorno, a conta volta a "a pagar" e pode ser paga de novo, gerando uma nova despesa.

3. **Recorrência mensal materializada.** A conta mensal vira uma série que gera 12 contas, uma por mês, com índice único `(série, vencimento)`: repetir ou correr não duplica nenhum mês. O vencimento fica entre os dias 1 e 28 (todo mês tem esse dia). "Criar mais 12 meses" estende a série, e "Encerrar" cancela as contas futuras ainda não pagas. Não há job: nada vence escondido nem é pago automaticamente.

4. **Categorias.**
   - As categorias do Caixa (despesas do P07) e as origens de receita (atendimento, que inclui as reservas e turmas da equipe do P28; pacote ou assinatura; outras) valem sem cadastro.
   - Uma categoria própria de despesa aponta para uma categoria do Caixa (`base`), para que a despesa continue válida no P07.
   - Uma receita só aceita categoria de receita, e uma despesa só aceita categoria de despesa.

5. **Conciliação por meio e origem.**
   - Para cada dia local, a tela mostra o registrado por meio (Pix, dinheiro, cartão, transferência, outro) e por origem (à mão ou pelo PSP), líquido de estornos.
   - O dono informa o valor do extrato e a conferência guarda o registrado e a diferença daquele momento. É append-only, e a última conferência vale.
   - Na origem PSP, a tela também mostra o que o provedor diz que pagou no dia (cobranças pagas do P14) e quantas diferenças a última conciliação do P14 achou. O PSP é só o simulado até haver contrato (P14).

6. **Demonstrativo em regime de caixa, não DRE.** Os critérios de reconhecimento valem para este relatório e só para ele:
   - **Entrou:** recebimentos registrados com data no mês (no fuso do negócio). O recebimento que foi estornado sai do mês inteiro, como no resumo do Caixa (P07), mesmo que o estorno seja de outro mês.
   - **Saiu:** despesas registradas com data no mês, com a mesma regra de estorno.
   - **Sobrou:** entrou − saiu. Não é lucro nem saldo bancário.
   - **Período escrito:** primeiro e último dia do mês, com o fuso (`America/Sao_Paulo` no piloto) e a hora da consulta.
   - **Cobertura (o que falta lançar):**
     - atendimentos concluídos sem cobrança nem crédito;
     - a receber já vencido;
     - contas do mês ainda não pagas;
     - lançamentos sem categoria própria;
     - dias com recebimento sem conferência;
     - notas autorizadas no mês (P16), mostradas só como informação, porque nota não é dinheiro.

   O que não está definido, e impede chamar de DRE: competência (receita quando o serviço é prestado, não quando é pago), impostos sobre receita, custo do serviço separado de despesa, depreciação e provisões. Esse relatório fica para quando houver contador e regra escritos. O texto "Não é DRE" aparece na resposta e na tela, e um teste de contrato impede o nome "DRE" no SQL.

7. **Só o dono** opera, com RLS só do dono. A auditoria não guarda fornecedor nem descrição (texto livre).

## Consequências

- O Caixa (P07) continua a única fonte de dinheiro. Contas é uma visão de gestão sobre ele. O resumo do Caixa e o demonstrativo do mês somam igual.
- A conciliação é declarada pelo dono. Ler o extrato bancário (Open Finance ou arquivo OFX) fica para depois, com consentimento e contrato próprios.
- Uma despesa paga fora das Contas, direto no Caixa, entra no demonstrativo e pode receber categoria própria, mas não aparece como conta paga.
