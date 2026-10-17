import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";

describe("parseEnv", () => {
  it("sem variáveis: ambiente local de demonstração, sem servidor", () => {
    expect(parseEnv({})).toEqual({ name: "local", demo: true, supabase: null });
  });

  it("homologação continua com banner de demonstração", () => {
    const env = parseEnv({
      VITE_APP_ENV: "staging",
      VITE_SUPABASE_URL: "https://exemplo.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    });
    expect(env.demo).toBe(true);
    expect(env.supabase?.url).toBe("https://exemplo.supabase.co");
  });

  it("recusa chave secreta no bundle", () => {
    expect(() =>
      parseEnv({ VITE_SUPABASE_URL: "https://exemplo.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: ["sb", "secret", "abc"].join("_") }),
    ).toThrow(/chave secreta/);
  });

  it("produção sem Supabase não sobe", () => {
    expect(() => parseEnv({ VITE_APP_ENV: "production" })).toThrow(/Produção exige/);
  });

  it("produção não mostra banner de demonstração", () => {
    const env = parseEnv({
      VITE_APP_ENV: "production",
      VITE_SUPABASE_URL: "https://exemplo.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    });
    expect(env.demo).toBe(false);
  });
});
