// Rotas carregadas sob demanda (P53, R8 do doc 15). O `module.tsx` de cada módulo fica só com o manifesto (id, caminho,
// rótulo, nível) e aponta cada rota para o arquivo da tela; o código da tela vai num pedaço próprio do build e só é
// baixado quando a rota abre. A forma `{ index | path, lazy }` é a que tests/e2e/foundation/rotas.ts sabe ler.
import type { ComponentType } from "react";
import type { LazyRouteFunction, RouteObject } from "react-router";

/** `lazy` de uma rota: carrega o arquivo e usa o componente escolhido como tela da rota. */
export function screen<M>(load: () => Promise<M>, pick: (m: M) => ComponentType): LazyRouteFunction<RouteObject> {
  return async () => ({ Component: pick(await load()) });
}
