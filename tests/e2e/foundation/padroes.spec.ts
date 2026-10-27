import { expect, type Page, test } from "@playwright/test";

// Padrões do sistema (auditoria de UX, onda 2) em todas as telas do menu e nas páginas públicas,
// no celular de 375 px e no desktop, nos temas claro e escuro.

const PUBLIC = ["/entrar", "/criar-conta", "/diretorio"];

async function appRoutes(page: Page): Promise<string[]> {
  await page.goto("/app");
  const hrefs = await page.locator("#tn-menu a[href^='/app']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  return [...new Set(["/app", ...hrefs])];
}

/** Problemas de padrão visíveis na tela atual (vazio = ok). */
async function audit(page: Page, width: number): Promise<string[]> {
  return page.evaluate((w) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push(`rolagem horizontal: ${document.documentElement.scrollWidth}px`);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    for (const el of Array.from(document.querySelectorAll("main *, .tn-net-public *, .tn-auth *"))) {
      if (!visible(el)) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (!own || el.closest(".tn-visually-hidden")) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) out.push(`fonte de ${size}px: "${el.textContent!.trim().slice(0, 30)}"`);
    }
    for (const b of Array.from(document.querySelectorAll("main button, main a.tn-button"))) {
      if (!visible(b)) continue;
      const name = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
      if (!name) out.push(`botão sem nome: ${b.outerHTML.slice(0, 80)}`);
    }
    for (const b of Array.from(document.querySelectorAll(".tn-icon-button"))) {
      if (!visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) out.push(`botão de ícone pequeno (${r.width}×${r.height}): ${b.getAttribute("aria-label")}`);
    }
    return out;
  }, width);
}

for (const scheme of ["light", "dark"] as const) {
  test(`padrões em todas as telas · 375 px · tema ${scheme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const routes = await appRoutes(page);
    expect(routes.length).toBeGreaterThan(15);
    const problems: string[] = [];
    for (const path of [...routes, ...PUBLIC]) {
      await page.goto(path);
      await expect(page.locator("h1").first(), path).toBeVisible();
      await expect(page.locator("main h1, body > div h1").first()).not.toHaveText("Carregando…");
      for (const p of await audit(page, 375)) problems.push(`${path} · ${p}`);
    }
    expect(problems).toEqual([]);
  });
}

test("desktop: as mesmas telas sem rolagem horizontal e sem fonte menor que 12 px", async ({ page, isMobile }) => {
  test.skip(isMobile, "largura de desktop");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const routes = await appRoutes(page);
  const problems: string[] = [];
  for (const path of [...routes, ...PUBLIC]) {
    await page.goto(path);
    await expect(page.locator("h1").first(), path).toBeVisible();
    for (const p of await audit(page, 1280)) problems.push(`${path} · ${p}`);
  }
  expect(problems).toEqual([]);
});
