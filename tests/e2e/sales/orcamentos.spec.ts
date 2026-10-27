import { expect, type Page, test } from "@playwright/test";

const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

test("orçamento: rascunho, link, nova versão, aceite da versão vista com horário e aceito ≠ pago", async ({ page }) => {
  await page.goto("/app/orcamentos");
  await expect(page.getByRole("heading", { name: "Orçamentos", level: 1 })).toBeVisible();
  await expect(page.getByText("Aceito não é pago", { exact: false }).first()).toBeVisible();
  // Lista primeiro: o formulário só abre pelo botão.
  await expect(page.getByRole("form", { name: "Novo orçamento" })).toHaveCount(0);
  await page.getByRole("button", { name: "Novo orçamento" }).click();

  const form = page.getByRole("form", { name: "Novo orçamento" });
  await form.getByLabel("Cliente", { exact: true }).selectOption({ label: "Cliente Exemplo Ana" });
  await form.getByLabel("Título").fill("Corte e barba");
  await form.getByRole("group", { name: "Item 1" }).getByLabel("Serviço").selectOption({ label: "Corte" });
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await form.getByRole("group", { name: "Item 2" }).getByLabel("Serviço").selectOption({ label: "Barba" });
  await expect(form.getByText(/Total: R\$\s100,00/)).toBeVisible();
  await form.getByLabel("Propor um horário").check();
  await form.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho salvo")).toBeVisible();
  await expect(form).toHaveCount(0);

  const list = page.getByRole("region", { name: "Seus orçamentos" });
  await expect(list).toContainText("Corte e barba");
  await expect(list).toContainText("Rascunho");
  await expect(list).toContainText("Horário proposto");
  await list.getByRole("button", { name: "Gerar link" }).click();
  const share = page.getByRole("region", { name: "Link do orçamento" });
  await expect(share).toContainText("A Tinindo não envia mensagens");
  const link = (await share.locator("code").textContent()) ?? "";
  expect(link).toMatch(/\/orcamento#t=[A-Za-z0-9_-]{43}$/);
  // Enviar pelo WhatsApp: wa.me com mensagem pronta que leva o link (sem telefone na base: wa.me/?text=).
  const wa = share.getByRole("link", { name: "Enviar pelo WhatsApp" });
  const waHref = (await wa.getAttribute("href")) ?? "";
  expect(waHref).toMatch(/^https:\/\/wa\.me\/(\d+)?\?text=/);
  expect(new URL(waHref).searchParams.get("text")).toContain(link);
  // Copiar dá retorno visível (clipboard simulado no navegador de teste).
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }));
  await share.getByRole("button", { name: "Copiar link" }).click();
  await expect(share.getByRole("status")).toHaveText("Copiado ✓");
  await expect(list).toContainText("Enviado, aguardando o cliente");

  // Nova versão depois de enviado: barba por R$35.
  await list.getByRole("button", { name: "Revisar" }).click();
  const revise = page.getByRole("form", { name: /Revisar orçamento/ });
  await revise.getByRole("group", { name: "Item 2" }).getByLabel("Valor (R$)").fill("35");
  await revise.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(page.getByText("Versão 2 salva")).toBeVisible();
  await expect(list).toContainText("versão 2");

  // O cliente abre o link: vê a versão 2; abrir não aceita; o token sai da URL.
  await soft(page, new URL(link).pathname + new URL(link).hash);
  await expect(page.getByRole("heading", { name: "Orçamento", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/orcamento$/);
  await expect(page.getByText(/Versão 2 · código/)).toBeVisible();
  await expect(page.getByRole("table")).toContainText(/R\$\s95,00/);
  await expect(page.getByText("Abrir esta página não aceita nada")).toBeVisible();
  await page.getByRole("button", { name: "Aceitar orçamento" }).click();
  await expect(page.getByText(/Orçamento aceito\. Horário reservado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar orçamento" })).toHaveCount(0);

  await soft(page, "/app/orcamentos");
  const after = page.getByRole("region", { name: "Seus orçamentos" });
  await expect(after).toContainText("Aceito");
  await expect(after).toContainText("Horário reservado na agenda");
  await expect(after).toContainText("registre a cobrança no Caixa");
  await after.getByRole("button", { name: "Ver versões" }).click();
  const versions = page.getByRole("region", { name: /Versões de/ });
  await expect(versions).toContainText("Aceito pelo cliente na versão 2");
  await expect(versions).toContainText("Versão 1");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("orçamento: formulário explica o que falta e não grava", async ({ page }) => {
  await page.goto("/app/orcamentos");
  await page.getByRole("button", { name: "Novo orçamento" }).click();
  const form = page.getByRole("form", { name: "Novo orçamento" });
  await form.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(form.getByText("Dê um título ao orçamento.")).toBeVisible();
  await form.getByLabel("Título").fill("Avulso");
  await form.getByLabel("Descrição").fill("Hidratação");
  await form.getByLabel("Valor (R$)").fill("12,345");
  await form.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(form.getByText(/valor inválido/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Seus orçamentos" })).toContainText("Nenhum orçamento ainda");
  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo orçamento" })).toBeVisible();
});

test("link de orçamento desconhecido não aceita nada", async ({ page }) => {
  await page.goto(`/orcamento#t=${"x".repeat(43)}`);
  await expect(page.getByText(/não é válido/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar orçamento" })).toHaveCount(0);
});
