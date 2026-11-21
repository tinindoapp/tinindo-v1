// P34 · sem internet, no navegador de verdade: a tela abre com o último dado e o aviso "Sem conexão · dados de HH:MM";
// o cache nunca serve resposta de outro negócio; comando sem rede falha na hora e nada é reenviado depois.
// A "Edge Function" é um servidor HTTP local de verdade (outra origem, com CORS), que o service worker alcança como
// alcançaria o Supabase. "Sem rede" = o servidor para de responder. A demonstração não chama servidor.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";

const T_A = "10000000-0000-4000-8000-00000000000a";
const T_B = "10000000-0000-4000-8000-00000000000b";
const JWT = `Bearer x.${Buffer.from(JSON.stringify({ sub: "dono-e2e" })).toString("base64url")}.y`;

async function controlled(page: Page) {
  await page.goto("/app");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** API falsa: responde 200 com o negócio do cabeçalho; `down` faz cair a conexão (como sem internet). */
async function fakeApi() {
  const state = { down: false, seen: [] as string[] };
  const server: Server = createServer((req, res) => {
    if (state.down) {
      req.socket.destroy();
      return;
    }
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Expose-Headers": "*" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    const tenant = String(req.headers["x-tinindo-tenant"] ?? "");
    state.seen.push(`${req.url} ${tenant}`);
    req.resume();
    req.on("end", () => res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ data: { tenant, bookings: 3 } })));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { state, base, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

/** Chama a "Edge Function" a partir da página, como o cliente da API faz. */
function call(page: Page, base: string, op: string, tenant: string, body: unknown = {}) {
  return page.evaluate(async ({ base, op, tenant, body, jwt }) => {
    const r = await fetch(`${base}/functions/v1/${op}`, {
      method: "POST",
      headers: { Authorization: jwt, "X-Tinindo-Tenant": tenant, "X-Request-Id": "aaaaaaaa-0000-4000-8000-000000000001", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!r) return { status: 0, offlineAt: null, json: null };
    return { status: r.status, offlineAt: r.headers.get("X-Tinindo-Offline-At"), json: await r.json().catch(() => null) };
  }, { base, op, tenant, body, jwt: JWT });
}

test("demonstração sem internet: a tela abre e avisa 'Sem conexão. Nada é salvo'; ao voltar, o aviso sai", async ({ page, context }) => {
  await controlled(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  const bar = page.getByRole("status").filter({ hasText: "Sem conexão" });
  await expect(bar).toContainText("Nada é salvo até a internet voltar");
  await context.setOffline(false);
  await expect(bar).toBeHidden();
});

test("leitura guardada abre sem rede; outro negócio não recebe; comando falha na hora e nunca é reenviado", async ({ page, context }) => {
  const api = await fakeApi();
  try {
    await controlled(page);
    const online = await call(page, api.base, "scheduling/booking.list", T_A, { window: "hoje" });
    expect(online).toMatchObject({ status: 200, offlineAt: null, json: { data: { tenant: T_A } } });

    api.state.down = true;
    await context.setOffline(true);
    const saved = await call(page, api.base, "scheduling/booking.list", T_A, { window: "hoje" });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ data: { tenant: T_A, bookings: 3 } });
    expect(saved.offlineAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await expect(page.getByRole("status").filter({ hasText: /Sem conexão · dados de \d{2}:\d{2}/ })).toBeVisible();

    // O cache nunca serve a resposta de A para o negócio B.
    const other = await call(page, api.base, "scheduling/booking.list", T_B, { window: "hoje" });
    expect(other.status).toBe(503);
    expect(other.json).toMatchObject({ error: { code: "PROVIDER_UNAVAILABLE" } });

    // Comando sem rede: erro na hora, com a mensagem de que nada foi salvo.
    const cmd = await call(page, api.base, "scheduling/booking.create", T_A, { service_id: "x" });
    expect(cmd.status).toBe(503);
    expect(cmd.json.error.message).toContain("nada foi salvo");

    // Volta a rede: nada do que falhou é reenviado sozinho (nenhuma fila escondida).
    const before = api.state.seen.length;
    api.state.down = false;
    await context.setOffline(false);
    await page.waitForTimeout(2000);
    expect(api.state.seen.slice(before).filter((s) => s.includes("booking.create"))).toEqual([]);
  } finally {
    await context.setOffline(false);
    await api.close();
  }
});
