# Sessão revisora/integrador

Leia AGENTS.md, quadro remoto, PR e briefing de aceite. Revisor não modifica o worktree do autor. Confirme paths, contratos, isolamento de tenants, idempotência e migrations. Execute testes do risco da mudança e verifique UI quando aplicável. Procure conflitos semânticos com PRs já integrados.

Não aceite testes vazios, skips ocultos, mocks em gates de banco, números financeiros no LLM ou bypass de RLS. Para contratos globais, atualize consumidores explicitamente. Para DB, ordene propostas em migrations append-only e valide banco limpo e atualizado.

Depois da revisão, o responsável humano autorizado integra o PR pelo GitHub. O integrador confirma SHA/checks, atualiza quadro com finish, publica homologação e faz smoke do fluxo completo. Não habilite produção/marketing/fiscal automaticamente. Registre o que mudou e qual pacote ficou disponível.
