import { expect, type Page, test } from "@playwright/test";

// P55 · Jornada do link na demonstração (desktop e celular): o dono informa endereço e política (D21); o cliente vê
// preço, local e política antes de confirmar (D23); corrigir o número mantém o horário; o código errado diz quantas
// tentativas restam; "Reenviar código" espera 30 s; a confirmação dá o link da reserva, que mostra a reserva sem conta
// (D20). Em domicílio, o pedido pergunta o bairro.

async function publish(page: Page, slug: string, where: "address" | "home") {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill(slug);
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  const form = page.getByRole("form", { name: "Endereço, horário e política" });
  if (where === "address") {
    await form.getByText("No meu endereço").click();
    await form.getByLabel("Endereço", { exact: true }).fill("Rua das Flores, 10");
  } else {
    await form.getByText("Em domicílio").click();
  }
  await form.getByLabel("Política de cancelamento (opcional)").fill("Cancele com 2 horas de antecedência.");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Endereço, horário e política salvos.")).toBeVisible();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${slug}$`));
}

const demoCode = async (page: Page) =>
  /O código seria (\d{6})/.exec((await page.getByText(/nenhuma mensagem é enviada/).textContent()) ?? "")![1]!;

test("jornada do link: preço, local e política antes; corrigir o número; tentativas; link da reserva", async ({ page }) => {
  await publish(page, "barbearia-jornada-e2e", "address");
  await expect(page.getByRole("link", { name: "Rua das Flores, 10" })).toBeVisible();
  await expect(page.getByText("Cancelamento: Cancele com 2 horas de antecedência.")).toBeVisible();

  await page.getByRole("button", { name: "Escolher dia e hora" }).click();
  await page.getByRole("list", { name: "Horários livres" }).getByRole("button").first().click();
  const facts = page.getByRole("definition").filter({ hasText: "Rua das Flores, 10" });
  await expect(facts).toBeVisible();
  await expect(page.getByText("Cancele com 2 horas de antecedência.")).toBeVisible();

  // Número errado → Corrigir → o mesmo horário é aceito com o número certo (sem "reservado por outra pessoa").
  await page.getByLabel("Seu nome").fill("Cliente Exemplo");
  await page.getByLabel("WhatsApp com DDD").fill("11977770001");
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
  await expect(page.getByText(/Preço/)).toBeVisible();
  await expect(page.getByText(/R\$\s60,00 · pago direto ao profissional/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Reenviar código \(em \d+ s\)/ })).toBeDisabled();
  await page.getByRole("button", { name: "Corrigir o número" }).click();
  await page.getByLabel("WhatsApp com DDD").fill("11977770002");
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
  await expect(page.getByText("(11) 97777-0002")).toBeVisible();
  await expect(page.getByText(/reservado por outra pessoa/)).toHaveCount(0);

  // Código errado diz quantas tentativas restam.
  await page.getByLabel("Código recebido").fill("000000");
  await page.getByRole("button", { name: "Confirmar horário" }).click();
  await expect(page.getByText(/Código não confere.*Restam 4 tentativas\./)).toBeVisible();
  await page.getByLabel("Código recebido").fill(await demoCode(page));
  await page.getByRole("button", { name: "Confirmar horário" }).click();
  await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();
  await expect(page.getByText(/Tem login|Minhas reservas/)).toHaveCount(0);

  // O link da reserva (D20): ver sem conta; avaliar fica para depois do atendimento.
  await page.getByRole("link", { name: "Ver minha reserva" }).click();
  await expect(page).toHaveURL(/\/reserva\/barbearia-jornada-e2e$/);
  await expect(page.getByRole("heading", { name: "Sua reserva", level: 1 })).toBeVisible();
  await expect(page.getByText("Confirmado")).toBeVisible();
  await expect(page.getByText("Depois do atendimento, abra este mesmo link para contar como foi.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("97777-0002");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("em domicílio, o pedido pergunta o bairro", async ({ page }) => {
  await publish(page, "barbearia-domicilio-e2e", "home");
  await expect(page.getByText("Atende em domicílio")).toBeVisible();
  await page.getByRole("button", { name: "Escolher dia e hora" }).click();
  await page.getByRole("list", { name: "Horários livres" }).getByRole("button").first().click();
  await expect(page.getByText("Em domicílio (o profissional vai até você)")).toBeVisible();
  await page.getByLabel("Seu nome").fill("Cliente Exemplo");
  await page.getByLabel("WhatsApp com DDD").fill("11977770003");
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  await expect(page.getByText("Informe o bairro onde vai ser o atendimento.")).toBeVisible();
  await page.getByLabel("Bairro do atendimento").fill("Moema");
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
});

test("link de reserva inválido: não encontrado com saída", async ({ page }) => {
  await page.goto("/reserva#t=" + "A".repeat(43));
  await expect(page.getByRole("heading", { name: "Não encontramos esta reserva" })).toBeVisible();
  await expect(page).toHaveURL(/\/reserva$/);
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
});
