import { expect, test } from "@playwright/test";

// Auditoria de UX, item 35: ligar e WhatsApp no cartão, editar e arquivar no menu "⋯" e a ficha com o histórico.
test("clientes: Ligar e WhatsApp no cartão, menu “⋯” por teclado e ficha com o histórico", async ({ page }) => {
  await page.goto("/app/clientes");
  const list = page.getByRole("region", { name: "Lista de clientes" });
  const ana = list.getByRole("listitem").filter({ hasText: "Cliente AB (exemplo)" });
  const call = ana.getByRole("link", { name: "Ligar para Cliente AB (exemplo)" });
  await expect(call).toHaveAttribute("href", "tel:+5511988887777");
  await expect(ana.getByRole("link", { name: /WhatsApp de Cliente AB/ })).toHaveAttribute("href", "https://wa.me/5511988887777");
  // Alvos de 44 px.
  for (const target of [call, ana.getByRole("link", { name: /WhatsApp/ }), ana.getByRole("button", { name: /Mais ações/ })]) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  // Sem telefone, sem os botões.
  const guest = list.getByRole("listitem").filter({ hasText: "Visitante sem login (exemplo)" });
  await expect(guest.getByRole("link", { name: /Ligar|WhatsApp/ })).toHaveCount(0);

  // Menu "⋯": abre pelo teclado, Esc fecha e devolve o foco.
  const more = ana.getByRole("button", { name: "Mais ações para Cliente AB (exemplo)" });
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Mais ações para Cliente AB (exemplo)" });
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: "Editar" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Arquivar" })).toBeFocused();
  // Demonstração: as ações de gravação ficam bloqueadas e o menu diz por quê.
  await expect(menu.getByRole("menuitem", { name: "Arquivar" })).toHaveAttribute("aria-disabled", "true");
  await expect(menu).toContainText("Demonstração: editar e arquivar ficam bloqueados.");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");

  // O nome leva à ficha.
  await ana.getByRole("link", { name: "Cliente AB (exemplo)", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/clientes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Cliente AB (exemplo)", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Cliente AB (exemplo) · Tinindo");
  await expect(page.getByRole("main").getByRole("link", { name: "Ligar para Cliente AB (exemplo)" })).toBeVisible();
  const history = page.getByRole("region", { name: "Atendimentos" });
  await expect(history.getByRole("region", { name: /Anteriores \(\d+\)/ })).toContainText("Concluído");
  await expect(history).toContainText("Até agora:");
  await expect(history).not.toContainText("mais antigos não aparecem");
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  // Voltar para a lista.
  await page.getByRole("main").getByRole("link", { name: "Clientes", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
});
