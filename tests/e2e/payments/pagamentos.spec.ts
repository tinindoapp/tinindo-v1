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
  const select = page.getByRole("form", { name: "Cobrar por Pix" }).getByLabel("Quem está devendo");
  const value = await select.locator("option", { hasText: text }).getAttribute("value");
  await select.selectOption(value!);
};

/** Gera a cobrança simulada do recebível selecionado e devolve o link público. */
async function chargeFirst(page: Page) {
  const form = page.getByRole("form", { name: "Cobrar por Pix" });
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText(/Cobrança de R\$\s[\d.,]+ criada/)).toBeVisible();
  const code = page.getByRole("group", { name: "Enviar a cobrança" }).getByLabel("Link de pagamento");
  return (await code.textContent())!;
}

test("pagamentos: cobrança Pix pelo provedor simulado, cliente paga pelo link, baixa única, estorno vinculado", async ({ page }) => {
  await page.goto("/app/pagamentos");
  await expect(page.getByRole("heading", { name: "Pagamentos", level: 1 })).toBeVisible();
  await expect(page.getByText("nenhum dinheiro existe")).toBeVisible();
  await expect(page.getByText("Nenhuma cobrança ainda")).toBeVisible();

  // Pix de verdade sem credenciais: recusa explícita.
  const form = page.getByRole("form", { name: "Cobrar por Pix" });
  await expect(form.getByLabel("Como receber")).toContainText("Recebimento simulado (demonstração)");
  await form.getByLabel("Como receber").selectOption("psp");
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText(/O banco não respondeu ou o Pix de verdade ainda não está ligado/)).toBeVisible();
  await form.getByLabel("Como receber").selectOption("simulated");
  const url = await chargeFirst(page);
  expect(url).toMatch(/\/pagar#t=[A-Za-z0-9_-]{43}$/);
  const list = page.getByRole("region", { name: "Cobranças" });
  await expect(list).toContainText("Aguardando pagamento");
  await expect(list.getByLabel("Pix copia e cola")).toContainText("SIMULADO");
  // Mesmo recebível: uma cobrança viva só.
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText("Já existe uma cobrança aguardando pagamento")).toBeVisible();

  // Copiar Pix (primário, 44 px), WhatsApp com mensagem pronta e o valor, copiar link.
  const share = page.getByRole("group", { name: "Enviar a cobrança" });
  const copy = share.getByRole("button", { name: "Copiar Pix" });
  expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const wa = share.getByRole("link", { name: "Enviar pelo WhatsApp" });
  const href = (await wa.getAttribute("href"))!;
  expect(href.startsWith("https://wa.me/?text=")).toBe(true);
  expect(decodeURIComponent(href.split("text=")[1]!).replace(/\s/g, " ")).toBe(`Oi, Ana! Segue o Pix de Corte de R$ 60,00: ${url}`);
  await expect(share.getByRole("button", { name: "Copiar link" })).toBeVisible();
  await expect(share.getByText("Abrir o WhatsApp não confirma que a cliente recebeu")).toBeVisible();

  // A cliente abre o link (mesma aba, pelo próprio link da tela) e paga (simulação): o banco confirma pelo webhook.
  await share.getByRole("link", { name: "Abrir o link como a cliente" }).click();
  await expect(page).toHaveURL(/\/pagar$/);
  await expect(page.getByRole("heading", { name: /Pagar Barbearia do Léo/ })).toBeVisible();
  await expect(page.getByText("R$ 60,00", { exact: true })).toBeVisible();
  await expect(page.getByText("Nenhum dinheiro é movimentado")).toBeVisible();
  await page.getByRole("group", { name: "Simular o pagamento" }).getByRole("button", { name: "Pagar (simulação)" }).click();
  await expect(page.getByText("Pagamento simulado confirmado pelo banco.")).toBeVisible();
  await expect(page.getByText("Pago (confirmado pelo banco)")).toBeVisible();
  await expect(page.getByRole("group", { name: "Simular o pagamento" })).toHaveCount(0);

  // De volta ao negócio: paga uma vez, recebível saiu dos abertos; estorno total vinculado.
  await soft(page, "/app/pagamentos");
  await expect(list).toContainText("Pago (confirmado pelo banco)");
  await expect(form.getByLabel("Quem está devendo")).not.toContainText("Corte · Ana");
  // Estorno mexe em dinheiro: pede confirmação com o valor e o motivo.
  await list.getByRole("button", { name: /Estornar tudo de Corte/ }).click();
  const refund = list.getByRole("group", { name: /Estornar R\$\s60,00 de Corte/ });
  await refund.getByRole("button", { name: "Sim, estornar" }).click();
  await expect(refund.getByText("Escreva o motivo do estorno.")).toBeVisible();
  await refund.getByLabel("Motivo do estorno").fill("Cliente desistiu");
  await refund.getByRole("button", { name: "Sim, estornar" }).click();
  await expect(page.getByText(/Estorno de R\$\s60,00 confirmado pelo banco/)).toBeVisible();
  await expect(list).toContainText("Estornado");
  await expect(form.getByLabel("Quem está devendo")).toContainText("Corte · Ana");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("pagamentos: aviso perdido aparece na conciliação e a consulta resolve; sem resposta não é presumido", async ({ page }) => {
  await page.goto("/app/pagamentos");
  const form = page.getByRole("form", { name: "Cobrar por Pix" });
  await pick(page, "Barba");
  const url = await chargeFirst(page);
  await openLink(page, url);
  await page.getByLabel("Simular aviso do banco perdido").check();
  await page.getByRole("button", { name: "Pagar (simulação)" }).click();
  await expect(page.getByText(/o aviso "se perdeu"/)).toBeVisible();
  await expect(page.getByText("Aguardando pagamento")).toBeVisible();

  await soft(page, "/app/pagamentos");
  const list = page.getByRole("region", { name: "Cobranças" });
  await expect(list).toContainText("Aguardando pagamento");
  await expect(page.getByRole("heading", { name: "Conferir com o extrato do dia" })).toBeVisible();
  const rec = page.getByRole("form", { name: "Conferir o dia" });
  await rec.getByLabel("Dia").fill("2026-10-20");
  await rec.getByRole("button", { name: "Conferir o dia" }).click();
  await expect(page.getByText(/Conferência de 20\/10\/2026: 1 diferença\(s\) listada\(s\)/)).toBeVisible();
  const recs = page.getByRole("list", { name: "Conferências" });
  await expect(recs).toContainText("O extrato diz pago, mas não há recebimento no caixa");
  await expect(recs).toContainText("20/10/2026");
  await expect(recs).not.toContainText("2026-10-20");
  // A cobrança ainda não venceu: consultar não muda nada. (Na demonstração, vence em 1 h.)
  await page.getByRole("button", { name: "Consultar o banco (simulação)" }).click();
  await expect(page.getByText(/0 consultada\(s\)/)).toBeVisible();

  // Sem resposta do provedor (valor terminado em 98): desconhecido, nunca presumido.
  await pick(page, "pomada");
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  await expect(page.getByText("O banco não respondeu. A cobrança NÃO foi presumida criada")).toBeVisible();
  await expect(list).toContainText("Sem resposta do banco (consultando)");
  await expect(list).toContainText("1 cobrança sem confirmação do banco");
  await page.getByRole("button", { name: "Consultar o banco (simulação)" }).click();
  await expect(page.getByText(/1 consultada\(s\), 0 paga\(s\), 1 encerrada\(s\)/)).toBeVisible();
  await expect(list).toContainText("Falhou");
  await expect(list).not.toContainText("sem confirmação do banco");
});

test("pagamentos: o link da cobrança abre mesmo recarregando a página; link desconhecido não culpa a cliente", async ({ page }) => {
  await page.goto("/app/pagamentos");
  await expect(page.getByText("Nenhuma cobrança ainda")).toBeVisible();
  await expect(page.getByRole("region", { name: "Cobranças" })).not.toContainText("sem confirmação do banco");
  const url = await chargeFirst(page);
  // Recarregar (colar o link na barra): a cobrança de exemplo está guardada na sessão desta aba.
  await page.goto(url);
  await expect(page.getByRole("heading", { name: /Pagar Barbearia do Léo/ })).toBeVisible();
  await expect(page.getByText("Este link não é válido")).toHaveCount(0);
  const copy = page.getByRole("button", { name: "Copiar Pix" });
  expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("Ver código")).toBeVisible();

  // Link desconhecido (outro documento: sai de /pagar antes, senão o navegador só troca o fragmento).
  await page.goto("/app");
  await page.goto(`/pagar#t=${"x".repeat(43)}`);
  await expect(page.getByText("Não encontramos esta cobrança. Ela pode ter sido paga, cancelada ou ter vencido. Peça um novo link a Barbearia do Léo (exemplo).")).toBeVisible();
});

test("pagamentos: Copiar Pix dá retorno 'Copiado ✓' e avisa quando não dá para copiar", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/app/pagamentos");
  await chargeFirst(page);
  const share = page.getByRole("group", { name: "Enviar a cobrança" });
  await share.getByRole("button", { name: "Copiar Pix" }).click();
  await expect(share.getByRole("button", { name: "Copiado ✓" })).toBeVisible();
  await expect(share.getByRole("status").filter({ hasText: "Pix copiado." })).toHaveCount(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("SIMULADO");

  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("negado")) } }));
  await share.getByRole("button", { name: "Copiar link" }).click();
  await expect(share.getByText(/Não deu para copiar/)).toBeVisible();
});
