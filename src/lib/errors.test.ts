import { describe, expect, it } from "vitest";
import { ApiError } from "./api/client.ts";
import { errorExplainer, errorInfo, explainError, isRetryable, SAFE_RETRY, serverMessage } from "./errors.ts";

const api = (code: ConstructorParameters<typeof ApiError>[0], field?: string, retryable = false) =>
  new ApiError(code, "Mensagem do servidor.", 409, "rid", retryable, field);

describe("errorInfo", () => {
  it("lê código e campo de ApiError e de objeto solto; o resto vira vazio", () => {
    expect(errorInfo(api("POLICY_REJECTED", "stock"))).toEqual({ code: "POLICY_REJECTED", field: "stock" });
    expect(errorInfo({ code: "NOT_FOUND" })).toEqual({ code: "NOT_FOUND", field: undefined });
    expect(errorInfo(null)).toEqual({});
    expect(errorInfo("falhou")).toEqual({});
    expect(errorInfo({ code: 42, field: {} })).toEqual({ code: undefined, field: undefined });
  });
});

describe("explainError", () => {
  const explain = errorExplainer({
    "POLICY_REJECTED.stock": "Estoque insuficiente.",
    POLICY_REJECTED: "As regras não permitem.",
    VALIDATION_ERROR: (e) => `Confira o campo ${e.field ?? "?"}.`,
  });

  it("procura código.campo, depois código, depois a frase padrão", () => {
    expect(explain(api("POLICY_REJECTED", "stock"))).toBe("Estoque insuficiente.");
    expect(explain(api("POLICY_REJECTED", "outro"))).toBe("As regras não permitem.");
    expect(explain(api("POLICY_REJECTED"))).toBe("As regras não permitem.");
    expect(explain(api("VALIDATION_ERROR", "lines"))).toBe("Confira o campo lines.");
    expect(explain(api("NOT_FOUND"))).toBe(SAFE_RETRY);
    expect(explain(new Error("rede"))).toBe(SAFE_RETRY);
    expect(explain(undefined)).toBe(SAFE_RETRY);
  });

  it("default do módulo troca a frase padrão", () => {
    expect(explainError(api("NOT_FOUND"), { default: "Nada foi alterado." })).toBe("Nada foi alterado.");
    expect(explainError(null)).toBe(SAFE_RETRY);
  });

  it("nome de propriedade herdada não vira frase", () => {
    expect(explainError({ code: "toString" })).toBe(SAFE_RETRY);
    expect(explainError({ code: "constructor", field: "name" })).toBe(SAFE_RETRY);
  });
});

describe("serverMessage e isRetryable", () => {
  it("usa o texto do servidor só quando o erro veio da API", () => {
    expect(serverMessage(api("NOT_FOUND"))).toBe("Mensagem do servidor.");
    expect(serverMessage(new Error("x"))).toBe("Erro inesperado. Tente novamente.");
    expect(serverMessage(null, "Outra.")).toBe("Outra.");
  });
  it("só erro da API marcado como repetível é repetível", () => {
    expect(isRetryable(api("PROVIDER_UNAVAILABLE", undefined, true))).toBe(true);
    expect(isRetryable(api("POLICY_REJECTED"))).toBe(false);
    expect(isRetryable(new Error("x"))).toBe(false);
  });
});
