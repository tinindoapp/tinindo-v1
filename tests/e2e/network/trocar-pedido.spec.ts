import { expect, test } from "@playwright/test";

// Recado #64, item 5: o mesmo WhatsApp com pedido aguardando código. A tela avisa antes de trocar, "Manter o anterior"
// segue para o código já enviado e "Trocar pelo novo" cancela o anterior e avisa depois de trocar.
test("mesmo WhatsApp: aviso antes de trocar, manter o anterior, trocar e confirmar", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-troca");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-troca$/);

  await page.getByRole("button", { name: "Escolher dia e hora" }).click();
  const slots = page.getByRole("list", { name: "Horários livres" });
  const firstSlot = slots.getByRole("button").first();
  const firstTime = (await firstSlot.innerText()).trim();
  await firstSlot.click();
  await page.getByLabel("Seu nome").fill("Maria Troca");
  await page.getByLabel("WhatsApp com DDD").fill("(11) 97777-4343");
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();

  // Volta e pede outro horário com o mesmo WhatsApp.
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByRole("button", { name: "Voltar" }).click();
  const secondSlot = slots.getByRole("button").nth(1);
  const secondTime = (await secondSlot.innerText()).trim();
  await secondSlot.click();
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(`Você já tem um pedido aguardando confirmação: Corte · ter, 20/10 às ${firstTime}.`);
  await expect(alert).toContainText("Se continuar, ele será trocado por este.");
  for (const name of ["Trocar pelo novo", "Manter o anterior"]) {
    expect((await alert.getByRole("button", { name }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  // Manter: segue para o código do pedido anterior.
  await alert.getByRole("button", { name: "Manter o anterior" }).click();
  await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
  await expect(page.getByText(`Corte · ter, 20/10 às ${firstTime}`)).toBeVisible();

  // Trocar: o anterior é cancelado e a tela diz isso.
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  await page.getByRole("alert").getByRole("button", { name: "Trocar pelo novo" }).click();
  await expect(page.getByText(/Seu pedido anterior foi cancelado e substituído por este/)).toBeVisible();
  const code = /O código seria (\d{6})/.exec(await page.getByText(/nenhuma mensagem é enviada/).innerText())![1]!;
  await page.getByLabel("Código recebido").fill(code);
  await page.getByRole("button", { name: "Confirmar horário" }).click();
  await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();
  await expect(page.getByText(/Corte · terça-feira, 20\/10 às/)).toContainText(secondTime);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
