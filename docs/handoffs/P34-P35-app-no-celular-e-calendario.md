# Handoff · App no celular e calendário (P34 como app instalável e P35 calendários)

Sessão: `claude/nifty-clarke-921fl8`, uma das cinco em paralelo, para @fffalleiros · 2026-11-21

Base:
- `tasks/P34.md` e `tasks/P35.md`;
- `docs/12_SITE_E_EXPERIENCIA.md` ("Mobile web é prioridade desde a primeira entrega"; não obrigar cliente a instalar app);
- handoffs do P53 (camada comum) e do P55 (pacote público separado).

Área:
- `public/`, `index.html` e `vite.config.ts`;
- `src/main.tsx`, só o registro do service worker;
- `src/app/pwa/` e `src/features/calendar/`, novos;
- as funções novas `supabase/functions/calendar/` e `supabase/functions/push/`;
- `worker/`, só o que o PWA pedir;
- migrations novas e testes.

**Nada foi aplicado na homologação. Nenhuma chave foi configurada** (VAPID só por segredo, item 3).

Os pacotes P34 e P35 não estão no quadro do `coord.py` (que vai até P46), então não houve `claim`. O P34 previa iPhone com `apps/mobile/` depois de ADR. Este pacote entrega o caminho que o doc 12 prioriza: o mesmo app web, instalável. Um app de loja continua para depois.

## 1 · App instalável

### Manifesto e ícones (`public/manifest.webmanifest`)
- Já havia manifesto. Mudou o seguinte:
  - `id: "/app"` e `display_override`;
  - categorias;
  - atalhos "Hoje" e "Agenda".
- Ícones só da marca, sem redesenho:
  - 192 e 512 são os `pwa-*` de `brand/marca-pronta/03-icone-app-e-favicon/`, os mesmos de antes.
  - **O ícone `maskable` agora é o `pwa-maskable-512.png` da marca, com área de segurança.** Antes reaproveitava o de 512 comum e cortava a borda no Android.
  - `apple-touch-icon-180` e os favicons continuam os mesmos.

### Tela de abertura
- **Android:** o navegador monta a abertura com `background_color` e o ícone do manifesto.
- **No HTML** (iPhone e qualquer primeira carga): o `#root` do `index.html` traz a wordmark original sobre o fundo do tema.
  - No escuro, usa a versão negativa, copiada em `public/brand/`.
  - Some quando o React monta. Não depende de script e usa só estilo em linha, que o CSP permite.
- Imagens `apple-touch-startup-image` por tamanho de iPhone não entraram: seriam cerca de 20 arquivos para manter. A abertura do HTML cobre esse caso.

### Service worker (`src/app/pwa/sw.ts`, regras em `sw-logic.ts`)
- **Montagem:** o plugin `serviceWorkerFile` do `vite.config.ts` gera `dist/sw.js` no fim do build.
  - É um script único (IIFE), sem `import`.
  - Leva a versão do build e a lista de arquivos a guardar.
  - A lista sai do `writeBundle`, que é a lista final. Pelo `generateBundle` entrava um pedaço só de CSS que o Vite apaga, e a instalação inteira falhava.
- **O que fica guardado:**
  - todo o JS e o CSS do build;
  - as fontes latin e latin-ext (2,2 MB sem compressão; cirílico, grego e vietnamita ficam de fora);
  - `index.html`, manifesto, ícones e a wordmark.
- **Como cada pedido é tratado:**
  - **Navegação no app:** rede primeiro. Sem rede, abre a casca guardada.
  - **Páginas do cliente final** (`/p`, `/pagar`, `/reserva`, `/orcamento`, `/avaliacoes`): passam direto.
  - **`/assets/*` com hash:** vêm do cache, de qualquer versão guardada.
  - **Edge Functions:** rede, sem passar pelo cache neste item.
  - **`version.json`, `og-config.json` e o próprio `sw.js`:** sempre da rede.
- **Atualização segura:**
  - A versão nova baixa tudo e só então assume (`skipWaiting` depois do `addAll`). Se a instalação falhar, a versão em uso continua.
  - O cache da versão anterior fica guardado, e só as mais antigas saem. A aba aberta continua com o código dela e acha os pedaços que ainda não tinha aberto.
  - A página **não recarrega sozinha**. Mostra "Nova versão disponível" com "Atualizar" (recarrega) e "Depois".
  - A próxima abertura já é a versão nova, porque a navegação é rede primeiro. Ninguém fica preso numa versão velha, e ninguém perde o que está digitando.
  - **Por que não "esperar o toque":** foi o desenho tentado primeiro (a versão nova esperando o `SKIP_WAITING`). No Chrome, a troca ficava presa em `installed` depois de uma navegação, e o teste falhava de forma intermitente. Por isso a troca passou a ser imediata.
- **Registro** (`src/app/pwa/register.ts`):
  - Fica no `main.tsx`, só no build e só fora das páginas do cliente final: quem só reserva pelo link não baixa o app para o cache.
  - Usa `updateViaCache: "none"`.
  - Confere a versão a cada 30 minutos, só com a tela visível.

