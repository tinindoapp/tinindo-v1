import { expect, test } from "@playwright/test";

test("equipe: concluir lança comissão e cobrança; reserva composta prende profissional e cadeira juntas; turma com lotação; novo recurso", async ({ page }) => {
  await page.goto("/app/equipe");
  await expect(page.getByRole("heading", { name: "Equipe", level: 1 })).toBeVisible();
  await expect(page.getByText("nada é cobrado nem enviado")).toBeVisible();

  // Atendimento de ontem: concluir abre a cobrança no Caixa e lança a comissão congelada (50% no corte).
  const agenda = page.getByRole("list", { name: "Reservas da equipe" });
  const yesterday = agenda.getByRole("listitem").filter({ hasText: "Bia" }).first();
  await expect(yesterday).toContainText("Confirmada");
  await expect(yesterday).toContainText("comissão 50%");
  await yesterday.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByText("Cobrança de R$ 60,00 aberta no Caixa e comissão lançada.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Comissões por profissional" })).toContainText("Bia: R$ 30,00 a pagar");

  // Reserva composta: Caio + Cadeira 1 amanhã às 10:00.
  await page.getByRole("button", { name: "Nova reserva" }).click();
  const form = page.getByRole("form", { name: "Nova reserva da equipe" });
  await form.getByLabel("Profissional").selectOption({ label: "Caio (você)" });
  await form.getByLabel("Cadeira: Cadeira 1").check();
  await form.getByRole("button", { name: "Ver horários livres" }).click();
  const slots = form.getByRole("group", { name: "Horários livres" });
  // Caio tem atendimento na agenda individual às 11:00: o horário não aparece.
  await expect(slots.getByRole("button", { name: "11:00", exact: true })).toHaveCount(0);
  await slots.getByRole("button", { name: "10:00", exact: true }).click();
  await form.getByRole("button", { name: "Reservar às 10:00" }).click();
  await expect(page.getByText(/Reservado: Corte com Caio \(você\) \+ Cadeira 1/)).toBeVisible();
  await expect(agenda).toContainText("Caio (você)");

  // A Cadeira 1 está presa às 10:00: com ela, Bia não tem 10:00; com a Cadeira 2, tem.
  await page.getByRole("button", { name: "Nova reserva" }).click();
  await form.getByLabel("Cadeira: Cadeira 1").check();
  await form.getByRole("button", { name: "Ver horários livres" }).click();
  await expect(slots.getByRole("button", { name: "10:00", exact: true })).toHaveCount(0);
  await form.getByLabel("Cadeira: Cadeira 1").uncheck();
  await form.getByLabel("Cadeira: Cadeira 2").check();
  await form.getByRole("button", { name: "Ver horários livres" }).click();
  await expect(slots.getByRole("button", { name: "10:00", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();

  // Turma com uma vaga: a segunda inscrição é recusada.
  await page.getByRole("button", { name: "Nova turma" }).click();
  const classForm = page.getByRole("form", { name: "Nova turma" });
  await classForm.getByLabel("Título").fill("Oficina de barba");
  await classForm.getByLabel("Início").fill("15:00");
  await classForm.getByLabel("Vagas").fill("1");
  await classForm.getByRole("button", { name: "Criar turma" }).click();
  await expect(page.getByText("Turma “Oficina de barba” criada com Bia na Sala de coloração: 1 vagas.")).toBeVisible();
  const classes = page.getByRole("list", { name: "Turmas" });
  await expect(classes).toContainText("0 de 1 vagas");
  await classes.getByRole("button", { name: "Inscrever" }).click();
  await expect(classes).toContainText("1 de 1 vagas");
  await classes.getByLabel("Inscrever cliente").selectOption({ label: "Carlos (exemplo)" });
  await classes.getByRole("button", { name: "Inscrever" }).click();
  await expect(page.getByText("A turma está lotada.")).toBeVisible();

  // Novo recurso.
  await page.getByRole("button", { name: "Novo recurso" }).click();
  const res = page.getByRole("form", { name: "Novo recurso" });
  await res.getByLabel("Tipo").selectOption({ label: "Cadeira" });
  await res.getByLabel("Nome").fill("Cadeira 3");
  await res.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByText("Cadeira “Cadeira 3” cadastrado.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Lista de cadeiras" })).toContainText("Cadeira 3");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
