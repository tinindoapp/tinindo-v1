import { describe, expect, it } from "vitest";
import { activeInfo, messagingChoice, paymentChoice, withProvider } from "./selection.ts";

const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe("escolha do provedor por segredo", () => {
  it("sem segredo, ou vazio: simulado, sem problema", () => {
    for (const e of [env({}), env({ MESSAGING_PROVIDER: "  " }), env({ MESSAGING_PROVIDER: "Simulado" })]) {
      expect(messagingChoice(e)).toEqual({ active: "simulated", real: false, missing: [], problems: [] });
    }
    expect(paymentChoice(env({}))).toMatchObject({ active: "simulated", real: false, missing: [] });
  });

  it("valor desconhecido: simulado, com o motivo e sem eco do segredo", () => {
    const c = messagingChoice(env({ MESSAGING_PROVIDER: "twilio" }));
    expect(c.active).toBe("simulated");
    expect(c.problems).toEqual(["MESSAGING_PROVIDER desconhecido; usando simulado"]);
  });

  it("meta e asaas mapeiam para os nomes internos; sem as chaves, ficam escolhidos e não configurados (não caem no simulado)", () => {
    const m = messagingChoice(env({ MESSAGING_PROVIDER: "META", WHATSAPP_ACCESS_TOKEN: "x" }));
    expect(m).toMatchObject({ active: "whatsapp_cloud", real: true, missing: ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"] });
    expect(m.problems.join(" ")).not.toContain("x ");
    expect(activeInfo(m)).toEqual({ active: "whatsapp_cloud", real: true, configured: false });
    const p = paymentChoice(env({ PSP_PROVIDER: "asaas", ASAAS_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: "t" }));
    expect(activeInfo(p)).toEqual({ active: "asaas", real: true, configured: true });
  });

  it("withProvider troca o provedor do corpo e mantém o resto", async () => {
    const req = new Request("http://x/a", { method: "POST", body: JSON.stringify({ provider: "psp", receivable_id: "r" }), headers: { "X-A": "1" } });
    const out = await withProvider(req, "simulated");
    expect(await out.json()).toEqual({ provider: "simulated", receivable_id: "r" });
    expect(out.headers.get("X-A")).toBe("1");
  });
});
