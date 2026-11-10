import { expect, type Page, test } from "@playwright/test";
import { expectDemoLabel, noHorizontalScroll } from "./helpers.ts";

// Auditoria da demonstração (docs/qa/AUDITORIA-DEMO-2026-10-25.md): o MESMO atendimento atravessa os módulos na aba.
// Agenda ("Atendido" → "Recebi R$ 60,00 no Pix", P48) → Caixa (recebido à mão → saldo) → cliente avalia. Concluir e
// receber continuam sendo registros separados; clique duplo não duplica. Roda nos dois projetos do Playwright (desktop
// e emulação de celular; não é aparelho real).

/** Navegação do próprio app, sem recarregar (recarregar zera a demonstração, por desenho). */
async function softGo(page: Page, path: string) {
  await page.evaluate((href) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

const received = (page: Page) => page.locator(".tn-fin-sum div").filter({ has: page.locator("dt", { hasText: /^Recebido$/ }) }).locator("dd");

test("mesmo atendimento: Atendido na agenda → Recebi no Pix → recebido no Caixa → saldo → avaliação", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
  await page.getByRole("button", { name: "Atendido", exact: true }).click();
  // P48: no lugar da confirmação, as saídas do Caixa. Um toque conclui e registra; o toque duplo não duplica.
  await page.getByRole("button", { name: /^Recebi R\$\s?60,00 no Pix$/ }).dblclick();
  await expect(page.getByText(/Atendimento concluído e R\$\s?60,00 recebido no Pix\. Registro manual no Caixa\./)).toBeVisible();
  await noHorizontalScroll(page);

  // Do atendimento concluído direto para o Caixa, sem recarregar: o link leva ao próprio atendimento.
  await page.getByRole("link", { name: "Cobrar no Caixa" }).click();
  await expect(page).toHaveURL(/\/app\/caixa\?atendimento=60000000-0000-4000-8000-000000000001$/);
  await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
  await expectDemoLabel(page);
  const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
  // Já cobrado e recebido: fora das pendências (ficam os dois de segunda 19/10 e o Corte de 28/09).
  await expect(pending.getByRole("listitem")).toHaveCount(3);
  await expect(pending.getByRole("listitem").filter({ hasText: "20/10/2026" })).toHaveCount(0);
  // Um recebimento só, de R$ 60,00 no dia, e o saldo do mês sobe uma vez.
  const payments = page.getByRole("region", { name: "Recebimentos no mês" });
  await expect(payments.getByRole("listitem").filter({ hasText: "20/10/2026" }).filter({ hasText: "R$ 60,00" })).toHaveCount(1);
  await expect(received(page)).toHaveText("R$ 1.800,00");
  const today = page.getByRole("region", { name: "Recebido", exact: true }).locator("div").filter({ hasText: /^Hoje/ }).locator("dd");
  await expect(today).toHaveText(/R\$\s?60,00/);
  await noHorizontalScroll(page);

  // A cliente (Ana, na demonstração) avalia exatamente esse atendimento, uma vez.
  await softGo(page, "/avaliar");
  const form = page.getByRole("form", { name: /Avaliar Corte em Barbearia Exemplo A, 20\/10/ });
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Publicar avaliação" })).toBeEnabled();
  await form.getByRole("radio", { name: "5 – Excelente" }).check();
  await form.getByRole("button", { name: "Publicar avaliação" }).dblclick();
  await expect(page.getByText("Obrigado! Sua avaliação foi publicada sem o seu nome.")).toBeVisible();
  await expect(page.getByRole("form", { name: /, 20\/10/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Suas avaliações" }).getByRole("listitem")).toHaveCount(1);
  await noHorizontalScroll(page);
});

test("atendimento futuro não conclui e não aparece no Caixa", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /15:00–15:30 Corte/ }).click();
  await expect(page.getByRole("button", { name: "Atendido", exact: true })).toHaveCount(0);
  await softGo(page, "/app/caixa");
  await expect(page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" }).getByRole("listitem")).toHaveCount(3);
});

test("cliente pelo perfil público: avaliações e caminho para avaliar; escolher horário não vira reserva sem o código", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-jornada");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-jornada$/);

  // Reserva em etapas (auditoria E4): o serviço vem marcado; segue para o dia e a hora.
  await page.getByRole("button", { name: "Escolher dia e hora" }).click();
  await page.getByRole("list", { name: "Horários livres" }).getByRole("button").first().click();
  await expect(page.getByRole("form", { name: "Pedir horário" })).toBeVisible();
  await expect(page.getByText(/horário confirmado|reserva confirmada|reservado com sucesso/i)).toHaveCount(0);

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
    await page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: "Cliente Exemplo Bruno" }).check();
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
    await page.getByRole("button", { name: "Atendido", exact: true }).click();
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Atendido", exact: true })).toBeVisible();
    await softGo(page, "/app/caixa");
    await expect(page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" }).getByRole("listitem")).toHaveCount(3);
  });

  test("recebimento de valor zero é recusado e o saldo não muda", async ({ page }) => {
    await page.goto("/app/caixa");
    const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    await pending.getByRole("listitem").filter({ hasText: "Bruno" }).filter({ hasText: "19/10/2026" }).getByRole("button", { name: /Cobrar depois/ }).click();
    const open = page.getByRole("region", { name: "A receber" });
    await open.getByRole("button", { name: "Registrar recebimento de Barba", exact: true }).click();
    await open.getByLabel("Valor recebido (R$)").fill("0");
    await open.getByRole("button", { name: "Registrar pagamento" }).click();
    await expect(open.getByText("Informe o valor recebido.")).toBeVisible();
    await expect(received(page)).toHaveText("R$ 1.740,00");
  });
});

test("minhas reservas: a cliente vê o que o dono agenda e conclui na mesma aba, sem ações de alterar", async ({ page }) => {
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: "Novo agendamento" }).click();
  await page.getByRole("radio", { name: /Corte/ }).check();
  await page.getByRole("button", { name: "13:00", exact: true }).click();
  await page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: "Cliente Exemplo Ana" }).check();
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
  await page.getByRole("button", { name: "Atendido", exact: true }).click();
  await page.getByRole("button", { name: "Cobrar depois", exact: true }).click();
  await expect(page.getByText(/Atendimento concluído/)).toBeVisible();
  await softGo(page, "/app/conta/reservas");
  await expect(next.getByRole("listitem")).toHaveCount(3);
  const past = page.getByRole("list", { name: "Reservas anteriores" });
  await expect(past.getByRole("listitem").filter({ hasText: "20/10" })).toContainText("Concluída");
  await expect(past.getByRole("link", { name: "Avaliar" })).toHaveCount(2); // 20/10 e 19/10
  await past.getByRole("listitem").filter({ hasText: "20/10" }).getByRole("link", { name: "Avaliar" }).click();
  await expect(page).toHaveURL(/\/avaliar\?atendimento=/);
  // Mesmos atendimentos concluídos nas duas telas, e o escolhido vem focado.
  const forms = page.getByRole("form", { name: /^Avaliar / });
  await expect(forms).toHaveCount(2);
  await expect(page.getByRole("form", { name: /, 19\/10/ })).toBeVisible();
  const chosen = page.getByRole("form", { name: /Avaliar Corte em Barbearia Exemplo A, 20\/10/ });
  await expect(chosen.getByRole("radio", { name: "1 – Ruim" })).toBeFocused();
});
