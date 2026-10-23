import { expect, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

// Correções do shell da auditoria docs/qa/acessibilidade.md (A11Y-01 a A11Y-04).

test("A11Y-03 · primeira tecla Tab mostra “Pular para o conteúdo” e Enter foca o main", async ({ page, isMobile }) => {
  test.skip(isMobile, "teclado físico: desktop");
  await page.goto("/app/agenda");
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
  // Próximo Tab já cai no conteúdo, não no menu.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
});

test("A11Y-02 · cada tela tem título próprio", async ({ page }) => {
  for (const [path, title] of [
    ["/app", "Hoje · Tinindo"],
    ["/app/agenda", "Agenda · Tinindo"],
    ["/app/clientes", "Clientes · Tinindo"],
    ["/app/conta", "Sua conta · Tinindo"],
    ["/nao-existe", "Página não encontrada · Tinindo"],
  ] as const) {
    await page.goto(path);
    await expect(page, path).toHaveTitle(title);
  }
});

test("A11Y-04 · trocar de tela leva o foco ao título; mudar só o dia da agenda não", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  // Carga inicial não rouba o foco.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  await openFromNav(page, "Agenda");
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeFocused();
  await expect(page).toHaveTitle("Agenda · Tinindo");

  const next = page.getByRole("button", { name: "Próximo dia" });
  await next.click();
  await expect(next).toBeFocused();
});

test("A11Y-01 · sem rolagem horizontal em 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/app/clientes/importar", "/app/conta", "/app/conta/novo-negocio", "/app/perfil"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320);
  }
});
