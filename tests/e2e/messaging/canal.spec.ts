import { expect, type Page, test } from "@playwright/test";

const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

/** Conecta o número simulado lendo o código no telefone do negócio (só sai pelo canal, depois do despacho). */
async function connectSimulated(page: Page) {
  const connect = page.getByRole("form", { name: "Conectar número" });
  await connect.getByRole("button", { name: "Conectar" }).click();
  const conn = page.getByRole("group", { name: "Número conectado" });
  await expect(conn).toContainText("Aguardando o código");
  await soft(page, "/app/mensagens/simulador");
  await page.getByLabel(/Número da cliente/).fill("+5511999990001");
  await expect(page.getByText("Nada entregue a este número ainda")).toBeVisible();
  await page.getByRole("button", { name: "Rodar o despacho (simulação)" }).click();
  const delivered = page.getByRole("list", { name: "Mensagens entregues" });
  await expect(delivered).toContainText("Seu código para conectar o número");
  const code = /([0-9]{6})/.exec((await delivered.textContent()) ?? "")![1]!;
  await soft(page, "/app/mensagens");
  const verify = conn.getByRole("form", { name: "Verificar número" });
  await verify.getByLabel("Código recebido no número").fill(code);
  await verify.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByText("Número verificado. O canal está conectado.")).toBeVisible();
  // Conectado, a conexão vira uma linha de status; os detalhes abrem em "Gerenciar".
  await expect(conn).toContainText("Número simulado conectado · (11) 99999-0001");
  return conn;
}

async function clientWrites(page: Page, phone: string, text: string) {
  await page.getByLabel(/Número da cliente/).fill(phone);
  const write = page.getByRole("form", { name: "Cliente escreve" });
  await write.getByLabel("Mensagem da cliente").fill(text);
  await write.getByRole("button", { name: "Enviar como cliente" }).click();
  await expect(page.getByText("Mensagem da cliente recebida pelo webhook.")).toBeVisible();
}

