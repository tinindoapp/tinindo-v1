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

test("horários: cartão por dia, copiar a segunda, Salvar só com mudança e aviso ao sair", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app/agenda/horarios");
  const monday = page.getByRole("group", { name: "Segunda" });
  await expect(monday).toContainText("09:00–12:00 e 13:00–19:00");
  const bar = page.getByRole("region", { name: "Alterações no expediente" });
  await expect(bar).toHaveCount(0);
  // Página curta: os sete dias como resumo, sem os campos abertos.
  await expect(page.getByRole("form", { name: "Expediente semanal" }).getByLabel("Início").filter({ visible: true })).toHaveCount(0);

  await monday.getByRole("button", { name: "Editar Segunda" }).click();
  await monday.getByLabel("Fim").nth(1).fill("17:00");
  await page.getByRole("button", { name: "Usar o horário de segunda nos dias úteis" }).click();
  await expect(bar).toContainText("copiado para terça a sexta");
  await expect(page.getByRole("group", { name: "Sexta" })).toContainText("09:00–12:00 e 13:00–17:00");
  await expect(page.getByRole("group", { name: "Sábado" })).toContainText("09:00–14:00");

  // A barra presa ao pé fica acima da barra de abas do celular, sem cobri-la.
  const tabbar = page.getByRole("navigation", { name: "Abas" });
  if (await tabbar.isVisible()) {
    const b = (await bar.boundingBox())!;
    const t = (await tabbar.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(t.y);
  }
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  // Sair pelo menu com mudança não salva: pergunta antes; "Continuar editando" fica na tela.
  await openFromNav(page, "Agenda");
  await expect(bar).toContainText("Sair sem salvar?");
  await expect(bar.getByText("Sair sem salvar?").locator("..")).toBeFocused();
  await bar.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page).toHaveURL(/\/app\/agenda\/horarios$/);
  // A folha do menu (celular) fecha e o foco volta ao "Salvar".
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(bar.getByRole("button", { name: "Salvar expediente" })).toBeFocused();

  await bar.getByRole("button", { name: "Salvar expediente" }).click();
  await expect(page.locator(".tn-toast")).toContainText("Expediente salvo.");
  await expect(bar).toHaveCount(0);
  // Salvo, sair não pergunta nada.
  await openFromNav(page, "Agenda");
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeVisible();
});
