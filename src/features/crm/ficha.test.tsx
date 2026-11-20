import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import type { CrmCustomer } from "@contracts";
import { ApiError } from "../../lib/api/client.ts";
import { SessionProvider } from "../../app/session.tsx";
import { routes } from "../../app/router.tsx";
import { type CrmApi, CrmApiContext, createDemoCrmApi, createServerCrmApi, type CustomerHistory } from "./api.ts";
import { CustomerPage, historySummary } from "./CustomerPage.tsx";
import { CustomersPage } from "./CustomersPage.tsx";
import { telHref, whatsappHref } from "./format.ts";

const ana: CrmCustomer = {
  id: FX.customers.abInA, tenant_id: FX.tenants.A, name: "Ana Exemplo", phone: "+5511987654321",
  email: "ana@exemplo.test", declared_source: "instagram", archived_at: null, version: 3,
};
const bruno: CrmCustomer = { ...ana, id: FX.customers.guestInA, name: "Bruno Sem Fone", phone: null, email: null, declared_source: null };

const history: CustomerHistory = {
  timezone: "America/Sao_Paulo",
  now: "2026-10-20T12:00:00.000Z",
  complete: true,
  items: [
    // Com fuso no texto (como vem da agenda): 10h em São Paulo é depois do "agora" (12:00Z = 9h).
    { id: "b3", starts_at: "2026-10-20T10:00:00-03:00", service: "Corte", status: "confirmed", price_cents: 6000 },
    { id: "b2", starts_at: "2026-10-13T13:00:00.000Z", service: "Barba", status: "no_show", price_cents: 4000 },
    { id: "b1", starts_at: "2026-10-06T13:00:00.000Z", service: "Corte", status: "completed", price_cents: 6000 },
  ],
};

function fakeApi(over: Partial<CrmApi> = {}): CrmApi {
  const api = createDemoCrmApi();
  return {
    ...api,
    readOnly: false,
    listCustomers: vi.fn(async () => ({ items: [ana, bruno], next_cursor: null })),
    getCustomer: vi.fn(async (id: string) => [ana, bruno].find((c) => c.id === id) ?? null),
    customerHistory: vi.fn(async () => history),
    archiveCustomer: vi.fn(async () => ({ customer: { ...ana, archived_at: "2026-10-20T12:00:00Z", version: 4 } })),
    ...over,
  };
}

const list = (api: CrmApi) =>
  render(
    <MemoryRouter>
      <CrmApiContext.Provider value={api}>
        <CustomersPage />
      </CrmApiContext.Provider>
    </MemoryRouter>,
  );

const ficha = (api: CrmApi, id: string) =>
  render(
    <MemoryRouter initialEntries={[`/app/clientes/${id}`]}>
      <CrmApiContext.Provider value={api}>
        <Routes>
          <Route path="/app/clientes/:customerId" element={<CustomerPage />} />
        </Routes>
      </CrmApiContext.Provider>
    </MemoryRouter>,
  );

describe("links de contato", () => {
  it("tel: com o E.164 e wa.me só com os dígitos; sem telefone, nada", () => {
    expect(telHref("+5511987654321")).toBe("tel:+5511987654321");
    expect(whatsappHref("+5511987654321")).toBe("https://wa.me/5511987654321");
    expect(telHref(null)).toBeNull();
    expect(whatsappHref("11987654321")).toBeNull();
  });
});

