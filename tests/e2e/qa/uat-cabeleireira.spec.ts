import { expect, test } from "@playwright/test";
import { bookFromAgenda, noHorizontalScroll, PENDING } from "./helpers.ts";

// UAT · Cabeleireira (docs/10): serviço de 90min e buffer; não cabe em intervalo de 60min; muda duração
// e verifica novas reservas, preservando as antigas; cliente reagenda para faixa permitida; preço
// contratado não muda.
// A demonstração é de barbearia (Corte 30 min + 10 depois, Barba 20 min + 5 depois); os testes que rodam
// provam a mesma regra de encaixe com esses serviços. O serviço de 90 min fica em fixme.

test.describe("UAT cabeleireira", () => {
  test("1a · cadastra serviço de 90 min com intervalo depois", async ({ page }) => {
    test.fixme(true, PENDING.crmWrite);
    await page.goto("/app/clientes/servicos");
    await page.getByRole("button", { name: "Novo serviço" }).click();
    await page.getByLabel("Nome").fill("Coloração");
    await page.getByLabel("Duração (min)").fill("90");
    await page.getByLabel("Intervalo depois (min)").fill("15");
    await page.getByLabel("Preço base (R$)").fill("180,00");
    await page.getByLabel("Piso (R$)").fill("150,00");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Coloração foi salvo.")).toBeVisible();
  });

  test("1b · serviço de 90 min não é oferecido num intervalo livre de 60 min", async ({ page }) => {
    test.fixme(true, `${PENDING.crmWrite} Depende de 1a para existir um serviço de 90 min.`);
    await page.goto("/app/agenda/novo?data=2026-10-20");
    await page.getByRole("radio", { name: /Coloração/ }).check();
    await expect(page.getByRole("button", { name: "14:00", exact: true })).toHaveCount(0);
  });

  test("1c · duração + intervalo decidem o encaixe antes da próxima reserva", async ({ page }) => {
    // Terça: livre 13:00–15:00, próxima reserva às 15:00.
    await page.goto("/app/agenda/novo?data=2026-10-20");
    const slots = page.getByRole("group", { name: "Horários livres" });

    await page.getByRole("radio", { name: /Corte/ }).check(); // 30 min + 10 depois
    await expect(slots.getByRole("button", { name: "14:15", exact: true })).toBeVisible(); // termina 14:55
    await expect(slots.getByRole("button", { name: "14:30", exact: true })).toHaveCount(0); // 15:10 invade

    await page.getByRole("radio", { name: /Barba/ }).check(); // 20 min + 5 depois
    await expect(slots.getByRole("button", { name: "14:30", exact: true })).toBeVisible(); // termina 14:55
    await expect(slots.getByRole("button", { name: "14:45", exact: true })).toHaveCount(0); // 15:10 invade

    // Pausa de almoço (12:00–13:00) nunca vira vaga.
    await expect(slots.getByRole("button", { name: "12:00", exact: true })).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test("2 · muda a duração do serviço: novas reservas usam a nova, antigas ficam como estavam", async ({ page }) => {
    test.fixme(true, PENDING.crmWrite);
    await page.goto("/app/clientes/servicos");
    await page.getByRole("button", { name: "Editar Corte" }).click();
    await page.getByLabel("Duração (min)").fill("45");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.goto("/app/agenda");
    await expect(page.getByRole("link", { name: /09:00–09:30 Corte/ })).toBeVisible();
  });

  test("3a · reagendar só oferece horários livres e não volta para o passado", async ({ page }) => {
    await page.goto("/app/agenda");
    await page.getByRole("link", { name: /09:40–10:10 Corte Cliente Exemplo Bruno/ }).click();
    await page.getByRole("link", { name: "Reagendar" }).click();
    await expect(page.getByRole("heading", { name: "Reagendar atendimento" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dia anterior" })).toBeDisabled();
    const slots = page.getByRole("group", { name: "Horários livres" });
    await expect(slots.getByRole("button", { name: "13:00", exact: true })).toBeVisible();
    // 10:20 é da Barba do mesmo cliente; 15:00 é outro corte.
    await expect(slots.getByRole("button", { name: "10:20", exact: true })).toHaveCount(0);
    await expect(slots.getByRole("button", { name: "15:00", exact: true })).toHaveCount(0);
    await slots.getByRole("button", { name: "13:00", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar reagendamento" }).click();
    await expect(page.getByText("Atendimento reagendado.")).toBeVisible();
    await expect(page.getByText(/terça-feira, 20 de outubro, 13:00–13:30/)).toBeVisible();
  });

  test("3b · a própria cliente reagenda pelo link, dentro da política", async ({ page }) => {
    test.fixme(true, PENDING.clientReschedule);
    await page.goto("/app/conta");
    await page.getByRole("link", { name: /Reagendar/ }).click();
  });

  test("4a · preço combinado não muda sozinho; mudança no reagendamento é explícita", async ({ page }) => {
    await page.goto("/app/agenda");
    await page.getByRole("link", { name: /15:00–15:30 Corte Cliente Exemplo Bruno Confirmado R\$ 51,00/ }).click();
    await expect(page.getByText("R$ 51,00")).toBeVisible();

    await page.getByRole("link", { name: "Reagendar" }).click();
    await page.getByRole("button", { name: "Próximo dia" }).click(); // quarta: sem a regra de terça
    await page.getByRole("button", { name: "10:30", exact: true }).click();
    await expect(page.getByText("Preço combinado hoje: R$ 51,00. Ao confirmar, passa a valer R$ 60,00.")).toBeVisible();

    // Desistir do reagendamento preserva o preço contratado.
    await page.getByRole("link", { name: /Voltar para o atendimento/ }).click();
    await expect(page.getByText("R$ 51,00")).toBeVisible();
    await expect(page.getByText("R$ 60,00")).toHaveCount(0);
  });

  test("4b · reagendar dentro da mesma regra mantém o preço sem aviso de mudança", async ({ page }) => {
    await page.goto("/app/agenda");
    await bookFromAgenda(page, { service: /Corte/, slot: "13:00", customer: "Cliente Exemplo Ana" });
    await expect(page.getByText("R$ 51,00")).toBeVisible();
    await page.getByRole("link", { name: "Reagendar" }).click();
    await page.getByRole("button", { name: "14:00", exact: true }).click();
    await expect(page.getByText(/Preço combinado hoje/)).toHaveCount(0);
    await page.getByRole("button", { name: "Confirmar reagendamento" }).click();
    await expect(page.getByText("Atendimento reagendado.")).toBeVisible();
    await expect(page.getByText("R$ 51,00")).toBeVisible();
  });

  test("4c · alterar o preço base do serviço não altera reservas já confirmadas", async ({ page }) => {
    test.fixme(true, PENDING.crmWrite);
    await page.goto("/app/clientes/servicos");
    await page.getByRole("button", { name: "Editar Corte" }).click();
    await page.getByLabel("Preço base (R$)").fill("80,00");
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.goto("/app/agenda");
    await expect(page.getByRole("link", { name: /09:00–09:30 Corte .* R\$ 60,00/ })).toBeVisible();
  });
});
