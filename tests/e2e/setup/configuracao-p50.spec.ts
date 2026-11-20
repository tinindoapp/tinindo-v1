import { expect, test } from "@playwright/test";
import { noHorizontalScroll, softNavigate } from "../qa/helpers.ts";

// P50 · configuração com uma fonte só, em demonstração offline, no celular (375 px) e no desktop:
// - a frase do personal com dois turnos vira dois períodos por dia, e "a domicílio" leva à tela Domicílio;
// - a negação ("não atendo domingo e segunda") vira os outros dias, com aviso para conferir;
// - "Pular" no guia do Assistente fica gravado: a Configuração mostra o passo dispensado e o progresso é o mesmo;
// - a âncora #modelos rola até os modelos depois que eles carregam.

test("frase do personal: dois turnos e domicílio; negação vira aviso; serviços com a duração do modelo", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/configurar#descrever");
  await expect(page.getByRole("heading", { name: "Descreva seu negócio em uma frase" })).toBeFocused();

  await page.getByLabel("Sua frase").fill("Sou personal trainer, atendo a domicílio de segunda a sexta das 6 às 12 e das 17 às 21");
  await page.getByRole("button", { name: "Montar rascunho" }).click();
  const draft = page.getByRole("form", { name: "Rascunho do seu negócio" });
  await expect(draft.getByLabel("Profissão", { exact: true })).toHaveValue("personal_trainer");
  await expect(draft.getByLabel("Início", { exact: true })).toHaveValue("06:00");
  await expect(draft.getByLabel("Fim", { exact: true })).toHaveValue("12:00");
  await expect(draft.getByLabel("Início do 2º período")).toHaveValue("17:00");
  await expect(draft.getByLabel("Fim do 2º período")).toHaveValue("21:00");
  await expect(draft.getByText("Li dois períodos por dia: 06:00 às 12:00 e 17:00 às 21:00. Confira.")).toBeVisible();
  await expect(draft.getByRole("link", { name: "Domicílio" })).toHaveAttribute("href", "/app/domicilio");
  await draft.getByRole("button", { name: "Adicionar Sessão individual (60 min)" }).click();
  await expect(draft.getByLabel("Minutos")).toHaveValue("60");
  await draft.getByLabel("Preço (R$)").fill("120");
  await noHorizontalScroll(page);
  await draft.getByRole("button", { name: "Salvar expediente e serviços" }).click();
  const confirm = page.getByRole("group", { name: "Salvar o rascunho?" });
  await expect(confirm).toContainText("Expediente: segunda a sexta, 06:00 às 12:00 e 17:00 às 21:00");
  await expect(confirm).toContainText("Sessão individual (60 min, R$ 120,00)");
  await confirm.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Salvo: expediente de 5 dias e 1 serviço criado." })).toBeVisible();

  // Negação: os outros dias, com aviso para conferir.
  await page.getByLabel("Sua frase").fill("Não atendo domingo e segunda. Sou barbeiro, das 9 às 20");
  await page.getByRole("button", { name: "Montar de novo" }).click();
  await expect(draft.getByRole("checkbox", { name: "Segunda" })).not.toBeChecked();
  await expect(draft.getByRole("checkbox", { name: "Terça" })).toBeChecked();
  await expect(draft.getByRole("checkbox", { name: "Sábado" })).toBeChecked();
  await expect(draft.getByText("Você disse que não atende domingo e segunda: marquei terça a sábado. Confira.")).toBeVisible();
  await noHorizontalScroll(page);
});

test("'Pular' no guia do Assistente fica gravado e aparece na Configuração; #modelos rola até os modelos", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  // Publica o perfil para o próximo passo ser opcional (o obrigatório não tem "Pular").
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-p50");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await expect(page.getByRole("heading", { name: "Seu perfil está no ar!" })).toBeVisible();

  await softNavigate(page, "/app/assistente");
  await page.getByRole("button", { name: "Me ajuda a configurar" }).click();
  const panel = page.locator("#ag-panel-setup");
  await expect(panel).toContainText("6 de 8");
  await expect(panel.getByRole("heading", { name: /Pôr foto e WhatsApp no perfil/ })).toBeVisible();
  await panel.getByRole("button", { name: "Pular por agora" }).click();
  await expect(panel.getByRole("heading", { name: /Conectar e verificar seu número/ })).toBeVisible();
  await noHorizontalScroll(page);

  // A Configuração lê o mesmo estado: o passo pulado no Assistente aparece dispensado.
  await softNavigate(page, "/app/configurar#modelos");
  await expect(page.getByRole("heading", { name: /Modelos de serviço · Barbearia/ })).toBeFocused();
  const steps = page.getByRole("list", { name: "Passos da configuração" }).getByRole("listitem");
  await expect(steps.filter({ hasText: "Pôr foto e WhatsApp no perfil" })).toContainText("dispensado");
  await expect(page.getByText("Barbearia Exemplo A: 6 de 8 passos feitos.")).toBeVisible();
  // O porquê da antecedência não promete o que o link não mostra.
  await expect(page.getByText(/A política aparece para o cliente antes de reservar/)).toHaveCount(0);
});
