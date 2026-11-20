import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupProgress, SetupServicesApplyOutput, SetupTemplatesOutput } from "@contracts";
import { demoSetupDismiss, demoSetupProgress, readDemoSetup } from "../../lib/demo/setup.ts";
import { resetDemoJourney, setPublishedSlug } from "../../lib/demo/journey.ts";
import { SETUP_STEPS } from "../../lib/setup/steps.ts";
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

  it("P50 · rascunho é tudo ou nada: serviço repetido não troca a profissão nem o expediente; blocos sobrepostos são recusados", async () => {
    const port = createDemoPort();
    await expect(port.applyDraft({ profession: "hairdresser", hours: [{ weekday: 2, local_start: "09:00", local_end: "19:00" }], services: [{ name: "Corte", duration_min: 45, base_price_cents: 8000 }] }, newKey()))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", field: "name" });
    expect((await port.templates()).profession).toBe("barber");
    await expect(port.applyDraft({ hours: [{ weekday: 2, local_start: "09:00", local_end: "13:00" }, { weekday: 2, local_start: "12:00", local_end: "18:00" }] }, newKey()))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", field: "hours" });
    // Dois turnos no mesmo dia são aceitos.
    const out = await port.applyDraft({ hours: [{ weekday: 2, local_start: "17:00", local_end: "21:00" }, { weekday: 2, local_start: "06:00", local_end: "12:00" }] }, newKey());
    expect(out.hours).toEqual([{ weekday: 2, local_start: "06:00", local_end: "12:00" }, { weekday: 2, local_start: "17:00", local_end: "21:00" }]);
  });

  it("P50 · o que o dono confirma é publicado para a Agenda, os Serviços e o perfil da aba; `reach` diz se há leitor ligado", async () => {
    const port = createDemoPort();
    expect(port.reach).toEqual({ hours: false, services: false });
    const hours = vi.fn();
    const services = vi.fn();
    const profession = vi.fn();
    const off = [readDemoSetup("hours", hours), readDemoSetup("services", services), readDemoSetup("profession", profession)];
    try {
      expect(port.reach).toEqual({ hours: true, services: true });
      const key = newKey();
      const input = { profession: "hairdresser" as const, hours: [{ weekday: 2, local_start: "09:00", local_end: "19:00" }], services: [{ name: "Escova", duration_min: 40, base_price_cents: 6000 }] };
      const out = await port.applyDraft(input, key);
      expect(hours).toHaveBeenCalledWith([{ weekday: 2, local_start: "09:00", local_end: "19:00" }]);
      expect(services).toHaveBeenCalledWith(out.created);
      expect(profession).toHaveBeenCalledWith("hairdresser");
      // Repetir com a mesma chave não publica de novo.
      await port.applyDraft(input, key);
      expect(hours).toHaveBeenCalledTimes(1);
      await port.applyServices([{ template_code: "hair_corte", name: "Corte feminino", duration_min: 45, base_price_cents: 9000 }], newKey());
      expect(services).toHaveBeenCalledTimes(2);
      // Recusado não publica nada.
      await expect(port.applyServices([{ template_code: null, name: "Escova", duration_min: 40, base_price_cents: 1 }], newKey())).rejects.toMatchObject({ field: "name" });
      expect(services).toHaveBeenCalledTimes(2);
    } finally {
      off.forEach((fn) => fn());
    }
    expect(port.reach).toEqual({ hours: false, services: false });
  });

  it("P50 · um estado só: o passo dispensado fora desta porta (guia do Assistente) aparece aqui, e o progresso é o mesmo", async () => {
    const port = createDemoPort();
    expect(demoSetupDismiss(SETUP_STEPS, "channel", true)).toBe(true);
    expect(demoSetupDismiss(SETUP_STEPS, "hours", true)).toBe(false);
    const p = await port.progress();
    expect(p.steps.find((s) => s.step === "channel")!.dismissed).toBe(true);
    const shared = demoSetupProgress(SETUP_STEPS, { profilePublished: false });
    expect({ done: p.done_count, resolved: p.resolved_count, next: p.next, steps: p.steps.map((s) => [s.step, s.done, s.dismissed]) })
      .toEqual({ done: shared.done_count, resolved: shared.resolved_count, next: shared.next, steps: shared.steps.map((s) => [s.step, s.done, s.dismissed]) });
  });

  it("P50 · a frase na demonstração usa as mesmas regras do servidor, sem assistente", async () => {
    const d = await createDemoPort().describe("Sou personal trainer, de segunda a sexta das 6 às 12 e das 17 às 21", newKey());
    expect(d.assistant).toBe(false);
    expect(d.windows).toHaveLength(10);
    expect(d.sources).toMatchObject({ profession: "rules", hours: "rules" });
  });
});
