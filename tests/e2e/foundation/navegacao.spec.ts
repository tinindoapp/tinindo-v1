import { expect, test } from "@playwright/test";

// Auditoria de UX, Onda 1 (itens 2, 3, 4 e E2): faixa Demonstração em todas as rotas, barras sem esconder
// conteúdo, aba ativa visível e sub-abas de 44 px.

test("E2 · faixa Demonstração aparece em 1 linha em /entrar, /criar-conta e /app", async ({ page }) => {
  for (const path of ["/entrar", "/criar-conta", "/app"]) {
    await page.goto(path);
    const note = page.getByRole("note");
    await expect(note).toHaveCount(1);
    await expect(note).toContainText("Demonstração");
    await expect(note).toContainText("dados fictícios");
    // Uma linha só, sem cortar o essencial.
    const box = (await note.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(30);
    const main = note.locator(".tn-demo-banner__main");
    expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
});

test("4 · sub-abas têm pelo menos 44 px e a ativa fica à vista", async ({ page, isMobile }) => {
  test.skip(!isMobile, "sub-abas só aparecem no celular");
  await page.goto("/app/agenda");
  const tabs = page.getByRole("navigation", { name: "Telas de Agenda" }).getByRole("link");
  await expect(tabs.first()).toBeVisible();
  for (const box of await Promise.all((await tabs.all()).map((l) => l.boundingBox()))) expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("navigation", { name: "Telas de Agenda" }).getByRole("link", { name: "Espera" })).toBeVisible();

  // Última tela de Clientes: a faixa rola até ela e indica que há mais telas do outro lado.
  await page.goto("/app/avaliacoes");
  const clientes = page.getByRole("navigation", { name: "Telas de Clientes" });
  const active = clientes.locator('[aria-current="page"]');
  await expect(active).toHaveText("Avaliações");
  await expect(active).toBeInViewport({ ratio: 1 });
  await expect(clientes.locator("ul")).toHaveAttribute("data-more-start", "true");
});

test("3 · aba ativa tem aria-current, rótulo de 12 px em 600 e pílula com contraste", async ({ page, isMobile }) => {
  test.skip(!isMobile, "barra de abas só no celular");
  await page.goto("/app/caixa");
  const active = page.getByRole("navigation", { name: "Abas" }).getByRole("link", { name: "Dinheiro" });
  await expect(active).toHaveAttribute("aria-current", "page");
  const style = await active.locator("span").evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight) };
  });
  expect(style.size).toBeGreaterThanOrEqual(12);
  expect(style.weight).toBeGreaterThanOrEqual(600);
  // Pílula preenchida com a cor do texto (não o cinza claro de antes, 1,09:1).
  const [pill, text] = await active.evaluate((el) => [getComputedStyle(el.querySelector(".tn-icon")!).backgroundColor, getComputedStyle(el).color]);
  expect(pill).toBe(text);
});

test("2 · com o app rolado, a barra lateral começa abaixo da barra superior", async ({ page, isMobile }) => {
  test.skip(isMobile, "barra lateral só no desktop");
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/app/clientes");
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  const header = (await page.locator("header.tn-appbar").boundingBox())!;
  const note = (await page.getByRole("note").boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Principal" }).boundingBox())!;
  // Faixa e barra continuam presas no topo, uma abaixo da outra.
  expect(note.y).toBe(0);
  expect(header.y).toBeGreaterThanOrEqual(note.y + note.height - 1);
  expect(nav.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  // A barra lateral cabe na tela: o último item é alcançável rolando só ela.
  expect(nav.y + nav.height).toBeLessThanOrEqual(600 + 1);
  // Foco por teclado não para atrás das barras.
  const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
  expect(padding).toBeGreaterThanOrEqual(header.y + header.height);
});
