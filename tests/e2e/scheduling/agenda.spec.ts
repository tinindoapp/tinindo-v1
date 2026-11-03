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
  // Avisos numa linha só: dados de exemplo e o fuso (o navegador está em Tóquio, o negócio em São Paulo).
  await expect(page.getByText(/As mudanças valem só nesta aba/)).toContainText("Horários de Brasília (UTC−03:00)");
  await expect(page.getByText(/\d+% ocupado/)).toBeVisible();
  // Detalhes recolhidos: aparecem ao abrir "Ver números do dia".
  await expect(page.getByText(/confirmados?: .* de 9 h livres para agendar/i)).toBeHidden();
  await page.getByText("Ver números do dia").click();
  await expect(page.getByText(/Confirmados: .* de 9 h livres para agendar/)).toBeVisible();
  await noHorizontalScroll(page);

  // Segmented: a pessoa toca no rótulo (a pílula); o rádio nativo fica por baixo.
  await page.getByRole("group", { name: "Visualização" }).locator("label").filter({ hasText: "Semana" }).click();
  await expect(page.getByRole("radio", { name: "Semana" })).toBeChecked();
  await expect(page.getByRole("heading", { name: /Semana de/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /quinta-feira, 22 de outubro/ })).toContainText("1 atendimento");
  await noHorizontalScroll(page);
});

test("cria, reagenda e cancela um atendimento", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: "Novo agendamento" }).click();
  await page.getByRole("radio", { name: /Barba/ }).check();
  await page.getByRole("button", { name: "Próximo dia" }).click(); // quarta, 21/10
  await page.getByRole("button", { name: "10:30", exact: true }).click();
  await page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: "Cliente Exemplo Bruno" }).check();
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
  await page.getByRole("button", { name: "Sim, cancelar" }).click();
  await expect(page.getByText("Atendimento cancelado. O horário voltou a ficar livre.")).toBeVisible();
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /Voltar para a agenda/ }).click();
  await expect(page.getByRole("heading", { name: /quarta-feira, 21 de outubro/ })).toBeVisible();
  await expect(page.getByRole("list", { name: /Linha do tempo/ })).toContainText("Cancelado");
});

