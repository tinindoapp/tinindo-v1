import { expect, test } from "@playwright/test";

// P49, decisão D2 (b): a quinta aba é "Retorno", com lembretes a mandar, quem não volta e lista de espera.
// Os links abrem o WhatsApp do dono; nada é enviado pela Tinindo e compartilhar não é entregar.
test("retorno: aba na barra, três blocos em ordem, lembrete marcado como compartilhado e caminho para a lista de espera", async ({ page, isMobile }) => {
  await page.goto("/app");
  if (isMobile) await page.getByRole("navigation", { name: "Abas" }).getByRole("link", { name: "Retorno" }).click();
  else await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Retorno", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/relacionamento\/retorno$/);
  await expect(page.getByRole("heading", { name: "Retorno", level: 1 })).toBeVisible();
  if (isMobile) await expect(page.getByRole("navigation", { name: "Abas" }).getByRole("link", { name: "Retorno" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(["Lembretes a mandar", "Quem não volta", "Lista de espera"]);

  // Lembrete sem canal: texto pronto e o WhatsApp numa aba nova. Abrir marca como compartilhado por você.
  const reminders = page.getByRole("region", { name: "Lembretes a mandar" });
  await expect(reminders).toContainText("Seu horário de Barba está confirmado");
  const link = reminders.getByRole("link", { name: "Mandar no WhatsApp para Carlos (exemplo)" });
  await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  await expect(link).toHaveAttribute("target", "_blank");
  // O WhatsApp não abre no teste: a aba nova é fechada assim que nasce.
  page.context().on("page", (p) => void p.close());
  await link.click();
  await expect(page.getByText("compartilhar não confirma que chegou")).toBeVisible();
  await expect(reminders).toContainText("Nenhum lembrete esperando você");

  // Quem não volta: Rita, com a última visita; o nome abre a ficha.
  const lapsed = page.getByRole("region", { name: "Quem não volta" });
  await expect(lapsed.getByRole("listitem")).toHaveCount(1);
  await expect(lapsed).toContainText("Rita (exemplo)");
  await expect(lapsed).toContainText("Última visita há 56 dias");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  const waitlist = page.getByRole("region", { name: "Lista de espera" });
  await waitlist.getByRole("link", { name: "Abrir a lista de espera" }).click();
  await expect(page.getByRole("heading", { name: "Lista de espera", level: 1 })).toBeVisible();
});

test("clientes: última visita na linha e filtro de quem não volta", async ({ page }) => {
  await page.goto("/app/clientes");
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
  await expect(page.getByText("Próximo: ter., 20/10")).toHaveCount(2);
  await page.getByText("Sem voltar há 30+ dias").click();
  await expect(page.getByText("Ninguém sem voltar há 30 dias ou mais")).toBeVisible();
  await page.goto("/app/clientes?filtro=sem-voltar");
  await expect(page.getByRole("radio", { name: "Sem voltar há 30+ dias" })).toBeChecked();
});
