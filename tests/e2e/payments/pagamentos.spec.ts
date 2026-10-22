import { expect, type Page, test } from "@playwright/test";

const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

/** Navegação sem recarregar: a demonstração vive na memória da aba (o link público é lido pelo fragmento). */
const openLink = async (page: Page, url: string) => {
  const u = new URL(url);
  await soft(page, u.pathname + u.hash);
};
const pick = async (page: Page, text: string) => {
  const select = page.getByRole("form", { name: "Cobrar pelo provedor" }).getByLabel("Recebível em aberto");
  const value = await select.locator("option", { hasText: text }).getAttribute("value");
  await select.selectOption(value!);
};

/** Gera a cobrança simulada do recebível selecionado e devolve o link público. */
async function chargeFirst(page: Page) {
  const form = page.getByRole("form", { name: "Cobrar pelo provedor" });
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText(/Cobrança de R\$\s[\d.,]+ criada/)).toBeVisible();
  const link = page.getByRole("link", { name: /\/pagar#t=/ });
  return (await link.getAttribute("href"))!;
}

test("pagamentos: cobrança Pix pelo provedor simulado, cliente paga pelo link, baixa única, estorno vinculado", async ({ page }) => {
  await page.goto("/app/pagamentos");
  await expect(page.getByRole("heading", { name: "Pagamentos", level: 1 })).toBeVisible();
  await expect(page.getByText("nenhum dinheiro existe")).toBeVisible();
  await expect(page.getByText("Nenhuma cobrança ainda")).toBeVisible();

  // PSP real sem credenciais: recusa explícita.
  const form = page.getByRole("form", { name: "Cobrar pelo provedor" });
  await form.getByLabel("Provedor").selectOption("psp");
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText(/não respondeu ou não está configurado/)).toBeVisible();
  await form.getByLabel("Provedor").selectOption("simulated");
  const url = await chargeFirst(page);
  const list = page.getByRole("region", { name: "Cobranças" });
  await expect(list).toContainText("Aguardando pagamento");
  await expect(list.getByLabel("Pix copia e cola")).toContainText("SIMULADO");
  // Mesmo recebível: uma cobrança viva só.
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText("Já existe uma cobrança aguardando pagamento")).toBeVisible();

  // A cliente abre o link e paga (simulação): o provedor confirma pelo webhook.
  await openLink(page, url);
  await expect(page.getByRole("heading", { name: /Pagar Barbearia do Léo/ })).toBeVisible();
  await expect(page.getByText("R$ 60,00")).toBeVisible();
  await expect(page.getByText("Nenhum dinheiro é movimentado")).toBeVisible();
  await page.getByRole("group", { name: "Simular o pagamento" }).getByRole("button", { name: "Pagar (simulação)" }).click();
  await expect(page.getByText("Pagamento simulado confirmado pelo provedor.")).toBeVisible();
  await expect(page.getByText("Pago (confirmado pelo provedor)")).toBeVisible();
  await expect(page.getByRole("group", { name: "Simular o pagamento" })).toHaveCount(0);

  // De volta ao negócio: paga uma vez, recebível saiu dos abertos; estorno total vinculado.
  await soft(page, "/app/pagamentos");
  await expect(list).toContainText("Pago (confirmado pelo provedor)");
  await expect(form.getByLabel("Recebível em aberto")).not.toContainText("Corte · Ana Beatriz");
  const refund = list.getByRole("form", { name: /Estornar Corte/ });
  await refund.getByLabel("Motivo do estorno").fill("Cliente desistiu");
  await refund.getByRole("button", { name: "Estornar tudo" }).click();
  await expect(page.getByText(/Estorno de R\$\s60,00 confirmado pelo provedor/)).toBeVisible();
  await expect(list).toContainText("Estornado");
  await expect(form.getByLabel("Recebível em aberto")).toContainText("Corte · Ana Beatriz");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("pagamentos: aviso perdido aparece na conciliação e a consulta resolve; sem resposta não é presumido", async ({ page }) => {
  await page.goto("/app/pagamentos");
  const form = page.getByRole("form", { name: "Cobrar pelo provedor" });
  await pick(page, "Barba");
  const url = await chargeFirst(page);
  await openLink(page, url);
  await page.getByLabel("Simular aviso do provedor perdido").check();
  await page.getByRole("button", { name: "Pagar (simulação)" }).click();
  await expect(page.getByText(/o aviso "se perdeu"/)).toBeVisible();
  await expect(page.getByText("Aguardando pagamento")).toBeVisible();

  await soft(page, "/app/pagamentos");
  const list = page.getByRole("region", { name: "Cobranças" });
  await expect(list).toContainText("Aguardando pagamento");
  const rec = page.getByRole("form", { name: "Conciliar o dia" });
  await rec.getByLabel("Dia").fill("2026-10-20");
  await rec.getByRole("button", { name: "Conciliar com o provedor" }).click();
  await expect(page.getByText(/1 diferença\(s\) listada\(s\)/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Conciliações" })).toContainText("O provedor diz pago, mas não há recebimento no caixa");
  // A cobrança ainda não venceu: consultar não muda nada. (Na demonstração, vence em 1 h.)
  await page.getByRole("button", { name: "Consultar o provedor (simulação)" }).click();
  await expect(page.getByText(/0 consultada\(s\)/)).toBeVisible();

  // Sem resposta do provedor (valor terminado em 98): desconhecido, nunca presumido.
  await pick(page, "pomada");
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText("O provedor não respondeu. A cobrança NÃO foi presumida criada")).toBeVisible();
  await expect(list).toContainText("Sem resposta do provedor (consultando)");
  await expect(list).toContainText("Sem resposta do provedor: 1");
  await page.getByRole("button", { name: "Consultar o provedor (simulação)" }).click();
  await expect(page.getByText(/1 consultada\(s\), 0 paga\(s\), 1 encerrada\(s\)/)).toBeVisible();
  await expect(list).toContainText("Falhou");
  await expect(list).toContainText("Sem resposta do provedor: 0");
});
