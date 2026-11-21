import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { SessionProvider } from "../../app/session.tsx";
import { createDemoPort, resetPrivacyDemo } from "./demoPort.ts";
import type { PrivacyPort } from "./port.ts";
import { PrivacyPage } from "./PrivacyPage.tsx";
import { createServerPort } from "./serverPort.ts";

beforeEach(() => resetPrivacyDemo());
afterEach(() => act(() => dismissToast()));

const renderPage = (port: PrivacyPort) => render(<SessionProvider client={null}><MemoryRouter><PrivacyPage port={port} /><Toaster /></MemoryRouter></SessionProvider>);
const click = async (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("Privacidade: baixar e eliminar dados (P57)", () => {
  it("baixar os dados do negócio: link com prazo e a exportação na lista; repetir usa outra chave", async () => {
    const port = createDemoPort();
    const spy = vi.spyOn(port, "exportData");
    renderPage(port);
    expect(screen.getByText(/Demonstração: os arquivos e pedidos daqui valem só nesta aba/)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Baixar os dados do negócio" }));
    expect(screen.getByRole("link", { name: "Baixar o arquivo (JSON)" })).toBeInTheDocument();
    expect(screen.getByText(/O link vale até/)).toBeInTheDocument();
    expect(within(await screen.findByRole("list", { name: "Exportações recentes" })).getByText(/Todo o negócio · .* · Pronto/)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Baixar os dados do negócio" }));
    const [k1, k2] = spy.mock.calls.map((c) => c[1]);
    expect(k1).not.toBe(k2);
  });

  it("eliminar um cliente: exige escolher e digitar ELIMINAR; depois ele some da busca", async () => {
    const port = createDemoPort();
    const erase = vi.spyOn(port, "erase");
    renderPage(port);
    const card = within(screen.getByRole("region", { name: "Eliminar os dados de um cliente" }));
    expect(card.getByRole("button", { name: "Eliminar os dados deste cliente" })).toBeDisabled();
    const select = card.getByLabelText("Cliente para eliminar");
    await screen.findAllByRole("option", { name: "Maria Exemplo Silva" });
    type(select, "30000000-0000-4000-8000-0000000000a3");
    await click(card.getByRole("button", { name: "Eliminar os dados deste cliente" }));
    const confirm = within(screen.getByRole("group", { name: "Eliminar os dados de Maria Exemplo Silva?" }));
    await click(confirm.getByRole("button", { name: "Eliminar agora" }));
    expect(erase).not.toHaveBeenCalled();
    type(confirm.getByLabelText("Digite ELIMINAR"), "eliminar");
    await click(confirm.getByRole("button", { name: "Eliminar agora" }));
    expect(erase).toHaveBeenCalledWith({ scope: "customer", customer_id: "30000000-0000-4000-8000-0000000000a3", confirm: "ELIMINAR" }, expect.any(String));
    expect(await screen.findByText(/Dados de Maria Exemplo Silva eliminados/)).toBeInTheDocument();
    expect(await port.customers("maria")).toEqual([]);
  });

  it("eliminar o negócio: agenda com carência de 7 dias e dá para cancelar", async () => {
    const port = createDemoPort();
    renderPage(port);
    const card = within(screen.getByRole("region", { name: "Eliminar o negócio" }));
    await click(card.getByRole("button", { name: "Pedir a eliminação do negócio" }));
    const confirm = within(screen.getByRole("group", { name: "Eliminar o negócio daqui a 7 dias?" }));
    type(confirm.getByLabelText("Digite ELIMINAR"), "ELIMINAR");
    await click(confirm.getByRole("button", { name: "Agendar a eliminação" }));
    expect(await card.findByText(/Eliminação agendada para .*27.* Até lá, tudo continua funcionando/)).toBeInTheDocument();
    await click(card.getByRole("button", { name: "Cancelar a eliminação" }));
    expect(await screen.findByText("Eliminação cancelada. Nada foi apagado.")).toBeInTheDocument();
    expect(await card.findByRole("button", { name: "Pedir a eliminação do negócio" })).toBeInTheDocument();
    expect(within(card.getByRole("list", { name: "Pedidos de eliminação" })).getByText(/Todo o negócio · .* · Cancelada/)).toBeInTheDocument();
  });

  it("porta do servidor: rotas da função privacy, chave de idempotência e busca de clientes pelo contrato do CRM", async () => {
    const meta = { request_id: "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10", as_of: "2026-10-20T12:00:00Z", schema_version: 1 };
    const exp = { id: "57000000-0000-4000-8000-0000000000e1", scope: "business", customer_id: null, status: "ready", bytes: 10,
      created_at: "2026-10-20T12:00:00Z", ready_at: "2026-10-20T12:00:01Z", expires_at: "2026-10-21T12:00:01Z" };
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ meta, data: url.includes("customer.list")
      ? { items: [], next_cursor: null }
      : { export: exp, download: { url: "https://storage.example/x", expires_at: "2026-10-20T12:15:00Z" } } }), { status: 200 }));
    const call = createApiClient({ baseUrl: "https://exemplo.supabase.co", publishableKey: "sb_publishable_exemplo", getAccessToken: async () => "jwt", fetch: fetchMock as unknown as typeof fetch });
    const port = createServerPort(call, FX.tenants.A);
    await port.exportData({ scope: "business" }, "chave-exportar-000001");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exemplo.supabase.co/functions/v1/privacy/privacy.export");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("chave-exportar-000001");
    expect(JSON.parse(String(init.body))).toEqual({ scope: "business" });
    await port.customers(" ana ");
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe("https://exemplo.supabase.co/functions/v1/crm/customer.list?include_archived=true&limit=20&q=ana");
  });
});
