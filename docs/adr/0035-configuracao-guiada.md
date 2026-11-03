# ADR-0035 · Configuração guiada: estado pelos dados, modelos por migration, rascunho confirmado e medição (P44)

Status: aceita · 2026-11-03 · integrador (sessão `claude-int-p44`, pedido do dono: "implemente de ponta a ponta, não pare para perguntar")

## Contexto

O P44 pede que o profissional seja levado pela mão no primeiro dia: "Deixe seu negócio pronto · N de 8" na Home, modelos de serviço por profissão, "descreva seu negócio em uma frase" e dicas nas telas vazias (docs/12 §onboarding, `docs/plano-assistente-configuracao-e-insights.md` §3). O aceite é um negócio novo chegar ao link público publicado em menos de 10 minutos pela Home, no celular, sem que nenhum serviço, horário ou preço seja gravado sem confirmação. A Conta (P01) já tinha uma lista "Primeiros passos" lida no navegador por RLS, com três passos.

## Decisões

1. **O estado de cada passo é calculado no servidor pelos dados reais, nunca por flag.** `app.setup_state` lê as tabelas dos outros pacotes: expediente (`availability_rules`, P03), serviço ativo com preço (`provider_services`, P02), antecedência de cancelamento (`tenant_onboarding`, P01), perfil publicado (`public_profiles`, P09), primeiro cliente (`customers`), foto ou WhatsApp no perfil (P09/P12), número verificado (`channel_connections`, P12) e primeiro recebimento (`payment_entries`, P07). `done` é consequência do dado existir e `done_at` é a data real desse dado. Apagar o dado volta o passo para "a fazer".

2. **Oito passos fixos, quatro obrigatórios.** Obrigatórios, nesta ordem: horários, serviço, antecedência de cancelamento, perfil publicado. Opcionais: primeiro cliente, foto e WhatsApp, número verificado, primeiro recebimento. "Pronto" = os quatro obrigatórios feitos; o link público recebe reservas. O próximo passo em destaque é o primeiro obrigatório pendente; só depois vêm os opcionais. Cada passo tem título, por quê (só enquanto pendente) e o caminho da tela que resolve. O catálogo é a função imutável `app.setup_steps()` e sua cópia de apresentação em `src/features/setup/labels.ts`.

3. **Dispensar é só para opcional.** `setup_dismissals` guarda "agora não" por (negócio, passo); a `check` da tabela e a RPC recusam passo obrigatório (400, campo `step`). O cartão da Home some quando os 8 estão feitos ou dispensados; a tela Configuração continua listando tudo.

4. **Modelos de serviço entram só por migration**, como `content_templates` do P22: `setup_service_templates` é append-only e sem escrita pela Data API. Cada modelo traz duração, intervalos e uma faixa de preço (ponto de partida, nunca "média de mercado"); o dono revisa o preço e confirma. "Pacote de 10 sessões" é `kind = package`: aparece como informação (vende-se no Caixa, P07), não vira serviço. As faixas iniciais são do piloto e devem ser revistas pelo dono do produto.

5. **Nada é gravado sem confirmação, e tudo passa pelas RPCs já existentes.** `setup.services_apply` e `setup.draft_apply` recebem o que o dono confirmou na tela (nome, duração e preço por item; dias e horários) e chamam `public.crm_service_save` (P02) e `public.scheduling_rules_save` (P03) por dentro, com chaves derivadas da chave do comando. Valem as mesmas regras (nome único entre ativos, limites, expediente válido) e é tudo ou nada: um item inválido desfaz o lote inteiro. Os comandos são idempotentes pela chave. A profissão do negócio pode ser ajustada pelo rascunho.

6. **"Descreva seu negócio em uma frase" é um analisador por regras, no cliente, com contrato de rascunho.** `_shared/domain/setup/describe.ts` lê profissão, quantas pessoas, dias (intervalos, dias soltos, "dias úteis", "todo dia"), horário (com "da manhã/tarde/noite", fim menor que o início vira tarde), pausa e serviços de um vocabulário fixo. O que não entendeu volta em `unknown` e a tela pergunta. O resultado (`SetupDescribeDraft`) é um rascunho revisado campo a campo e só vira dado pelo `setup.draft_apply`. O P46 devolve o mesmo formato a partir do modelo de linguagem, validado pelo contrato.

7. **Medição sem flag: `setup.step_completed.v1` uma vez por (negócio, passo).** `app.setup_record_completions` roda em toda leitura de `setup.progress` (e nos comandos), sob `pg_advisory_xact_lock` por negócio: a primeira vez que um passo é visto feito grava `setup_step_completions` (backend-only) com a data real do dado e os segundos desde o cadastro, e emite o evento pelo outbox. Leituras simultâneas não duplicam (teste de concorrência). Por isso `setup_progress` não é `stable`, embora a rota seja uma consulta sem chave.

8. **Indicador "negócios prontos em 24 h" no P18**, só para a operadora: `analytics_cost_to_serve` ganha o campo aditivo `setup_ready_24h` (negócios criados no período, prontos e prontos em até 24 h do cadastro), calculado pela data real dos dados (`app.setup_ready_at`), não pela leitura.

9. **Estados vazios com dica e botão** são um componente compartilhado (`SetupHint`) usado em Agenda (dia sem expediente), Serviços, Clientes, Caixa e Mensagens; a Home ganha o cartão. A lista "Primeiros passos" da Conta continua como está (três passos lidos por RLS); recomenda-se trocá-la pelo cartão ou por `setup.progress` numa próxima passada de UX, para ter uma lista só (E9).

10. **Demonstração offline** emula as mesmas regras com os dados de exemplo da aba: expediente, serviços, política, cliente e recebimentos já existem; o perfil só fica "feito" quando o dono o publica na tela Perfil (ponte `getPublishedSlug` do `journey.ts`); o que o dono salva pela Configuração vale só na aba. Tudo rotulado.

## Fora deste pacote

- Configuração em conversa pelo assistente ("Me ajuda a configurar") e leitura de frases livres pelo modelo: P46.
- Passo "perfil incompleto" como insight proativo: P45 lê `setup.progress`.
- Recepção automática pelo WhatsApp e qualquer ação sem confirmação.

## Consequências

- Os passos dependem das tabelas de seis pacotes: mudar uma dessas tabelas pede revisar `app.setup_state` (teste pgTAP 31 cobre cada passo).
- A migration só adiciona; para desligar o cartão basta tirar a linha do módulo em `src/app/modules.ts` e a chamada na Home. Os modelos ficam no banco sem efeito.
- O evento sai na primeira leitura depois do dado existir: quem nunca abre a Home não gera evento, mas o indicador do P18 não depende do evento (usa a data real).
