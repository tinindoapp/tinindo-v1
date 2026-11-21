import { describe, expect, it, vi } from "vitest";
import { services as fixtureServices } from "@contracts/fixtures.ts";
import { createServerPort } from "./serverPort.ts";

describe("pricing · porta do servidor · catálogo", () => {
  it("lê todas as páginas de serviços seguindo next_cursor (recado #169, item 4)", async () => {
    const [a, b] = fixtureServices;
    const call = vi.fn(async (path: string) => ({
      data: path.includes("cursor=") ? { items: [b], next_cursor: null } : { items: [a], next_cursor: "pagina-2" },
    }));
    const port = createServerPort(call as never, "10000000-0000-4000-8000-00000000000a");
    expect((await port.services()).map((s) => s.id)).toEqual([a!.id, b!.id]);
    expect(call.mock.calls.map((c) => c[0])).toEqual(["/crm/services?limit=100", "/crm/services?limit=100&cursor=pagina-2"]);
  });
});
