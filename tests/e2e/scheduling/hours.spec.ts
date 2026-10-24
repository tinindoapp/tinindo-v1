import { expect, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

test("horários: bloqueio criado aparece na lista e some dos horários livres", async ({ page }) => {
  await page.goto("/app/agenda");
  await openFromNav(page, "Horários");
  await expect(page.getByRole("heading", { name: "Horários de atendimento" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Segunda" })).toBeVisible();

  await page.getByLabel("Dia").fill("2026-10-21");
  await page.getByLabel("Das").fill("17:00");
  await page.getByLabel("Até").fill("18:00");
  await page.getByLabel("Motivo").fill("Banco");
  await page.getByRole("button", { name: "Bloquear" }).click();
  await expect(page.getByText("Bloqueio criado")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Banco" })).toBeVisible();

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  // Navegação dentro do app: a emulação guarda o estado só enquanto a página não recarrega.
  await openFromNav(page, "Agenda");
  await page.getByRole("link", { name: "Novo agendamento" }).click();
  await page.getByRole("button", { name: "Próximo dia" }).click();
  const slots = page.getByRole("group", { name: "Horários livres" });
  await expect(slots.getByRole("button", { name: "16:00" })).toBeVisible();
  await expect(slots.getByRole("button", { name: "17:00" })).toHaveCount(0);
  await expect(slots.getByRole("button", { name: "18:00" })).toBeVisible();
});
