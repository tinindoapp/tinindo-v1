// A emulação segue as regras do banco (pgTAP 23, integração 40).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoCustomerPort, createDemoOwnerPort, createDemoPublicPort, resetDemoState } from "./demoPort.ts";

const k = () => crypto.randomUUID();
beforeEach(() => resetDemoState());

describe("demonstração de Avaliações", () => {
  it("cliente avalia uma vez; média aparece só com 3; dono responde sem mudar a nota; competência nunca certificada", async () => {
    const c = createDemoCustomerPort();
    const o = createDemoOwnerPort();
    const p = createDemoPublicPort();
    expect((await p.list("barbearia-exemplo-a")).summary.rating_average).toBeNull();
    const pend = await c.pending();
    await c.submit(pend.pending[0]!.booking_id, 3, "Ok", k());
    await expect(c.submit(pend.pending[0]!.booking_id, 5, null, k())).rejects.toMatchObject({ field: "already_reviewed" });
    const pub = await p.list("barbearia-exemplo-a");
    expect(pub.summary).toMatchObject({ reviews_count: 3, rating_average: 4, certified_competence: false });
    const l = await o.list();
    const mine = l.reviews.find((r) => r.body === "Ok")!;
    await o.reply(mine.id, mine.version, "Obrigado!", k());
    expect((await p.list("barbearia-exemplo-a")).reviews.find((r) => r.id === mine.id)).toMatchObject({ rating: 3, reply: { body: "Obrigado!" } });
    await o.report(mine.id, "offensive", k());
    expect((await p.list("barbearia-exemplo-a")).reviews.map((r) => r.id)).toContain(mine.id);
  });
});
