# ADR-0023 · Metas por indicador, sugestões por regra e conteúdo aprovado (P22)

Status: aceita · 2026-10-23 · integrador (onda 2, PR 8; plano em `docs/plano-onda-2.md`)

## Contexto

O P18 mede; o P13, P19, P20 agem. Falta o elo que orienta o profissional sem prometer resultado: metas que ele entende, sugestões que se apoiam em dado existente e conteúdo pronto para a presença digital. Riscos: metas "declaradas" (número digitado em vez de medido), sugestões geradas por modelo que inventam ou prometem, e publicação fora do que o dono autorizou no perfil (P09). Docs/00 e doc17: "recomendação se apoia em dado existente; publicação passa pelo escopo autorizado".

## Decisões

1. **Meta é um alvo sobre um indicador do P18; o progresso é o próprio indicador.** `goals` guarda `metric_key` (subconjunto de `MetricKey`: ocupação, faltas, cancelamentos, ofertas de vaga, orçamentos, recebido, despesas, cobrança registrada, lembretes), alvo, mês (fuso do negócio) e direção derivada do indicador (faltas, cancelamentos e despesas: quanto menor melhor). `app.ga_goal_json` chama `app.an_metrics` no mês: valor, numerador, denominador, `insufficient` quando não há dado (nunca zero disfarçado), `attainment` 0–1 e `achieved`. Uma meta ativa por indicador e mês (índice único parcial; criação concorrente vira `POLICY_REJECTED`, não erro interno). `human_minutes` fica fora: é custo da Tinindo, não meta do profissional.
2. **Sugestões só por regras fixas, sem LLM.** `app.ga_rules` avalia cinco regras sobre o mês corrente, cada uma com limiar mínimo de denominador e evidência explícita (taxas e contagens, nunca nomes), apontando a tela onde a ação acontece: faltas ≥ 15% com lembretes < 80% → Relacionamento; ocupação < 50% com público autorizado inativo → Campanhas; cobrança registrada < 90% → Caixa; orçamentos aceitos ≥ 60% → Assinaturas; perfil publicado com `bio` escolhida e vazia → Conteúdo. Nenhuma regra age sozinha. O contrato de teste garante que a migration não chama provedor externo.
3. **Decisão registrada uma vez por regra e mês; acompanhamento observacional.** `advice_decisions` guarda a decisão (aceita/dispensada), a evidência e o indicador congelado no momento; 30 dias depois `app.ga_tick` (em `jobs_run`) mede o mesmo indicador de novo e classifica a variação como `improved/worsened/unchanged/insufficient`. A tela diz "variação observada, não efeito". É aprendizado por resultado sem causalidade presumida (o P19 é o caminho para efeito).
4. **Conteúdo pré-aprovado entra por migration.** `content_templates` (profissão ou `all`, `bio` ou `post`, com `{{business}}`/`{{area}}`) só muda por migration revisada; `approved_by = 'tinindo'`. A tela mostra o texto preenchido com os dados que o negócio já declarou públicos (nome e área do perfil). Posts são para copiar; não há publicação automática em rede social.
5. **Publicação só pelo escopo autorizado do P09.** `content_publish` exige perfil publicado com o campo `bio` entre os `public_fields` escolhidos pelo dono, texto da própria profissão (ou geral) e do tipo `bio`; grava em `profile_contents` (um por negócio, versionado) e emite `content.published.v1`. `app.network_profile_json` (P09) é substituída de forma aditiva para ter fonte para `bio`: aparece na projeção pública só se o campo foi escolhido; tirar o campo esconde o texto sem apagar nada. Isso fecha a lacuna registrada no P09 ("bio ainda não tem fonte").

## Consequências

- `jobs_run` devolve também `advice.followed_up`. Seis responsabilidades por rodada: o próximo passo é um cron por família.
- Novos limiares das regras são constantes no SQL; mudar é migration (`create or replace app.ga_rules`), e a tela nunca repete os números: lê a sugestão.
- O perfil público pode mostrar `bio`; a tela do Perfil (P09) continua decidindo o escopo. Textos de `post` não têm efeito fora do app.
- Sem `public_profiles` publicado, a seção de conteúdo mostra o bloqueio e o caminho (Perfil), em vez de esconder o recurso.
