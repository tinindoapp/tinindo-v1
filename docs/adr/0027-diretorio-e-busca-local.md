# ADR-0027 · Diretório e busca local (P23)

Status: aceita · 2026-10-24 · integrador (onda 3, PR 4; `docs/plano-onda-3.md`)

## Decisões

1. **Opt-in com perfil publicado.** O negócio entra pela tela Diretório (Negócio) informando UF e cidade; sem perfil público (P09) publicado, recusa. Tirar o perfil do ar tira do diretório na leitura.
2. **Só campos autorizados no cartão** (`app.dsc_card`): nome público só se o perfil publica `display_name` (senão a área), categoria, área, cidade/UF declaradas, link do site (P17) se publicado, se aceita agendamento pelo link e, só se o dono escolher, os dias com expediente. Nunca contatos, clientes, preços ou a agenda de clientes.
3. **Critérios documentados e determinísticos** (`app.dsc_criteria`, mostrados na página): profissão e cidade/UF exatas, bairro contido na área do perfil, dia da semana só entre quem mostra o expediente; ordem alfabética do nome exibido (desempate pelo endereço). Nunca destaque pago, nota, posição comprada. Ranking explicável e monetização ficam para o P27.
4. **Disponibilidade publicável = dias de atendimento**, não horários livres em tempo real: é dado que o dono decide mostrar, barato de consultar e sem expor a ocupação da agenda. A vaga real continua no perfil público (P09), que já consulta o motor de agenda.
5. **Páginas indexáveis** por cidade e profissão servidas pela função (`GET /discovery/page?uf=&city=&category=`): título, descrição, canônico `/diretorio/:uf/:cidade/:categoria`, `ItemList` com os itens públicos; CSP sem script; cache de 10 min. O app tem as mesmas rotas para navegação.
6. **Moderação só pelo backend** (`discovery_moderate`): suspende com motivo ou libera; o dono vê o motivo e não desfaz a suspensão salvando de novo.
7. **Correção transversal:** o teste de concorrência mostrou que o primeiro salvamento em paralelo vazava `duplicate key`. Corrigido aqui e, pelo mesmo padrão, no rascunho do site (P17) e no perfil fiscal (P16) por `create or replace` em `20261024141000_fix_first_save_race.sql`: o segundo perde por versão (409).

## Contrato (aditivo)

Módulo `discovery`: `discovery.get`, `discovery.save`, `directory.search` (anon), `directory.cities` (anon).

## Pendências do dono do projeto

Regras de moderação e contestação, oferta local suficiente antes de divulgar as páginas (docs/17: F4 exige oferta e moderação), roteamento das páginas `/diretorio/...` para a rota indexável no ambiente hospedado.
