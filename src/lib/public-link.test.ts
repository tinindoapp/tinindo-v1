import { afterEach, describe, expect, it } from "vitest";
import { forgetLinkToken, readLinkToken, takeLinkToken } from "./public-link.ts";

const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "Zz"; // 43 caracteres
const KEY = "tinindo.teste";

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("readLinkToken", () => {
  it("aceita só o token de 43 caracteres em #t=", () => {
    expect(TOKEN).toHaveLength(43);
    expect(readLinkToken(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(readLinkToken(`#x=1&t=${TOKEN}&y=2`)).toBe(TOKEN);
    expect(readLinkToken(`#t=${TOKEN}a`)).toBeNull();
    expect(readLinkToken(`#t=${TOKEN.slice(1)}`)).toBeNull();
    expect(readLinkToken(`#at=${TOKEN}`)).toBeNull();
    expect(readLinkToken("")).toBeNull();
  });
});

describe("takeLinkToken", () => {
  it("tira o token da URL, guarda na sessão da aba e devolve", () => {
    window.history.replaceState(null, "", `/oferta#t=${TOKEN}`);
    expect(takeLinkToken(KEY)).toBe(TOKEN);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/oferta");
    expect(sessionStorage.getItem(KEY)).toBe(TOKEN);
  });

  it("página recarregada (sem token na URL) usa o guardado; sem nada, null", () => {
    expect(takeLinkToken(KEY)).toBeNull();
    sessionStorage.setItem(KEY, TOKEN);
    expect(takeLinkToken(KEY)).toBe(TOKEN);
    expect(takeLinkToken("tinindo.outra")).toBeNull();
  });
});

describe("forgetLinkToken", () => {
  it("apaga só o token da chave pedida", () => {
    sessionStorage.setItem(KEY, TOKEN);
    sessionStorage.setItem("tinindo.outra", TOKEN);
    forgetLinkToken(KEY);
    expect(takeLinkToken(KEY)).toBeNull();
    expect(takeLinkToken("tinindo.outra")).toBe(TOKEN);
  });
});
