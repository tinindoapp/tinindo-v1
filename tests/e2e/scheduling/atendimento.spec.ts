import { expect, type Page, test } from "@playwright/test";

// Atendimento (auditoria de UX, itens 24, 25 e 27) na demonstração offline: hoje = terça 20/10/2026, 09:00 no fuso
// do negócio. O estado vive na aba: os fluxos navegam pelo próprio app, sem recarregar.
test.use({ timezoneId: "Asia/Tokyo" });

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function softGo(page: Page, href: string) {
  await page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);
}

const toast = (page: Page) => page.locator(".tn-toast");

test("pendência da tela Hoje leva à reserva provisória, que mostra o prazo e confirma", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("link", { name: /Reserva provisória · 10:45 Corte/ }).click();
  await expect(page.getByRole("heading", { name: "Atendimento", level: 1 })).toBeVisible();
  // Prazo no fuso do negócio, não no do navegador (Tóquio).
  await expect(page.getByText("Vence às 09:10 se não for confirmada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar atendimento" })).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(toast(page)).toContainText("Reserva confirmada por R$ 60,00.");
  await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
  await expect(page.getByRole("button", { name: "Confirmar reserva" })).toHaveCount(0);
});

test("liberar a reserva provisória pede confirmação com a consequência e não pede motivo", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /10:45–11:15 Corte/ }).click();
  await page.getByRole("button", { name: "Liberar horário" }).click();
  await expect(page.getByText(/deixa de valer e o horário 10:45–11:15 volta a ficar livre/)).toBeVisible();
  await expect(page.getByLabel("Motivo")).toHaveCount(0);
  await page.getByRole("button", { name: "Sim, liberar" }).click();
  await expect(toast(page)).toContainText("Horário liberado. O pedido deixou de valer.");
  await expect(page.locator(".tn-sched-badge")).toHaveText("Cancelado");
});

test("cartão do dia: Faltou executa na hora e o aviso desfaz", async ({ page }) => {
  await page.goto("/app/agenda");
  const timeline = page.getByRole("list", { name: /Linha do tempo/ });
  // Só o atendimento que já começou (09:00) tem Atendido e Faltou.
  await expect(timeline.getByRole("button", { name: /^Faltou/ })).toHaveCount(1);
  const box = await timeline.getByRole("button", { name: "Faltou às 09:00" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await noHorizontalScroll(page);
  await timeline.getByRole("button", { name: "Faltou às 09:00" }).click();
  await expect(toast(page)).toContainText("Falta registrada às 09:00.");
  await expect(timeline.getByRole("link", { name: /09:00–09:30 Corte.*Faltou/ })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /^Faltou/ })).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Desfazer" }).click();
  await expect(toast(page)).toContainText("Falta desfeita.");
  await expect(timeline.getByRole("link", { name: /09:00–09:30 Corte.*Confirmado/ })).toBeVisible();
});

test("detalhe: Atendido pede confirmação; depois disso não há Faltou", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
  await page.getByRole("button", { name: "Atendido", exact: true }).click();
  await expect(page.getByText("Isso registra que o atendimento aconteceu. Não registra pagamento.")).toBeVisible();
  await page.getByRole("button", { name: "Sim, foi atendido" }).click();
  await expect(toast(page)).toContainText("O pagamento não foi registrado");
  await expect(page.locator(".tn-sched-badge")).toHaveText("Concluído");
  await expect(page.getByRole("button", { name: "Faltou", exact: true })).toHaveCount(0);
});

test("cancelar: motivo, Desfazer refaz no mesmo horário e a lista de espera é oferecida", async ({ page }) => {
  await page.goto("/app/agenda/novo?data=2026-10-21");
  await page.getByRole("radio", { name: /Barba/ }).check();
  await page.getByRole("button", { name: "11:00", exact: true }).click();
  await page.getByLabel("Cliente").selectOption({ label: "Cliente Exemplo Bruno" });
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByText(/quarta-feira, 21 de outubro, 11:00–11:20/)).toBeVisible();
  const firstUrl = page.url();

  await page.getByRole("button", { name: "Cancelar atendimento" }).click();
  await page.getByLabel("Motivo").fill("Cliente avisou que não vem");
  await page.getByRole("button", { name: "Sim, cancelar" }).click();
  const next = page.getByRole("region", { name: "Atendimento cancelado" });
  await expect(next).toContainText("Motivo: Cliente avisou que não vem");
  await expect(next.getByRole("link", { name: "Oferecer à lista de espera (1 pessoa)" })).toBeVisible();
  // Cadastro de exemplo sem WhatsApp: o botão não aparece.
  await expect(next.getByRole("link", { name: "Avisar no WhatsApp" })).toHaveCount(0);
  await noHorizontalScroll(page);

  await next.getByRole("button", { name: "Desfazer" }).click();
  await expect(toast(page)).toContainText("Cancelamento desfeito");
  await expect(page).not.toHaveURL(firstUrl);
  await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
  await expect(page.getByText(/quarta-feira, 21 de outubro, 11:00–11:20/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Atendimento cancelado" })).toHaveCount(0);
});

test("cancelar pedido do link público: Avisar no WhatsApp abre com o texto pronto", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-aviso");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  const first = page.getByRole("list", { name: "Horários livres" }).getByRole("button").first();
  const time = (await first.innerText()).trim();
  await first.click();
  await page.getByLabel("Seu nome").fill("Cliente do link");
  await page.getByLabel("WhatsApp com DDD").fill("(11) 97777-4343");
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  const code = /O código seria (\d{6})/.exec(await page.getByText(/nenhuma mensagem é enviada/).innerText())![1]!;
  await page.getByLabel("Código recebido").fill(code);
  await page.getByRole("button", { name: "Confirmar horário" }).click();
  await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();

  await softGo(page, "/app/agenda");
  await page.getByRole("link", { name: new RegExp(`^${time}–.*Confirmado`) }).click();
  await page.getByRole("button", { name: "Cancelar atendimento" }).click();
  await page.getByLabel("Motivo").fill("Imprevisto");
  await page.getByRole("button", { name: "Sim, cancelar" }).click();
  const whatsapp = page.getByRole("region", { name: "Atendimento cancelado" }).getByRole("link", { name: "Avisar no WhatsApp" });
  await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/5511977774343\?text=/);
  const text = decodeURIComponent((await whatsapp.getAttribute("href"))!.split("text=")[1]!);
  expect(text).toContain("Olá, Cliente do link!");
  expect(text).toContain(`às ${time}`);
  expect(text).not.toContain("Imprevisto");
});
