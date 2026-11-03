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
  // Item 43: resumo no topo, selos só positivos (pílulas) e a verificação de identidade como tarefa.
  const profile = page.getByRole("region", { name: "Seu perfil" });
  await expect(profile).toContainText("4,7 ★ · 3 avaliações");
  const badges = page.getByRole("list", { name: "Selos" });
  await expect(badges).not.toContainText("não verificada");
  await expect(badges).not.toContainText("Competência certificada");
  await expect(badges).toContainText("atendimentos concluídos na Tinindo");
  await profile.getByText("Verifique sua identidade").click();
  await expect(profile).toContainText("videochamada com documento ou pelo gov.br");
  const received = page.getByRole("list", { name: "Avaliações recebidas" });
  const item = received.getByRole("listitem").filter({ hasText: "Atendimento pontual" });
  await expect(item).toContainText("cliente com atendimento verificado");
  // Item 44: "Denunciar" fica no "⋯"; responder foca o campo, conta os caracteres e mostra a prévia pública.
  await expect(item.getByRole("button", { name: /^Denunciar/ })).toHaveCount(0);
  await expect(item.getByRole("button", { name: /^Mais ações para a avaliação/ })).toBeVisible();
  await item.getByRole("button", { name: "Responder" }).click();
  const replyForm = page.getByRole("form", { name: "Responder avaliação" });
  const replyField = replyForm.getByLabel("Sua resposta (pública)");
  await expect(replyField).toBeFocused();
  await expect(replyForm).toContainText("0/600");
  await replyForm.getByRole("button", { name: "Obrigado pela avaliação!" }).click();
  await expect(replyField).toHaveValue("Obrigado pela avaliação! ");
  await replyField.fill("Obrigado, até a próxima!");
  await expect(replyForm).toContainText("24/600");
  await expect(replyForm.getByRole("region", { name: "Prévia pública" })).toContainText("Resposta do profissional: Obrigado, até a próxima!");
  await page.getByRole("button", { name: "Publicar resposta" }).click();
  await expect(page.getByText("Resposta publicada.")).toBeVisible();
  await expect(received).toContainText("Resposta do profissional: Obrigado, até a próxima!");

  await soft(page, "/avaliacoes/barbearia-exemplo-a");
  await expect(page.getByRole("list", { name: "Avaliações publicadas" })).toContainText("Atendimento pontual, voltarei.");
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("avaliações: denunciar pelo “⋯” pede o motivo; Esc no menu e Voltar devolvem o foco", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app/avaliacoes");
  const item = page.getByRole("list", { name: "Avaliações recebidas" }).getByRole("listitem").filter({ hasText: "Pontual e caprichoso." });
  const more = item.getByRole("button", { name: /^Mais ações para a avaliação/ });
  await more.click();
  await page.getByRole("menuitem", { name: "Denunciar…" }).click();
  const confirm = item.getByRole("group", { name: "Denunciar esta avaliação?" });
  await expect(confirm).toContainText("continua visível");
  await confirm.getByRole("button", { name: "Sim, denunciar" }).click();
  await expect(confirm.getByText("Escolha o motivo da denúncia.")).toBeVisible();
  await expect(confirm.getByLabel("Motivo")).toBeFocused();
  await confirm.getByRole("button", { name: "Voltar" }).click();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("menuitem", { name: "Denunciar…" }).click();
  await item.getByRole("group", { name: "Denunciar esta avaliação?" }).getByLabel("Motivo").selectOption({ label: "Expõe dados pessoais" });
  await item.getByRole("button", { name: "Sim, denunciar" }).click();
  await expect(page.getByText("Denúncia enviada.")).toBeVisible();
  await expect(item).toContainText("Denúncia em análise pela moderação.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});
