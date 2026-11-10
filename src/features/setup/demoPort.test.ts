import { beforeEach, describe, expect, it } from "vitest";
import { SetupProgress, SetupServicesApplyOutput, SetupTemplatesOutput } from "@contracts";
import { resetDemoJourney, setPublishedSlug } from "../../lib/demo/journey.ts";
import { createDemoPort, demoSetupEvents, resetDemoState } from "./demoPort.ts";
import { newKey } from "./port.ts";

beforeEach(() => {
  resetDemoState();
  resetDemoJourney();
});

describe("emulação da Configuração (mesmas regras do banco)", () => {
  it("estado calculado pelos fatos da aba: o perfil só fica feito quando publicado; obrigatórios primeiro no próximo", async () => {
    const port = createDemoPort();
    const p = SetupProgress.parse(await port.progress());
    expect(p.done_count).toBe(5);
    expect(p.next).toBe("profile");
    expect(p.ready).toBe(false);
    expect(p.steps.find((s) => s.step === "profile")).toMatchObject({ done: false, why: expect.stringContaining("link") });
    setPublishedSlug("barbearia-exemplo-a");
    const after = await port.progress();
    expect(after.steps.find((s) => s.step === "profile")!.done).toBe(true);
    expect(after.ready).toBe(true);
    expect(after.next).toBe("photo_whatsapp");
    expect(after.done_count).toBe(6);
  });

  it("evento setup.step_completed.v1 sai uma vez por passo, com o tempo desde o cadastro", async () => {
    const port = createDemoPort();
    await port.progress();
    await port.progress();
    const events = demoSetupEvents();
    expect(events.map((e) => e.step).sort()).toEqual(["cancellation_policy", "first_cash", "first_customer", "hours", "service"]);
    expect(events.every((e) => e.seconds_since_signup >= 0)).toBe(true);
    setPublishedSlug("x");
    await port.progress();
    await port.progress();
    expect(demoSetupEvents().filter((e) => e.step === "profile")).toHaveLength(1);
  });

  it("dispensar: só opcional, idempotente pela chave, e desfazer volta a mostrar", async () => {
    const port = createDemoPort();
    await expect(port.dismiss("hours", true, newKey())).rejects.toMatchObject({ code: "VALIDATION_ERROR", field: "step" });
    const key = newKey();
    const p1 = await port.dismiss("channel", true, key);
    expect(p1.steps.find((s) => s.step === "channel")!.dismissed).toBe(true);
    expect(p1.resolved_count).toBe(6);
    expect(p1.next).toBe("profile");
    expect(await port.dismiss("channel", true, key)).toEqual(p1);
    const p2 = await port.dismiss("channel", false, newKey());
    expect(p2.steps.find((s) => s.step === "channel")!.dismissed).toBe(false);
  });

  it("modelos da profissão marcam os que já existem; criar é tudo ou nada e idempotente", async () => {
    const port = createDemoPort();
    const t = SetupTemplatesOutput.parse(await port.templates());
    expect(t.profession).toBe("barber");
    expect(t.templates.map((x) => [x.code, x.exists])).toEqual([["barber_corte", true], ["barber_barba", true], ["barber_corte_barba", false]]);
    // Nome repetido no meio: nada é criado.
    await expect(port.applyServices([{ template_code: "barber_corte_barba", name: "Corte e barba", duration_min: 50, base_price_cents: 7000 }, { template_code: null, name: "corte", duration_min: 30, base_price_cents: 1 }], newKey()))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", field: "name" });
    expect((await port.templates()).templates[2]!.exists).toBe(false);
    const key = newKey();
    const out = SetupServicesApplyOutput.parse(await port.applyServices([{ template_code: "barber_corte_barba", name: "Corte e barba", duration_min: 50, base_price_cents: 7000 }], key));
    expect(out.created).toHaveLength(1);
    expect(await port.applyServices([{ template_code: "barber_corte_barba", name: "Corte e barba", duration_min: 50, base_price_cents: 7000 }], key)).toEqual(out);
    expect((await port.templates()).templates[2]!.exists).toBe(true);
    await expect(port.applyServices([], newKey())).rejects.toMatchObject({ code: "VALIDATION_ERROR", field: "services" });
  });

  it("rascunho: profissão, expediente e serviços; horário invertido ou nada a aplicar é recusado", async () => {
    const port = createDemoPort();
    await expect(port.applyDraft({}, newKey())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(port.applyDraft({ hours: [{ weekday: 2, local_start: "19:00", local_end: "09:00" }] }, newKey())).rejects.toMatchObject({ code: "VALIDATION_ERROR", field: "hours" });
    const out = await port.applyDraft({ profession: "hairdresser", hours: [{ weekday: 2, local_start: "09:00", local_end: "19:00" }], services: [{ name: "Escova", duration_min: 40, base_price_cents: 6000 }] }, newKey());
    expect(out.profession).toBe("hairdresser");
    expect(out.hours).toHaveLength(1);
    expect(out.created.map((c) => c.name)).toEqual(["Escova"]);
    expect((await port.templates()).profession).toBe("hairdresser");
    expect((await port.templates()).templates.find((t) => t.code === "hair_escova")!.exists).toBe(true);
  });
});
