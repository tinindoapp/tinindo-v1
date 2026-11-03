import { expect, type Page, test } from "@playwright/test";

const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

test("lista de espera: oferta para o primeiro da fila, link sem envio automático e aceite único", async ({ page }) => {
  await page.goto("/app/lista-de-espera");
  await expect(page.getByRole("heading", { name: "Lista de espera", level: 1 })).toBeVisible();
  const slots = page.getByRole("region", { name: "Vagas para oferecer" });
  await expect(slots).toContainText("Próximo da fila: Cliente Exemplo Ana");
  await slots.getByRole("button", { name: /Preparar oferta/ }).click();

  const share = page.getByRole("region", { name: "Link da oferta" });
  await expect(share).toContainText("A Tinindo não envia mensagens");
  const link = (await share.locator("code").textContent()) ?? "";
  expect(link).toMatch(/\/oferta#t=[A-Za-z0-9_-]{43}$/);
  // Copiar só registra o compartilhamento quando dá certo (clipboard simulado no navegador de teste).
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }));
  await share.getByRole("button", { name: "Copiar link" }).click();
  await expect(share.getByRole("status")).toHaveText("Copiado ✓");
  const offers = page.getByRole("region", { name: "Ofertas" });
  await expect(offers).toContainText("Oferta aberta");
  await expect(offers).toContainText("a entrega não é confirmada");
  await expect(offers).not.toContainText(/entregue/i);

  // O cliente abre o link: nada é reservado até aceitar; o token sai da URL.
  await soft(page, new URL(link).pathname + new URL(link).hash);
  await expect(page.getByRole("heading", { name: "Vaga disponível" })).toBeVisible();
  await expect(page).toHaveURL(/\/oferta$/);
  await expect(page.getByText("Abrir esta página não reserva nada")).toBeVisible();
  await page.getByRole("button", { name: "Aceitar e reservar" }).click();
  await expect(page.getByText("Reserva confirmada")).toBeVisible();

  await soft(page, "/app/lista-de-espera");
  await expect(page.getByRole("region", { name: "Ofertas" })).toContainText("Aceita: reserva confirmada");
  await expect(page.getByRole("region", { name: "Vagas para oferecer" })).toContainText("Nenhuma vaga liberada");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("lista de espera: só entra quem autorizou o aviso de vaga", async ({ page }) => {
  await page.goto("/app/lista-de-espera");
  const form = page.getByRole("form", { name: "Adicionar à lista" });
  await form.getByLabel("Cliente", { exact: true }).selectOption({ label: "Cliente Exemplo Bruno" });
  await form.getByLabel("Quinta").check();
  await form.getByRole("button", { name: "Adicionar" }).click();
  await expect(form.getByText("Só entra na lista quem autorizou")).toBeVisible();
  await form.getByLabel(/O cliente autorizou/).check();
  await form.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("region", { name: "Na lista" })).toContainText("Cliente Exemplo Bruno");
});

test("link de oferta desconhecido não reserva nada", async ({ page }) => {
  await page.goto(`/oferta#t=${"x".repeat(43)}`);
  await expect(page.getByText(/não é válido/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar e reservar" })).toHaveCount(0);
});

test("cancelar → oferecer à lista de espera: a vaga chega pela URL, em destaque e com o foco em Preparar oferta", async ({ page }) => {
  await page.goto("/app/agenda/novo?data=2026-10-21");
  await page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: "Cliente Exemplo Bruno" }).check();
  await page.getByRole("radio", { name: /Barba/ }).check();
  await page.getByRole("button", { name: "11:00", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByText("Agendamento confirmado.")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar atendimento" }).click();
  await page.getByLabel("Motivo").fill("Cliente avisou que não vem");
  await page.getByRole("button", { name: "Sim, cancelar" }).click();

  await page.getByRole("region", { name: "Atendimento cancelado" }).getByRole("link", { name: "Oferecer à lista de espera (1 pessoa)" }).click();
  await expect(page).toHaveURL(/\/app\/lista-de-espera\?vaga=2026-10-21T11%3A00%3A00-03%3A00$/);
  const slots = page.getByRole("region", { name: "Vagas para oferecer" });
  const target = slots.locator(".tn-wl-target");
  await expect(target).toContainText("Vaga liberada agora");
  await expect(target).toContainText(/quarta-feira, 21\/10, 11:00–11:30/);
  await expect(target).toContainText("Próximo da fila: Cliente Exemplo Ana");
  await expect(target.getByRole("button", { name: /^Preparar oferta/ })).toBeFocused();
  await expect(target).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Link da oferta" })).toContainText("A Tinindo não envia mensagens");
  await expect(slots).toContainText("Oferta preparada para Cliente Exemplo Ana na vaga de quarta-feira, 21/10, às 11:00");
});

test("vaga pela URL que ninguém da lista aceita: a tela diz com o horário escrito", async ({ page }) => {
  await page.goto(`/app/lista-de-espera?vaga=${encodeURIComponent("2026-10-20T15:00:00-03:00")}`);
  await expect(page.getByRole("region", { name: "Vagas para oferecer" })).toContainText(
    "Ninguém da lista aceita terça-feira, 20/10, às 15:00. A vaga continua livre na agenda.",
  );
});
