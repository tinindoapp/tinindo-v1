import { expect, test } from "@playwright/test";
import { bookFromAgenda, expectDemoLabel, noHorizontalScroll, openFromNav, PENDING } from "./helpers.ts";

// UAT · Barbeiro (docs/10): cria corte de 30min; importa cinco clientes; agenda um; abre link público;
// cliente escolhe vaga; aplica oferta terça com piso; cancela; lista de espera recupera; conclui;
// marca recebido; consulta "o que tenho amanhã?".
// O que a demonstração já cobre roda; o resto fica em test.fixme com o motivo.

test.describe("UAT barbeiro", () => {
  test("1a · catálogo mostra Corte de 30 min com preço base e piso", async ({ page }) => {
    await page.goto("/app");
    await openFromNav(page, "Clientes");
    await page.getByRole("navigation", { name: "Seções de clientes e catálogo" }).getByRole("link", { name: "Serviços" }).click();
    await expect(page.getByRole("heading", { name: "Serviços", level: 1 })).toBeVisible();
    const corte = page.getByRole("list").getByRole("listitem").filter({ hasText: "Corte" }).first();
    await expect(corte).toContainText("30 min");
    await expect(corte).toContainText("R$ 60,00");
    await expect(corte).toContainText("piso R$ 45,00");
    // Modelos da profissão aparecem, mas a demonstração não grava.
    await expect(page.getByRole("button", { name: "Modelo: Corte (30 min)" })).toBeDisabled();
    await expectDemoLabel(page);
    await noHorizontalScroll(page);
  });

  test("1b · barbeiro cria o serviço Corte de 30 min", async ({ page }) => {
    test.fixme(true, PENDING.crmWrite);
    await page.goto("/app/clientes/servicos");
    await page.getByRole("button", { name: "Modelo: Corte (30 min)" }).click();
    await page.getByLabel("Preço base (R$)").fill("60,00");
    await page.getByLabel("Piso (R$)").fill("45,00");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Corte foi salvo.")).toBeVisible();
  });

  const fiveCustomers = [
    "nome,telefone,email",
    "Cliente Teste Um,11987650001,um@exemplo.test",
    "Cliente Teste Dois,11987650002,",
    "Cliente Teste Três,,tres@exemplo.test",
    "Cliente Teste Quatro,11987650004,",
    "Cliente Teste Cinco,11987650005,cinco@exemplo.test",
  ].join("\n");

  test("2a · importação de cinco clientes mostra prévia sem mesclar nada", async ({ page }) => {
    await page.goto("/app/clientes/importar");
    await page.getByLabel("Ou cole o conteúdo").fill(fiveCustomers);
    await page.getByRole("button", { name: "Ver prévia" }).click();
    await expect(page.getByRole("heading", { name: "Prévia" })).toBeVisible();
    await expect(page.getByText(/5 linha\(s\) prontas, 0 com problema/)).toBeVisible();
    await expect(page.getByText("Linha 2", { exact: false })).toBeVisible();
    await expect(page.getByText("(11) 98765-0001")).toBeVisible();
    // Sem servidor, a gravação fica bloqueada em vez de fingir sucesso.
    await expect(page.getByRole("button", { name: "Importar", exact: true })).toBeDisabled();
    await noHorizontalScroll(page);
  });

  test("2b · importa os cinco clientes e eles aparecem na lista", async ({ page }) => {
    test.fixme(true, PENDING.crmWrite);
    await page.goto("/app/clientes/importar");
    await page.getByLabel("Ou cole o conteúdo").fill(fiveCustomers);
    await page.getByRole("button", { name: "Ver prévia" }).click();
    await page.getByRole("button", { name: "Importar", exact: true }).click();
    await expect(page.getByText(/5 criad/)).toBeVisible();
    await page.getByRole("link", { name: "Clientes", exact: true }).click();
    await expect(page.getByText("Cliente Teste Cinco")).toBeVisible();
  });

  test("3+5a · agenda um corte na terça à tarde com a oferta aprovada respeitando o piso", async ({ page }) => {
    await page.goto("/app");
    await openFromNav(page, "Agenda");
    await page.getByRole("link", { name: "Novo agendamento" }).click();
    await page.getByRole("radio", { name: /Corte/ }).check();
    await page.getByRole("button", { name: "13:00", exact: true }).click();
    await page.getByLabel("Cliente").selectOption({ label: "Cliente Exemplo Ana" });
    // Regra emulada do P05: terça 13h–17h, 15% de desconto, nunca abaixo do piso (R$ 45,00).
    await expect(page.getByText("R$ 51,00", { exact: true })).toBeVisible();
    await expect(page.getByText(/Desconto de horário aprovado \(regra v3\)/)).toBeVisible();
    await expect(page.getByText("Ver o valor não segura o horário", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Confirmar agendamento" }).click();
    await expect(page.getByText("Agendamento confirmado.")).toBeVisible();
    await expect(page.getByText(/terça-feira, 20 de outubro, 13:00–13:30/)).toBeVisible();
    await expect(page.getByText("R$ 51,00")).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("5b · barbeiro cria a oferta de terça com piso e ela passa a valer nas novas cotações", async ({ page }) => {
    await page.goto("/app");
    await openFromNav(page, "Preços");
    const form = page.getByRole("form", { name: "Nova regra" });
    await form.getByLabel("Desconto pedido (%)").fill("40");
    await form.getByLabel("Teto aprovado (%)").fill("40");
    await form.getByRole("button", { name: "Ver prévia" }).click();
    const proposals = page.getByRole("list", { name: "Propostas aguardando aprovação" });
    await expect(proposals.getByText("Desconto limitado ao preço mínimo", { exact: false })).toBeVisible();
    await expect(proposals.getByText(/R\$\s?45,00/).first()).toBeVisible();
    await proposals.getByRole("button", { name: "Aprovar e publicar" }).click();
    await expect(page.getByText(/Regra v4 publicada/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Regras ativas" }).getByRole("listitem")).toHaveCount(1);
  });

  test("4a · link público abre o perfil e o cliente escolhe uma vaga sem reserva falsa", async ({ page }) => {
    await page.goto("/app/perfil");
    await page.getByLabel("Endereço do perfil").fill("barbeiro-uat");
    await page.getByLabel("Bairro ou região").fill("Centro");
    await page.getByRole("button", { name: "Publicar perfil" }).click();
    await page.getByRole("link", { name: "Abrir perfil público" }).click();
    await expect(page).toHaveURL(/\/p\/barbeiro-uat$/);
    await expectDemoLabel(page);
    await expect(page.getByText("Perfil novo · ainda sem avaliações")).toBeVisible();
    const slots = page.getByRole("list", { name: "Horários livres" });
    await slots.getByRole("button").first().click();
    await expect(page.getByText("Demonstração: nada foi reservado.")).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("4b · vaga escolhida pelo link público vira reserva na agenda do barbeiro", async ({ page }) => {
    test.fixme(true, PENDING.publicBooking);
    await page.goto("/p/barbeiro-uat");
    await page.getByRole("list", { name: "Horários livres" }).getByRole("button").first().click();
    await page.getByRole("button", { name: /Confirmar/ }).click();
    await page.goto("/app/agenda");
    await expect(page.getByText("Link de agendamento")).toBeVisible();
  });

  test("6 · cancela um atendimento com motivo e o horário volta a ficar livre", async ({ page }) => {
    await page.goto("/app/agenda");
    await bookFromAgenda(page, { service: /Barba/, slot: "11:00", customer: "Cliente Exemplo Bruno", nextDays: 1 });
    await page.getByRole("button", { name: "Cancelar atendimento" }).click();
    await expect(page.getByText("Nenhuma mensagem é enviada automaticamente ao cliente.", { exact: false })).toBeVisible();
    // Motivo é obrigatório.
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await expect(page.getByRole("alert")).toHaveText("Informe o motivo do cancelamento.");
    await page.getByLabel("Motivo").fill("Cliente avisou que não vem");
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await expect(page.getByText("Atendimento cancelado. O horário voltou a ficar livre.")).toBeVisible();
    await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar atendimento" })).toHaveCount(0);
  });

  test("7 · lista de espera oferece a vaga cancelada e recupera o horário", async ({ page }) => {
    test.fixme(true, PENDING.waitlist);
    await page.goto("/app/lista-de-espera");
    await expect(page.getByRole("button", { name: /Oferecer vaga/ })).toBeVisible();
  });

  test("8 · conclui o atendimento das 09:00 sem registrar pagamento", async ({ page }) => {
    await page.goto("/app/agenda");
    await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
    await page.getByRole("button", { name: "Concluir atendimento" }).click();
    await expect(page.getByText("Isso registra que o atendimento aconteceu. Não registra pagamento.")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar conclusão" }).click();
    await expect(page.getByText(/Atendimento concluído\. O pagamento não foi registrado/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Concluir atendimento" })).toHaveCount(0);
  });

  test("9a · Caixa não finge recebimento: concluído fica sem cobrança até registrar", async ({ page }) => {
    await page.goto("/app");
    await openFromNav(page, "Caixa");
    await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
    await expect(page.getByText("Dados de exemplo.")).toBeVisible();
    const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    await expect(pending.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("region", { name: /Caixa registrado/ })).toContainText("Atendimento agendado ou concluído não conta como recebido");
  });

  test("9b · marca o atendimento concluído como recebido, uma única vez", async ({ page }) => {
    await page.goto("/app");
    await openFromNav(page, "Caixa");
    const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    const item = pending.getByRole("listitem").filter({ hasText: "Bruno" });
    await item.getByRole("button", { name: /Marcar como recebido/ }).click();
    await expect(page.getByText(/Recebido R\$\s?40,00/)).toBeVisible();
    await expect(pending.getByRole("listitem").filter({ hasText: "Bruno" })).toHaveCount(0);
    const payments = page.getByRole("region", { name: "Recebimentos no mês" });
    await expect(payments.getByRole("listitem").filter({ hasText: "R$ 40,00" })).toHaveCount(1);
  });

  test("10a · agenda de amanhã responde visualmente o que há na quarta", async ({ page }) => {
    await page.goto("/app/agenda");
    await page.getByRole("button", { name: "Próximo dia" }).click();
    await expect(page.getByRole("heading", { name: /quarta-feira, 21 de outubro/ })).toBeVisible();
    const timeline = page.getByRole("list", { name: /Linha do tempo de quarta-feira/ });
    await expect(timeline).toContainText("Cancelado");
    await expect(page.getByText("Horários no fuso do negócio: America/Sao Paulo (UTC−03:00)")).toBeVisible();
  });

  test("10b · pergunta ao assistente “o que tenho amanhã?” e recebe período, fonte e cobertura", async ({ page }) => {
    test.fixme(true, PENDING.agent);
    await page.goto("/app/assistente");
    await page.getByRole("textbox").fill("o que tenho amanhã?");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/quarta-feira, 21 de outubro/)).toBeVisible();
    await expect(page.getByText(/registros lançados na Tinindo/)).toBeVisible();
  });
});
