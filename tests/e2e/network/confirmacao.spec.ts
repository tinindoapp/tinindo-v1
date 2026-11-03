import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Onda 3 da auditoria de UX (E10, E12): perfil com a reserva primeiro e confirmação com próximo passo.

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function publishWithWhatsapp(page: Page, slug: string) {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill(slug);
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  const media = page.getByRole("region", { name: "Foto e contato" });
  await media.getByRole("checkbox", { name: /Mostrar botão do WhatsApp/ }).check();
  await media.getByRole("button", { name: "Salvar foto e opções" }).click();
  await expect(page.getByText("Foto e opções do perfil salvas.")).toBeVisible();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${slug}$`));
}

for (const scheme of ["light", "dark"] as const) {
  test(`reserva primeiro, telefone formatado, Corrigir, Adicionar à agenda e Falar com o profissional (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await publishWithWhatsapp(page, `barbearia-confirma-${scheme}`);

    // E12: a primeira ação é ver os horários; avaliar e minhas reservas ficam no rodapé.
    const cta = page.getByRole("link", { name: "Ver horários livres" });
    await expect(cta).toBeVisible();
    expect((await cta.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const footer = page.locator("footer.tn-net-foot");
    await expect(footer.getByRole("link", { name: "Avaliar meu atendimento" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Minhas reservas" })).toBeVisible();
    await cta.click();
    await expect(page.getByRole("heading", { name: "Escolha o serviço" })).toBeFocused();

    await page.getByRole("button", { name: "Escolher dia e hora" }).click();
    const slot = page.getByRole("list", { name: "Horários livres" }).getByRole("button").first();
    const time = (await slot.textContent())!.trim();
    await slot.click();
    // Dia da demonstração: 20/10/2026, em São Paulo (UTC−3).
    const [hh, mm] = time.split(":").map(Number);
    const utc = `20261020T${String(hh! + 3).padStart(2, "0")}${String(mm).padStart(2, "0")}00Z`;
    await page.getByLabel("Seu nome").fill("Cliente Exemplo");
    await page.getByLabel("WhatsApp com DDD").fill("11977774343");
    await page.getByRole("button", { name: "Pedir este horário" }).click();
    await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();

    // E10: o número aparece como a pessoa conhece, e dá para corrigir sem perder a escolha.
    await expect(page.getByText("(11) 97777-4343")).toBeVisible();
    await expect(page.getByText("+5511977774343")).toHaveCount(0);
    const fix = page.getByRole("button", { name: "Corrigir o número" });
    expect((await fix.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await fix.click();
    await expect(page.getByRole("heading", { name: "Seus dados" })).toBeVisible();
    await expect(page.getByLabel("WhatsApp com DDD")).toBeFocused();
    await expect(page.getByLabel("WhatsApp com DDD")).toHaveValue("11977774343");
    await expect(page.getByText(`Corte · ter 20/10 · ${time}`)).toBeVisible();
    // Sem mudar nada, pedir de novo é o mesmo pedido (mesma chave): volta ao código.
    await page.getByRole("button", { name: "Pedir este horário" }).click();
    await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
    const code = /O código seria (\d{6})/.exec((await page.getByText(/nenhuma mensagem é enviada/).textContent()) ?? "")![1]!;
    await page.getByLabel("Código recebido").fill(code);
    await page.getByRole("button", { name: "Confirmar horário" }).click();
    await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();

    const talk = page.getByRole("link", { name: "Falar com o profissional" });
    const href = new URL((await talk.getAttribute("href"))!);
    expect(`${href.origin}${href.pathname}`).toBe("https://wa.me/5511999990001");
    expect(href.searchParams.get("text")).toContain("Marquei Corte");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Adicionar à agenda" }).click()]);
    expect(download.suggestedFilename()).toBe(`horario-barbearia-confirma-${scheme}.ics`);
    const ics = await readFile((await download.path())!, "utf8");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain(`DTSTART:${utc}`);
    expect(ics).toMatch(/DTEND:20261020T\d{6}Z/);
    expect(ics).toContain("SUMMARY:Corte · Barbearia Exemplo A");
    expect(ics).not.toMatch(/97777|Cliente Exemplo/);
    await noHorizontalScroll(page);
  });
}