### "Adicionar à tela de início" (`src/app/pwa/install.ts`, `PwaLayer.tsx`)
- A faixa monta numa raiz própria (`#tn-pwa`), sem tocar no AppShell, e fica acima da barra de abas.
- **Convite:** só no celular, dentro do `/app`, fora do modo instalado e **depois de um dia de uso**. "Agora não" vale 30 dias.
- **Android ou Chromium:** "Instalar" usa o pedido do navegador (`beforeinstallprompt`). Se o dono recusar, aparecem as instruções.
- **iPhone:** os passos do Safari (Compartilhar → "Adicionar à Tela de Início"). Em outro navegador do iPhone, a primeira instrução é abrir no Safari.
- **Instruções a qualquer hora:** o endereço com `#instalar` abre as instruções do aparelho e as dos outros. O link no menu vai por recado (item 5).

### Testes
- **Unitários** (`src/app/pwa/*.test.ts*`, 19):
  - classificação dos pedidos;
  - versão e limpeza de caches;
  - lista de instalação;
  - plataformas e passos;
  - "Agora não";
  - registro (aviso só a partir da segunda versão, "Atualizar" recarrega uma vez, conferência só com a tela visível);
  - a faixa (convite, instruções, `#instalar`).
- **e2e** (`tests/e2e/pwa/app-instalavel.spec.ts`, desktop e Pixel 7):
  - manifesto e ícones existem;
  - o service worker controla o `/app`;
  - Hoje e Agenda abrem sem internet (demonstração);
  - páginas do cliente final não registram o service worker;
  - versão nova: aviso sem recarregar, e "Atualizar" recarrega;
  - sem o toque, a próxima abertura já é a nova;
  - em 375 px com toque: convite, instruções, "Agora não" guardado e `#instalar`.
- **A suíte e2e inteira com o service worker ligado:** 360 passaram e 34 foram pulados. O service worker não atrapalhou os outros testes.

## 2 · Sem internet

### O que abre sem internet (`src/app/pwa/sw-offline.ts`)
- **Leituras guardadas:** só as da Hoje e da Agenda do dia.
  - `GET /context` e `GET /crm/services|customers`;
  - `scheduling/booking.list`, `booking.get`, `schedule.settings`, `schedule.day_plans` e `availability.list`;
  - `finance/finance.summary` e `finance.uncharged`;
  - `growth-advice/insight.list`, `setup/setup.progress` e `waitlist/waitlist.list`.
- **Ordem:** rede primeiro. A resposta boa (2xx) fica guardada; erro do servidor não substitui a última boa.
- **Sem rede:** devolve a cópia guardada com `X-Tinindo-Offline-At` e avisa a tela.
- **Chave da cópia:**
  - pessoa (o `sub` do login) + negócio (`X-Tinindo-Tenant`) + endereço sem a `apikey` + corpo do pedido;
  - a pessoa vai no caminho da chave (`/__offline__/<pessoa>/<pedido>`), o que permite apagar por pessoa.
- **O cache nunca serve resposta de outro negócio:**
  - outro negócio, outra pessoa, outra janela da agenda ou pedido sem login recebem 503 `PROVIDER_UNAVAILABLE` ("Sem conexão, e este aparelho ainda não tem estes dados guardados");
  - teste de unidade e e2e no navegador.
- **Validade e limpeza:**
  - **24 h:** depois disso, a cópia não aparece e sai do aparelho.
  - **Outra pessoa entra:** na primeira resposta dela, o que era da anterior sai.
  - **Sair da conta:** a página percebe que o login do Supabase saiu do `localStorage` (a cada 10 s e pelo evento `storage`) e pede para apagar tudo. Isso não depende da tela de sessão, que está fora da área.

### Gravação sem internet
- **Comando sem rede** (qualquer POST fora da lista): 503 na hora, no envelope v1: "Sem conexão: nada foi salvo. Tente de novo quando a internet voltar."
- **Nenhuma fila:** nada fica guardado nem é reenviado quando a rede volta. Há teste que confere que nada é reenviado.
- **A demonstração** não chama servidor e continua como sempre.

### Aviso na tela (`offline.ts`, faixa no `PwaLayer`)
- **Sem rede:** "Sem conexão · dados de HH:MM. Nada é salvo até a internet voltar."
  - A hora é a dos dados guardados mais antigos que a tela mostrou, no horário do aparelho.
  - Sem dado guardado, a faixa diz só "Sem conexão".
  - O fundo é de aviso, opaco.
- **Ao voltar a conexão** depois de mostrar dados guardados: "Conexão de volta. Atualizando…", e a tela recarrega sozinha em 1,5 s.
  - Se alguém está digitando (campo com foco), a tela não recarrega e mostra o botão "Atualizar".

### Testes
- **Unitários:**
  - `sw-offline.test.ts` (ambiente node, com Cache Storage em memória): o que entra na lista, cópia com a hora, isolamento por negócio, pessoa, janela e login, troca de pessoa, 24 h, saída da conta, erro 5xx, e comando sem rede (falha na hora, sem fila, sem reenvio);
  - `offline.test.ts`: hora mais antiga, "dados de 14:05", recarga ao voltar, não recarrega com alguém digitando, saída da conta.
- **e2e** `tests/e2e/pwa/sem-internet.spec.ts`:
  - na demonstração, sem internet, a Hoje abre com o aviso, que sai quando a rede volta;
  - com uma API falsa (`context.route`):
    - leitura guardada abre sem rede, com o aviso "dados de HH:MM";
    - o negócio B recebe 503;
    - o comando falha com "nada foi salvo";
    - nada é reenviado.
  - O spec liga `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS` para o Playwright ver o que o service worker busca. O `playwright.config.ts` está fora da área.
