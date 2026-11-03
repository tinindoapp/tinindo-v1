import { expect, type Page } from "@playwright/test";

// Passos comuns das specs do Canal (demonstração: o estado vive na aba, então navega sem recarregar).
export const soft = (page: Page, href: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);

/** Conecta o número simulado lendo o código no telefone do negócio (só sai pelo canal, depois do despacho). */
export async function connectSimulated(page: Page) {
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

export async function clientWrites(page: Page, phone: string, text: string) {
  await page.getByLabel(/Número da cliente/).fill(phone);
  const write = page.getByRole("form", { name: "Cliente escreve" });
  await write.getByLabel("Mensagem da cliente").fill(text);
  await write.getByRole("button", { name: "Enviar como cliente" }).click();
  await expect(page.getByText("Mensagem da cliente recebida pelo webhook.")).toBeVisible();
}
