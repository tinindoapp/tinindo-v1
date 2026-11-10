import { expect, test } from "@playwright/test";

// Item 19 da auditoria de UX: avisos repetidos empilhados (até 250 px antes do conteúdo) nas telas de Dinheiro e
// Crescer. Fica a faixa "Demonstração" do topo, no máximo um aviso da tela antes do conteúdo, e as explicações em
// "Como funciona", recolhido.
const SCREENS = [
  { path: "/app/caixa", title: "Caixa" },
  { path: "/app/pagamentos", title: "Pagamentos" },
  { path: "/app/assinaturas", title: "Assinaturas" },
  { path: "/app/notas", title: "Notas fiscais" },
  { path: "/app/metas", title: "Metas e sugestões" },
  { path: "/app/campanhas", title: "Campanhas" },
  { path: "/app/indicacoes", title: "Indicações" },
  { path: "/app/resultado", title: "Resultado" },
  { path: "/app/assistente", title: "Assistente" },
];

test("dinheiro e crescer: um aviso da tela, no máximo, antes do conteúdo; explicações recolhidas", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const s of SCREENS) {
    await page.goto(s.path);
    await expect(page.getByRole("heading", { name: s.title, level: 1 })).toBeVisible();
    // A faixa global continua identificando a demonstração.
    await expect(page.getByRole("note")).toContainText("Demonstração");
    await expect(page.locator("main h2, main form").first()).toBeVisible();
    const before = await page.locator("main").evaluate((main) => {
      const first = main.querySelector("h2, form");
      const banners = [...main.querySelectorAll<HTMLElement>(".tn-banner")].filter((b) => !first || b.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { count: banners.length, height: banners.reduce((h, b) => h + b.getBoundingClientRect().height, 0) };
    });
    expect(before.count, s.path).toBeLessThanOrEqual(1);
    expect(before.height, s.path).toBeLessThanOrEqual(100);
    for (const d of await page.locator("main details.tn-help").all()) await expect(d, s.path).not.toHaveAttribute("open", "");
  }
});
