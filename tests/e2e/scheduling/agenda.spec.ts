import { expect, type Page, test } from "@playwright/test";

// Agenda (P04) em demonstração offline: emulação do motor (P03) sobre as fixtures do contrato v1.
// O navegador roda em outro fuso para provar que os horários seguem o fuso do negócio.
test.use({ timezoneId: "Asia/Tokyo" });

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test("hoje: horários no fuso do negócio, ocupação e dados de exemplo identificados", async ({ page }) => {
  await page.goto("/app/agenda");
  await expect(page.getByText("Dados de exemplo.")).toBeVisible();
  const timeline = page.getByRole("list", { name: /Linha do tempo/ });
  await expect(timeline.getByRole("listitem").first()).toContainText("09:00–09:30");
  await expect(page.getByText("Horários no fuso do negócio: America/Sao Paulo (UTC−03:00)")).toBeVisible();
  await expect(page.getByText(/confirmados de 9 h vendáveis/)).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Semana" }).click();
  await expect(page.getByRole("heading", { name: /Semana de/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /qui\., 22\/10/ })).toContainText("1 atendimento");
  await noHorizontalScroll(page);
});

test("cria, reagenda e cancela um atendimento", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: "Novo agendamento" }).click();
  await page.getByRole("radio", { name: /Barba/ }).check();
  await page.getByRole("button", { name: "Próximo dia" }).click(); // quarta, 21/10
  await page.getByRole("button", { name: "10:30", exact: true }).click();
  await page.getByLabel("Cliente").selectOption({ label: "Cliente Exemplo Bruno" });
  await expect(page.getByText("Ver o valor não segura o horário", { exact: false })).toBeVisible();
  await expect(page.getByText(/Política de cancelamento/)).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();

  await expect(page.getByText("Agendamento confirmado.")).toBeVisible();
  await expect(page.getByText(/quarta-feira, 21 de outubro, 10:30–10:50/)).toBeVisible();
  await expect(page.getByText("R$ 40,00")).toBeVisible();

  await page.getByRole("link", { name: "Reagendar" }).click();
  await page.getByRole("button", { name: "14:00", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar reagendamento" }).click();
  await expect(page.getByText("Atendimento reagendado.")).toBeVisible();
  await expect(page.getByText(/quarta-feira, 21 de outubro, 14:00–14:20/)).toBeVisible();

  await page.getByRole("button", { name: "Cancelar atendimento" }).click();
  await page.getByLabel("Motivo").fill("Cliente pediu para remarcar depois");
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(page.getByText("Atendimento cancelado. O horário voltou a ficar livre.")).toBeVisible();
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /Voltar para a agenda/ }).click();
  await expect(page.getByRole("heading", { name: /quarta-feira, 21 de outubro/ })).toBeVisible();
  await expect(page.getByRole("list", { name: /Linha do tempo/ })).toContainText("Cancelado");
});

test("conflito 409 é explicado e o horário ocupado some da lista", async ({ page }) => {
  await page.goto("/app/agenda/novo?data=2026-10-20&simular=conflito");
  await page.getByRole("button", { name: "15:45" }).click();
  await page.getByLabel("Cliente").selectOption({ label: "Cliente Exemplo Ana" });
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();

  await expect(page.getByText("Esse horário acabou de ser ocupado")).toBeVisible();
  await expect(page.getByText(/conflito 409\)\. Nenhum agendamento foi criado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "16:30" })).toBeVisible();
  await expect(page.getByRole("button", { name: "15:45" })).toHaveCount(0);
  await noHorizontalScroll(page);
});

test("ações principais têm alvo de toque de pelo menos 44px", async ({ page }) => {
  await page.goto("/app/agenda");
  await expect(page.getByRole("list", { name: /Linha do tempo/ })).toBeVisible();
  for (const name of ["Dia", "Semana", "Hoje", "Dia anterior", "Próximo dia"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
  }
  const link = await page.getByRole("link", { name: "Novo agendamento" }).boundingBox();
  expect(link?.height ?? 0).toBeGreaterThanOrEqual(44);
});
