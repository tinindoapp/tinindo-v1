import { expect, test } from "@playwright/test";

test("domicílio: roteiro em ordem com janela de chegada, marcar visita pelo CEP, fora da área recusado, tirar com desfazer, zonas e regras", async ({ page }, info) => {
  // Celular estreito (375 px), além do desktop.
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/domicilio");
  await expect(page.getByRole("heading", { name: "Domicílio", level: 1 })).toBeVisible();
  await expect(page.getByText(/Demonstração/).first()).toBeVisible();

  // Roteiro do dia em ordem, com deslocamento e janela de chegada.
  await expect(page.getByRole("heading", { name: /Roteiro de terça-feira, 20\/10/ })).toBeVisible();
  const route = page.getByRole("list", { name: "Visitas em ordem" });
  const stops = route.getByRole("listitem");
  await expect(stops).toHaveCount(2);
  await expect(stops.nth(0)).toContainText("09:00 · Ana Souza · Centro");
  await expect(stops.nth(0)).toContainText("Sair às 08:40 · 20 minutos de deslocamento");
  await expect(stops.nth(0)).toContainText("Chegada entre 08:30 e 09:00");
  await expect(stops.nth(1)).toContainText("10:30 · Carlos Lima · Pinheiros");
  await expect(stops.nth(1)).toContainText("25 minutos de deslocamento");

  // Mensagem pronta da janela para o cliente.
  await stops.nth(0).getByRole("button", { name: "Avisar a janela" }).click();
  await expect(stops.nth(0).getByRole("link", { name: "Enviar pelo WhatsApp" })).toHaveAttribute("href", /Chego%20entre%2008%3A30%20e%2009%3A00/);

  // Marcar a Bia como domicílio pelo CEP (só os 5 dígitos ficam).
  const bia = page.getByRole("form", { name: "Marcar Bia Rocha como domicílio" });
  await bia.getByLabel("CEP (opcional)").fill("01010-100");
  await expect(bia.getByText("CEP 01010: Centro.")).toBeVisible();
  await bia.getByRole("button", { name: "Marcar domicílio" }).click();
  await expect(page.getByText("Bia Rocha a domicílio: chegada entre 13:30 e 14:00.")).toBeVisible();
  await expect(stops).toHaveCount(3);
  await expect(stops.nth(2)).toContainText("Sair às 13:35 · 25 minutos de deslocamento");

  // CEP fora de qualquer zona: avisado no campo; erro de digitação fica embaixo do campo.
  const duda = page.getByRole("form", { name: "Marcar Duda Alves como domicílio" });
  await duda.getByLabel("CEP (opcional)").fill("999");
  await duda.getByRole("button", { name: "Marcar domicílio" }).click();
  await expect(duda.getByText("CEP com pelo menos 5 dígitos (ex.: 01310-100).")).toBeVisible();
  await duda.getByLabel("CEP (opcional)").fill("99999-000");
  await expect(duda.getByText("CEP 99999 não está em nenhuma zona.")).toBeVisible();

  // Tirar do domicílio com confirmação e desfazer.
  await stops.nth(2).getByRole("button", { name: "Tirar Bia Rocha do domicílio" }).click();
  await page.getByRole("button", { name: "Tirar", exact: true }).click();
  await expect(page.getByText(/Bia Rocha saiu do roteiro/)).toBeVisible();
  await expect(stops).toHaveCount(2);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Visita de volta ao roteiro.")).toBeVisible();
  await expect(stops).toHaveCount(3);

  // Zonas: fora da área por distância; um CEP numa zona só.
  await page.getByText("Zonas", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alphaville · fora da área" })).toBeVisible();
  const zone = page.getByRole("form", { name: "Nova zona" });
  await zone.getByLabel("Nome (bairro ou região)").fill("Sé");
  await zone.getByLabel("CEPs (5 dígitos)").fill("01001");
  await zone.getByLabel("Distância da base (km)").fill("1");
  await zone.getByLabel("Minutos da base").fill("15");
  await zone.getByRole("button", { name: "Criar zona" }).click();
  await expect(page.getByText("Um desses CEPs já está em outra zona ativa. Cada CEP fica numa zona só.")).toBeVisible();
  await zone.getByLabel("CEPs (5 dígitos)").fill("01003");
  await zone.getByRole("button", { name: "Criar zona" }).click();
  await expect(page.getByText("Zona “Sé” salva, dentro da área.")).toBeVisible();

  // Regras: janela de chegada maior vale para o roteiro.
  await page.getByText("Regras", { exact: true }).click();
  await page.getByLabel("Janela de chegada (min)").fill("45");
  await page.getByRole("button", { name: "Salvar regras" }).click();
  await expect(page.getByText("Regras do domicílio salvas. Valem para os próximos recálculos.")).toBeVisible();
  await page.getByText("Roteiro", { exact: true }).click();
  await expect(page.getByRole("list", { name: "Visitas em ordem" }).getByRole("listitem").nth(0)).toContainText("Chegada entre 08:15 e 09:00");

  // Sem rolagem horizontal no celular.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
