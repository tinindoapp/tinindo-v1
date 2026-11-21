import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router";
import { publicRoutes } from "./public-app.tsx";
import { isPublicPath } from "./public-paths.ts";

const paths = (routes: RouteObject[]): string[] =>
  routes.flatMap((r) => [...(r.path ? [r.path] : []), ...(r.children ? paths(r.children) : [])]);

describe("pacote público (P55, recado #119)", () => {
  const own = paths(publicRoutes).filter((p) => p !== "*");

  it("todo caminho do pacote público é escolhido pelo main.tsx", () => {
    for (const p of own) expect(isPublicPath(p.replace(/:[a-z]+/g, "exemplo")), p).toBe(true);
  });

  it("o que exige login ou é do dono fica no app completo", () => {
    for (const p of ["/", "/app", "/app/agenda", "/entrar", "/avaliar", "/avaliar/x", "/convite", "/indicar", "/oferta", "/pagamentos", "/reservas", "/p"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("cobre as páginas do cliente final", () => {
    expect(own).toEqual(expect.arrayContaining(["/p/:slug", "/reserva", "/reserva/:slug", "/s/:slug", "/pagar", "/pagar/:slug", "/orcamento", "/orcamento/:slug", "/avaliacoes/:slug"]));
  });
});
