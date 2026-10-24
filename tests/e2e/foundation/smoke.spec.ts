import { expect, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

test("shell abre em demonstração, navega e não estoura a largura", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Demonstração");
  await expect(page.getByRole("img", { name: "Tinindo" })).toBeVisible();

  await openFromNav(page, "Agenda");
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeVisible();

  // Compara com a largura do viewport configurado: no modo mobile o Chrome alarga o
  // viewport de layout para caber conteúdo largo, então innerWidth sozinho não detecta.
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
});

test("rota inexistente mostra página amigável", async ({ page }) => {
  await page.goto("/nao-existe");
  await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
});

test("alvos de toque da navegação têm pelo menos 44px (abas, menu e barra lateral)", async ({ page }) => {
  await page.goto("/app");
  const principal = page.getByRole("navigation", { name: "Principal" });
  const mobile = !(await principal.isVisible());
  if (mobile) {
    const tabs = page.getByRole("navigation", { name: "Abas" }).getByRole("link");
    expect(await tabs.count()).toBe(5);
    for (const box of await Promise.all((await tabs.all()).map((l) => l.boundingBox()))) expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(principal).toBeVisible();
  }
  const links = principal.getByRole("link");
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThan(10);
  for (const box of await Promise.all((await links.all()).map((l) => l.boundingBox()))) expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("menu agrupa as telas e fecha ao navegar", async ({ page }) => {
  await page.goto("/app");
  await openFromNav(page, "Campanhas");
  await expect(page.getByRole("heading", { name: "Campanhas", level: 1 })).toBeVisible();
  const principal = page.getByRole("navigation", { name: "Principal" });
  if (!(await principal.isVisible())) {
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Telas de Crescer" }).getByRole("link", { name: "Campanhas" })).toHaveAttribute("aria-current", "page");
  }
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
