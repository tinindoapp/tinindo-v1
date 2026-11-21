import { expect, test } from "@playwright/test";

// P55 parte 2, item 1 (recado #119): as páginas do cliente final carregam um pacote próprio, sem as telas do dono, a
// sessão e o cliente Supabase. Antes da divisão, cada página baixava 1.039.293 bytes de JS (304.108 gzip); depois,
// cerca de 650 KB. O teto falha se o pacote público voltar a crescer. Para baixar o teto, ver o recado #159 (contratos).
const CEILING = 700_000;

for (const path of ["/p/barbearia-exemplo-a", "/avaliacoes/barbearia-exemplo-a", "/pagar", "/orcamento", "/reserva"]) {
  test(`pacote público abaixo do teto em ${path}`, async ({ page }) => {
    const scripts = new Map<string, number>();
    page.on("response", async (r) => {
      if (r.request().resourceType() !== "script") return;
      scripts.set(r.url(), (await r.body().catch(() => Buffer.alloc(0))).length);
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const total = [...scripts.values()].reduce((a, b) => a + b, 0);
    const names = [...scripts.keys()].map((u) => new URL(u).pathname);
    expect(total, `JS baixado em ${path}: ${total} bytes (${names.join(", ")})`).toBeLessThanOrEqual(CEILING);
    // Nada das telas do dono nem do app completo.
    expect(names.some((n) => /\/mount-|\/router-|\/Home-/.test(n)), names.join(", ")).toBe(false);
  });
}
