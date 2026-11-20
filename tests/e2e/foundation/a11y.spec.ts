import { expect, type Page, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";
import { menuRoutes, NOT_FOUND, routerRoutes, sweepRoutes } from "./rotas.ts";

// Correções do shell da auditoria docs/qa/acessibilidade.md (A11Y-01 a A11Y-04).
// A11Y-01 e A11Y-02 varrem todas as rotas (menu + roteador, ver rotas.ts), não uma lista digitada (revisão de 10/11, testes-06).

/** Rolagem lateral e texto visível que passa da borda da tela ou da caixa que o corta (vazio = ok). */
async function overflow320(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth > width) out.add(`rolagem horizontal: ${document.documentElement.scrollWidth}px`);
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el.closest("svg, script, style, noscript, .tn-visually-hidden")) continue;
      const text = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent!.trim()).filter(Boolean).join(" ");
      if (!text) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || s.visibility === "hidden" || s.display === "none") continue;
      // Caixa mais próxima que corta o conteúdo na horizontal. Se ela rola (tabela, abas), o texto é alcançável.
      // Caixa de 1 px que corta (no elemento ou acima dele) é texto só para leitor de tela, como no
      // .tn-visually-hidden: não está à vista.
      let clip: Element | null = null;
      let srOnly = false;
      for (let a: Element | null = el; a && !srOnly; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === "visible") continue;
        const box = a.getBoundingClientRect();
        srOnly = box.width <= 1 || box.height <= 1;
        if (!clip && a !== el) clip = a;
      }
      if (srOnly) continue;
      if (clip && /auto|scroll/.test(getComputedStyle(clip).overflowX) && clip.scrollWidth > clip.clientWidth) continue;
      const where = el.tagName.toLowerCase() + Array.from(el.classList).map((c) => `.${c}`).join("");
      const sample = `${where} "${text.slice(0, 40)}"`;
      // Meio pixel de folga para arredondamento de subpixel.
      if (r.right > width + 0.5 || r.left < -0.5) {
        out.add(`texto fora da tela (de ${Math.round(r.left)} a ${Math.round(r.right)} px em ${width}): ${sample}`);
      } else if (clip && clip !== document.documentElement && clip !== document.body) {
        const c = clip.getBoundingClientRect();
        if (r.right > c.right + 0.5 || r.left < c.left - 0.5) {
          out.add(`texto cortado pela caixa (texto de ${Math.round(r.left)} a ${Math.round(r.right)} px, caixa de ${Math.round(c.left)} a ${Math.round(c.right)}): ${sample}`);
        }
      }
    }
    return [...out];
  });
}

test("A11Y-03 · primeira tecla Tab mostra “Pular para o conteúdo” e Enter foca o main", async ({ page, isMobile }) => {
  test.skip(isMobile, "teclado físico: desktop");
  await page.goto("/app/agenda");
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
  // Próximo Tab já cai no conteúdo, não no menu.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
});

/** Na demonstração já existe sessão: a tela de entrada manda para o app. Qualquer outro redirecionamento é novidade. */
const REDIRECTS_IN_DEMO = { "/entrar": "/app" };

/** Abre a rota e espera a tela pronta: <h1> à vista e já sem o "Carregando…". */
async function openRoute(page: Page, path: string) {
  await page.goto(path);
  const h1 = page.locator("h1").first();
  await expect(h1, path).toBeVisible();
  await expect(h1, path).not.toHaveText("Carregando…");
}

/**
 * P51: as varreduras abrem todas as rotas do roteador. Com os 27 módulos ligados na demonstração, cada tela continua
 * sendo varrida, inclusive as que o piloto não mostra; a porta "Não disponível no piloto" tem o próprio e2e
 * (escopo.spec.ts).
 */
const allModules = (page: Page) => page.addInitScript(() => localStorage.setItem("tinindo.demo.modulos", "todos"));

