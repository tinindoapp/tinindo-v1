import { expect, type Page, test } from "@playwright/test";
import { expectDemoLabel, noHorizontalScroll } from "./helpers.ts";

// Auditoria da demonstração (docs/qa/AUDITORIA-DEMO-2026-10-25.md): o MESMO atendimento atravessa os módulos na aba.
// Agenda (concluir) → Caixa (sem cobrança → recebido à mão → saldo) → cliente avalia. Concluir não recebe; clique duplo
// não duplica. Roda nos dois projetos do Playwright (desktop e emulação de celular; não é aparelho real).

/** Navegação do próprio app, sem recarregar (recarregar zera a demonstração, por desenho). */
async function softGo(page: Page, path: string) {
  await page.evaluate((href) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

const received = (page: Page) => page.locator(".tn-fin-sum div").filter({ has: page.locator("dt", { hasText: /^Recebido$/ }) }).locator("dd");

test("mesmo atendimento: concluir na agenda → sem cobrança no Caixa → recebido à mão → saldo → avaliação", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
  await page.getByRole("button", { name: "Concluir atendimento" }).click();
  await page.getByRole("button", { name: "Confirmar conclusão" }).dblclick();
  await expect(page.getByText(/Atendimento concluído\. O pagamento não foi registrado/)).toBeVisible();
  await noHorizontalScroll(page);

  // Do atendimento concluído direto para o Caixa, sem recarregar.
  await page.getByRole("link", { name: "Cobrar no Caixa" }).click();
  await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
  await expectDemoLabel(page);
  const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
  await expect(pending.getByRole("listitem")).toHaveCount(3);
  const visit = pending.getByRole("listitem").filter({ hasText: "20/10/2026" });
  await expect(visit).toHaveCount(1);
  await expect(visit).toContainText("Ana");
  await expect(visit).toContainText("R$ 60,00");
  // Concluir não é receber: saldo ainda é o dos exemplos.
  await expect(received(page)).toHaveText("R$ 260,00");
  await noHorizontalScroll(page);

  await visit.getByRole("button", { name: /Marcar como recebido/ }).dblclick();
  await expect(page.getByText(/Recebido R\$\s?60,00 \(.+\) de .*Ana/)).toBeVisible();
  await expect(pending.getByRole("listitem").filter({ hasText: "20/10/2026" })).toHaveCount(0);
  const payments = page.getByRole("region", { name: "Recebimentos no mês" });
  await expect(payments.getByRole("listitem").filter({ hasText: "20/10/2026" }).filter({ hasText: "R$ 60,00" })).toHaveCount(1);
  await expect(received(page)).toHaveText("R$ 320,00");

  // A cliente (Ana, na demonstração) avalia exatamente esse atendimento, uma vez.
  await softGo(page, "/avaliar");
  const form = page.getByRole("form", { name: /Avaliar Corte em Barbearia Exemplo A, 20\/10/ });
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Publicar avaliação" })).toBeDisabled();
  await form.getByLabel("5").check();
  await form.getByRole("button", { name: "Publicar avaliação" }).dblclick();
  await expect(page.getByText("Obrigado! Sua avaliação foi publicada sem o seu nome.")).toBeVisible();
  await expect(page.getByRole("form", { name: /, 20\/10/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Suas avaliações" }).getByRole("listitem")).toHaveCount(1);
  await noHorizontalScroll(page);
});

test("atendimento futuro não conclui e não aparece no Caixa", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /15:00–15:30 Corte/ }).click();
  await expect(page.getByRole("button", { name: "Concluir atendimento" })).toHaveCount(0);
  await softGo(page, "/app/caixa");
  await expect(page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" }).getByRole("listitem")).toHaveCount(2);
});

test("cliente pelo perfil público: avaliações e caminho para avaliar; horário escolhido não vira reserva falsa", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-jornada");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-jornada$/);

  await page.getByRole("list", { name: "Horários livres" }).getByRole("button", { name: "12:00" }).click();
  await expect(page.getByText(/nada foi reservado: a reserva on-line ainda não está disponível/)).toBeVisible();
  await expect(page.getByText(/reserva confirmada|reservado com sucesso/i)).toHaveCount(0);

  await page.getByRole("link", { name: "2 avaliações de clientes" }).click();
  await expect(page).toHaveURL(/\/avaliacoes\/barbearia-jornada$/);
  await expect(page.getByRole("list", { name: "Avaliações publicadas" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("link", { name: "Voltar ao perfil" }).click();
  await page.getByRole("link", { name: "Avaliar meu atendimento" }).click();
  await expect(page).toHaveURL(/\/avaliar$/);
  await expect(page.getByRole("heading", { name: "Avaliar atendimentos" })).toBeVisible();
  await noHorizontalScroll(page);
});

test("versão do build aparece no banner e em /version.json", async ({ page, request }) => {
  await page.goto("/app");
  await expect(page.getByRole("note")).toContainText(/versão [0-9a-f]{7}|versão desconh/);
  const res = await request.get("/version.json");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ commit: expect.any(String), branch: expect.any(String) });
});

// Regressões que a auditoria já viu passar à mão: repetidas aqui para não voltarem.
test.describe("regressões da auditoria", () => {
  test("agendamento com clique duplo cria um só; voltar sem confirmar não cria nada", async ({ page }) => {
    await page.goto("/app/agenda");
    // Voltar no meio do fluxo: nada é criado.
    await page.getByRole("link", { name: "Novo agendamento" }).click();
    await page.getByRole("radio", { name: /Barba/ }).check();
    await page.getByRole("button", { name: "Próximo dia" }).click(); // quarta, 21/10
    await page.getByRole("button", { name: "11:00", exact: true }).click();
    await page.getByRole("link", { name: /Voltar para a agenda/ }).click();

    await page.getByRole("link", { name: "Novo agendamento" }).click();
    await page.getByRole("radio", { name: /Barba/ }).check();
    await page.getByRole("button", { name: "Próximo dia" }).click();
    await page.getByRole("button", { name: "10:30", exact: true }).click();
    await page.getByLabel("Cliente").selectOption({ label: "Cliente Exemplo Bruno" });
    await page.getByRole("button", { name: "Confirmar agendamento" }).dblclick();
    await expect(page.getByText("Agendamento confirmado.")).toBeVisible();

    // Voltar leva à agenda do dia do atendimento (quarta).
    await page.getByRole("link", { name: /Voltar para a agenda/ }).click();
    const timeline = page.getByRole("list", { name: /Linha do tempo de quarta-feira/ });
    await expect(timeline.getByRole("link", { name: /10:30–10:50 Barba/ })).toHaveCount(1);
    await expect(timeline.getByRole("link", { name: /11:00–11:20 Barba/ })).toHaveCount(0);
  });

  test("concluir: voltar no painel não conclui", async ({ page }) => {
    await page.goto("/app/agenda");
    await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
    await page.getByRole("button", { name: "Concluir atendimento" }).click();
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Concluir atendimento" })).toBeVisible();
    await softGo(page, "/app/caixa");
    await expect(page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" }).getByRole("listitem")).toHaveCount(2);
  });

  test("recebimento de valor zero é recusado e o saldo não muda", async ({ page }) => {
    await page.goto("/app/caixa");
    const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    await pending.getByRole("listitem").filter({ hasText: "Bruno" }).getByRole("button", { name: /Cobrar depois/ }).click();
    const open = page.getByRole("region", { name: "A receber" });
    await open.getByRole("button", { name: /Registrar recebimento/ }).click();
    await open.getByLabel("Valor recebido (R$)").fill("0");
    await open.getByRole("button", { name: "Registrar pagamento" }).click();
    await expect(open.getByText("Informe o valor recebido.")).toBeVisible();
    await expect(received(page)).toHaveText("R$ 260,00");
  });
});

test("minhas reservas: a cliente vê o que o dono agenda e conclui na mesma aba, sem ações de alterar", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: "Novo agendamento" }).click();
  await page.getByRole("radio", { name: /Corte/ }).check();
  await page.getByRole("button", { name: "13:00", exact: true }).click();
  await page.getByLabel("Cliente").selectOption({ label: "Cliente Exemplo Ana" });
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByText("Agendamento confirmado.")).toBeVisible();

  await softGo(page, "/app/conta/reservas");
  await expect(page.getByRole("heading", { name: "Minhas reservas", level: 1 })).toBeVisible();
  await expect(page.getByText(/Você vê como a Cliente Exemplo Ana/)).toBeVisible();
  const next = page.getByRole("list", { name: "Próximas reservas" });
  await expect(next.getByRole("listitem")).toHaveCount(4);
  await expect(next).toContainText("13:00–13:30");
  await expect(page.getByRole("list", { name: "Reservas anteriores" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Cancelar|Remarcar|Reagendar/ })).toHaveCount(0);
  await noHorizontalScroll(page);

  // O dono conclui o atendimento das 09:00: para a cliente ele vira "Concluída" e avaliável.
  await softGo(page, "/app/agenda");
  await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
  await page.getByRole("button", { name: "Concluir atendimento" }).click();
  await page.getByRole("button", { name: "Confirmar conclusão" }).click();
  await expect(page.getByText(/Atendimento concluído/)).toBeVisible();
  await softGo(page, "/app/conta/reservas");
  await expect(next.getByRole("listitem")).toHaveCount(3);
  const past = page.getByRole("list", { name: "Reservas anteriores" });
  await expect(past.getByRole("listitem").filter({ hasText: "20/10" })).toContainText("Concluída");
  await past.getByRole("listitem").filter({ hasText: "20/10" }).getByRole("link", { name: "Avaliar" }).click();
  await expect(page).toHaveURL(/\/avaliar$/);
  await expect(page.getByRole("form", { name: /Avaliar Corte em Barbearia Exemplo A, 20\/10/ })).toBeVisible();
});
