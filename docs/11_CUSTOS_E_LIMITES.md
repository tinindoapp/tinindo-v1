# 11 · Custos e limites

## O que é preço verificado e o que é hipótese

Supabase publica Pro a partir de US$25/mês, crédito de compute de US$10 e projetos adicionais a partir de cerca de US$10/mês. Dois projetos Micro na mesma organização Pro dão referência de US$35/mês, antes de excedentes e extras. Verificar configuração no checkout; não tratar como cotação fechada. Plano inclui backups diários com retenção limitada; PITR é extra. Fonte oficial consultada em 17/10/2026.

Demais números abaixo são orçamento gerencial proposto, **não preços cotados** de fornecedor. Dólar de R$5,50 é hipótese de planejamento, não câmbio consultado. Impostos, IOF e variação podem alterar custo.

| Componente | Hipótese mensal para piloto com até 50 profissionais |
|---|---:|
| Supabase, dois Micro/Pro | US$35 base |
| Hosting frontend/preview | US$0–25 |
| E-mail transacional e observabilidade | US$0–30 |
| Reserva variável LLM/transcrição | US$20–100 |
| WhatsApp oficial | Calculado por volume/categoria/BSP; fora do subtotal |
| Subtotal técnico indicativo | US$55–190 ≈ R$303–1.045 |

Não inclui assinaturas Claude/Codex/Lovable dos fundadores, GitHub/plano de proteção, trabalho humano, marketing, taxas de cobrança, fiscal, SMS, aquisição de domínio ou assessoria. Modelos de desenvolvimento e custo de IA embarcada são contas diferentes.

## Modelo unitário a preencher com dados reais

```text
custo_llm = tokens_input/1e6 * tarifa_input
          + tokens_output/1e6 * tarifa_output
          + cache + áudio + ferramentas cobradas
custo_whatsapp = Σ mensagens_entregues_categoria_pais * tarifa_atual
               + taxa_BSP + mensalidade/número, se houver
custo_servir = infra_alocada + llm + mensagens + suporte + taxas_variáveis
contribuição = receita_líquida - custo_servir
```

WhatsApp possui categorias/regras de gratuidade e cobrança que precisam ser verificadas por país e parceiro. Não usar “custo por conversa” genérico nem supor que toda mensagem é grátis. Exibir orçamento de campanha antes da aprovação e respeitar limite no servidor.

Exemplo sintético: 50 pagantes × R$79 = R$3.950 de receita bruta. Infra R$450 + IA R$300 + canais R$250 + suporte 12h×R$50 = R$1.600; sobra R$2.350 (59,5%) antes de impostos, cobrança, aquisição e despesas fixas. Se suporte virar 1h por profissional, ele sozinho custa R$2.500; no mesmo cenário sobra R$450 (11,4%). Isso demonstra por que serviço humano ilimitado não cabe escondido no plano barato.

Não projetar CAC/LTV confiável com dez amigos testando. Registrar origem, tempo dos fundadores, conversão para pagante, margem e retenção. Payback só faz sentido com CAC de canal reproduzível e contribuição líquida medida.

## Guardrails de consumo

- Uma franquia de interações/custo por negócio, com número provisório configurável no backend; não publicar “ilimitado”.
- Limite por execução e por dia; kill switch por tenant/provedor.
- Consulta numérica sem LLM quando possível; modelo adequado à tarefa, sem chamar modelo máximo para tudo.
- Sem jobs que analisam toda base a cada minuto; incremental por evento e resumo diário.
- Mensagens de marketing como pacote/uso adicional transparente; lembrete e campanha separados.
- Importação, site e organização humana cobrados por escopo; onboarding inicial limitado e medido.
- Plano gratuito não financia campanhas irrestritas. Perfil público não autoriza scraping nem marketing.

**Decisão comercial provisória:** preservar R$79 de fundador para adesões elegíveis; aprender custo-to-serve; experimentar planos posteriores acima disso para novos clientes quando o serviço entregue justificar. Não incluir emissão fiscal, marketing pesado e atendimento humano ilimitado por inércia.

## Complemento da reconciliação

O doc15 reconcilia os cinco pacotes assistidos do Gabriel. São hipóteses com R$60/h e 25% de reserva, distintas deste cenário. Não somar estimativas por 1.000 clientes nem embutir serviços humanos na oferta de R$79. Medir minutos e canal por cliente antes de ampliar.
