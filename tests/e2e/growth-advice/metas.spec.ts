import { expect, test } from "@playwright/test";

test("metas e conteúdo: progresso com denominador, uma meta por indicador, sugestões por regra com evidência, acompanhamento observado, conteúdo só pelo escopo", async ({ page }) => {
  await page.goto("/app/metas");
  await expect(page.getByRole("heading", { name: "Metas e conteúdo", level: 1 })).toBeVisible();
  await expect(page.getByText("Sem inteligência artificial nas sugestões.")).toBeVisible();
  await expect(page.getByText("nada é publicado de verdade")).toBeVisible();

  // Meta de faltas: progresso é o indicador com denominador.
  const form = page.getByRole("form", { name: "Nova meta" });
  await expect(form.getByText("Agora: 15% (6 de 40).")).toBeVisible();
  await form.getByLabel("Meta (%)").fill("10");
  await form.getByRole("button", { name: "Criar meta" }).click();
  await expect(page.getByText(/Meta de Faltas criada: 10% \(quanto menor, melhor\)/)).toBeVisible();
  const goals = page.getByRole("list", { name: "Metas" });
  await expect(goals).toContainText("Faltas · meta 10%");
  await expect(goals).toContainText("Agora: 15% (6 de 40) · 67% do caminho");
  await expect(goals.getByRole("progressbar")).toHaveCount(1);
  // Segunda meta do mesmo indicador no mês é recusada.
  await page.getByRole("form", { name: "Nova meta" }).getByLabel("Meta (%)").fill("5");
  await page.getByRole("form", { name: "Nova meta" }).getByRole("button", { name: "Criar meta" }).click();
  await expect(page.getByText("Já existe uma meta ativa para este indicador neste mês.")).toBeVisible();
  // Indicador sem dado: insuficiente, não zero.
  const form3 = page.getByRole("form", { name: "Nova meta" });
  await form3.getByRole("combobox", { name: "Indicador" }).selectOption("waitlist_acceptance");
  await expect(form3.getByText("Agora: ainda sem dado suficiente (não é zero).")).toBeVisible();

  // Sugestões com evidência e decisão; acompanhamento como variação observada.
  const suggestions = page.getByRole("list", { name: "Sugestões" });
  await expect(suggestions.getByRole("listitem")).toHaveCount(5);
  await expect(suggestions).toContainText("Faltas acima de 15% e lembretes abaixo de 80%");
  await expect(suggestions).toContainText("Evidência: no_show = 15% · no_show_n = 40 · reminders = 50%");
  await expect(suggestions.getByRole("link", { name: "Ir para a tela" }).first()).toHaveAttribute("href", "/app/relacionamento");
  await suggestions.getByRole("listitem").filter({ hasText: "Faltas acima de 15%" }).getByRole("button", { name: "Vou fazer" }).click();
  await expect(page.getByText(/Sugestão aceita\. Em 30 dias medimos o indicador de novo/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Decisões" })).toContainText("Aceita em");
  await page.getByRole("button", { name: "Avançar 30 dias (simulação)" }).click();
  await expect(page.getByText("Acompanhamento (simulação): 1 decisão(ões) medida(s) de novo.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Decisões" })).toContainText("melhorou 30 dias depois (variação observada, não efeito)");
  await expect(page.getByRole("list", { name: "Decisões" })).not.toContainText(/causou|efeito da/);

  // Conteúdo aprovado: publicar só pelo escopo (demonstração com o campo escolhido).
  const content = page.getByRole("list", { name: "Conteúdo aprovado" });
  await expect(content.getByRole("listitem")).toHaveCount(5);
  await expect(content).toContainText("Barbearia Exemplo A em Pinheiros: cortes, barba e cuidado com horário marcado.");
  await expect(page.getByText("Nenhuma apresentação publicada.")).toBeVisible();
  await content.getByRole("listitem").filter({ hasText: "Apresentação clássica" }).getByRole("button", { name: "Publicar no perfil" }).click();
  await expect(page.getByText("“Apresentação clássica” publicada como apresentação do perfil.")).toBeVisible();
  await expect(page.getByText(/Publicado no perfil:/)).toBeVisible();
  await expect(content.getByRole("button", { name: "Publicada" })).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Sugestões" })).not.toContainText("Perfil público sem apresentação");
  await page.getByRole("button", { name: "Remover" }).click();
  await expect(page.getByText("Apresentação removida do perfil.")).toBeVisible();

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
