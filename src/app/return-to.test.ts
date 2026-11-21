import { describe, expect, it } from "vitest";
import { authLinkError, safeReturnPath, signInHref } from "./return-to.ts";

describe("volta ao destino depois de entrar", () => {
  it("aceita caminhos internos do app, com busca e fragmento", () => {
    expect(safeReturnPath("/app/agenda/atendimento/abc?x=1")).toBe("/app/agenda/atendimento/abc?x=1");
    expect(safeReturnPath("/app/caixa?atendimento=1#recebi")).toBe("/app/caixa?atendimento=1#recebi");
    expect(safeReturnPath("/app")).toBe("/app");
  });

  it("recusa outro domínio, esquema, barra dupla, contrabarra e telas fora da lista", () => {
    for (const bad of ["https://mal.example/app", "//mal.example/app", "/\\mal.example", "javascript:alert(1)", "app/agenda", "/entrar", "/criar-conta", "", null, undefined, `/app/${"x".repeat(2100)}`]) {
      expect(safeReturnPath(bad), String(bad)).toBeNull();
    }
    expect(safeReturnPath("/app/../../mal")).toBeNull();
  });

  it("monta o endereço de entrar com o destino e o motivo", () => {
    expect(signInHref("/app/clientes/42", "sessao")).toBe("/entrar?volta=%2Fapp%2Fclientes%2F42&motivo=sessao");
    expect(signInHref("/app")).toBe("/entrar");
    expect(signInHref("https://mal.example", "saiu")).toBe("/entrar?motivo=saiu");
  });

  it("lê o erro de link vencido que o Supabase põe no fragmento", () => {
    expect(authLinkError("#error=access_denied&error_code=otp_expired&error_description=x")).toBe("expired");
    expect(authLinkError("#error=access_denied&error_code=bad_jwt")).toBe("invalid");
    expect(authLinkError("#conteudo")).toBeNull();
    expect(authLinkError("")).toBeNull();
  });
});