test("canal: número verificado pelo código entregue no canal, cliente escreve, resposta na janela, enviada → lida, opt-out e humano assume", async ({ page }) => {
  await page.goto("/app/mensagens");
  await expect(page.getByRole("heading", { name: "Mensagens", level: 1 })).toBeVisible();
  await expect(page.getByText("nenhuma mensagem sai do navegador")).toBeVisible();
  // Sem conexão: estado vazio guiado.
  await expect(page.getByRole("heading", { name: "Conecte o número do seu negócio" })).toBeVisible();

  // Provedor oficial sem segredos: recusa explícita, nada gravado.
  const connect = page.getByRole("form", { name: "Conectar número" });
  await connect.getByLabel("Provedor").selectOption("whatsapp_cloud");
  await connect.getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByText("O provedor oficial não está configurado neste ambiente.")).toBeVisible();
  await connect.getByLabel("Provedor").selectOption("simulated");
  await connectSimulated(page);

  // A cliente escreve pelo simulador (mesmo webhook, assinado) e é reconhecida pelo telefone.
  await soft(page, "/app/mensagens/simulador");
  await clientWrites(page, "+5511988887777", "Oi! Tem horário quarta?");
  await soft(page, "/app/mensagens");
  const inbox = page.getByRole("region", { name: "Caixa de entrada" });
  await expect(inbox).toContainText("Ana Beatriz (exemplo)");
  await expect(inbox).toContainText("Janela aberta");
  await expect(inbox).toContainText("1 não lida");
  // A linha inteira leva à tela da conversa.
  await inbox.getByRole("link", { name: /Ana Beatriz/ }).click();
  await expect(page).toHaveURL(/\/app\/mensagens\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Ana Beatriz (exemplo)", level: 1 })).toBeVisible();
  const convo = page.getByRole("region", { name: /Conversa com Ana Beatriz/ });
  await expect(convo.getByRole("list", { name: "Mensagens da conversa" })).toContainText("Recebida");
  const reply = convo.getByRole("form", { name: "Responder" });
  // Campo de escrever fixo no rodapé, visível e acima da barra de abas do celular.
  await expect(reply).toBeInViewport();
  const tabbar = page.locator(".tn-tabbar");
  if (await tabbar.isVisible()) {
    const r = (await reply.boundingBox())!;
    expect(r.y + r.height).toBeLessThanOrEqual((await tabbar.boundingBox())!.y + 1);
  }
  await reply.getByLabel(/Resposta/).fill("Oi, Ana! Quarta às 10h?");
  await reply.getByRole("button", { name: "Enviar" }).click();
  await expect(reply.getByText("Mensagem na fila.")).toBeVisible();
  await expect(convo).toContainText("Na fila");
  await convo.getByRole("button", { name: "Rodar o despacho (simulação)" }).click();
  await expect(convo).toContainText("Enviada");
  await expect(convo).not.toContainText("Entregue");

  // O provedor confirma leitura; entregue depois de lida não anda para trás.
  const convoUrl = new URL(page.url()).pathname;
  await soft(page, "/app/mensagens/simulador");
  await page.getByLabel(/Número da cliente/).fill("+5511988887777");
  const phone = page.getByRole("list", { name: "Mensagens entregues" });
  await expect(phone).toContainText("Oi, Ana! Quarta às 10h?");
  await phone.getByRole("button", { name: "Marcar lida" }).click();
  await expect(page.getByText("Provedor confirmou: lida.")).toBeVisible();
  await phone.getByRole("button", { name: "Marcar entregue" }).click();
  await expect(page.getByText("Estado não avança para trás; nada mudou.")).toBeVisible();

  // Opt-out pela cliente bloqueia; o dono assume a conversa.
  await clientWrites(page, "+5511988887777", "SAIR");
  await soft(page, "/app/mensagens");
  await expect(inbox).toContainText("Pediu para não receber");
  await soft(page, convoUrl);
  await expect(convo).toContainText("Lida");
  await expect(convo).toContainText("A cliente pediu para não receber mensagens.");
  await expect(reply.getByRole("button", { name: "Enviar" })).toBeDisabled();
  await convo.getByRole("button", { name: "Assumir a conversa" }).click();
  await expect(page.getByText("Você assumiu a conversa.")).toBeVisible();
  await expect(convo).toContainText("Você está atendendo");
  await page.getByRole("main").getByRole("link", { name: "Mensagens", exact: true }).first().click();
  await expect(inbox).toContainText("Você está atendendo");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("canal: número inválido falha com motivo e entrega desconhecida é consultada sem reenvio", async ({ page }) => {
  await page.goto("/app/mensagens");
  const conn = await connectSimulated(page);
  await soft(page, "/app/mensagens/simulador");
  await clientWrites(page, "+5511988880000", "oi");
  await clientWrites(page, "+5511988889999", "oi");
  await soft(page, "/app/mensagens");
  const inbox = page.getByRole("region", { name: "Caixa de entrada" });
  for (const phone of ["+5511988880000", "+5511988889999"]) {
    await inbox.getByRole("link", { name: new RegExp(phone.replace("+", "\\+")) }).first().click();
    const convo = page.getByRole("region", { name: `Conversa com ${phone}` });
    const reply = convo.getByRole("form", { name: "Responder" });
    await reply.getByLabel(/Resposta/).fill("teste");
    await reply.getByRole("button", { name: "Enviar" }).click();
    await expect(reply.getByText("Mensagem na fila.")).toBeVisible();
    await soft(page, "/app/mensagens");
  }
  await expect(conn).toContainText("2 na fila");
  await conn.getByRole("button", { name: "Gerenciar" }).click();
  await conn.getByRole("button", { name: "Rodar o despacho (simulação)" }).click();
  await expect(page.getByText("0 enviada(s), 1 falhou(aram), 1 desconhecida(s), 0 resolvida(s)")).toBeVisible();
  await expect(conn).toContainText("Entrega desconhecida: 1");
  await expect(inbox.getByRole("listitem").filter({ hasText: "+5511988880000" })).toContainText("Falhou");
  await expect(inbox.getByRole("listitem").filter({ hasText: "+5511988889999" })).toContainText("Entrega desconhecida");
  await inbox.getByRole("listitem").filter({ hasText: "+5511988880000" }).getByRole("link").click();
  await expect(page.getByRole("region", { name: "Conversa com +5511988880000" })).toContainText("Falhou (número inválido)");
  await soft(page, "/app/mensagens");
  await conn.getByRole("button", { name: "Gerenciar" }).click();
  await conn.getByRole("button", { name: "Rodar o despacho (simulação)" }).click();
  await expect(page.getByText("0 enviada(s), 0 falhou(aram), 0 desconhecida(s), 1 resolvida(s)")).toBeVisible();
  await expect(inbox.getByRole("listitem").filter({ hasText: "+5511988889999" })).toContainText("(Enviada)");
  await expect(conn).toContainText("Entrega desconhecida: 0");
});
