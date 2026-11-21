# Handoff · Primeiro acesso de verdade

Sessão: Claude Code na nuvem, para @fffalleiros · 2026-11-21
Branch: `claude/kind-allen-m9zju9` → PR para `main`.
Pacote: um profissional novo, do cadastro ao primeiro recebimento, sem demonstração. Área: `src/features/identity`, `src/features/privacy`, `src/app` (sessão, cadastro, login, recuperação, erros; não a Home), `supabase/functions/identity`, `supabase/templates`, `tests/integration`, `tests/e2e` (jornadas com servidor) e `docs/qa`.

## Entregue

### 1. Jornada com servidor de um negócio que nasce do zero

`tests/e2e/servidor/jornada-primeiro-acesso.spec.ts`, no job que já roda `bash tests/e2e/servidor/run.sh` no CI, contra o Postgres do runner e os handlers de produção.

- **Desktop, cabeleireira** ("Corte feminino", 45 min + 10, R$ 80) e **375 px, personal** ("Sessão individual", 60 min, R$ 120). Cada uma:
  1. cria a conta em `/criar-conta` (confirmação desligada, o caso da homologação hoje);
  2. cria o negócio (nome, profissão, termos) e cai na Home com "Deixe seu negócio pronto · 0 de 7";
  3. configura pela Home (horários → 1 de 7, serviço → 2 de 7) e por `/app/configurar` (antecedência, perfil → "Seu link público já recebe reservas");
  4. liga Mensagens por `app.module_admin_set` (o que o `preparar:uat` faz) e conecta o número simulado pela tela;
  5. numa aba anônima, pede pelo `/p/<slug>`, lê o código em Mensagens › Simulador e confirma; a reserva aparece na Agenda;
  6. leva a reserva para ontem (único outro preparo por SQL), Atendido › "Recebi R$ X no Pix", confere no Caixa;
  7. abre Retorno; confere no banco cada registro e que nada nasceu em outro negócio.
- **Confirmação ligada** (desktop): a tela diz para abrir o link, `/app` volta a `/entrar`, entrar sem confirmar mostra "Falta confirmar o e-mail…", o link da caixa simulada entra e abre o "Criar meu negócio".
- O gateway de teste (`tests/e2e/servidor/gateway.ts`) passou a imitar `/auth/v1/signup`, `/verify` (com e sem confirmação, e-mail repetido como o GoTrue), `email_not_confirmed` no login, uma caixa de correio (`/__teste/correio`) e as leituras da Conta para conta nova. Qualquer 4xx/5xx fora da lista `CONHECIDAS` reprova.
- **Corrigido na área ao rodar:** o resumo semanal da caixa de Mensagens (`src/app/OwnerDigest.tsx`) chamava `growth-advice/digest.list` com "Metas e sugestões" desligado (padrão no piloto) e levava 403; agora só monta com o módulo ligado.

### 2. Conta: cadastro, confirmação, "Esqueci minha senha" e troca de senha

