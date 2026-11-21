# src/lib/telemetry · captura de erro do frontend (P58)

O que é gravado em `public.ops_errors`, pela RPC `public.ops_error_record`, sem serviço externo:

- **Erro de tela** (`render`): só o nome do tipo do erro, por exemplo `TypeError`.
- **Chamada às funções** (`call`): resposta 5xx com o código do catálogo, ou que não chegou (`NETWORK`, status 0), com o `request_id`.
- **Erro solto na página** (`unhandled`): `error` e `unhandledrejection` da janela.

Todo registro leva a rota da tela **sem id** e o SHA do build. A rota passa por `cleanRoute`, a mesma regra de `app.ops_clean_route` no banco: uuid, número longo, `@` e trecho comprido viram `:id`, e a query sai.

Nunca saem a mensagem do erro, o corpo, o token, o negócio ou dado de cliente. O teto é de 20 registros por carregamento de página, sem repetir o mesmo erro em 60 s. O banco tem outro teto, de 500 por origem a cada 10 minutos.

Na demonstração, sem Supabase, `createAppTelemetry` não faz nada e o `fetch` passa direto.

## Ligação na raiz do app (integrador; `src/app` e `src/main.tsx` não são do P58)

```ts
// src/app/telemetry.ts (novo)
import { createAppTelemetry } from "../lib/telemetry/index.ts";
import { appEnv } from "./env.ts";

export const telemetry = createAppTelemetry({ supabase: appEnv.supabase, sha: __TININDO_BUILD__.commit });
```

```tsx
// src/main.tsx: antes do createRoot(...)
import { telemetry } from "./app/telemetry.ts";
telemetry.install(window);
```

```ts
// src/app/session.tsx, linha do createSessionClient, e src/app/api.tsx, publicCall(): acrescentar o fetch
createSessionClient({ baseUrl: …, publishableKey: …, getAccessToken, fetch: telemetry.wrapFetch((i, n) => fetch(i, n)) })
createApiClient({ baseUrl: …, publishableKey: …, getAccessToken: async () => null, fetch: telemetry.wrapFetch((i, n) => fetch(i, n)) })
```

```tsx
// src/app/pages/Fallbacks.tsx (RouteError) e src/app/ModuleError.tsx (ModuleError): logo depois do useRouteError()
import { useEffect } from "react";
import { telemetry } from "../telemetry.ts"; // em ModuleError.tsx: "./telemetry.ts"

useEffect(() => {
  // 404 de rota não é erro de tela.
  if (!(isRouteErrorResponse(error) && error.status === 404)) telemetry.captureRender(error);
}, [error]);
```

Para conferir, abra a homologação, force um erro (por exemplo, `/app/clientes/<id que não existe>` com a função fora do ar) e veja a linha em **Saúde da operação** › "Erros na última hora". Nada mais muda na tela.

O gateway de teste da jornada com servidor (`tests/e2e/servidor/gateway.ts`) só atende três leituras de `/rest/v1`. Com a captura ligada, um erro na jornada tentaria `rpc/ops_error_record` e receberia 404. A jornada não deve ter erro, então isso não muda o resultado dela; se mudar, acrescente a rota ao gateway.
