import { expect, test } from "@playwright/test";

test("assinaturas: plano, adesão declarada com termos congelados, ciclo renova, mudar o plano não muda a assinante, cancelar preserva o saldo", async ({ page }) => {
  await page.goto("/app/assinaturas");
  await expect(page.getByRole("heading", { name: "Assinaturas", level: 1 })).toBeVisible();
  await expect(page.getByText("nada é cobrado")).toBeVisible();
  const plans = page.getByRole("list", { name: "Planos cadastrados" });
  await expect(plans).toContainText("Corte mensal");
  await expect(plans).toContainText("4 × Corte por mês · R$ 200,00 · 0 assinante(s)");

  // Lista primeiro: a adesão abre pelo botão; exige a declaração de aceite.
  await expect(page.getByRole("form", { name: "Nova assinatura" })).toHaveCount(0);
  await page.getByRole("button", { name: "Nova assinatura" }).click();
  const form = page.getByRole("form", { name: "Nova assinatura" });
  await expect(form.getByRole("button", { name: "Registrar adesão" })).toBeDisabled();
  await form.getByLabel(/A cliente aceitou estes termos/).check();
  await form.getByRole("button", { name: "Registrar adesão" }).click();
  await expect(page.getByText(/Ana Beatriz \(exemplo\) assinou “Corte mensal”: 4 sessões por mês por R\$\s200,00/)).toBeVisible();
  const subs = page.getByRole("list", { name: "Assinaturas" });
  await expect(subs).toContainText("Ativa");
  await expect(subs).toContainText("Ciclo 1:");
  await expect(subs).toContainText("4 de 4 sessões restantes · cobrança em aberto (R$ 200,00)");
  await expect(plans).toContainText("1 assinante(s)");
  await expect(form).toHaveCount(0);
  await page.getByRole("button", { name: "Nova assinatura" }).click();
  await form.getByLabel(/A cliente aceitou estes termos/).check();
  await form.getByRole("button", { name: "Registrar adesão" }).click();
  await expect(page.getByText("Esta cliente já assina este plano.")).toBeVisible();

  await page.getByRole("button", { name: "Fechar" }).click();

  // Novo plano pelo botão da seção.
  await page.getByRole("button", { name: "Novo plano" }).click();
  const newPlan = page.getByRole("form", { name: "Novo plano" });
  await newPlan.getByLabel("Nome do plano").fill("Barba quinzenal");
  await newPlan.getByLabel("Preço por ciclo (R$)").fill("60,00");
  await newPlan.getByRole("button", { name: "Criar plano" }).click();
  await expect(page.getByText("Plano “Barba quinzenal” criado.")).toBeVisible();
  await expect(newPlan).toHaveCount(0);
  await expect(plans).toContainText("Barba quinzenal");

  // Mudar o preço do plano não muda a assinante.
  await plans.getByRole("listitem").filter({ hasText: "Corte mensal" }).getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("form", { name: "Editar Corte mensal" });
  await edit.getByLabel("Preço por ciclo (R$)").fill("250,00");
  await edit.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByText("Quem já assina mantém os termos aceitos.")).toBeVisible();
  await expect(plans).toContainText("R$ 250,00");
  await expect(subs).toContainText("por R$ 200,00");

  // Antes de vencer, a renovação não abre ciclo (a renovação ao vencer está provada na integração e no pgTAP).
  await page.getByRole("button", { name: "Avançar o ciclo (simulação)" }).click();
  await expect(page.getByText("Renovação (simulação): 0 ciclo(s) aberto(s)")).toBeVisible();

  // Cancelar no fim do ciclo, depois manter; cancelar agora preserva o saldo.
  await subs.getByRole("button", { name: "Cancelar no fim do ciclo" }).click();
  await expect(page.getByText("não renova. Saldo e termos preservados.")).toBeVisible();
  await expect(subs).toContainText("Ativa, não renova no fim do ciclo");
  await subs.getByRole("button", { name: "Manter assinatura" }).click();
  await expect(page.getByText("volta a renovar")).toBeVisible();
  await subs.getByRole("button", { name: "Cancelar agora" }).click();
  await expect(page.getByText("As sessões do ciclo atual continuam válidas")).toBeVisible();
  await expect(subs).toContainText("Cancelada");
  await expect(subs).toContainText("4 de 4 sessões restantes");
  await subs.getByRole("button", { name: "Ver ciclos" }).click();
  await expect(subs.getByRole("list", { name: /Ciclos de Ana Beatriz/ })).toContainText("Ciclo 1");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
