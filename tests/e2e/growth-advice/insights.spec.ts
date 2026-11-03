import { expect, test } from "@playwright/test";

// P45 · Insights proativos na demonstração (motor emulado sobre a base de exemplo, rotulado): a Home mostra até 3,
// cada um com período, número e denominador, "Ver" e "Agora não"; "Ver" de proposta abre a sugestão em Metas e
// sugestões, onde "Preparar" cria a proposta no fluxo dono (nada publicado); "Ver" de tela abre o fluxo; o resumo
// semanal chega na caixa de Mensagens.
test("Home: até 3 sugestões com evidência; Agora não silencia; Ver leva à proposta ou à tela do fluxo", async ({ page }) => {
  await page.goto("/app");
  const card = page.getByRole("region", { name: "Para você esta semana" });
  await expect(card).toBeVisible();
  const items = card.getByRole("list", { name: "Sugestões para você" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  // Ordem por prioridade, com período, número e denominador em cada uma.
  await expect(items.nth(0)).toContainText("Faltas concentradas na quarta");
  await expect(items.nth(0)).toContainText("5 de 12 atendimentos de quarta com falta, de 21/08 a 20/10.");
  await expect(items.nth(1)).toContainText("Horário vazio toda semana: sábado das 9h às 14h");
  await expect(items.nth(1)).toContainText("Vazia em 5 de 5 semanas, de 14/09 a 18/10.");
  await expect(items.nth(2)).toContainText("3 de 4 itens do perfil prontos (hoje, 20/10).");
  for (const item of await items.all()) {
    await expect(item.getByRole("button", { name: /^Agora não/ })).toBeVisible();
    await expect(item.getByRole("button", { name: /^Ver/ }).or(item.getByRole("link", { name: /^Ver/ }))).toHaveCount(1);
  }
  // O cartão fica logo abaixo do cartão de configuração (P44), antes do resumo e da agenda do dia.
  const order = await page.locator("main").evaluate((m) => [...m.querySelectorAll("[aria-labelledby], .tn-stats, #home-insights, #home-next")]
    .map((e) => (e.id || e.getAttribute("aria-labelledby") || e.className) as string));
  const setupAt = order.findIndex((x) => /setup/i.test(x));
  const insightsAt = order.indexOf("home-insights");
  expect(insightsAt).toBeGreaterThan(-1);
  if (setupAt >= 0) expect(insightsAt).toBeGreaterThan(setupAt);
  expect(insightsAt).toBeLessThan(order.findIndex((x) => /home-next/.test(x)));

  // "Agora não": sai da Home por 30 dias.
  await items.nth(2).getByRole("button", { name: /^Agora não/ }).click();
  await expect(page.getByText("“Perfil incompleto” silenciada por 30 dias.")).toBeVisible();
  await expect(items).toHaveCount(2);

  // "Ver" de proposta: abre a sugestão destacada em Metas e sugestões; "Preparar" cria a proposta (aprovação em Preços).
  await items.nth(1).getByRole("link", { name: /^Ver/ }).click();
  await expect(page).toHaveURL(/\/app\/metas\?insight=/);
  await expect(page.getByRole("heading", { name: "Metas e sugestões", level: 1 })).toBeVisible();
  const open = page.getByRole("list", { name: "Sugestões abertas" });
  const focused = open.locator("li[data-focus='true']");
  await expect(focused).toContainText("Horário vazio toda semana: sábado das 9h às 14h");
  await expect(focused).toContainText("Acontece em Preços, como proposta para você aprovar.");
  await expect(focused).toBeFocused();
  await focused.getByRole("button", { name: "Preparar regra de preço" }).click();
  await expect(page.getByText("Proposta de regra de preço criada. Ela só vale depois que você aprovar e publicar em Preços.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir Preços" })).toBeVisible();
  const decided = page.getByRole("list", { name: "Sugestões decididas" });
  await expect(decided).toContainText("Horário ocioso · preparada");
  await expect(decided).toContainText("Perfil incompleto · silenciada por 30 dias");
  // O que a conta olhou: insuficiente ≠ zero, com o motivo.
  await page.getByText("O que a conta olhou").click();
  await expect(page.getByRole("list", { name: "Regras e dados" })).toContainText("Clientes sem retorno: ainda sem dado suficiente (não é zero) (menos de 5 clientes que voltaram 2 vezes ou mais)");
  // Sem nome cru de campo ou de regra na tela.
  const body = await page.locator("main").innerText();
  for (const raw of ["idle_slot", "no_show_concentration", "uncharged_bookings", "numerator", "denominator", "P05", "P13"]) expect(body).not.toContain(raw);

  // "Ver" de tela: registra e abre o fluxo dono (Relacionamento, para os lembretes).
  await page.getByRole("link", { name: "Hoje" }).first().click();
  const again = page.getByRole("region", { name: "Para você esta semana" }).getByRole("list", { name: "Sugestões para você" }).getByRole("listitem");
  await expect(again).toHaveCount(1);
  await again.first().getByRole("button", { name: /^Ver/ }).click();
  await expect(page).toHaveURL(/\/app\/relacionamento$/);

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("resumo semanal por modelo fixo na caixa de Mensagens e em Metas e sugestões", async ({ page }) => {
  await page.goto("/app/mensagens");
  const digest = page.getByRole("region", { name: "Resumo da semana · da Tinindo" });
  await expect(digest).toContainText("Resumo da semana de 12/10 a 18/10.");
  await expect(digest).toContainText("Texto automático por modelo fixo, com os números registrados no app.");
  await digest.getByRole("link", { name: "Ver sugestões em Metas e sugestões" }).click();
  await expect(page.getByRole("region", { name: "Resumo da semana" })).toContainText("Resumo da semana de 12/10 a 18/10.");
});