- **Senha mínima de 10, com letras e números (D28, #90).** Já estava em `supabase/config.toml` (`minimum_password_length = 10`, `letters_digits`) e na tela; a mensagem de senha fraca vinda do servidor agora diz a regra ("Use pelo menos 10 caracteres, com letras e números…").
- **Com confirmação de e-mail ligada:** o cadastro devolve sem sessão e a tela diz "Confira seu e-mail". E-mail já usado responde igual (o Auth não diz). Entrar com e-mail não confirmado mostra "Falta confirmar o e-mail" e o botão **"Reenviar o link de confirmação"** (`auth.resend`, com o mesmo destino `/app/conta/novo-negocio`); a resposta é sempre neutra ("Se o e-mail puder ser usado, enviamos um link novo") e o limite de envio vira "Muitas tentativas".
- **Sem confirmação (como no local e no CI):** o cadastro já entra e vai para criar o negócio. E-mail já usado mostra a frase neutra de antes (`EMAIL_UNAVAILABLE`).
- **"Esqueci minha senha":** resposta neutra sempre (só limite de envio aparece). O link do e-mail leva a `/app/conta/nova-senha`; se o endereço de volta não estiver na lista do Auth e o link cair na raiz, o evento `PASSWORD_RECOVERY` leva a pessoa à tela de nova senha mesmo assim (`session.recovering`). Link vencido (`#error_code=otp_expired`) vai para `/entrar` com a explicação e o caminho para pedir outro.
- **Troca de senha:** "A nova senha precisa ser diferente da atual" (`same_password`) e "O link ou a sessão venceu…" (sessão de recuperação vencida), em vez de "Não foi possível concluir".
- **Modelos de e-mail** (`supabase/templates/confirmation.html`, `recovery.html`): revisados em português, com validade ("vale por 1 hora e só funciona uma vez") e o que fazer quando vence. Colar no painel do Supabase conforme `release/EMAIL-RESEND.md` (não aplicado na homologação).

### 3. Login que volta ao destino, sessão expirada e saída limpa

- `src/app/return-to.ts`: `?volta=` com destino interno validado (só `/app/…` e as páginas públicas `/reserva`, `/p`, `/pagar`, `/orcamento`, `/avaliar`, `/convite`, `/indicar`, `/oferta`…; recusa `//`, `\`, outra origem e texto longo) e `?motivo=` (`sessao`, `saiu`, `link`).
- O shell manda quem não está logado para `/entrar?volta=<onde estava>`; depois de entrar, volta para lá. Link de recado (`/app/agenda/…`, `/app/clientes/…`) aberto deslogado volta ao recado.
- **Sessão que cai sozinha** (token vencido de vez, ou uma função respondendo `AUTH_REQUIRED`): sai só neste aparelho e mostra "Sua sessão terminou. Entre de novo para continuar de onde parou", com o destino.
- **Sair:** apaga o cliente de API da sessão, as chaves `tinindo.*` do `localStorage`/`sessionStorage` e o negócio escolhido; `/entrar` diz "Você saiu da conta. O que estava guardado neste aparelho foi apagado" e **não** guarda o destino (aparelho dividido).
- Erro de login neutro ("E-mail ou senha inválidos") e limite de tentativas próprio.

### 4. Estados do primeiro dia

- **Conta:** o cartão "Primeiros passos" deixou de contar 5 passos (contradizia o "N de 7" da Hoje, achado A7 da revisão de 04/11). Aponta para a Configuração, que lê o estado do servidor, e para "Dizer o que você quer resolver primeiro".
- **Mais recursos:** cada módulo diz o que faz e, desligado, o que acontece ao ligar ("Ao ligar, Assinaturas entra no menu. Comece criando um plano…"), usando o nome do menu. Sem módulo disponível, um aviso em vez de cartão vazio.
- **Seus dados (P57):** datas no fuso do negócio (não mais fixo), "Ainda não há clientes cadastrados…", "Nenhum arquivo gerado ainda" e, para a equipe, "Só quem é dono do negócio baixa ou elimina dados. Você pode ver o que já foi pedido".

### 5. Termos e política no cadastro (#87)

- `src/features/identity/legal.ts`: registro dos dois textos (título, versão, `status: "rascunho"`, `publishedAt: null`) lidos de `docs/legal/*.md` sob demanda (fora do pacote inicial).
- A folha (`LegalSheet`) mostra o texto com o aviso **"Rascunho em revisão jurídica. Este ainda não é o texto final…"** e "Versão que o aceite registra: termos-piloto-v0". Marcas `pendente` do rascunho aparecem destacadas.
- O cadastro tem "Ao criar a conta, você concorda com os Termos de uso e a Política de privacidade da fase piloto", com os dois abrindo a folha. As versões vão nos metadados da conta (indicativo).
- **O registro que vale** continua em `public.policy_acceptances`, gravado ao criar o negócio. Novo: a função `identity` **recusa** `business.create` sem as duas versões atuais (`CURRENT_POLICY_VERSIONS`), com "Os termos mudaram. Recarregue a página…". `legal.test.tsx` falha se a lista da tela e a da função divergirem.
- Quando o advogado aprovar: trocar o texto em `docs/legal`, subir a versão (`POLICY_VERSIONS` e `CURRENT_POLICY_VERSIONS`, no mesmo PR), mudar `status` para `"publicado"` e `publishedAt`. Nenhuma migration é necessária.

### 6. `docs/qa/UAT-PILOTO.md`

- `npm run preparar:uat -- homolog --cabeleireiro <id> --personal <id>` no lugar do SQL à mão (e `--desligar` ao fim).
- O que mudou desde 20/11: série do servidor e "Cancelar os próximos" (#143), link da reserva com preço, local, regra, "Reenviar código" e "Ver minha reserva" (P55), layout novo (P54), Conta e termos (este pacote).
- Senha de 10 e reenvio de confirmação no "Antes de cada sessão"; observação de "Mais recursos" e "Seus dados".
- **Ficha da sessão**, uma por pessoa, em texto para copiar.

## Decisões tomadas aqui (sem parar para perguntar)

- Sair não guarda o destino (aparelho dividido); sessão vencida guarda.
- O aceite com valor jurídico é o do servidor, ao criar o negócio. O metadado do cadastro é só indicativo (a pessoa edita os próprios metadados).
- O texto jurídico aparece já no piloto, marcado como rascunho, em vez de esconder (pedido da #87: estrutura pronta).
- `AUTH_REQUIRED` de uma função encerra a sessão só neste aparelho (`scope: "local"`), para não derrubar a pessoa em outro celular.

## Recados (fora da área)

- **#160** · quem reserva pelo link não vira cliente (A11): Retorno fica vazio e "Primeiro cliente" segue pendente. A spec fixa o comportamento de hoje; trocar quando corrigir.
- **#161** · rótulo da profissão em dois jeitos (`setup/labels.ts`) e `/p` chamando o Site guardado (404 em `presence.public_site`, na lista `CONHECIDAS`).
- Anotado sem recado: com Mensagens ligado, a contagem vira "N de 8" (passo do número, `src/lib/setup/steps.ts`); é do P51 e o roteiro do UAT avisa. O "aluno(a)" só no campo de cancelamento da Conta é o substantivo do preset do personal; ficou.

## Testes e resultados (local)

| Comando | Resultado |
|---|---|
| `npm run lint` | ok |
| `npm run typecheck` | ok |
| `npm run test:unit` | 1089+ ok |
| `npm run test:contracts` | 846 ok, 38 pulados |
| `npm run test:integration` | 163 ok |
| `npm run db:test:local` e `db:test:concurrency` | ok |
| `npx playwright test` (desktop e Pixel 7) | 320 ok, 34 pulados (antes, 3 × 2 falhas da folha dos termos e da Conta, atualizadas de propósito em `tests/e2e/identity/cadastro.spec.ts`) |
| `bash tests/e2e/servidor/run.sh` | 5 ok (P59 e primeiro acesso nos dois projetos, confirmação ligada no desktop), sem 403 |

## Contratos, migrations, flags

Nenhuma migration, nenhum contrato novo. Função `identity` com uma validação a mais (400 `accepted_policy_versions`). Nada aplicado na homologação.
