import { expect, type Page, test } from "@playwright/test";
import { appendFileSync } from "node:fs";

// P55 parte 2 · itens 2 e 6: as páginas do cliente final e as telas do dono em Perfil, Site, Avaliações e Pagamentos
// medidas em 390 × 844 (demonstração), nos dois temas. Para cada tela:
// - altura até duas alturas de celular (1.688 px, regra do P54);
// - contraste WCAG de todo texto visível (4,5:1; 3:1 no texto grande), com a opacidade dos pais composta;
// - alvos de toque de 44 × 44 (link dentro de frase é isento, WCAG 2.5.8);
// - todo controle com nome acessível;
// - foco visível no primeiro controle alcançado pelo Tab.
// MEDIR_OUT=arquivo.jsonl grava as medidas, uma tela por linha (usadas no handoff docs/handoffs/P55-parte2-cliente-leve.md).
test.use({ viewport: { width: 390, height: 844 } });

const LIMIT = 2 * 844;

const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);
const openLink = (page: Page, url: string) => soft(page, new URL(url).pathname + new URL(url).hash);

function inPage() {
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 };
  };
  type C = NonNullable<ReturnType<typeof parse>>;
  const lum = ({ r, g, b }: C) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top: C, bot: C): C => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el: Element) => {
    const stack: C[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg: C = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i]!, bg);
    return bg;
  };
  const ratio = (a: C, b: C) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const hidden = (el: Element) => !!el.closest(".tn-visually-hidden, [aria-hidden=true]");

  const fails: { text: string; r: number; need: number }[] = [];
  let minRatio = 99;
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || hidden(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
    if (el.closest("[disabled],[aria-disabled=true]")) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    const eff = over({ ...fg, a: fg.a * opacity }, bg);
    const size = parseFloat(s.fontSize), weight = Number(s.fontWeight);
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const r = Math.round(ratio(eff, bg) * 100) / 100;
    minRatio = Math.min(minRatio, r);
    if (r < need) fails.push({ text: el.textContent!.trim().slice(0, 40), r, need });
  }

  const small: { name: string; w: number; h: number }[] = [];
  const unnamed: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox]")) {
    if (!visible(el) && !el.matches("input[type=radio], input[type=checkbox]")) continue;
    // O aviso passageiro (toast) é do kit, fora da área: botão de 40 px no recado #159.
    // O nome do negócio no cabeçalho público (kit, 26 px) também: recado #159.
    if (el.closest("[disabled], .tn-toaster, .tn-pub-head__name")) continue;
    // Nome acessível (aproximação): aria-label, aria-labelledby, rótulo, texto ou title.
    const labelled = el.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const label = (el as HTMLInputElement).labels?.[0]?.textContent;
    const name = (el.getAttribute("aria-label") || labelled || label || el.textContent || el.getAttribute("title") || el.getAttribute("alt") || "").trim();
    if (!name) unnamed.push(el.outerHTML.slice(0, 80));
    const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && !!el.closest("p, li > span, .tn-muted, dd, .tn-field__hint");
    if (inline) continue;
    const box = (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label")) || el;
    if (!visible(box)) continue;
    const r = box.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small.push({ name: name.slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return {
    height: Math.round(document.documentElement.scrollHeight),
    width: document.documentElement.scrollWidth,
    minRatio,
    fails,
    small,
    unnamed,
  };
}

async function measure(page: Page, id: string) {
  await page.waitForLoadState("networkidle");
  // Sem transição: a troca de tema mede a cor final, não a do meio da animação.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  const out: Record<string, unknown> = { id, url: new URL(page.url()).pathname };
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const m = await page.evaluate(inPage);
    out[scheme] = { height: m.height, minRatio: m.minRatio, fails: m.fails, small: m.small, unnamed: m.unnamed };
    expect.soft(m.fails, `${id} (${scheme}): texto sem contraste`).toEqual([]);
    if (scheme === "light") {
      expect.soft(m.height, `${id}: mais de duas alturas de celular`).toBeLessThanOrEqual(LIMIT);
      expect.soft(m.width, `${id}: rolagem horizontal`).toBeLessThanOrEqual(390);
      expect.soft(m.small, `${id}: alvos menores que 44 px`).toEqual([]);
      expect.soft(m.unnamed, `${id}: controles sem nome acessível`).toEqual([]);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  // Foco visível: o primeiro Tab cai num controle com contorno.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 ? `${s.outlineWidth} ${s.outlineStyle}` : `sem contorno: ${el.outerHTML.slice(0, 60)}`;
  });
  expect.soft(ring, `${id}: foco visível no primeiro Tab`).toMatch(/px (solid|auto|dashed|double)/);
  out.focus = ring;
  if (process.env.MEDIR_OUT) appendFileSync(process.env.MEDIR_OUT, JSON.stringify(out) + "\n");
}

async function publishProfile(page: Page, slug: string) {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill(slug);
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("heading", { name: "Onde, quando e cancelamento", level: 2 }).click();
  const form = page.getByRole("form", { name: "Endereço, horário e política" });
  await form.getByText("No meu endereço").click();
  await form.getByLabel("Endereço", { exact: true }).fill("Rua das Flores, 10 · Centro");
  await form.getByLabel(/Horário de funcionamento/).fill("Ter a sáb, 9h às 19h");
  await form.getByLabel("Política de cancelamento (opcional)").fill("Cancele ou remarque com 2 horas de antecedência.");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Endereço, horário e política salvos.")).toBeVisible();
}

const demoCode = async (page: Page) =>
  /O código seria (\d{6})/.exec((await page.getByText(/nenhuma mensagem é enviada/).textContent()) ?? "")![1]!;

test.beforeEach(async ({ page }) => {
  // Telas de módulos guardados (Site, Avaliações, Pagamentos) ligadas na demonstração.
  await page.addInitScript(() => localStorage.setItem("tinindo.demo.modulos", "todos"));
});

test("perfil (vitrine e reserva), ver a reserva e lista de avaliações", async ({ page }) => {
  await publishProfile(page, "barbearia-medidas");
  await measure(page, "dono-perfil");
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page.getByRole("heading", { name: "Escolha o serviço" })).toBeVisible();
  await measure(page, "perfil");

  await page.getByRole("button", { name: "Escolher dia e hora" }).click();
  await page.getByRole("list", { name: "Horários livres" }).getByRole("button").first().click();
  await measure(page, "perfil-dados");
  await page.getByLabel("Seu nome").fill("Cliente Exemplo");
  await page.getByLabel("WhatsApp com DDD").fill("11977770001");
  await page.getByRole("button", { name: "Pedir este horário" }).click();
  await page.getByLabel("Código recebido").fill(await demoCode(page));
  await page.getByRole("button", { name: "Confirmar horário" }).click();
  await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();
  await measure(page, "perfil-confirmado");
  await page.getByRole("link", { name: "Ver minha reserva" }).click();
  await expect(page.getByRole("heading", { name: "Sua reserva", level: 1 })).toBeVisible();
  await measure(page, "reserva");

  await soft(page, "/avaliacoes/barbearia-medidas");
  await expect(page.getByRole("heading", { level: 1, name: /Avaliações/ })).toBeVisible();
  await measure(page, "avaliacoes");
});