test("conflito 409 é explicado e o horário ocupado some da lista", async ({ page }) => {
  await page.goto("/app/agenda/novo?data=2026-10-20&simular=conflito");
  await page.getByRole("button", { name: "15:45" }).click();
  await page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: "Cliente Exemplo Ana" }).check();
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
  // Dia/Semana é escolha única (Segmented): a pílula de 36 px fica num trilho de 44 px, que é o alvo de toque.
  const track = await page.getByRole("group", { name: "Visualização" }).locator(".tn-segmented__track").boundingBox();
  expect(track?.height ?? 0).toBeGreaterThanOrEqual(44);
  for (const name of ["Hoje", "Dia anterior", "Próximo dia"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
  }
  const link = await page.getByRole("link", { name: "Novo agendamento" }).boundingBox();
  expect(link?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("celular: o primeiro atendimento do dia aparece sem rolar e o botão flutuante não o cobre", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/agenda");
  const first = page.getByRole("list", { name: /Linha do tempo/ }).getByRole("listitem").first();
  await expect(first).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const box = (await first.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(812);
  const fab = await page.getByRole("link", { name: "Novo agendamento" }).boundingBox();
  if (fab && (await page.getByRole("link", { name: "Novo agendamento" }).evaluate((el) => getComputedStyle(el).position)) === "fixed") {
    // O botão redondo fica no canto do cartão; nada que se lê ou se toca no cartão fica embaixo dele.
    const parts = first.locator(".tn-sched-time, .tn-sched-item__title, .tn-sched-badge, button");
    for (let i = 0; i < (await parts.count()); i++) {
      const p = (await parts.nth(i).boundingBox())!;
      const overlaps = p.y < fab.y + fab.height && fab.y < p.y + p.height && p.x < fab.x + fab.width && fab.x < p.x + p.width;
      expect(overlaps, await parts.nth(i).innerText()).toBe(false);
    }
  }
  // No fim da página, o último item fica acima do botão flutuante (folga embaixo).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = await page.getByRole("list", { name: /Linha do tempo/ }).getByRole("listitem").last().boundingBox();
  if (fab && last) expect(last.y + last.height).toBeLessThanOrEqual(fab.y);
});

test("novo agendamento: cliente primeiro, busca, + Novo e barra de resumo que não cobre nada", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app/agenda/novo?data=2026-10-20");
  const customer = page.getByRole("group", { name: "Cliente" });
  await expect(customer).toBeVisible();
  // Ordem: Cliente → Serviço → Dia e horário.
  const y = async (name: string) => (await page.getByRole("group", { name, exact: true }).boundingBox())!.y;
  expect(await y("Cliente")).toBeLessThan(await y("Serviço"));
  expect(await y("Serviço")).toBeLessThan(await y("Dia e horário"));

  await customer.getByLabel("Buscar cliente").fill("Dona Rosa");
  await expect(customer).toContainText("Nenhum cliente com “Dona Rosa”");
  await customer.getByRole("button", { name: "+ Novo cliente" }).click();
  const form = customer.getByRole("form", { name: "Novo cliente" });
  await expect(form.getByLabel("Nome")).toHaveValue("Dona Rosa");
  await form.getByLabel("WhatsApp").fill("(11) 97777-1212");
  await form.getByRole("button", { name: "Cadastrar e escolher" }).click();
  await expect(customer.getByRole("radio", { name: /Dona Rosa/ })).toBeChecked();

  await page.getByRole("radio", { name: /Corte/ }).check();
  await page.getByRole("button", { name: "13:00", exact: true }).click();
  const bar = page.getByRole("region", { name: "Resumo do agendamento" });
  await expect(bar).toContainText(/Corte · 13:00 · R\$\s51,00/);

  // Presa ao pé enquanto rola, acima da barra de abas do celular; no fim da página volta ao lugar, depois da revisão.
  const tabbar = page.getByRole("navigation", { name: "Abas" });
  if (await tabbar.isVisible()) {
    const b = (await bar.boundingBox())!;
    const t = (await tabbar.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(t.y);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const policy = (await page.getByText(/Política de cancelamento/).boundingBox())!;
  const end = (await bar.boundingBox())!;
  expect(policy.y + policy.height).toBeLessThanOrEqual(end.y);
  await noHorizontalScroll(page);

  await bar.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByText("Agendamento confirmado.")).toBeVisible();
  await expect(page.getByText("Dona Rosa")).toBeVisible();
});

test("novo agendamento sem cadastro: o atendimento fica sem cliente vinculado", async ({ page }) => {
  await page.goto("/app/agenda/novo?data=2026-10-21");
  await page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: /Sem cadastro/ }).check();
  await page.getByRole("button", { name: "10:30", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByText("Agendamento confirmado.")).toBeVisible();
  await expect(page.getByText("Sem cliente cadastrado")).toBeVisible();
});

test("semana: \"Seg 19\" numa linha, contagem à direita com seta, Hoje e Livre", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/agenda?visao=semana&data=2026-10-20");
  const today = page.getByRole("button", { name: /terça-feira, 20 de outubro/ });
  await expect(today).toContainText("Ter 20");
  await expect(today).toContainText("Hoje");
  const day = (await today.locator(".tn-sched-weekday__day").boundingBox())!;
  const side = (await today.locator(".tn-sched-weekday__side").boundingBox())!;
  // Uma linha só (sem quebra) e a contagem à direita, na mesma altura.
  expect(day.height).toBeLessThan(32);
  expect(side.x).toBeGreaterThan(day.x + day.width);
  await expect(page.getByRole("button", { name: /sexta-feira, 23 de outubro/ })).toContainText("Livre");
  await expect(page.getByRole("button", { name: /domingo, 25 de outubro/ })).toContainText("Fechado");
  await noHorizontalScroll(page);
});
