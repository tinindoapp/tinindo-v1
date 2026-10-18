# 08 · GitHub e sessões paralelas

## Vocabulário em um minuto

Branch é uma linha de trabalho; worktree é uma pasta isolada dessa linha; commit é uma versão registrada; PR é o pedido revisável de integrar a mudança; CI executa verificações automáticas; homologação é o ambiente de teste compartilhado; UAT é teste com quem usará o produto. Um PR aprovado ainda não significa publicação em produção.

## Cinco camadas com funções distintas

1. `CLAUDE.md` / `AGENTS.md`: instruções compartilhadas, versionadas.
2. `docs/` / `tasks/`: contratos, aceite e contexto. Cada agente lê só o necessário.
3. **Quadro remoto na branch `coordination`**: reserva e estado do trabalho em `workboard.json`.
4. Branch + worktree por sessão/tarefa: separação dos arquivos locais.
5. PR, revisão, CI e proteção de `main`: mecanismo de integração e bloqueio.

Não existe memória automática compartilhada entre as máquinas de Felipe e Gabriel. O arquivo de instruções não é mutex, não é controle de acesso e não garante obediência do modelo. GitHub e testes fazem as verificações executáveis. O coordenador entregue evita reservas concorrentes entre sessões que seguem o protocolo; não impede um colaborador autorizado de editar arquivos à mão. Proteções e revisão continuam necessárias.

## Repositório e Lovable

Primeiro confirmar o repositório vinculado ao projeto Lovable. A documentação consultada diz que a vinculação cria um repositório; importar ZIP cria projeto que depois recebe nova vinculação. Se já estiver conectado, usar aquele repositório. Se não estiver, criar/importar o shell mínimo, conectar uma vez e tornar o repo resultante canônico. Repositório canônico do app: `tinindoapp/tinindo-v1` (ADR-0001). O site público continua fora dele.

Lovable visualiza uma branch ativa por projeto. Reservar o projeto compartilhado para `main`/homologação e anotar SHA testado. Não trocar a branch enquanto Gabriel valida outra versão. Para testar PR isolado: preview de PR em outro hosting ou agendar a troca e restaurar depois. Não desconectar/reconectar Git sync como forma de atualizar código. Não usar edição automática do Lovable no fluxo diário; se houver edição excepcional, ela vira branch/PR e recebe os mesmos checks.

## Modelo de branches

| Branch | Uso | Quem escreve |
|---|---|---|
| `main` | Código integrado e implantável em homologação | Somente PR revisado |
| `task/p03/<sessao>` | Uma tarefa, uma sessão responsável | Dono da reserva |
| `fix/<issue>` | Correção delimitada | Responsável nomeado, mesmo protocolo |
| `coordination` | Estado do trabalho; nunca mergear em main | Ferramenta de coordenação |

Produção usa tag/commit aprovado. `main` não precisa ser produção automática. Evitar branch permanente `develop` no piloto: ela dobra a integração. Atualizar branch de tarefa a partir de `origin/main` antes do PR final; se já publicada, preferir merge de main ou rebase coordenado, nunca force-push que descarte trabalho alheio.

## Um worktree por sessão

No clone de cada pessoa, depois de autenticar com sua própria conta:

```bash
git fetch origin --prune
python3 scripts/coord.py --repo OWNER/REPO status
python3 scripts/coord.py --repo OWNER/REPO claim P03 --session felipe-p03-a
git worktree add ../tinindo-p03-a -b task/p03/felipe-p03-a origin/main
cd ../tinindo-p03-a
claude
```

`OWNER/REPO` deve ser substituído pelo repositório canônico confirmado. O comando `claim` retorna o nome exato da branch; usar esse valor. A reserva não cria branch/worktree nem escolhe tarefa por você. Alternativa: `claude --worktree <nome>` cria checkout isolado; ainda exige reserva remota e registro do nome final. Não criar simultaneamente ambos para a mesma tarefa.

No Windows, usar WSL ou adaptar `python3` para o Python instalado; não presumir que Bash existe. Cada worktree usa porta de frontend distinta. Banco local compartilhado também pode colidir: ou um stack local por worktree com portas distintas, ou um único dono de migrations e fixtures por sessão com IDs próprios. Nunca executar reset em homologação para “limpar teste”.

## Coordenador incluído

Pré-requisitos: Python 3.10+, Git e GitHub CLI `gh` autenticado. A ferramenta usa a autenticação do `gh`, não recebe PAT em argumento e não imprime tokens.

Bootstrap único, depois de confirmar repo e fazer primeiro commit:

```bash
gh api repos/OWNER/REPO/git/refs -f ref=refs/heads/coordination -f sha=SHA_ATUAL_DA_MAIN
python3 scripts/coord.py --repo OWNER/REPO init --integrators LOGIN_FELIPE LOGIN_GABRIEL
```

Se a branch já existir, não recriar nem sobrescrever. Integradores precisam ser logins reais com acesso; a ferramenta valida o ator pelo GitHub. O comando `init` lê o manifest local e não marca nada concluído. P00 também precisa de PR integrado e conclusão. A branch de coordenação pode receber commits diretos de estado; essa exceção não se aplica à `main`.

