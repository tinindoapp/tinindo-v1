import { expect, type Page, test } from "@playwright/test";
import { menuRoutes } from "./rotas.ts";

// Padrões do sistema (auditoria de UX, onda 2) em todas as telas do menu e nas páginas públicas,
// no celular de 375 px e no desktop, nos temas claro e escuro.
// Contraste (revisão de 10/11, testes-03): medido pela cor calculada do texto contra o fundo calculado, WCAG 1.4.3.

const PUBLIC = ["/entrar", "/criar-conta", "/diretorio"];
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];

/** Texto com contraste abaixo do mínimo: a chave identifica o elemento; a razão é a medida. */
type LowContrast = { key: string; ratio: number; min: number; colors: string };

/**
 * Contraste reprovado que já existe nas telas e ainda não foi corrigido (o dono da tela corrige em `src/`; este
 * pacote só mede). A lista não pode apodrecer: o teste falha com qualquer reprovação que não esteja aqui e também
 * falha se uma linha daqui deixar de ocorrer (aí é só apagar a linha).
 * `where` = rota · seletor · "texto", como sai na mensagem de falha. `ratio` é a razão medida, só para registro.
 */
const KNOWN_LOW_CONTRAST: readonly { where: string; scheme: Scheme; ratio: number }[] = [
  // --tn-text-muted sobre --tn-surface-sunken no tema claro (src/features/setup/setup.css, .tn-setup-step__tag).
  { where: '/app/configurar · span.tn-setup-step__tag · "opcional"', scheme: "light", ratio: 4.49 },
];

