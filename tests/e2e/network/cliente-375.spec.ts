import { expect, type Page, test } from "@playwright/test";

// P55 · Páginas do cliente final em 375 px (celular pequeno): o negócio primeiro (D18), a Tinindo só no rodapé, nenhuma
// rolagem horizontal e "não encontrado" sempre com saída. Demonstração offline: o perfil vive na aba.
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

const soft = (page: Page, to: string) =>
  page.evaluate((href) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);

test("375 px: perfil com o negócio no topo, reserva na primeira tela e rodapé da Tinindo", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-375");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-375$/);

  const name = page.getByRole("heading", { name: "Barbearia Exemplo A", level: 1 });
  await expect(name).toBeVisible();
  // Sem foto: a inicial ocupa o lugar dela.
  await expect(page.locator(".tn-pub-avatar")).toHaveText("B");
  const step = page.getByRole("heading", { name: "Escolha o serviço" });
  await expect(step).toBeVisible();
  expect((await step.boundingBox())!.y).toBeLessThan(812);
  await expect(page.locator("footer.tn-pub-foot")).toContainText("Página feita com a Tinindo");
  await noHorizontalScroll(page);

  // Do passo 2 em diante o cabeçalho recolhe e o resto da página sai da frente.
  await page.getByRole("button", { name: "Escolher dia e hora" }).click();
  await expect(page.locator(".tn-pub-head[data-compact]")).toBeVisible();
  await expect(page.getByRole("list", { name: "Reputação" })).toHaveCount(0);
  await noHorizontalScroll(page);
});

test("375 px: links sem token válido mostram 'não encontrado' com saída", async ({ page }) => {
  await page.goto("/p/nao-existe-375");
  await expect(page.getByRole("heading", { name: "Perfil não encontrado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await noHorizontalScroll(page);

  for (const [path, title] of [
    ["/pagar", "Este link de pagamento não vale mais"],
    ["/orcamento", "Este orçamento não está mais disponível"],
  ] as const) {
    await soft(page, path);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    await expect(page.locator("footer.tn-pub-foot")).toContainText("Página feita com a Tinindo");
    await noHorizontalScroll(page);
  }
});

// P55 parte 2, itens 5 e 6: vitrine do perfil e reserva inteira com toque em 375 px.
test("375 px com toque: vitrine (local, horário, política, avaliações) e reserva até a confirmação", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-toque");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).tap();
  await page.getByRole("heading", { name: "Onde, quando e cancelamento", level: 2 }).tap();
  const form = page.getByRole("form", { name: "Endereço, horário e política" });
  await form.getByText("Em domicílio").tap();
  await form.getByLabel(/Horário de funcionamento/).fill("Ter a sáb, 9h às 19h");
  await form.getByLabel("Política de cancelamento (opcional)").fill("Cancele com 2 horas.");
  await form.getByRole("button", { name: "Salvar" }).tap();
  await expect(page.getByText("Endereço, horário e política salvos.")).toBeVisible();
  await page.getByRole("link", { name: "Abrir perfil público" }).tap();

  const facts = page.getByRole("list", { name: "Informações" });
  await expect(facts).toContainText("Atende em domicílio");
  await expect(facts).toContainText("Ter a sáb, 9h às 19h");
  await expect(page.getByText("Cancelamento: Cancele com 2 horas.")).toBeVisible();
  // Avaliações em destaque, lidas da lista pública do módulo Avaliações (demonstração: as de exemplo).
  const highlights = page.getByRole("region", { name: "O que os clientes dizem" });
  await expect(highlights).toBeVisible();
  await expect(highlights.getByRole("listitem").first()).toContainText("atendimento verificado");
  const all = highlights.getByRole("link", { name: /^Ver a/ });
  expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // O selo de avaliações e os destaques contam o mesmo número.
  const count = /Ver as (\d+) avaliações/.exec((await all.textContent()) ?? "")?.[1];
  if (count) await expect(page.getByRole("list", { name: "Reputação" })).toContainText(`${count} avaliações de clientes`);
  // Serviço com duração (e "a partir de" quando o dono liga os preços).
  await expect(page.getByRole("radio", { name: /min/ }).first()).toBeAttached();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Escolher dia e hora" }).tap();
  await page.getByRole("list", { name: "Horários livres" }).getByRole("button").first().tap();
  await page.getByLabel("Seu nome").fill("Cliente Toque");
  await page.getByLabel("WhatsApp com DDD").fill("11977770375");
  await page.getByLabel("Bairro do atendimento").fill("Moema");
  await page.getByRole("button", { name: "Pedir este horário" }).tap();
  const code = /O código seria (\d{6})/.exec((await page.getByText(/nenhuma mensagem é enviada/).textContent()) ?? "")![1]!;
  await page.getByLabel("Código recebido").fill(code);
  await page.getByRole("button", { name: "Confirmar horário" }).tap();
  await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();
  await noHorizontalScroll(page);
});
