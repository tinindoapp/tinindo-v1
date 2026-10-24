# Plano da onda 3 · fechar a F2 e abrir a F4

Aprovado por @fffalleiros em 2026-10-24 ("Mete ficha e aprova tudo"). Esta aprovação é a decisão do integrador de liberar P16, P17, P23 e P24 para implementação; o manifesto do piloto (`coordination/manifest.json`) segue com P00–P10, como nas ondas anteriores. Liberar código não é liberar operação real: emissão fiscal, domínio, conta Google e diretório público dependem de credenciais, contratos e moderação fora do repositório.

| PR | Pacote | Entrega | Gate externo |
|---|---|---|---|
| 1 | UI etapa 2 | Lista primeiro com botão "Novo…" em Orçamentos, Assinaturas e Campanhas; `PageHeader` explícito nas telas internas (ADR-0024) | nenhum |
| 2 | P17 · Site e Google | Página padronizada do negócio, publicação aprovada e reversível, domínio do cliente com verificação, entrega com evidência, Google por acesso delegado atrás de porta; nenhuma garantia de posição | DNS real, conta Google do cliente |
| 3 | P16 · Fiscal seletivo | Elegibilidade e representação, emissão de NFS-e num caso elegível por provedor atrás de porta (sandbox), protocolo, pasta do contador; emitir não dá baixa | provedor fiscal homologado, certificado/credencial do profissional |
| 4 | P23 · Diretório e busca local | Busca por profissão, região e disponibilidade publicável; páginas indexáveis; só dado autorizado; critérios documentados | oferta local e moderação antes de abrir ao público |
| 5 | P24 · Avaliações e verificação | Avaliação com vínculo verificável, resposta, denúncia, moderação; identidade, indicação e competência não se confundem | moderação humana antes de abrir ao público |

Fora: P25–P27 (contratação, condomínios, ranking) dependem de oferta real e moderação; ficam para a próxima onda.

Regras de cada PR: migration nova append-only com pgTAP, contratos v1 aditivos, Edge Function pelo `rpc-handler`, porta de demonstração identificada, testes de contrato, integração, concorrência quando há disputa, e2e no celular e desktop, gitleaks, ADR e handoff. Merge um a um com CI verde.