/** Problemas de padrão visíveis na tela atual (vazio = ok) e os textos com contraste abaixo do mínimo. */
async function audit(page: Page, width: number): Promise<{ problems: string[]; lowContrast: LowContrast[]; measured: number }> {
  return page.evaluate(async (w) => {
    // Entrada de tela (opacidade animando) mudaria a medida: espera as animações que terminam.
    await Promise.all(
      document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => null)),
    );
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push(`rolagem horizontal: ${document.documentElement.scrollWidth}px`);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const ownText = (el: Element) =>
      Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent!.trim()).filter(Boolean).join(" ");
    for (const el of Array.from(document.querySelectorAll("main *, .tn-net-public *, .tn-auth *"))) {
      if (!visible(el)) continue;
      if (!ownText(el) || el.closest(".tn-visually-hidden")) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) out.push(`fonte de ${size}px: "${el.textContent!.trim().slice(0, 30)}"`);
    }
    for (const b of Array.from(document.querySelectorAll("main button, main a.tn-button"))) {
      if (!visible(b)) continue;
      const name = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
      if (!name) out.push(`botão sem nome: ${b.outerHTML.slice(0, 80)}`);
    }
    for (const b of Array.from(document.querySelectorAll(".tn-icon-button"))) {
      if (!visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) out.push(`botão de ícone pequeno (${r.width}×${r.height}): ${b.getAttribute("aria-label")}`);
    }

    // ---- Contraste (WCAG 1.4.3): cor do texto contra o primeiro fundo opaco dos ancestrais.
    type Rgba = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const cache = new Map<string, Rgba>();
    const parse = (css: string): Rgba => {
      let c = cache.get(css);
      if (c) return c;
      const rgb = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(css);
      const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(css);
      if (rgb) c = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
      else if (srgb) c = [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
      else {
        // Outros formatos (oklch, lab…): o canvas converte para sRGB.
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        c = [d[0]!, d[1]!, d[2]!, d[3]! / 255];
      }
      cache.set(css, c);
      return c;
    };
    /** `top` sobre `under`, os dois em alfa não pré-multiplicado. */
    const over = (top: Rgba, under: Rgba): Rgba => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const ch = (i: 0 | 1 | 2) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
      return [ch(0), ch(1), ch(2), a];
    };
    const luminance = (c: Rgba) => {
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    };
    const describe = (el: Element) => {
      const one = (e: Element) => e.tagName.toLowerCase() + Array.from(e.classList).map((c) => `.${c}`).join("");
      if (el.classList.length) return one(el);
      const named = el.parentElement?.closest("[class]");
      return named ? `${one(named)} ${one(el)}` : one(el);
    };
    const css = (c: Rgba) => `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;

    const low = new Map<string, { key: string; ratio: number; min: number; colors: string }>();
    let measured = 0;
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el.closest("svg, script, style, noscript, .tn-visually-hidden")) continue;
      const text = ownText(el);
      if (!text || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth) continue;
      // Caixa de 1 px que corta o conteúdo é texto só para leitor de tela (como o .tn-visually-hidden): não está à vista.
      let srOnly = false;
      for (let a: Element | null = el; a && !srOnly; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === "visible") continue;
        const box = a.getBoundingClientRect();
        srOnly = box.width <= 1 || box.height <= 1;
      }
      if (srOnly) continue;
      // Componente inativo fica fora do critério (WCAG 1.4.3): o próprio controle, o que está dentro dele e o rótulo.
      if (el.closest("[disabled], [aria-disabled='true']")) continue;
      const control = el.closest("label")?.control;
      if (control?.matches(":disabled, [aria-disabled='true']")) continue;

      // Cadeia do elemento até a raiz, com fundo e opacidade de cada nível.
      const chain: { bg: Rgba; opacity: number; image: boolean }[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        chain.push({ bg: parse(s.backgroundColor), opacity: Number(s.opacity), image: s.backgroundImage !== "none" });
      }
      // Primeiro fundo opaco: o nível mais próximo com cor sólida e sem opacidade dele para cima.
      let above = 1;
      const solid: boolean[] = [];
      for (let i = chain.length - 1; i >= 0; i--) {
        above *= chain[i]!.opacity;
        solid[i] = above >= 0.999 && chain[i]!.bg[3] >= 0.999;
      }
      const base = solid.indexOf(true);
      const path = chain.slice(0, base === -1 ? chain.length : base + 1);
      // Imagem ou gradiente no caminho: a cor de trás não é uma só. Não mede (e não inventa).
      if (path.some((l) => l.image)) continue;
      if (base === -1) {
        out.push(`contraste sem fundo opaco para medir: ${describe(el)} "${text.slice(0, 40)}"`);
        continue;
      }
      // Compõe de dentro para fora: cada nível é um grupo (fundo + o que está dentro) multiplicado pela opacidade.
      const s = getComputedStyle(el);
      const render = (withText: boolean): Rgba => {
        let inner: Rgba = withText ? parse(s.webkitTextFillColor || s.color) : [0, 0, 0, 0];
        path.forEach((l, i) => {
          const group = over(inner, l.bg);
          inner = [group[0], group[1], group[2], group[3] * (i === path.length - 1 ? 1 : l.opacity)];
        });
        return inner;
      };
      const fg = render(true);
      const bg = render(false);
      const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      measured++;
      const size = parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      // Texto grande: 18 pt (24 px), ou 14 pt (18,66 px) em negrito.
      const min = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio >= min) continue;
      const key = `${describe(el)} · "${text.slice(0, 40)}"`;
      const prev = low.get(key);
      if (!prev || ratio < prev.ratio) low.set(key, { key, ratio: Math.round(ratio * 100) / 100, min, colors: `${css(fg)} sobre ${css(bg)}` });
    }
    return { problems: out, lowContrast: [...low.values()], measured };
  }, width);
}

/** Varre as telas do menu e as públicas em uma largura e um tema; devolve o que achou, já com a rota na frente. */
async function sweep(page: Page, width: number, scheme: Scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  const routes = await menuRoutes(page);
  expect(routes.length).toBeGreaterThan(15);
  expect(routes, "a configuração guiada entra na varredura").toContain("/app/configurar");
  const problems: string[] = [];
  const lowContrast: string[] = [];
  for (const path of [...routes, ...PUBLIC]) {
    await page.goto(path);
    await expect(page.locator("h1").first(), path).toBeVisible();
    await expect(page.locator("main h1, body > div h1").first()).not.toHaveText("Carregando…");
    // Defeito C da revisão de 10/11: o passo indicado ("data-next") tinha texto da cor do fundo.
    if (path === "/app/configurar") await expect(page.locator(".tn-setup-step[data-next]")).toBeVisible();
    const found = await audit(page, width);
    expect(found.measured, `${path}: nenhum texto medido`).toBeGreaterThan(0);
    for (const p of found.problems) problems.push(`${path} · ${p}`);
    for (const c of found.lowContrast) lowContrast.push(`${path} · ${c.key} — ${c.ratio}:1 (mínimo ${c.min}), ${c.colors}`);
  }
  return { problems, lowContrast };
}

/** Separa o contraste reprovado em novo (falha) e conhecido; devolve também as exceções que não ocorreram mais. */
function againstKnown(lowContrast: string[], scheme: Scheme) {
  const known = KNOWN_LOW_CONTRAST.filter((k) => k.scheme === scheme).map((k) => k.where);
  const where = (line: string) => line.slice(0, line.lastIndexOf(" — "));
  return {
    novos: lowContrast.filter((l) => !known.includes(where(l))),
    resolvidos: known.filter((k) => !lowContrast.some((l) => where(l) === k)),
  };
}

for (const scheme of SCHEMES) {
  const run = async (page: Page, width: number, height: number) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    const { problems, lowContrast } = await sweep(page, width, scheme);
    expect(problems).toEqual([]);
    const { novos, resolvidos } = againstKnown(lowContrast, scheme);
    expect(novos, "contraste abaixo do mínimo").toEqual([]);
    expect(resolvidos, "exceção de contraste que não ocorre mais: apague a linha de KNOWN_LOW_CONTRAST").toEqual([]);
  };

  test(`padrões em todas as telas · 375 px · tema ${scheme}`, async ({ page }) => {
    await run(page, 375, 812);
  });

  test(`desktop: as mesmas telas sem rolagem horizontal, sem fonte menor que 12 px e com contraste · tema ${scheme}`, async ({ page, isMobile }) => {
    test.skip(isMobile, "largura de desktop");
    await run(page, 1280, 800);
  });
}