test("avaliar e telas do dono em Site e Avaliações", async ({ page }) => {
  await page.goto("/avaliar");
  await expect(page.getByRole("heading", { name: "Avaliar atendimentos", level: 1 })).toBeVisible();
  await measure(page, "avaliar");
  await soft(page, "/app/site");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await measure(page, "dono-site");
  await soft(page, "/app/avaliacoes");
  await expect(page.getByRole("heading", { name: "Avaliações", level: 1 })).toBeVisible();
  await measure(page, "dono-avaliacoes");
});

test("cobrança: tela do dono e página de pagar", async ({ page }) => {
  await page.goto("/app/pagamentos");
  await expect(page.getByRole("heading", { name: "Pagamentos", level: 1 })).toBeVisible();
  await measure(page, "dono-pagamentos");
  const form = page.getByRole("form", { name: "Cobrar por Pix" });
  await form.getByRole("button", { name: "Gerar cobrança Pix" }).click();
  const url = (await page.getByRole("group", { name: "Enviar a cobrança" }).getByLabel("Link de pagamento").textContent())!;
  await openLink(page, url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await measure(page, "pagar");
});

test("orçamento pelo link", async ({ page }) => {
  await page.goto("/app/orcamentos");
  await page.getByRole("button", { name: "Novo orçamento" }).click();
  const form = page.getByRole("form", { name: "Novo orçamento" });
  await form.getByRole("group", { name: "Escolha o cliente" }).getByRole("radio").first().check();
  await form.getByRole("group", { name: "Item 1" }).getByLabel("Serviço").selectOption({ label: "Corte" });
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await form.getByRole("group", { name: "Item 2" }).getByLabel("Serviço").selectOption({ label: "Barba" });
  await form.getByLabel("Propor um horário").check();
  await form.getByRole("button", { name: "Salvar rascunho" }).click();
  await page.getByRole("region", { name: "Seus orçamentos" }).getByRole("button", { name: "Gerar link" }).click();
  const link = (await page.getByRole("region", { name: "Link do orçamento" }).locator("code").textContent())!;
  await openLink(page, link);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await measure(page, "orcamento");
});

test("oferta da lista de espera", async ({ page }) => {
  await page.goto("/app/lista-de-espera");
  await page.getByRole("region", { name: "Vagas para oferecer" }).getByRole("button", { name: /Preparar oferta/ }).click();
  const link = (await page.getByRole("region", { name: "Link da oferta" }).locator("code").textContent())!;
  await openLink(page, link);
  await expect(page.getByRole("heading", { name: "Vaga disponível" })).toBeVisible();
  await measure(page, "oferta");
});
