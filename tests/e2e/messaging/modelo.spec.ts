import { expect, test } from "@playwright/test";
import { clientWrites, connectSimulated, soft } from "./helpers.ts";

// Auditoria de UX, itens 20, 39 e 41: selo de não lidas na aba Mensagens; modelo aprovado com nome legível, campos com
// nome e prévia; no celular numa folha inferior (foco preso, Esc devolve o foco, fundo travado), no desktop num cartão
// rolado até a vista com o foco no primeiro campo.
for (const scheme of ["light", "dark"] as const) {
  test(`mensagens: selo de não lidas e modelo aprovado na folha ou no cartão (${scheme})`, async ({ page, isMobile }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/app/mensagens");
    await connectSimulated(page);
    await soft(page, "/app/mensagens/simulador");
    await clientWrites(page, "+5511988887777", "Oi! Tem horário quarta?");
    await soft(page, "/app/mensagens");

    // Selo com o número escrito: na barra de abas (celular) ou no menu lateral (desktop).
    const nav = page.getByRole("navigation", { name: isMobile ? "Abas" : "Principal" });
    const tab = nav.getByRole("link", { name: "Mensagens, 1 não lida" });
    await expect(tab).toBeVisible();
    if (isMobile) {
      const badge = (await tab.locator(".tn-tabbar__badge").boundingBox())!;
      const tabBox = (await tab.boundingBox())!;
      expect(badge.y).toBeGreaterThanOrEqual(tabBox.y);
      expect(badge.x + badge.width).toBeLessThanOrEqual(tabBox.x + tabBox.width + 1);
    }

    const inbox = page.getByRole("region", { name: "Caixa de entrada" });
    await inbox.getByRole("link", { name: /Ana Beatriz/ }).click();
    await expect(page.getByRole("heading", { name: "Ana Beatriz (exemplo)", level: 1 })).toBeVisible();
    // Ao abrir a conversa, o selo some.
    await expect(nav.getByRole("link", { name: "Mensagens", exact: true })).toBeVisible();

    const open = page.getByRole("button", { name: "Enviar modelo aprovado" });
    await open.click();
    const form = page.getByRole("form", { name: "Enviar modelo aprovado" });
    await expect(form.getByLabel("Modelo")).toBeFocused();
    await expect(form.getByLabel("Modelo").locator("option").first()).toHaveText("Confirmação de horário");
    await expect(form).not.toContainText("confirmacao_agendamento");
    await expect(form.getByLabel("Nome da cliente")).toHaveValue("Ana");
    const preview = form.getByRole("region", { name: "Prévia da mensagem" });
    await expect(preview).toContainText("Olá, Ana! Seu horário de [Serviço]");

    if (isMobile) {
      const sheet = page.getByRole("dialog", { name: "Enviar modelo aprovado" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute("aria-modal", "true");
      // Fundo travado e folha presa embaixo, dentro da tela.
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
      // A folha sobe com animação (translateY de 24 px): mede depois que ela termina.
      await sheet.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const box = (await sheet.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      // Botão principal fixo no rodapé da folha.
      const send = sheet.getByRole("button", { name: "Enviar modelo" });
      await expect(send).toBeInViewport();
      // Foco preso: Shift+Tab do primeiro campo vai para dentro da folha, nunca para a página atrás.
      for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Tab");
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      // Esc fecha e devolve o foco ao botão que abriu.
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(open).toBeFocused();
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
      await open.click();
      await expect(page.getByRole("dialog", { name: "Enviar modelo aprovado" })).toBeVisible();
    } else {
      // Desktop: cartão na própria tela, rolado até a vista.
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Enviar modelo aprovado" })).toBeInViewport();
    }

    // Todos os campos vazios apontados de uma vez; preencher atualiza a prévia; enviar fecha e avisa.
    await form.getByRole("button", { name: "Enviar modelo" }).click();
    await expect(form.getByText("Preencha “Serviço”.")).toBeVisible();
    await expect(form.getByText("Preencha “Dia e hora”.")).toBeVisible();
    await expect(form.getByLabel("Serviço")).toBeFocused();
    await form.getByLabel("Serviço").fill("Corte");
    await form.getByLabel("Dia e hora").fill("quarta às 10h");
    await expect(preview).toContainText("Seu horário de Corte está confirmado para quarta às 10h.");
    await form.getByRole("button", { name: "Enviar modelo" }).click();
    await expect(page.getByText(/Confirmação de horário na fila/)).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Mensagens da conversa" })).toContainText("Seu horário de Corte está confirmado");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
}
