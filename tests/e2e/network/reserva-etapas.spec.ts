import { expect, type Page, test } from "@playwright/test";

// Onda 2 da auditoria de UX (E4 e E5): reserva pelo link em etapas "Serviço · Dia e hora · Seus dados · Código",
// dia visível antes da hora, resumo da escolha, voltar sem perder nada; perfil só com selos positivos.
async function publishAndOpen(page: Page, slug: string) {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill(slug);
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${slug}$`));
}

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

for (const scheme of ["light", "dark"] as const) {
  test(`reserva em etapas com dia antes da hora e voltar sem perder a escolha (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await publishAndOpen(page, `barbearia-etapas-${scheme}`);

    // E5: sem selo negativo e sem promessa da Tinindo.
    const badges = page.getByRole("list", { name: "Reputação" });
    await expect(badges).not.toContainText("não verificada");
    await expect(page.locator("body")).not.toContainText("Tinindo garante");

    const steps = page.getByRole("navigation", { name: "Etapas da reserva" });
    await expect(steps).toContainText("Passo 1 de 4");
    await expect(steps.locator('[aria-current="step"]')).toHaveText(/Serviço/);
    const barba = page.getByRole("radio", { name: /^Barba/ });
    await barba.check();
    await page.getByRole("button", { name: "Escolher dia e hora" }).click();

    await expect(steps).toContainText("Passo 2 de 4");
    await expect(steps.locator('[aria-current="step"]')).toHaveText(/Dia e hora/);
    const days = page.getByRole("group", { name: "Dia" });
    await expect(days.getByRole("radio")).toHaveCount(14);
    await expect(days.getByRole("radio", { name: "ter 20/10" })).toBeChecked();
    // Dias numa fileira rolável: a página não rola para o lado.
    await noHorizontalScroll(page);
    const other = days.getByRole("radio", { name: "qui 22/10" });
    await other.check();
    const chip = other.locator("xpath=..");
    const box = await chip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    // Selecionado com os tokens do sistema: preenchimento e peso, não só cor.
    const selected = await chip.evaluate((el) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement("div");
      probe.style.background = "var(--tn-selected-bg)";
      document.body.append(probe);
      const bg = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { bg: cs.backgroundColor, expected: bg, weight: Number(cs.fontWeight) };
    });
    expect(selected.bg).toBe(selected.expected);
    expect(selected.weight).toBeGreaterThanOrEqual(600);

    const slot = page.getByRole("list", { name: "Horários livres" }).getByRole("button").first();
    const time = (await slot.innerText()).trim();
    expect((await slot.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await slot.click();

    await expect(steps).toContainText("Passo 3 de 4");
    await expect(page.getByText(`Barba · qui 22/10 · ${time}`)).toBeVisible();
    await page.getByLabel("Seu nome").fill("Maria Etapas");
    await noHorizontalScroll(page);

    // Voltar: o horário escolhido continua marcado, o dia e o serviço também.
    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(steps).toContainText("Passo 2 de 4");
    await expect(page.getByRole("list", { name: "Horários livres" }).getByRole("button", { name: time, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(days.getByRole("radio", { name: "qui 22/10" })).toBeChecked();
    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(barba).toBeChecked();
    await page.getByRole("button", { name: "Escolher dia e hora" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByLabel("Seu nome")).toHaveValue("Maria Etapas");

    await page.getByLabel("WhatsApp com DDD").fill("(11) 97777-4343");
    await page.getByRole("button", { name: "Pedir este horário" }).click();
    await expect(steps).toContainText("Passo 4 de 4");
    await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
    const code = /O código seria (\d{6})/.exec(await page.getByText(/nenhuma mensagem é enviada/).innerText())![1]!;
    await page.getByLabel("Código recebido").fill(code);
    await page.getByRole("button", { name: "Confirmar horário" }).click();
    await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();
    await expect(page.getByText(/Barba · quinta-feira, 22\/10 às/)).toBeVisible();
    await noHorizontalScroll(page);
  });
}
