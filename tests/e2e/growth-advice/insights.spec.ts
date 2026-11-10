import { expect, test } from "@playwright/test";

// P45 · Insights proativos na demonstração (motor emulado sobre a base de exemplo, rotulado). Desde o P48 (decisão D6)
// a Home mostra UMA sugestão, a de maior prioridade, no fim da tela, com período, número e denominador, "Ver", "Agora não"
// e "Ver todas"; decidida uma, a seguinte aparece. "Ver" de tela abre o fluxo; "Ver" de proposta abre a sugestão em
// Metas e sugestões, onde "Preparar" cria a proposta no fluxo dono (nada publicado); o resumo semanal chega na caixa de
// Mensagens.
test("Home: uma sugestão com evidência e Ver todas; Ver leva à tela do fluxo ou à proposta; Agora não silencia", async ({ page }) => {
  await page.goto("/app");
  const card = page.getByRole("region", { name: "Para você esta semana" });
  await expect(card).toBeVisible();
  const items = card.getByRole("list", { name: "Sugestões para você" }).getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Faltas concentradas na quarta");
  await expect(items.first()).toContainText("5 de 12 atendimentos de quarta com falta, de 21/08 a 20/10.");
  await expect(items.first().getByRole("button", { name: /^Agora não/ })).toBeVisible();
  await expect(card.getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/app/metas");
  // O dia primeiro: a sugestão vem depois do Próximo, da lista do dia, das pendências, dos números e da configuração.
  await expect(page.getByRole("heading", { name: "Atendimentos de hoje" })).toBeVisible();
  await expect(page.locator("[aria-labelledby='setup-card-title']")).toBeVisible();
  const order = await page.locator("main").evaluate((m) => [...m.querySelectorAll("[aria-labelledby], .tn-stats")]
    .map((e) => (e.classList.contains("tn-stats") ? "tn-stats" : e.getAttribute("aria-labelledby")) as string));
  const at = (x: string) => order.indexOf(x);
  expect(at("home-next-title")).toBeGreaterThan(-1);
  expect(at("home-next-title")).toBeLessThan(at("home-day"));
  expect(at("home-day")).toBeLessThan(at("home-pending"));
  expect(at("home-pending")).toBeLessThan(at("tn-stats"));
  expect(at("tn-stats")).toBeLessThan(at("setup-card-title"));
  expect(at("setup-card-title")).toBeLessThan(at("home-insights"));

  // "Ver" de tela: registra e abre o fluxo dono (Relacionamento, para os lembretes).
  await items.first().getByRole("button", { name: /^Ver/ }).click();
  await expect(page).toHaveURL(/\/app\/relacionamento$/);

  // De volta à Hoje, a seguinte por prioridade. "Ver" de proposta abre a sugestão destacada em Metas e sugestões.
  await page.getByRole("link", { name: "Hoje" }).first().click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Horário vazio toda semana: sábado das 9h às 14h");
  await expect(items.first()).toContainText("Vazia em 5 de 5 semanas, de 14/09 a 18/10.");
  await items.first().getByRole("link", { name: /^Ver/ }).click();
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
  // O que a conta olhou: insuficiente ≠ zero, com o motivo.
  await page.getByText("O que a conta olhou").click();
  await expect(page.getByRole("list", { name: "Regras e dados" })).toContainText("Clientes sem retorno: ainda sem dado suficiente (não é zero) (menos de 5 clientes que voltaram 2 vezes ou mais)");
  // Sem nome cru de campo ou de regra na tela.
  const body = await page.locator("main").innerText();
  for (const raw of ["idle_slot", "no_show_concentration", "uncharged_bookings", "numerator", "denominator", "P05", "P13"]) expect(body).not.toContain(raw);

  // "Agora não": sai da Home por 30 dias.
  await page.getByRole("link", { name: "Hoje" }).first().click();
  await expect(items.first()).toContainText("3 de 4 itens do perfil prontos (hoje, 20/10).");
  await items.first().getByRole("button", { name: /^Agora não/ }).click();
  await expect(page.getByText("“Perfil incompleto” silenciada por 30 dias.")).toBeVisible();
  await expect(card).not.toContainText("3 de 4 itens do perfil prontos");

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
