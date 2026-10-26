import { expect, test } from "@playwright/test";

// P43 · Reserva pelo link público na demonstração offline: o visitante pede o horário, recebe o código (mostrado na tela,
// nada é enviado), confirma e a reserva aparece na Agenda da mesma aba com origem "Link de agendamento".
// O estado vive na aba, então a navegação entre as telas é a do próprio app.
const go = (page: import("@playwright/test").Page, href: string) =>
  page.evaluate((h) => {
    window.history.pushState(null, "", h);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

test("visitante reserva pelo link e o dono vê na Agenda", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-link");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-link$/);

  const slots = page.getByRole("list", { name: "Horários livres" });
  const first = slots.getByRole("button").first();
  const time = (await first.innerText()).trim();
  await first.click();
  await page.getByLabel("Seu nome").fill("Maria Visitante");
  await page.getByLabel("WhatsApp com DDD").fill("(11) 97777-4343");
  await page.getByRole("button", { name: "Pedir este horário" }).click();

  await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
  const demo = await page.getByText(/nenhuma mensagem é enviada/).innerText();
  const code = /O código seria (\d{6})/.exec(demo)![1]!;
  await page.getByLabel("Código recebido").fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Confirmar horário" }).click();
  await expect(page.getByText(/Código incorreto/)).toBeVisible();
  await page.getByLabel("Código recebido").fill(code);
  await page.getByRole("button", { name: "Confirmar horário" }).click();
  await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("10000000-0000-4000-8000-00000000000a");
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  await go(page, "/app/agenda");
  const row = page.getByRole("link", { name: new RegExp(`^${time}–.*Confirmado`) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText("Link de agendamento")).toBeVisible();
  // O dono vê quem pediu, com o WhatsApp para falar com a pessoa.
  await expect(page.getByText(/Maria Visitante/)).toBeVisible();
  await expect(page.getByRole("link", { name: "+5511977774343" })).toHaveAttribute("href", "https://wa.me/5511977774343");

  await go(page, "/p/barbearia-link");
  await expect(page.getByRole("list", { name: "Horários livres" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Horários livres" }).getByRole("button", { name: time, exact: true })).toHaveCount(0);
});