test("a varredura cobre o menu e o roteador", async ({ page }) => {
  await allModules(page);
  const router = routerRoutes();
  // Lida de src/app/router.tsx: se o leitor quebrar e devolver quase nada, a varredura não pode passar vazia.
  expect(router.length).toBeGreaterThan(40);
  expect(router).toEqual(expect.arrayContaining(["/app", "/entrar", "/app/conta/novo-negocio", "/app/clientes/importar", NOT_FOUND]));
  // Todo link do menu é rota do roteador (o menu não aponta para tela que não existe).
  const menu = await menuRoutes(page);
  expect(menu.length).toBeGreaterThan(15);
  expect(menu.filter((r) => !router.includes(r))).toEqual([]);
});

test("A11Y-02 · cada tela tem título próprio", async ({ page }) => {
  for (const [path, title] of [
    ["/app", "Hoje · Tinindo"],
    ["/app/agenda", "Agenda · Tinindo"],
    ["/app/clientes", "Clientes · Tinindo"],
    ["/app/conta", "Sua conta · Tinindo"],
    [NOT_FOUND, "Página não encontrada · Tinindo"],
  ] as const) {
    await page.goto(path);
    await expect(page, path).toHaveTitle(title);
  }
});

test("A11Y-02 · toda rota tem título próprio, terminado em “· Tinindo”", async ({ page }) => {
  test.setTimeout(120_000);
  await allModules(page);
  const problems: string[] = [];
  const byTitle = new Map<string, string[]>();
  const redirected: Record<string, string> = {};
  for (const path of await sweepRoutes(page)) {
    await openRoute(page, path);
    const landed = new URL(page.url()).pathname;
    if (landed !== path) {
      redirected[path] = landed;
      continue;
    }
    // O título vem do <h1> (RouteFocus): espera ele deixar de ser só o nome do app.
    await expect(page, path).toHaveTitle(/^\S.* · Tinindo$/);
    const title = await page.title();
    const parts = title.split(" · ").map((p) => p.trim());
    if (parts.some((p) => !p)) problems.push(`${path} · título com parte vazia: "${title}"`);
    if (new Set(parts).size !== parts.length) problems.push(`${path} · título repete um trecho: "${title}"`);
    if (/Carregando/.test(title)) problems.push(`${path} · título de carregamento: "${title}"`);
    byTitle.set(title, [...(byTitle.get(title) ?? []), path]);
  }
  // Título próprio: duas telas diferentes não podem se anunciar com o mesmo nome.
  for (const [title, paths] of byTitle) {
    if (paths.length > 1) problems.push(`mesmo título "${title}" em ${paths.join(", ")}`);
  }
  expect(problems).toEqual([]);
  expect(redirected, "rotas que a demonstração redireciona (o título delas é o do destino)").toEqual(REDIRECTS_IN_DEMO);
});

test("A11Y-04 · trocar de tela leva o foco ao título; mudar só o dia da agenda não", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  // Carga inicial não rouba o foco.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  await openFromNav(page, "Agenda");
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeFocused();
  await expect(page).toHaveTitle("Agenda · Tinindo");

  const next = page.getByRole("button", { name: "Próximo dia" });
  await next.click();
  await expect(next).toBeFocused();
});

test("A11Y-01 · em 320 px, nenhuma rota rola de lado nem corta texto", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 640 });
  const problems: string[] = [];
  for (const path of await sweepRoutes(page)) {
    await openRoute(page, path);
    for (const p of await overflow320(page)) problems.push(`${path} · ${p}`);
  }
  expect(problems).toEqual([]);
});

test("A11Y-01 · na Hoje, o valor em reais fica dentro do cartão em 320 e 375 px", async ({ page }) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/app");
    const stat = page.getByRole("group", { name: "Resumo" }).getByRole("link", { name: /Recebido na semana/ });
    await expect(stat).toBeVisible();
    const fits = await stat.evaluate((el) => {
      const card = el.getBoundingClientRect();
      // P54: o número é uma linha de resumo (rótulo à esquerda, valor à direita), não mais ladrilho.
      const value = el.querySelector(".tn-summary__row-value")!.getBoundingClientRect();
      return value.right <= card.right && value.left >= card.left;
    });
    expect(fits, `largura ${width}`).toBe(true);
  }
});
