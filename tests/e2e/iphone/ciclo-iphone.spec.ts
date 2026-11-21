import { expect, type Page, test } from "@playwright/test";
import { toStep } from "../scheduling/flow.ts";

// Bloco 1 da revisão de qualidade · Safari do iPhone. Roda no projeto "iphone" (WebKit, iPhone 13) e no celular do
// Chromium. Percorre o ciclo principal (configurar, agendar, atender, receber, retorno, reserva pelo link) e, em cada
// tela, confere o que só o iPhone cobra:
// - campo com letra de 16 px ou mais (abaixo disso o Safari amplia a tela ao tocar);
// - toque sem espera de zoom de toque duplo (touch-action: manipulation) em botões e links;
// - data e hora com altura de toque e sem encolher vazios;
// - nenhuma barra fixa (topo, abas, barra de confirmar) cobrindo o campo focado: é o que o teclado faz parecer quando a
//   página não rola o campo para a área livre;
// - nada rolando de lado.
// Não substitui o aparelho real (docs/qa/IPHONE-SAFARI.md): o teclado virtual e a área segura de verdade não existem
// no emulador.

test.skip(({ isMobile }) => !isMobile, "só celular");

async function iosChecks(page: Page, where: string) {
  const report = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const text = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"], [type="hidden"]), select, textarea';
    const fields = [...document.querySelectorAll<HTMLElement>(text)].filter(visible);
    const small = fields.filter((f) => parseFloat(getComputedStyle(f).fontSize) < 16).map((f) => f.id || f.getAttribute("name") || f.tagName);
    const dates = [...document.querySelectorAll<HTMLElement>('input[type="date"], input[type="time"], input[type="datetime-local"]')]
      .filter(visible)
      .filter((f) => f.getBoundingClientRect().height < 44)
      .map((f) => `${f.id || f.tagName} ${Math.round(f.getBoundingClientRect().height)}px`);
    const taps = [...document.querySelectorAll<HTMLElement>("main button, main a[href], main summary")]
      .filter(visible)
      .filter((b) => getComputedStyle(b).touchAction !== "manipulation")
      .map((b) => (b.textContent ?? "").trim().slice(0, 30));
    return { small, dates, taps: taps.slice(0, 5), scroll: document.documentElement.scrollWidth - innerWidth };
  });
  expect.soft(report.small, `${where}: campo com letra < 16 px (o iPhone amplia)`).toEqual([]);
  expect.soft(report.dates, `${where}: data/hora abaixo de 44 px`).toEqual([]);
  expect.soft(report.taps, `${where}: toque sem touch-action: manipulation`).toEqual([]);
  expect.soft(report.scroll, `${where}: rolagem de lado`).toBeLessThanOrEqual(0);
}

/** Foca cada campo visível (como o toque faz) e confere que nenhuma barra fixa fica por cima dele. */
async function focusedFieldsClear(page: Page, where: string) {
  const fields = page.locator('main :is(input:not([type="checkbox"], [type="radio"], [type="hidden"]), select, textarea):visible');
  const n = Math.min(await fields.count(), 8);
  for (let i = 0; i < n; i++) {
    const field = fields.nth(i);
    await field.focus();
    const covered = await field.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const bars = [...document.querySelectorAll<HTMLElement>("body *")].filter((b) => {
        const cs = getComputedStyle(b);
        if (cs.position !== "fixed" && cs.position !== "sticky") return false;
        if (b.contains(el) || el.contains(b)) return false;
        // Aviso passageiro (toast) some sozinho e não recebe toque: não é barra.
        if (b.closest(".tn-toaster")) return false;
        const br = b.getBoundingClientRect();
        return br.width > innerWidth * 0.6 && br.height > 0 && br.height < innerHeight / 2 && cs.visibility !== "hidden";
      });
      return bars
        .filter((b) => {
          const br = b.getBoundingClientRect();
          return br.top < r.bottom - 4 && br.bottom > r.top + 4;
        })
        .map((b) => `${b.className || b.tagName}`);
    });
    expect.soft(covered, `${where}: campo ${i + 1} focado fica atrás de barra fixa`).toEqual([]);
  }
}

test("ciclo no iPhone: configurar, agendar, atender, receber e retorno", async ({ page }) => {
  // Configurar
  await page.goto("/app/configurar");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await iosChecks(page, "Configurar");

  // Agendar: cada passo do Novo agendamento, com o campo focado à vista
  await page.goto("/app/agenda/novo");
  for (const step of ["Cliente", "Serviço", "Horário", "Revisão"] as const) {
    await toStep(page, step);
    await iosChecks(page, `Novo agendamento · ${step}`);
    await focusedFieldsClear(page, `Novo agendamento · ${step}`);
  }

  // Horários (data e hora nativas)
  await page.goto("/app/horarios");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await iosChecks(page, "Horários");
  await focusedFieldsClear(page, "Horários");

  // Atender e receber: toque duplo no "Recebi" registra uma vez
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
  await iosChecks(page, "Atendimento");
  await page.getByRole("button", { name: "Atendido", exact: true }).tap();
  await page.getByRole("button", { name: /^Recebi R\$\s?60,00 no Pix$/ }).dblclick();
  await expect(page.getByText(/Atendimento concluído e R\$\s?60,00 recebido no Pix/)).toHaveCount(1);
  await expect(page.getByText(/R\$\s?60,00 recebido no Pix/)).toHaveCount(1);

  // Caixa: abrir "Registrar" e o formulário com valor, data e forma
  await page.getByRole("link", { name: "Cobrar no Caixa" }).click();
  await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
  await iosChecks(page, "Caixa");
  await page.getByRole("button", { name: /Registrar/ }).first().tap();
  await iosChecks(page, "Caixa · Registrar");
  await focusedFieldsClear(page, "Caixa · Registrar");

  // Retorno
  await page.getByRole("navigation", { name: "Abas" }).getByRole("link", { name: "Retorno" }).tap();
  await expect(page.getByRole("heading", { name: "Retorno", level: 1 })).toBeVisible();
  await iosChecks(page, "Retorno");
});

test("reserva pelo link no iPhone: perfil público, horário, contato e código", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-iphone");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).tap();
  await page.getByRole("link", { name: "Abrir perfil público" }).tap();
  await expect(page).toHaveURL(/\/p\/barbearia-iphone$/);
  await iosChecks(page, "Perfil público");

  await page.getByRole("button", { name: "Escolher dia e hora" }).tap();
  await page.getByRole("list", { name: "Horários livres" }).getByRole("button").first().tap();
  await iosChecks(page, "Reserva · contato");
  await page.getByLabel("Seu nome").fill("Maria iPhone");
  await page.getByLabel("WhatsApp com DDD").fill("(11) 97777-4343");
  // O teclado numérico do telefone não pode esconder o campo atrás de barra fixa.
  await focusedFieldsClear(page, "Reserva · contato");
  await page.getByRole("button", { name: "Pedir este horário" }).tap();

  await expect(page.getByRole("heading", { name: "Confirme o horário" })).toBeVisible();
  const demo = await page.getByText(/nenhuma mensagem é enviada/).innerText();
  const code = /O código seria (\d{6})/.exec(demo)![1]!;
  const input = page.getByLabel("Código recebido");
  // Código de uma vez: o iOS oferece o código da mensagem acima do teclado quando o campo pede.
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await input.fill(code);
  await iosChecks(page, "Reserva · código");
  await page.getByRole("button", { name: "Confirmar horário" }).tap();
  await expect(page.getByRole("heading", { name: "Horário confirmado" })).toBeVisible();
});
