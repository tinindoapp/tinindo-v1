import { expect, test } from "@playwright/test";
import { noHorizontalScroll, softNavigate } from "../qa/helpers.ts";

// P44 · jornada pela Home, no celular e no desktop, em demonstração offline: o cartão "Deixe seu negócio pronto"
// aponta o próximo passo, leva à tela que resolve, o perfil vai ao ar e o link público abre; os opcionais são
// dispensados e o cartão some. Depois, a frase do negócio vira rascunho revisável e os modelos viram serviços só
// depois da confirmação. Com banco real a mesma jornada roda em tests/integration/46_p44_configuracao.

test("negócio pronto pela Home: próximo passo → perfil no ar → link público; opcionais dispensados; linha some", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app");
  // P48 (decisão D6): com atendimento no dia, a configuração é uma linha fina, abaixo do dia, com o próximo passo como link.
  const card = page.getByRole("region", { name: /Deixe seu negócio pronto/ });
  await expect(card).toBeVisible();
  // P51: "Conectar e verificar seu número" sai da conta enquanto Mensagens está guardado: 7 passos.
  await expect(card).toContainText("5 de 7");
  await expect(card.getByRole("progressbar", { name: "Passos feitos" })).toHaveAttribute("aria-valuenow", "5");
  await expect(card).not.toContainText("O link público é como o cliente reserva com você.");
  const lineBox = (await card.boundingBox())!;
  expect(lineBox.height).toBeLessThanOrEqual(96);
  await noHorizontalScroll(page);

  // O link do próximo passo leva direto à tela que resolve.
  await card.getByRole("link", { name: /^Publicar perfil/ }).click();
  await expect(page.getByRole("heading", { name: "Seu perfil público" })).toBeVisible();
  await page.getByLabel("Endereço do perfil").fill("barbearia-pronta");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await expect(page.getByRole("heading", { name: "Seu perfil está no ar!" })).toBeVisible();

  // O link público abre fora do shell e mostra o negócio.
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-pronta$/);
  await expect(page.getByRole("heading", { name: /Barbearia Exemplo A/ }).first()).toBeVisible();
  await noHorizontalScroll(page);

  // De volta à Home (sem recarregar, para manter a demonstração): o passo ficou feito e o próximo é opcional.
  await softNavigate(page, "/app");
  await expect(card).toContainText("6 de 7");
  await expect(card.getByRole("link", { name: /^Pôr foto e WhatsApp/ })).toHaveAttribute("href", "/app/perfil");

  // Opcionais são dispensados na tela Configuração (o título da linha leva até lá); obrigatórios não têm "Agora não".
  await card.getByRole("link", { name: "Deixe seu negócio pronto" }).click();
  await expect(page.getByRole("heading", { name: "Deixe seu negócio pronto", level: 1 })).toBeVisible();
  const steps = page.getByRole("list", { name: "Passos da configuração" }).getByRole("listitem");
  await steps.filter({ hasText: "Pôr foto e WhatsApp no perfil" }).getByRole("button", { name: "Agora não" }).click();
  await expect(steps.filter({ hasText: "Pôr foto e WhatsApp no perfil" })).toContainText("dispensado");
  // O passo do canal não aparece no piloto (Mensagens guardado): não há o que dispensar.
  await expect(steps.filter({ hasText: "Conectar e verificar seu número" })).toHaveCount(0);
  await softNavigate(page, "/app");
  await expect(page.getByRole("heading", { name: "Atendimentos de hoje" })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("configuração: passos com por quê, frase do negócio vira rascunho revisável e modelos só criam depois de confirmar", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/configurar");
  await expect(page.getByRole("heading", { name: "Deixe seu negócio pronto", level: 1 })).toBeVisible();
  // D11 (b): sem aviso de demonstração por tela; a faixa do topo já diz.
  await expect(page.getByText("Demonstração: o que você salvar aqui vale só nesta aba.")).toHaveCount(0);
  // P54: o próximo passo em destaque e o outro que falta à vista; os 5 feitos recolhidos até "Ver os feitos".
  const steps = page.getByRole("list", { name: "Passos da configuração" }).getByRole("listitem");
  await expect(steps).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Passos · 5 de 7 feitos" })).toBeVisible();
  await expect(steps.nth(0)).toContainText("Próximo passo");
  await expect(steps.nth(0)).toContainText("Publicar seu perfil e mandar o link");
  await expect(steps.nth(0).getByRole("link", { name: /Publicar perfil/ })).toHaveAttribute("href", "/app/perfil");
  await expect(steps.nth(0).getByRole("button", { name: "Agora não" })).toHaveCount(0);
  await expect(steps.nth(1).getByRole("button", { name: /Agora não/ })).toBeVisible();
  await page.getByRole("button", { name: "Ver os feitos (5)" }).click();
  await expect(steps).toHaveCount(7);
  await expect(steps.nth(4)).toContainText("Definir a antecedência para cancelar");
  await expect(steps.nth(4)).toContainText("Feito");
  await expect(steps.nth(4).getByRole("button", { name: /Agora não/ })).toHaveCount(0);

  // Frase → rascunho (seção recolhida: horários e serviço já estão feitos); nada salvo até confirmar.
  await page.getByRole("heading", { name: "Descreva seu negócio em uma frase" }).click();
  await page.getByLabel("Sua frase").fill("Sou barbeiro, sozinho, de terça a sábado das 9 às 19. Faço sobrancelha.");
  await page.getByRole("button", { name: "Montar rascunho" }).click();
  const draft = page.getByRole("form", { name: "Rascunho do seu negócio" });
  await expect(draft.getByLabel("Profissão")).toHaveValue("barber");
  await expect(draft.getByRole("checkbox", { name: "Terça" })).toBeChecked();
  await expect(draft.getByRole("checkbox", { name: "Segunda" })).not.toBeChecked();
  await expect(draft.getByLabel("Início")).toHaveValue("09:00");
  await expect(draft.getByLabel("Fim")).toHaveValue("19:00");
  await expect(draft.getByLabel("Serviço 1")).toHaveValue("Sobrancelha");
  await draft.getByLabel("Minutos").fill("15");
  await draft.getByLabel("Preço (R$)").fill("25,00");
  await draft.getByRole("button", { name: "Salvar expediente e serviços" }).click();
  const confirm = page.getByRole("group", { name: "Salvar o rascunho?" });
  await expect(confirm).toContainText("Expediente: terça a sábado, 09:00 às 19:00");
  await expect(confirm).toContainText("Serviços: Sobrancelha (15 min, R$ 25,00).");
  await confirm.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Salvo: expediente de 5 dias e 1 serviço criado." })).toBeVisible();

  // Modelos: já no catálogo vira texto; marcar pede o preço; criar só depois da confirmação.
  await page.getByRole("heading", { name: /Modelos de serviço · Barbearia/ }).click();
  await expect(page.getByText("Já no catálogo: Corte, Barba.")).toBeVisible();
  const models = page.getByRole("form", { name: "Modelos de serviço" });
  await expect(models.getByRole("checkbox", { name: /^Corte$/ })).toHaveCount(0);
  await models.getByRole("checkbox", { name: /Corte e barba/ }).check();
  const price = models.getByLabel("Preço de Corte e barba (R$)");
  await expect(price).toHaveValue("55,00");
  await price.fill("70");
  await models.getByRole("button", { name: "Criar 1 serviço" }).click();
  const create = page.getByRole("group", { name: "Criar os serviços marcados?" });
  await expect(create).toContainText("Corte e barba (50 min, R$ 70,00)");
  await create.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 serviço criado: Corte e barba." })).toBeVisible();
  await expect(page.getByText("Já no catálogo: Corte, Barba, Corte e barba.")).toBeVisible();
  await expect(models).toHaveCount(0);
  await noHorizontalScroll(page);
});

test("estado vazio com dica e botão: dia sem expediente leva aos horários; serviços e caixa apontam o próximo passo", async ({ page }) => {
  // Domingo 25/10 da demonstração não tem expediente: a agenda explica e oferece a tela de horários.
  await page.goto("/app/agenda?data=2026-10-25");
  await expect(page.getByText("Sem expediente neste dia.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Definir horários" })).toHaveAttribute("href", "/app/agenda/horarios");
  await noHorizontalScroll(page);
});
