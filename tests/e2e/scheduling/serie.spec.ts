import { expect, type Page, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

// "Repetir toda semana" (decisão D8 a) em demonstração offline: a emulação segue a mesma regra de booking.create_series.
// A demonstração é a da barbearia de exemplo (serviços Corte e Barba); a jornada é a do personal: aluno fixo, duas
// vezes por semana, no mesmo horário. O navegador roda em outro fuso para provar que as datas seguem o fuso do negócio.
test.use({ timezoneId: "Asia/Tokyo" });

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test("personal: aluno fixo terça e quinta às 7h por 8 semanas vira 16 atendimentos", async ({ page }) => {
  // O expediente de exemplo abre às 09:00: o personal atende terça e quinta desde as 07:00.
  await page.goto("/app/agenda/horarios");
  for (const day of ["Terça", "Quinta"]) {
    const group = page.getByRole("group", { name: day });
    await group.getByRole("button", { name: `Editar ${day}` }).click();
    await group.getByLabel("Início").first().fill("07:00");
  }
  await page.getByRole("button", { name: "Salvar expediente" }).click();
  await expect(page.locator(".tn-toast")).toContainText("Expediente salvo.");

  // Navegação dentro do app: a emulação guarda o estado só enquanto a página não recarrega.
  await openFromNav(page, "Agenda");
  await page.getByRole("link", { name: "Novo agendamento" }).click();
  await page.getByRole("button", { name: "+ Novo cliente" }).click();
  const novo = page.getByRole("form", { name: "Novo cliente" });
  await novo.getByLabel("Nome").fill("Aluno Fixo Rafael");
  await novo.getByRole("button", { name: "Cadastrar e escolher" }).click();
  await expect(page.getByText("Aluno Fixo Rafael foi cadastrado e escolhido.")).toBeVisible();

  // Hoje é terça 20/10, 09:00: a terça das 07:00 já passou, então a primeira data é a quinta 22/10.
  await page.getByRole("checkbox", { name: /Repetir toda semana/ }).check();
  const form = page.getByRole("form", { name: "Repetir toda semana" });
  await expect(form.getByRole("checkbox", { name: "Terça" })).toBeChecked();
  await form.getByRole("checkbox", { name: "Quinta" }).check();
  await form.getByLabel("Horário").fill("07:00");
  await form.getByLabel("Quantas semanas").fill("8");

  // Prévia: as 16 datas, todas livres, antes de qualquer gravação.
  const dates = form.getByRole("list", { name: "Datas da repetição" });
  await expect(dates.getByRole("listitem")).toHaveCount(16);
  await expect(dates.getByRole("listitem").first()).toContainText("22/10 · 07:00–07:30");
  await expect(dates.getByRole("listitem").last()).toContainText("15/12 · 07:00–07:30");
  await expect(dates.getByText("Livre", { exact: true })).toHaveCount(16);
  await expect(form.getByText("16 datas: 16 livres.")).toBeVisible();
  await expect(form.getByText(/Toda semana: terça e quinta, às 07:00\./)).toBeVisible();
  await expect(form.getByText(/Nada é criado até você confirmar\./)).toBeVisible();
  await expect(form.getByRole("region", { name: "Resumo da repetição" })).toContainText("16 agendamentos · Corte · 07:00");
  await noHorizontalScroll(page);

  await form.getByRole("button", { name: "Confirmar repetição" }).click();
  const done = page.getByRole("region", { name: "16 agendamentos criados" });
  await expect(done).toBeVisible();
  await expect(done).toContainText("Aluno Fixo Rafael · Corte · toda semana: terça e quinta, às 07:00.");
  await expect(done).toContainText("De quinta-feira, 22 de outubro a terça-feira, 15 de dezembro.");
  await expect(done).toContainText("Nenhuma data ficou de fora.");
  await noHorizontalScroll(page);

  // Agenda: a primeira data, com a marca da repetição.
  await done.getByRole("link", { name: "Ver na agenda" }).click();
  await expect(page.getByRole("heading", { name: /quinta-feira, 22 de outubro/ })).toBeVisible();
  const first = page.getByRole("list", { name: /Linha do tempo/ }).getByRole("listitem").filter({ hasText: "07:00–07:30" });
  await expect(first).toContainText("Aluno Fixo Rafael");
  await expect(first).toContainText("Repete toda semana · 1 de 16");
  await noHorizontalScroll(page);

  // Detalhe: indicador, o próximo da repetição e só "Cancelar só este" (o servidor não cancela os próximos de uma vez).
  await first.getByRole("link").click();
  await expect(page.getByText(/quinta-feira, 22 de outubro, 07:00–07:30/)).toBeVisible();
  await expect(page.getByText("Repete toda semana · 1 de 16")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar só este" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancelar os próximos/ })).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.getByRole("link", { name: "Abrir o próximo" }).click();
  await expect(page.getByText(/terça-feira, 27 de outubro, 07:00–07:30/)).toBeVisible();
  await expect(page.getByText("Repete toda semana · 2 de 16")).toBeVisible();
});

test.describe("celular de 375 px", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("prévia com conflito marcado, alvos de 44 px e nenhuma rolagem lateral", async ({ page }) => {
    await page.goto("/app/agenda/novo?data=2026-10-21");
    await page.getByRole("checkbox", { name: /Repetir toda semana/ }).check();
    const form = page.getByRole("form", { name: "Repetir toda semana" });
    await form.getByRole("checkbox", { name: "Quarta" }).uncheck();
    await form.getByRole("checkbox", { name: "Quinta" }).check();
    await form.getByLabel("Horário").fill("09:00");
    await form.getByLabel("Quantas semanas").fill("3");

    // Quinta 22/10 às 09:00 já tem o Corte da Ana: a data aparece marcada antes de confirmar.
    const dates = form.getByRole("list", { name: "Datas da repetição" });
    await expect(dates.getByRole("listitem")).toHaveCount(3);
    await expect(dates.getByRole("listitem").first()).toContainText("22/10");
    await expect(dates.getByRole("listitem").first()).toContainText("Indisponível: fica de fora");
    await expect(form.getByText("3 datas: 2 livres e 1 fica de fora.")).toBeVisible();
    await noHorizontalScroll(page);

    for (const target of [
      form.locator(".tn-chip").filter({ hasText: "Qui" }),
      form.getByLabel("Horário"),
      form.getByLabel("Quantas semanas"),
      form.locator(".tn-segmented__track"),
      form.getByRole("button", { name: "Confirmar repetição" }),
    ]) {
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // "Até uma data" dá as mesmas três quintas.
    await form.locator("label").filter({ hasText: "Até uma data" }).click();
    await form.getByLabel("Último dia").fill("2026-11-05");
    await expect(dates.getByRole("listitem")).toHaveCount(3);
    await noHorizontalScroll(page);

    await page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: "Cliente Exemplo Bruno" }).check();
    await form.getByRole("button", { name: "Confirmar repetição" }).click();
    const done = page.getByRole("region", { name: "2 agendamentos criados" });
    await expect(done).toContainText("1 data ficou de fora");
    await expect(done.getByRole("list", { name: "Datas que ficaram de fora" })).toContainText("quinta-feira, 22 de outubro, 09:00–09:30");
    await noHorizontalScroll(page);
  });
});