```bash
python3 scripts/coord.py --repo OWNER/REPO status
python3 scripts/coord.py --repo OWNER/REPO claim P04 --session gabriel-p04-a
python3 scripts/coord.py --repo OWNER/REPO assert P04 --session gabriel-p04-a
python3 scripts/coord.py --repo OWNER/REPO heartbeat P04 --session gabriel-p04-a
python3 scripts/coord.py --repo OWNER/REPO review P04 --session gabriel-p04-a --pr 42
python3 scripts/coord.py --repo OWNER/REPO finish P04 --pr 42
```

`status` mostra tarefas disponíveis, dependências, donos, PRs e reservas vencidas. `claim` faz atualização otimista com SHA do arquivo remoto: em disputa, relê e reavalia a disponibilidade. Uma tarefa reserva também suas áreas exclusivas. Estado vivo fica no remoto; editar manifest local não altera uma reserva em curso.

Reserva dura duas horas, com heartbeat sugerido a cada 30 minutos e antes de commit/push. Se vencer durante implementação, a sessão para de escrever e pede retomada ao integrador. Não há roubo automático por timeout. Para intervenção:

```bash
python3 scripts/coord.py --repo OWNER/REPO block P04 --session gabriel-p04-a --reason "aguardando contrato de disponibilidade"
python3 scripts/coord.py --repo OWNER/REPO reset P04 --confirm-stopped --reason "sessao anterior encerrada; branch preservada no handoff"
```

Reset exige integrador, motivo e confirmação de que o escritor anterior parou. Ele libera a tarefa, não apaga branch/PR/código. Não reaproveitar identificador de sessão em outra execução. `review` mantém a área reservada enquanto o PR é avaliado. Para corrigir review ou retomar blocked, o mesmo dono usa `resume Pxx --session ID`; isso preserva branch/PR e cria novo prazo. Sessão em implementação vencida não pode usar resume: requer recuperação pelo integrador. Enquanto review/blocked, não escrever. Sincronizar relógios das máquinas; TTL é coordenação, não autorização de segurança. `finish` exige integrador e PR realmente merged na `main` do mesmo repo, com branch esperada. Concluir pacote não significa publicar em produção.

Falha de rede depois de uma escrita: não presumir fracasso nem iniciar segunda sessão. Consultar `status`; a gravação pode ter ocorrido. Permissões GitHub (403/404) não são tratadas como “quadro vazio”. Se indisponível, pausar escrita de áreas compartilhadas e coordenação automática; o integrador pode distribuir tarefas manualmente de forma exclusiva, registrando depois. Não rodar dois mecanismos concorrentes.

## Ownership e arquivos disputados

Integrador é dono de `package.json`, lockfile, roteador central, tokens visuais, contratos, CI e migrations aplicadas. P04 registra rota por módulo, não reescreve o roteador de P09. Mudança global vira pequena tarefa/PR separado, revisado antes dos consumidores. Manifest usa recursos lógicos exclusivos; o CI/Codeowners e revisão verificam os caminhos de cada PR. O coordenador não fiscaliza diff sozinho.

Migrations: módulos propõem; integrador ordena, adapta, testa em banco limpo e banco atualizado e aplica. Dois agentes nunca fazem `supabase db push` no mesmo projeto. `CLAUDE.md` nunca deve mandar “corrija todo o projeto até funcionar” sem escopo.

## PR e integração diária

PR explica problema, mudança, teste, contrato, migration e flag. Inclui issue/pacote, sessão, SHA testado e handoff. Revisor diferente do autor. Checks de tipo/build, domínio, RLS/DB, contratos e e2e necessários. Resolver comentários; não aprovar só porque o agente disse “passou”.

Proteger `main`: exigir PR, uma revisão, checks obrigatórios, branch atualizada, impedir force-push e bypass rotineiro inclusive de admins. Em repo privado, verificar plano GitHub que ofereça esses controles; se indisponível, resolver plano/organização, não fingir que instruções Markdown substituem enforcement. CODEOWNERS precisa de logins válidos e regra de review habilitada para ter efeito.

Integração em slices: identidade+catálogo; reserva completa; preço+lista; recebimento+agente. O integrador revisa diffs e execução, não apenas resolve marcadores de conflito. Conflito semântico pode compilar e ainda duplicar cobrança.

## Não fazer

Não usar uma branch compartilhada por vários terminais. Não executar `git add .` sem revisar arquivos/segredos. Não dar credenciais de produção a agentes de implementação. Não usar `--dangerously-skip-permissions` como configuração padrão. Não permitir deploy, compra, mudança de ACL ou migration destrutiva só porque um prompt pediu autonomia. Não copiar banco real para fixtures. Não deixar PRs uma semana sem integração.

## Avançar a fase sem perder histórico

Depois de todos os pacotes atuais integrados, o integrador revisa um novo manifest com `phase` diferente e IDs novos P11–P99. Pode declarar dependências das tarefas antigas. Executar `python3 scripts/coord.py --repo OWNER/REPO advance --manifest coordination/fase2.json`. A ferramenta preserva histórico e tarefas concluídas e recusa fase anterior incompleta. Não rodar `init` novamente nem editar o JSON remoto à mão. Labels F2-01 deste plano são blocos de produto; convertê-los para os IDs de tarefa suportados ao abrir a fase. Se o escopo futuro exceder P99, versionar explicitamente a ferramenta antes, sem reaproveitar IDs.
