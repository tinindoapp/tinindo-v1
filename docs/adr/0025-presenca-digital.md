# ADR-0025 · Presença digital: site, domínio e Google (P17)

Status: aceita · 2026-10-24 · integrador (onda 3, PR 2; `docs/plano-onda-3.md`)

## Decisões

1. **Site = projeção pública aprovada.** O conteúdo (`app.prs_snapshot`) sai só do perfil P09 publicado (nome, categoria, área e `bio` quando o campo foi escolhido), da frase de apresentação do dono, dos serviços que ele marcar (preço base só com a seção "Preços"), do expediente (seção "Horários") e do link de agendamento (seção "Agendar", só se o perfil publica `booking_link`). Nunca lê clientes, agenda de clientes, piso de preço ou custos. Sem perfil publicado não há prévia nem site, e tirar o perfil do ar derruba o site na leitura pública.
2. **Publicar é aprovar o hash da prévia.** `site.publish` recalcula o conteúdo e só publica se o hash for o que o dono viu; qualquer mudança (um preço, um serviço desativado) devolve 409 `STALE_VERSION` (`preview`). Cada publicação vira uma versão append-only (`presence_site_versions`); preço novo não muda a versão no ar. O mesmo conteúdo já no ar não cria versão duplicada (dois cliques em paralelo).
3. **Reversível.** `site.unpublish` tira do ar; `site.restore` põe de volta uma versão aprovada antes, exatamente como foi aprovada (é uma nova aprovação explícita daquela versão). Cada passo vira entrega registrada.
4. **Página indexável servida pelo backend.** `GET /functions/v1/presence/page?slug=` (ou `?host=`) devolve HTML com título, descrição, canônico (domínio verificado quando houver) e dados estruturados `LocalBusiness` mínimos e verdadeiros: sem nota agregada, avaliação ou promessa de posição. Texto escapado; CSP sem script executável; cache de 5 min (tirar do ar vale em minutos). A rota `/s/:slug` do app mostra o mesmo conteúdo. As cores da página repetem os tokens da marca (teste de contrato compara com `brand/tokens/tokens.css`).
5. **Domínio é do cliente.** A Tinindo não compra nem registra domínio. O dono liga um nome (um ativo por negócio); o banco gera um token aleatório e a tela mostra o registro TXT `_tinindo-verify.<domínio>` = `tinindo-verify=<token>`. "Verificar agora" é uma consulta: o banco autoriza o dono e aplica 20 s entre consultas; a função consulta o DNS pela porta (`Deno.resolveDns`) e grava o observado pela RPC de backend, que compara com o token e decide (`found`, `not_found`, `taken`, `lookup_failed`). Falha de consulta nunca vira verificado. Um nome verificado pertence a um negócio só (índice único; corrida resolvida pelo índice, o outro vê `taken`). Nomes da Tinindo e de teste são recusados. O destino do CNAME vem do ambiente (`PRESENCE_CNAME_TARGET`); sem ele, a tela diz que aparece quando o ambiente hospedado existir.
6. **Google por acesso de gerente.** O dono adiciona a Tinindo como gerente (nunca proprietária) no Perfil da Empresa e registra aqui o nome do perfil e, opcionalmente, o link do Maps (validado). Nenhuma credencial do Google é guardada. Revogar é imediato no registro; sem acesso ativo, `ops.presence_delivery` recusa (422 `google_access`).
7. **Entregas com evidência.** `presence_deliveries` (append-only) registra publicações (versão e hash), domínio verificado (registro observado), acesso concedido/revogado e as entregas da operação no Google (só operador ativo do P15, com link https de comprovação e, opcionalmente, o pedido de serviço do qual ele é responsável). Nenhum tipo de entrega fala em posição ou ranking.
8. **Ícone "site"** (globo) desenhado na especificação do manual, como os demais de ADR-0024 §7; entra na lista para o sprite oficial.

## Contrato (aditivo)

Módulo `presence`: `presence.get`, `site.save`, `site.publish`, `site.unpublish`, `site.restore`, `domain.add`, `domain.remove`, `domain.check`, `google.set`, `ops.presence_delivery`, `presence.public_site`. Eventos `presence.site.published.v1` e `presence.domain.verified.v1`.

## Consequências e pendências do dono do projeto

- Para ir ao ar de verdade: domínio de sites da Tinindo e roteamento por host para a rota `page` (CDN/worker), `PRESENCE_CNAME_TARGET` e certificado TLS por domínio do cliente. Nada disso existe no repositório.
- Operação no Google é manual pela equipe (sem API do Google conectada); conectar a API do Perfil da Empresa é decisão e credencial do dono, atrás da mesma regra de acesso.
- Revisão humana dos textos da tela antes de dado real (release/CHECKLIST).
