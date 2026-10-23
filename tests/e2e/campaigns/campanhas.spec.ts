import { expect, test } from "@playwright/test";

test("campanhas: público autorizado, aprovação com controle sorteado e tetos, resultado por braço com intervalo, sem efeito presumido, cancelar", async ({ page }) => {
  await page.goto("/app/campanhas");
  await expect(page.getByRole("heading", { name: "Campanhas", level: 1 })).toBeVisible();
  await expect(page.getByText("Medição honesta.")).toBeVisible();
  await expect(page.getByText("nada é enviado")).toBeVisible();
  const form = page.getByRole("form", { name: "Nova campanha" });
  await expect(form.getByText(/Público autorizado agora: 6 cliente\(s\)/)).toBeVisible();
  await form.getByRole("combobox", { name: "Segmento" }).selectOption("marketing_all");
  await expect(form.getByText(/Público autorizado agora: 8 cliente\(s\)/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Aprovar campanha" })).toBeDisabled();
  await form.getByLabel("Nome").fill("Volta pro corte");
  await form.getByLabel("Grupo de controle (%)").fill("50");
  await form.getByLabel("Teto de envios").fill("3");
  await form.getByRole("combobox", { name: "Oferta", exact: true }).selectOption("discount_pct");
  await form.getByLabel("Desconto (%)").fill("10");
  await form.getByRole("button", { name: "Aprovar campanha" }).click();
  await expect(page.getByText(/Campanha “Volta pro corte” aprovada: 3 cliente\(s\) recebem a oferta, 4 no grupo de controle\. Janela de 14 dias; com grupo de controle sorteado\./)).toBeVisible();
  const list = page.getByRole("list", { name: "Campanhas" });
  await expect(list).toContainText("Em curso · todas com consentimento de marketing · 10% de desconto · público 8: 3 recebem, 4 controle · teto 3 envios");
  await expect(list).toContainText("Resultado parcial");
  await expect(list).toContainText("Inconclusivo: grupos pequenos demais para comparar.");
  // Quem entrou saiu do público da próxima campanha.
  await expect(page.getByRole("form", { name: "Nova campanha" }).getByText(/Público autorizado agora: 1 cliente\(s\)/)).toBeVisible();

  await list.getByRole("button", { name: "Ver participantes" }).click();
  const members = list.getByRole("list", { name: "Participantes de Volta pro corte" });
  await expect(members.getByRole("listitem")).toHaveCount(7);
  await expect(members).toContainText("recebe a oferta · passo manual · não agendou");
  await expect(members).toContainText("controle · não agendou");

  await list.getByRole("button", { name: "Simular janela (demonstração)" }).click();
  await expect(page.getByText("Simulação: parte das clientes agendou e a janela fechou pelo worker.")).toBeVisible();
  await expect(list).toContainText("Encerrada");
  await expect(list).toContainText("Resultado final");
  await expect(list).toContainText(/Receberam a oferta: \d de 3 agendaram \(\d+%; intervalo \d+% a \d+%\)/);
  await expect(list).toContainText(/Grupo de controle: \d de 4 agendaram/);
  await expect(list).not.toContainText(/efeito da campanha foi|causou/);

  // Segunda campanha sem controle: só observação; cancelar para o pendente.
  const form2 = page.getByRole("form", { name: "Nova campanha" });
  await form2.getByRole("combobox", { name: "Segmento" }).selectOption("marketing_all");
  await form2.getByLabel("Nome").fill("Só observação");
  await form2.getByLabel("Grupo de controle (%)").fill("0");
  await form2.getByRole("button", { name: "Aprovar campanha" }).click();
  await expect(page.getByText(/“Só observação” aprovada: .* 0 no grupo de controle.*sem grupo de controle \(observação\)/)).toBeVisible();
  await expect(list).toContainText("Só observação: sem grupo de controle, o resultado não mede efeito da campanha.");
  await list.getByRole("button", { name: "Cancelar campanha" }).click();
  await expect(page.getByText("Campanha cancelada: o que ainda não saiu parou")).toBeVisible();
  await expect(list).toContainText("Cancelada");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
