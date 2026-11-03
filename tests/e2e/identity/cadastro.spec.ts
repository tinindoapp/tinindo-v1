import { expect, type Page, test } from "@playwright/test";

// Onda 3 da auditoria de UX (E7, E8, E9, E13): cadastro, entrada, criação do negócio e "Sua conta" em demonstração.

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

for (const scheme of ["light", "dark"] as const) {
  test(`criar conta: para quem é, regra da senha e Mostrar senha de 44 px (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/criar-conta");
    await expect(page.getByText(/Para quem atende com hora marcada/)).toBeVisible();
    await expect(page.getByText("Pelo menos 10 caracteres, com letras e números.")).toBeVisible();
    const password = page.getByLabel("Senha", { exact: true });
    const toggle = page.getByRole("button", { name: "Mostrar senha" });
    const box = await toggle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(password).toHaveAttribute("type", "password");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByLabel("Repita a senha")).toHaveAttribute("type", "text");
    await noHorizontalScroll(page);
  });
}

// /entrar redireciona para /app na demonstração offline: o "Mostrar senha" do login tem teste unitário (SignIn.test.tsx).

for (const scheme of ["light", "dark"] as const) {
  test(`criar negócio: termos numa folha, frase de saúde à parte e fuso recolhido (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/app/conta/novo-negocio");
    await expect(page.getByRole("heading", { name: "Criar meu negócio", level: 1 })).toBeVisible();

    // Fuso: uma linha com o detectado; a troca fica recolhida.
    await expect(page.getByText(/^Fuso horário:/)).toBeVisible();
    await expect(page.getByLabel("Fuso horário")).toBeHidden();
    await page.getByText("Trocar o fuso").click();
    await expect(page.getByLabel("Fuso horário")).toBeVisible();

    await expect(page.getByRole("checkbox", { name: /Li e aceito/ })).not.toHaveAccessibleName(/saúde/);
    await expect(page.getByText(/Não cadastre dados de saúde de ninguém/)).toBeVisible();

    const terms = page.getByRole("button", { name: "Termos de uso" });
    const tbox = await terms.boundingBox();
    expect(tbox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await terms.click();
    const sheet = page.getByRole("dialog", { name: "Termos de uso" });
    await expect(sheet).toBeVisible();
    // O rascunho de docs/legal é "NÃO PUBLICAR": a folha só diz que o texto está em revisão.
    await expect(sheet.getByText(/Texto em revisão/)).toBeVisible();
    await expect(sheet.getByText(/RASCUNHO|NÃO PUBLICAR/)).toHaveCount(0);
    // A folha cabe na tela e só o texto rola.
    const vbox = await sheet.boundingBox();
    const viewport = page.viewportSize()!;
    expect((vbox?.x ?? -1) >= 0 && (vbox?.width ?? 0) <= viewport.width).toBe(true);
    await noHorizontalScroll(page);
    await sheet.getByRole("button", { name: "Fechar" }).click();
    await expect(sheet).toBeHidden();
    await expect(terms).toBeFocused();

    await page.getByRole("button", { name: "Política de privacidade" }).click();
    const privacy = page.getByRole("dialog", { name: "Política de privacidade" });
    await expect(privacy.getByText(/Política de privacidade está em revisão/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(privacy).toBeHidden();
  });
}

test.describe("fuso do aparelho", () => {
  test.use({ timezoneId: "America/Manaus" });
  test("criar negócio usa o fuso do aparelho quando é do Brasil", async ({ page }) => {
    await page.goto("/app/conta/novo-negocio");
    await expect(page.getByText(/^Fuso horário:/)).toContainText("Amazonas (Manaus) · o mesmo do seu aparelho");
  });
});

test("sua conta: primeiros passos no topo, sem texto técnico, e criar outro negócio sem destaque", async ({ page }) => {
  await page.goto("/app/conta");
  const steps = page.getByRole("region", { name: /Primeiros passos/ });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole("link", { name: "Publicar seu perfil e mandar o link" })).toBeVisible();
  await expect(page.getByText(/O servidor confere/)).toHaveCount(0);
  const other = page.getByRole("link", { name: "Criar outro negócio" });
  await expect(other).not.toHaveClass(/tn-button/);
  // Fica depois de Segurança, no fim da tela.
  const security = page.getByRole("heading", { name: "Segurança" });
  const [sy, oy] = await Promise.all([security.boundingBox(), other.boundingBox()]);
  expect((oy?.y ?? 0) > (sy?.y ?? 0)).toBe(true);
  const [stepsBox, objective] = await Promise.all([
    steps.boundingBox(),
    page.getByRole("heading", { name: "Objetivo e política de cancelamento" }).boundingBox(),
  ]);
  expect((stepsBox?.y ?? 0) < (objective?.y ?? 0)).toBe(true);
  await noHorizontalScroll(page);
});
