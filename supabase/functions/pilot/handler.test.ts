import { describe, expect, it, vi } from "vitest";
import { createPilotHandler, type PilotDeps } from "./handler.ts";

const setup = (rpc: PilotDeps["rpc"]) => createPilotHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/pilot/${op}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("Edge Function pilot", () => {
  it("funil: sem negócio selecionado; o banco decide se é operador", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } }));
    const res = await setup(rpc)(post("pilot.funnel", {}, { Authorization: "Bearer jwt" }));
    expect(res.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith("jwt", "pilot_funnel", {});
  });
  it("resposta fora do contrato (passo a mais) vira 500, nunca chega à tela", async () => {
    const rpc = vi.fn(async () => ({ data: { businesses: [{ tenant_id: "10000000-0000-4000-8000-00000000000a", name: "A", profession: "barber",
      signup_at: "2026-11-20T12:00:00Z", timezone: "America/Sao_Paulo", steps: [], done: 0, total: 7 }], truncated: { businesses: false } }, error: null }));
    const res = await setup(rpc)(post("pilot.funnel", {}, { Authorization: "Bearer jwt" }));
    expect(res.status).toBe(500);
  });
});
