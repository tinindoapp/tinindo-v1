// P54 parte 2: o mesmo medidor de docs/handoffs/P54/medir.cjs (altura, contraste, alvos de 44 px, preto que não é
// ação) nas telas da parte 2: Agenda, Novo agendamento, atendimento, Horários, Configuração, Serviços, Preços, Lista
// de espera, Mensagens, Orçamentos e Assinaturas.
// Uso (na raiz do repo, com `npm run build` e `npx vite preview --port 4280` rodando):
//   node docs/handoffs/P54/medir.cjs <rotulo> [porta] [light|dark]  → grava <rotulo>/medidas.json e as capturas.
// CHROMIUM=/caminho/do/chromium usa um navegador já instalado.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const label = process.argv[2] || "antes";
const scheme = process.argv[4] || "light";
const port = process.argv[3] || "4280";
const out = path.join(process.cwd(), label);
const SUFFIX = scheme === "dark" ? "-escuro" : "";
fs.mkdirSync(out, { recursive: true });
const BASE = `http://127.0.0.1:${port}`;

const SCREENS = [
  { id: "agenda", url: "/app/agenda" },
  { id: "agenda-semana", url: "/app/agenda", open: "semana" },
  { id: "novo", url: "/app/agenda/novo" },
  { id: "atendimento", url: "/app/agenda", open: "atendimento" },
  { id: "horarios", url: "/app/agenda/horarios" },
  { id: "configurar", url: "/app/configurar" },
  { id: "servicos", url: "/app/clientes/servicos" },
  { id: "precos", url: "/app/precos" },
  { id: "espera", url: "/app/lista-de-espera" },
  { id: "mensagens", url: "/app/mensagens" },
  { id: "conversa", url: "/app/mensagens", open: "conversa" },
  { id: "orcamentos", url: "/app/orcamentos" },
  { id: "assinaturas", url: "/app/assinaturas" },
];
const ONLY = process.env.SCREENS ? process.env.SCREENS.split(",") : null;

function inPage() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };

  // Contraste: elementos com texto próprio (nó de texto filho não vazio).
  const texts = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    if (el.closest("[disabled],[aria-disabled=true]")) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color); if (!fg) continue;
    const bg = bgOf(el);
    let opacity = 1; for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    const eff = over({ ...fg, a: fg.a * opacity }, bg);
    const size = parseFloat(s.fontSize), weight = Number(s.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r = ratio(eff, bg);
    texts.push({ text: el.textContent.trim().slice(0, 40), r: Math.round(r * 100) / 100, need: large ? 3 : 4.5 });
  }
  const fails = texts.filter((t) => t.r < t.need);
  const minRatio = texts.reduce((m, t) => Math.min(m, t.r), 99);

  // Alvos: controles interativos visíveis. Link dentro de parágrafo de texto é isento (WCAG 2.5.8, inline).
  const targets = [];
  for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox]")) {
    if (!visible(el)) continue;
    if (el.closest("[disabled]")) continue;
    const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p, li > span, .tn-muted");
    // Caixa de seleção/rádio dentro de <label>: o alvo é o rótulo inteiro.
    const box = (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label")) || el;
    const r = box.getBoundingClientRect();
    targets.push({ tag: el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), inline: !!inline });
  }
  const small = targets.filter((t) => !t.inline && (t.h < 44 || t.w < 44));

  // Botões pretos preenchidos (fundo = cor de ação) que não são botão de ação.
  const action = getComputedStyle(document.documentElement).getPropertyValue("--tn-action").trim();
  const blacks = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c.a < 1) continue;
    if (c.r < 30 && c.g < 30 && c.b < 30) blacks.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), text: el.textContent.trim().slice(0, 30), isAction: el.matches("button, a[href]") });
  }
  const h1 = document.querySelector("main h1, h1");
  return {
    height: document.documentElement.scrollHeight,
    screens: Math.round((document.documentElement.scrollHeight / 844) * 100) / 100,
    h1: h1 ? h1.textContent.trim() : null,
    textCount: texts.length, minRatio, contrastFails: fails.slice(0, 20), contrastFailCount: fails.length,
    targetCount: targets.length, smallTargets: small.slice(0, 40), smallTargetCount: small.length,
    blackFills: blacks.length, blackNonAction: blacks.filter((b) => !b.isAction).map((b) => `${b.tag}.${b.cls} ${b.text}`).slice(0, 10),
  };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, hasTouch: true, isMobile: true });
  // Liga os módulos opcionais da demonstração (Orçamentos, Assinaturas, Mensagens…), como os e2e (tests/e2e/escopo.ts).
  await ctx.addInitScript(() => { try { localStorage.setItem("tinindo.demo.modulos", "todos"); } catch { /* */ } });
  const page = await ctx.newPage();
  const result = {};
  for (const s of SCREENS) {
    if (ONLY && !ONLY.includes(s.id)) continue;
    await page.goto(BASE + s.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const open = async (locator) => {
      if ((await locator.count()) === 0) { console.log(s.id, "sem o que abrir na demonstração"); return; }
      await locator.first().click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
    };
    if (s.open === "semana") await open(page.getByRole("radio", { name: "Semana" }).or(page.getByRole("tab", { name: "Semana" })).or(page.getByRole("button", { name: "Semana" })));
    if (s.open === "atendimento") await open(page.locator('main a[href*="/app/agenda/atendimento/"]'));
    if (s.open === "conversa") await open(page.locator('main a[href^="/app/mensagens/"]').filter({ hasNotText: /Simulador/ }));
    result[s.id] = { url: page.url().replace(BASE, ""), ...(await page.evaluate(inPage)) };
    if (!SUFFIX) {
      await page.screenshot({ path: path.join(out, `${s.id}-inteira.png`), fullPage: true });
      await page.screenshot({ path: path.join(out, `${s.id}-dobra.png`) });
    }
    console.log(s.id, result[s.id].height, "px", result[s.id].screens, "telas · contraste min", result[s.id].minRatio, "falhas", result[s.id].contrastFailCount, "· alvos <44", result[s.id].smallTargetCount, "/", result[s.id].targetCount, "· pretos", result[s.id].blackFills, "(não ação", result[s.id].blackNonAction.length + ")");
  }
  fs.writeFileSync(path.join(out, `medidas${SUFFIX}.json`), JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