describe("cartão do cliente", () => {
  it("WhatsApp à vista e Ligar no “⋯” (P54: uma ação visível por linha); sem telefone, nenhum dos dois", async () => {
    list(fakeApi());
    const anaItem = (await screen.findByRole("link", { name: "Ana Exemplo" })).closest("li")!;
    const wa = within(anaItem).getByRole("link", { name: /WhatsApp de Ana Exemplo/ });
    expect(wa).toHaveAttribute("href", "https://wa.me/5511987654321");
    expect(wa).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(anaItem).queryByRole("link", { name: /Ligar/ })).not.toBeInTheDocument();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    fireEvent.click(within(anaItem).getByRole("button", { name: "Mais ações para Ana Exemplo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ligar" }));
    expect(assign).toHaveBeenCalledWith("tel:+5511987654321");
    vi.unstubAllGlobals();
    const brunoItem = screen.getByRole("link", { name: "Bruno Sem Fone" }).closest("li")!;
    expect(within(brunoItem).queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    fireEvent.click(within(brunoItem).getByRole("button", { name: "Mais ações para Bruno Sem Fone" }));
    expect(screen.queryByRole("menuitem", { name: "Ligar" })).not.toBeInTheDocument();
  });

  it("o nome leva à ficha do cliente", async () => {
    list(fakeApi());
    expect(await screen.findByRole("link", { name: "Ana Exemplo" })).toHaveAttribute("href", `/${ana.id}`);
  });

  it("menu “⋯”: aria-haspopup e aria-expanded, setas andam, Esc fecha e devolve o foco ao botão", async () => {
    list(fakeApi());
    const button = await screen.findByRole("button", { name: "Mais ações para Ana Exemplo" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Mais ações para Ana Exemplo" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    const [call, edit, archive] = within(menu).getAllByRole("menuitem");
    expect(call).toHaveTextContent("Ligar");
    await waitFor(() => expect(call).toHaveFocus());
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(archive).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(call).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(archive).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("Editar pelo menu abre o formulário com o foco no nome", async () => {
    list(fakeApi());
    fireEvent.click(await screen.findByRole("button", { name: "Mais ações para Ana Exemplo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveFocus());
    expect(screen.getByLabelText("Nome")).toHaveValue("Ana Exemplo");
  });

  it("demonstração somente leitura: itens do menu bloqueados e nada é chamado", async () => {
    const api = fakeApi({ readOnly: true });
    list(api);
    fireEvent.click(await screen.findByRole("button", { name: "Mais ações para Ana Exemplo" }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveAccessibleDescription(/editar e arquivar ficam bloqueados/);
    const archive = within(menu).getByRole("menuitem", { name: "Arquivar" });
    expect(archive).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(archive);
    expect(api.archiveCustomer).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Nome")).not.toBeInTheDocument();
  });
});

describe("ficha do cliente", () => {
  it("abre com Agendar (principal), WhatsApp e Ligar; resumo de retorno; próximos e anteriores em linhas com link; contato", async () => {
    ficha(fakeApi(), ana.id);
    expect(await screen.findByRole("heading", { name: "Ana Exemplo", level: 1 })).toBeInTheDocument();
    const agendar = screen.getByRole("link", { name: "Agendar" });
    expect(agendar).toHaveAttribute("href", `/app/agenda/novo?cliente=${ana.id}`);
    expect(agendar).toHaveAttribute("data-variant", "primary");
    expect(screen.getByRole("link", { name: "Ligar para Ana Exemplo" })).toHaveAttribute("href", "tel:+5511987654321");
    expect(screen.getByRole("link", { name: /WhatsApp de Ana Exemplo/ })).toHaveAttribute("data-variant", "ghost");
    // Resumo: última visita concluída em destaque; concluídos, faltas e o próximo em linhas.
    const summary = await screen.findByRole("group", { name: "Resumo de retorno" });
    expect(summary).toHaveTextContent(/Última visita\s*há 14 dias/);
    const rows = within(summary).getByRole("list", { name: "Atendimentos" });
    expect(rows).toHaveTextContent(/Concluídos\s*1/);
    expect(rows).toHaveTextContent(/Faltas\s*1/);
    expect(within(rows).getByRole("link", { name: /Próximo atendimento/ })).toHaveAttribute("href", "/app/agenda/atendimento/b3");
    const next = screen.getByRole("region", { name: "Próximos" });
    expect(within(next).getByRole("heading", { level: 2 })).toHaveTextContent(/^Próximos\s*·\s*1$/);
    expect(next).toHaveTextContent(/Corte.*R\$\s60,00.*Confirmado/);
    expect(within(next).getByRole("link")).toHaveAttribute("href", "/app/agenda/atendimento/b3");
    const past = screen.getByRole("region", { name: "Anteriores" });
    expect(within(past).getByRole("heading", { level: 2 })).toHaveTextContent(/^Anteriores\s*·\s*2$/);
    expect(past).toHaveTextContent("Faltou");
    expect(past).toHaveTextContent("Concluído");
    expect(within(past).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/app/agenda/atendimento/b2", "/app/agenda/atendimento/b1"]);
    // Sem caixa em volta de cada atendimento: linhas de .tn-list.
    expect(past.querySelector("ul")).toHaveClass("tn-list");
    expect(screen.getByRole("region", { name: "Contato" })).toHaveTextContent("(11) 98765-4321");
  });

  it("anteriores: cinco e “Ver todos (N)”; leitura incompleta diz que cortou", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`, starts_at: `2026-09-${String(20 - i).padStart(2, "0")}T13:00:00.000Z`, service: "Corte", status: "completed" as const, price_cents: 6000,
    }));
    ficha(fakeApi({ customerHistory: vi.fn(async () => ({ ...history, complete: false, items: many })) }), ana.id);
    const past = await screen.findByRole("region", { name: "Anteriores" });
    expect(within(past).getByRole("heading", { level: 2 })).toHaveTextContent(/^Anteriores\s*·\s*7$/);
    expect(within(past).getAllByRole("listitem")).toHaveLength(5);
    expect(within(past).getByText("Mostrando os 7 mais recentes; os mais antigos não aparecem aqui.")).toHaveClass("tn-list-foot__note");
    fireEvent.click(within(past).getByRole("button", { name: "Ver todos (7)" }));
    expect(within(past).getAllByRole("listitem")).toHaveLength(7);
  });

  it("sem telefone: sem botões e explica onde cadastrar", async () => {
    ficha(fakeApi(), bruno.id);
    expect(await screen.findByRole("heading", { name: "Bruno Sem Fone", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ligar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Sem telefone cadastrado/)).toBeInTheDocument();
  });

  it("histórico que falha diz com honestidade que ainda não está disponível", async () => {
    ficha(fakeApi({ customerHistory: vi.fn(async () => Promise.reject(new ApiError("FORBIDDEN", "Sem permissão.", 403, null, false))) }), ana.id);
    expect(await screen.findByText(/Histórico ainda não disponível: Sem permissão\./)).toBeInTheDocument();
  });

  it("cliente que não existe no negócio", async () => {
    ficha(fakeApi(), "99999999-0000-4000-8000-000000000000");
    expect(await screen.findByRole("heading", { name: "Cliente não encontrado", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute("href", "/app/clientes");
  });

  it("resume o histórico só com os estados que aparecem", () => {
    expect(historySummary([])).toBe("");
    expect(historySummary(history.items)).toBe("1 concluído · 1 falta");
  });
});

describe("servidor", () => {
  const ok = <T,>(data: T) => ({ data, requestId: "r" });

  it("getCustomer lê customer.get por id, numa chamada só", async () => {
    const call = vi.fn(async (_path: string) => ok({ customer: ana }));
    const api = createServerCrmApi({ call: call as never, tenantId: FX.tenants.A, readProfession: async () => "barber" });
    expect(await api.getCustomer(ana.id)).toEqual(ana);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![0]).toBe(`/crm/customer.get?customer_id=${ana.id}`);
  });

  it("getCustomer devolve null quando o servidor responde NOT_FOUND", async () => {
    const call = vi.fn(async () => {
      throw new ApiError("NOT_FOUND", "Não encontrado.", 404, "r", false);
    });
    const api = createServerCrmApi({ call: call as never, tenantId: FX.tenants.A, readProfession: async () => "barber" });
    expect(await api.getCustomer(ana.id)).toBeNull();
  });

  it("customerHistory lê booking.list_by_customer página a página e fica sem os vencidos", async () => {
    const booking = (id: string, status: string) => ({
      id, tenant_id: FX.tenants.A, resource_id: FX.tenants.A, service_id: "s1", customer_id: ana.id, starts_at: "2026-10-06T13:00:00.000Z",
      ends_at: "2026-10-06T13:30:00.000Z", status, agreed_price_cents: 6000, version: 1,
    });
    const bodies: { customer_id: string; cursor?: string }[] = [];
    const call = vi.fn(async (path: string, _schema: unknown, init?: { body?: { customer_id: string; cursor?: string } }) => {
      if (path === "/context") return ok({ timezone: "America/Sao_Paulo" });
      if (path.startsWith("/crm/services")) return ok({ items: [{ id: "s1", name: "Corte" }], next_cursor: null });
      bodies.push(init!.body!);
      return bodies.length === 1
        ? ok({ bookings: [booking("b2", "completed"), booking("e", "expired")], next_cursor: "c2" })
        : ok({ bookings: [booking("b1", "no_show")], next_cursor: null });
    });
    const api = createServerCrmApi({ call: call as never, tenantId: FX.tenants.A, readProfession: async () => "barber" });
    const out = await api.customerHistory(ana.id);
    expect(call.mock.calls.filter(([p]) => p === "/scheduling/booking.list_by_customer")).toHaveLength(2);
    expect(bodies).toEqual([{ customer_id: ana.id, cursor: undefined, limit: 100 }, { customer_id: ana.id, cursor: "c2", limit: 100 }]);
    expect(out.items.map((i) => i.id)).toEqual(["b2", "b1"]);
    expect(out.complete).toBe(true);
    expect(out.timezone).toBe("America/Sao_Paulo");
  });
});

describe("ficha na demonstração", () => {
  it("rota /app/clientes/:id mostra o histórico da base de exemplo", async () => {
    const router = createMemoryRouter(routes, { initialEntries: [`/app/clientes/${FX.customers.abInA}`] });
    render(
      <SessionProvider client={null}>
        <RouterProvider router={router} />
      </SessionProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Cliente AB (exemplo)", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Anteriores" })).toHaveTextContent(/^Anteriores\s*·\s*\d+/);
    // D11 (b): o aviso de demonstração fica só na faixa do topo.
    expect(screen.queryByText(/nada é salvo/)).not.toBeInTheDocument();
  });
});
