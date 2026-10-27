import { expect, type Page, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

// Navegação interna (sem recarregar): a demonstração guarda o estado na aba.
const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

test("avaliações: cliente avalia atendimento concluído sem o nome aparecer; dono responde; selos separados; lista pública", async ({ page }) => {
  await page.goto("/avaliar");
  await expect(page.getByRole("heading", { name: "Avaliar atendimentos", level: 1 })).toBeVisible();
  const form = page.getByRole("form", { name: /Avaliar Corte em Barbearia Exemplo A/ });
  // Botão sempre ativo: sem nota, explica embaixo da nota e não publica.
  await form.getByRole("button", { name: "Publicar avaliação" }).click();
  await expect(form.getByText("Escolha uma nota de 1 a 5.")).toBeVisible();
  await form.getByRole("radio", { name: "5 – Excelente" }).check();
  await form.getByLabel("Comentário (opcional)").fill("Atendimento pontual, voltarei.");
  await form.getByRole("button", { name: "Publicar avaliação" }).click();
  await expect(page.getByText("Obrigado! Sua avaliação foi publicada sem o seu nome.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Suas avaliações" })).toContainText("Atendimento pontual, voltarei.");

  await soft(page, "/app");
  await openFromNav(page, "Avaliações");
  await expect(page.getByRole("heading", { name: "Avaliações", level: 1 })).toBeVisible();
  const badges = page.getByRole("list", { name: "Selos" });
  await expect(badges).toContainText("Identidade não verificada");
  await expect(badges).toContainText("Competência certificada: não");
  await expect(badges).toContainText("média 4,7");
  const received = page.getByRole("list", { name: "Avaliações recebidas" });
  const item = received.getByRole("listitem").filter({ hasText: "Atendimento pontual" });
  await expect(item).toContainText("cliente com atendimento verificado");
  await item.getByRole("button", { name: "Responder" }).click();
  await page.getByRole("form", { name: "Responder avaliação" }).getByLabel("Sua resposta (pública)").fill("Obrigado, até a próxima!");
  await page.getByRole("button", { name: "Publicar resposta" }).click();
  await expect(page.getByText("Resposta publicada.")).toBeVisible();
  await expect(received).toContainText("Resposta do profissional: Obrigado, até a próxima!");

  await soft(page, "/avaliacoes/barbearia-exemplo-a");
  await expect(page.getByRole("list", { name: "Avaliações publicadas" })).toContainText("Atendimento pontual, voltarei.");
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
