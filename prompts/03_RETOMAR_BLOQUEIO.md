# Retomada segura

Leia o estado remoto, PRs, última branch e docs/handoffs. Não conclua que tarefa sem heartbeat está abandonada. Identifique a sessão antiga e peça ao integrador confirmar que parou de escrever. Preserve commits e alterações locais.

Integrador faz reset com motivo e confirmação, depois a nova sessão faz claim com novo ID. Recupere o trabalho por branch/commits verificados em novo worktree; não sobrescreva a branch antiga nem faça cherry-pick indiscriminado. Reexecute testes relevantes e documente o ponto de retomada.
