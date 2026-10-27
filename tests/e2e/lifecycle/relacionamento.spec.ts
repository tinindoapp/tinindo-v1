import { expect, test } from "@playwright/test";

test("relacionamento: fila com estado por palavra, compartilhar texto, réguas com teto, reativação só com público aprovado", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }));
  await page.goto("/app/relacionamento");
  await expect(page.getByRole("heading", { name: "Relacionamento", level: 1 })).toBeVisible();
  await expect(page.getByText("nada é enviado")).toBeVisible();
  const queue = page.getByRole("region", { name: "Fila de mensagens" });
  await expect(queue.getByRole("list", { name: "Contagem por estado" })).toContainText("Enviado ao canal: 1");
  await expect(queue).toContainText("Para você compartilhar");
  await expect(queue).toContainText("mensagem entregue");

  // Passo manual: copiar e marcar como compartilhado (compartilhar não é entregar). Repetir não existe.
  const carlos = queue.getByRole("list", { name: "Passos" }).getByRole("listitem").filter({ hasText: "Confirmação do agendamento · Carlos (exemplo)" });
  await expect(carlos).toContainText("Seu horário de Barba está confirmado");
  await carlos.getByRole("button", { name: "Copiar e marcar como compartilhado" }).click();
  await expect(page.getByText("Compartilhar não confirma entrega.")).toBeVisible();
  await expect(carlos).toContainText("Compartilhado por você");
  await expect(carlos.getByRole("button", { name: "Copiar e marcar como compartilhado" })).toHaveCount(0);

  // Lembrete agendado sai quando vence (régua rodando) e o teto diário adia o excedente.
  await page.getByLabel("Mostrar").selectOption("scheduled");
  await expect(queue.getByRole("list", { name: "Passos" }).getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Mostrar").selectOption("");
  const settings = page.getByRole("form", { name: "Réguas" });
  await settings.getByLabel("Teto de envios por dia").fill("1");
  await settings.getByRole("button", { name: "Salvar réguas" }).click();
  await expect(page.getByText("Réguas salvas.")).toBeVisible();
  await expect(page.getByText("Hoje já saíram 1 pelo canal")).toBeVisible();

  // Reativação: ninguém elegível sem consentimento; o público visto é o aprovado.
  const react = page.getByRole("region", { name: "Reativação (campanha)" });
  await expect(react).toContainText("Ninguém elegível agora.");
  await expect(react.getByRole("button", { name: /Aprovar campanha/ })).toBeDisabled();

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("relacionamento: se a cópia falha, o passo não é marcado como compartilhado", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("negado")) }, configurable: true }));
  await page.goto("/app/relacionamento");
  const queue = page.getByRole("region", { name: "Fila de mensagens" });
  const carlos = queue.getByRole("list", { name: "Passos" }).getByRole("listitem").filter({ hasText: "Confirmação do agendamento · Carlos (exemplo)" });
  await carlos.getByRole("button", { name: "Copiar e marcar como compartilhado" }).click();
  await expect(carlos.getByRole("status")).toHaveText("Não deu para copiar. Toque e segure no link para copiar.");
  await expect(carlos).toContainText("Para você compartilhar");
  await expect(carlos.getByRole("button", { name: "Copiar e marcar como compartilhado" })).toBeVisible();
  const wa = carlos.getByRole("link", { name: "Enviar pelo WhatsApp" });
  expect(await wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=/);
});
