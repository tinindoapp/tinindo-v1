import { expect, type Page, test } from "@playwright/test";

const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

test("serviço assistido: escopo aceito, acesso concedido pelo dono, minutos com teto, entrega aprovada e leitura registrada", async ({ page }) => {
  await page.goto("/app/servicos-tinindo");
  await expect(page.getByRole("heading", { name: "Plano e serviços", level: 1 })).toBeVisible();
  await expect(page.getByText("não é pagamento")).toBeVisible();
  const plan = page.getByRole("region", { name: "Seu plano" });
  await expect(plan).toContainText("Grátis");
  await plan.getByRole("button", { name: "Escolher Completo (fundador)" }).click();
  await expect(page.getByText("Plano alterado para Completo (fundador)")).toBeVisible();
  await expect(plan).toContainText(/R\$\s79,00\/mês/);

  const request = page.getByRole("form", { name: "Pedir Implantação assistida (exemplo)" });
  // Botão sempre ativo: sem aceitar o escopo, avisa embaixo da caixa e não pede.
  await request.getByRole("button", { name: "Pedir este serviço" }).click();
  await expect(request.getByText("Marque que leu e aceita o escopo para pedir.")).toBeVisible();
  await expect(request.getByLabel(/Li e aceito este escopo/)).toBeFocused();
  await request.getByLabel(/Li e aceito este escopo/).check();
  await request.getByRole("button", { name: "Pedir este serviço" }).click();
  await expect(page.getByText(/Pedido de “Implantação assistida \(exemplo\)” registrado/)).toBeVisible();

  // Operadora assume; sem acesso concedido não começa.
  await soft(page, "/app/servicos-tinindo/operacao");
  await expect(page.getByRole("heading", { name: "Operação Tinindo", level: 1 })).toBeVisible();
  const queue = page.getByRole("region", { name: "Fila" });
  await queue.getByRole("button", { name: "Assumir" }).click();
  await expect(queue).toContainText("Sem acesso concedido");
  await queue.getByRole("button", { name: "Começar" }).click();
  await expect(page.getByText("Sem acesso concedido pelo cliente: não dá para começar.")).toBeVisible();

  // Dono concede acesso só ao catálogo, por 7 dias.
  await soft(page, "/app/servicos-tinindo");
  const orders = page.getByRole("region", { name: "Seus pedidos" });
  await expect(orders).toContainText("Aguardando seu acesso");
  const grant = orders.getByRole("form", { name: "Conceder acesso" });
  await grant.getByLabel("Para quê").fill("Cadastrar serviços e preços");
  await grant.getByRole("button", { name: "Conceder acesso" }).click();
  await expect(page.getByText(/Acesso concedido a Operadora Tinindo \(exemplo\) por 7 dias/)).toBeVisible();

  // Operadora começa, lê o que foi concedido, registra minutos (teto de 120) e entrega.
  await soft(page, "/app/servicos-tinindo/operacao");
  await queue.getByRole("button", { name: "Começar" }).click();
  await expect(queue).toContainText("Em execução");
  await queue.getByRole("button", { name: "Ver dados concedidos" }).click();
  await expect(queue.getByRole("group", { name: "Dados concedidos" })).toContainText("Serviços: Corte");
  await expect(queue.getByRole("group", { name: "Dados concedidos" })).not.toContainText("Clientes");
  const work = queue.getByRole("form", { name: "Registrar minutos" });
  await work.getByLabel("Minutos").fill("100");
  await work.getByRole("button", { name: "Registrar minutos" }).click();
  await expect(queue).toContainText("100 de 120 min medidos");
  await work.getByLabel("Minutos").fill("30");
  await work.getByRole("button", { name: "Registrar minutos" }).click();
  await expect(page.getByText("Isso passa da franquia de minutos do pedido. Nada foi registrado.")).toBeVisible();
  await expect(queue).toContainText("100 de 120 min medidos");
  const deliver = queue.getByRole("form", { name: "Enviar entrega" });
  await deliver.getByLabel("Título da entrega").fill("Cadastro inicial");
  await deliver.getByLabel(/Evidência/).fill("Serviços e horários cadastrados");
  await deliver.getByRole("button", { name: "Enviar entrega" }).click();
  await expect(queue).toContainText("Aguardando sua revisão");

  // Dono aprova: entregue e acesso encerrado; o registro mostra a leitura.
  await soft(page, "/app/servicos-tinindo");
  await orders.getByRole("group", { name: "Entrega para revisar" }).getByRole("button", { name: "Aprovar entrega" }).click();
  await expect(page.getByText("Entrega aprovada. O acesso da equipe foi encerrado.")).toBeVisible();
  await expect(orders).toContainText("Entregue");
  await expect(orders.getByRole("list", { name: "Acessos concedidos" })).toContainText("encerrado");
  const log = page.getByRole("region", { name: "Registro de acesso" });
  await expect(log).toContainText("Operadora Tinindo (exemplo): Leitura com acesso delegado (Serviços e preços)");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
