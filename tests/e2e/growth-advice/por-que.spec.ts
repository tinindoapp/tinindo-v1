import { expect, test } from "@playwright/test";

// "Por quê?" nas sugestões de Metas e sugestões (T3 da revisão de 04/11), na demonstração (sem rede e sem modelo: a
// frase fixa por regra, sem o selo "escrito pelo assistente"). Roda em desktop e celular (Pixel 7, ~412 px) pelo
// projeto "recursos" do playwright.config.ts, que liga os módulos por ativação; o teste também confere 375 px.
for (const width of [null, 375]) {
  test(`Por quê? abre a frase da sugestão e O que a conta olhou explica o insuficiente${width ? ` (${width} px)` : ""}`, async ({ page }) => {
    if (width) await page.setViewportSize({ width, height: 800 });
    await page.goto("/app/metas");
    await expect(page.getByRole("heading", { name: "Metas e sugestões", level: 1 })).toBeVisible();
    const open = page.getByRole("list", { name: "Sugestões abertas" });
    const item = open.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Faltas concentradas na quarta" }) });
    const why = item.getByRole("button", { name: /^Por quê\?/ });
    await expect(why).toHaveAttribute("aria-expanded", "false");
    await why.click();
    await expect(why).toHaveAttribute("aria-expanded", "true");
    const text = "De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta. Um lembrete no dia anterior costuma ajudar quem esquece. Ajuste os lembretes em Relacionamento.";
    const panel = item.locator(`#${await why.getAttribute("aria-controls")}`);
    await expect(panel).toHaveAttribute("aria-live", "polite");
    await expect(panel).toHaveText(text);
    await expect(item.getByText("escrito pelo assistente")).toHaveCount(0);
    await why.click();
    await expect(why).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveText("");

    // Horário ocioso: a faixa e as semanas da evidência.
    const idle = open.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^Horário vazio toda semana/ }) });
    await idle.getByRole("button", { name: /^Por quê\?/ }).click();
    await expect(idle).toContainText("A faixa de sábado das 9h às 14h ficou vazia em 5 das 5 semanas, de 14/09 a 18/10.");

    // Insuficiente não é zero: a frase diz o que falta e o número de hoje.
    await page.getByText("O que a conta olhou").click();
    await expect(page.getByRole("list", { name: "Regras e dados" })).toContainText(
      "Ainda não dá para saber se seus clientes estão voltando: preciso de pelo menos 5 clientes com 2 atendimentos. Hoje são 4. Isso não quer dizer zero.");

    const body = await page.locator("main").innerText();
    for (const raw of ["no_show_concentration", "few_returning_customers", "numerator"]) expect(body).not.toContain(raw);
    expect(body).not.toMatch(/\bIA\b/);
    const w = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
  });
}
