import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ProviderService } from "@contracts";
import { FX, services } from "@contracts/fixtures.ts";
import type { CrmCustomer } from "@contracts";
import { ApiError } from "../../lib/api/client.ts";
import { SessionProvider } from "../../app/session.tsx";
import { routes } from "../../app/router.tsx";
import { type CrmApi, CrmApiContext, createDemoCrmApi, DEMO_CUSTOMERS } from "./api.ts";
import { CustomersPage } from "./CustomersPage.tsx";
import { ImportPage } from "./ImportPage.tsx";
import { ServicesPage } from "./ServicesPage.tsx";

const ana: CrmCustomer = {
  id: FX.customers.abInA, tenant_id: FX.tenants.A, name: "Ana Exemplo", phone: "+5511987654321",
  email: "ana@exemplo.test", declared_source: "instagram", archived_at: null, version: 3,
};

function fakeApi(over: Partial<CrmApi> = {}): CrmApi {
  return {
    readOnly: false,
    profession: vi.fn(async () => "barber" as const),
    listCustomers: vi.fn(async () => ({ items: [ana], next_cursor: null })),
    upsertCustomer: vi.fn<CrmApi["upsertCustomer"]>(async (input) => ({
      customer: { ...ana, id: FX.customers.guestInA, name: input.name, phone: input.phone ?? null, version: 1 },
      possible_duplicates: [],
    })),
    archiveCustomer: vi.fn(async () => ({ customer: { ...ana, archived_at: "2026-10-20T12:00:00Z", version: 4 } })),
    listServices: vi.fn(async () => ({ items: services.filter((s) => s.tenant_id === FX.tenants.A), next_cursor: null })),
    saveService: vi.fn<CrmApi["saveService"]>(async (input) => ({ service: { ...(services[0] as ProviderService), name: input.name } })),
    importPreview: vi.fn<CrmApi["importPreview"]>(async (rows) => ({ rows: rows.map((r) => ({ line: r.line, matches: [] })) })),
    importCustomers: vi.fn(async () => ({ created: [], skipped: [], rejected: [] })),
    ...over,
  };
}

const renderWith = (api: CrmApi, ui: React.ReactNode) =>
  render(<CrmApiContext.Provider value={api}>{ui}</CrmApiContext.Provider>);
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("clientes", () => {
  it("lista clientes do negócio com contato formatado e origem declarada", async () => {
    renderWith(fakeApi(), <CustomersPage />);
    expect(await screen.findByText("Ana Exemplo")).toBeInTheDocument();
    expect(screen.getByText(/\(11\) 98765-4321 · ana@exemplo\.test · Origem: Instagram/)).toBeInTheDocument();
  });

  it("personal trainer vê “Alunos”", async () => {
    renderWith(fakeApi({ profession: async () => "personal_trainer" }), <CustomersPage />);
    expect(await screen.findByRole("heading", { name: "Alunos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo aluno" })).toBeInTheDocument();
  });

  it("cria cliente com telefone normalizado e chave de idempotência", async () => {
    const api = fakeApi();
    renderWith(api, <CustomersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    type("Nome", "Bruno Novo");
    type("Telefone", "(11) 91234-5678");
    fireEvent.change(screen.getByLabelText("Como chegou até você"), { target: { value: "referral" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.upsertCustomer).toHaveBeenCalledTimes(1));
    const [input, key] = vi.mocked(api.upsertCustomer).mock.calls[0]!;
    expect(input).toEqual({ name: "Bruno Novo", phone: "+5511912345678", email: null, declared_source: "referral" });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Bruno Novo foi salvo.")).toBeInTheDocument();
  });

  it("telefone inválido é barrado antes do servidor", async () => {
    const api = fakeApi();
    renderWith(api, <CustomersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    type("Nome", "Bruno");
    type("Telefone", "1199");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Telefone inválido/)).toBeInTheDocument();
    expect(api.upsertCustomer).not.toHaveBeenCalled();
  });

  it("avisa possível duplicado sem mesclar", async () => {
    const api = fakeApi({
      upsertCustomer: vi.fn(async () => ({ customer: { ...ana, id: FX.customers.guestInA, name: "Ana E." }, possible_duplicates: [ana.id] })),
    });
    renderWith(api, <CustomersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    type("Nome", "Ana E.");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/1 cadastro\(s\) parecido\(s\).*nada foi mesclado/)).toBeInTheDocument();
  });

  it("edita com a versão carregada e mostra conflito de versão do servidor", async () => {
    const api = fakeApi({
      upsertCustomer: vi.fn(async () => {
        throw new ApiError("STALE_VERSION", "Este registro foi alterado por outra pessoa. Recarregue e tente de novo.", 409, null, false);
      }),
    });
    renderWith(api, <CustomersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Ana Exemplo" }));
    expect(screen.getByLabelText("Telefone")).toHaveValue("(11) 98765-4321");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/alterado por outra pessoa/)).toBeInTheDocument();
    expect(vi.mocked(api.upsertCustomer).mock.calls[0]![0]).toMatchObject({ customer_id: ana.id, expected_version: 3 });
  });

  it("arquiva com expected_version", async () => {
    const api = fakeApi();
    renderWith(api, <CustomersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar Ana Exemplo" }));
    await waitFor(() =>
      expect(api.archiveCustomer).toHaveBeenCalledWith(
        { customer_id: ana.id, expected_version: 3, archived: true },
        expect.any(String),
      ),
    );
    expect(await screen.findByText("Ana Exemplo foi arquivado.")).toBeInTheDocument();
  });
});

describe("serviços", () => {
  it("lista duração, intervalos, preço e piso", async () => {
    renderWith(fakeApi(), <ServicesPage />);
    const item = (await screen.findByText("Corte")).closest("li")!;
    expect(within(item).getByText(/30 min/)).toBeInTheDocument();
    expect(item).toHaveTextContent(/intervalo 0 antes \/ 10 depois/);
    expect(item).toHaveTextContent(/R\$\s60,00.*piso R\$\s45,00/);
  });

  it.each(["0", "4", "1441", "30,5"])("duração %s é negada antes do servidor", async (duration) => {
    const api = fakeApi();
    renderWith(api, <ServicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo serviço" }));
    type("Nome", "Rápido");
    type("Duração (min)", duration);
    type("Preço base (R$)", "50");
    type("Piso (R$)", "40");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Duração entre 5 minutos e 24 horas/)).toBeInTheDocument();
    expect(api.saveService).not.toHaveBeenCalled();
  });

  it("modelo da profissão preenche duração e intervalos; preço em centavos inteiros", async () => {
    const api = fakeApi();
    renderWith(api, <ServicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Modelo: Corte e barba (50 min)" }));
    expect(screen.getByLabelText("Duração (min)")).toHaveValue("50");
    type("Preço base (R$)", "89,90");
    type("Piso (R$)", "70");
    expect(screen.getByText(/piso é manual/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.saveService).toHaveBeenCalled());
    expect(vi.mocked(api.saveService).mock.calls[0]![0]).toMatchObject({
      name: "Corte e barba",
      duration_min: 50,
      buffer_after_min: 10,
      base_price_cents: 8990,
      min_price_cents: 7000,
      estimated_cost_cents: null,
    });
  });

  it("piso acima do preço base é negado", async () => {
    const api = fakeApi();
    renderWith(api, <ServicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo serviço" }));
    type("Nome", "Caro");
    type("Duração (min)", "30");
    type("Preço base (R$)", "50");
    type("Piso (R$)", "60");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/não pode passar do preço base/)).toBeInTheDocument();
    expect(api.saveService).not.toHaveBeenCalled();
  });
});

describe("importação", () => {
  const csv = ["nome;telefone;email", "Bruno;11 91111-0000;", "Ana Exemplo;(11) 98765-4321;", "Ruim;1199;"].join("\n");

  it("prévia mostra problemas e parecidos; envia todas as linhas com a decisão; relata rejeitadas", async () => {
    const api = fakeApi({
      importPreview: vi.fn<CrmApi["importPreview"]>(async (rows) => ({
        rows: rows.map((r) => ({
          line: r.line,
          matches: r.line === 3 ? [{ customer_id: ana.id, name: "Ana Exemplo", reasons: ["phone" as const, "name" as const] }] : [],
        })),
      })),
      importCustomers: vi.fn(async () => ({
        created: [{ line: 2, customer_id: FX.customers.guestInA, possible_duplicates: [] }],
        skipped: [{ line: 3, duplicate_of: [ana.id] }],
        rejected: [{ line: 4, field: "phone", reason: "PHONE_INVALID" as const }],
      })),
    });
    renderWith(api, <ImportPage />);
    type("Ou cole o conteúdo", csv);
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    expect(await screen.findByText(/Parecido com: Ana Exemplo \(telefone, nome\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 linha\(s\) prontas, 1 com problema/)).toBeInTheDocument();
    expect(screen.getByText("Problema: Telefone inválido")).toBeInTheDocument();
    // Preview só consulta linhas sem problema.
    expect(vi.mocked(api.importPreview).mock.calls[0]![0].map((r) => r.line)).toEqual([2, 3]);
    expect(screen.getByLabelText("Linha 3")).toHaveValue("skip");

    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    expect(await screen.findByText(/1 criado\(s\), 1 pulado\(s\).*1 rejeitado\(s\)/)).toBeInTheDocument();
    const [rows, key] = vi.mocked(api.importCustomers).mock.calls[0]!;
    expect(rows.map((r) => [r.line, r.on_duplicate])).toEqual([
      [2, "skip"],
      [3, "skip"],
      [4, "skip"],
    ]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(within(screen.getByRole("list", { name: "Linhas rejeitadas" })).getByText(/Telefone inválido/)).toBeInTheDocument();
  });

  it("“criar mesmo assim” vai explícito na linha", async () => {
    const api = fakeApi({
      importPreview: vi.fn<CrmApi["importPreview"]>(async (rows) => ({
        rows: rows.map((r) => ({ line: r.line, matches: r.line === 3 ? [{ customer_id: ana.id, name: "Ana", reasons: ["phone" as const] }] : [] })),
      })),
    });
    renderWith(api, <ImportPage />);
    type("Ou cole o conteúdo", csv);
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    fireEvent.change(await screen.findByLabelText("Linha 3"), { target: { value: "create" } });
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    await waitFor(() => expect(api.importCustomers).toHaveBeenCalled());
    expect(vi.mocked(api.importCustomers).mock.calls[0]![0].find((r) => r.line === 3)?.on_duplicate).toBe("create");
  });

  it("arquivo sem coluna nome é recusado com mensagem", async () => {
    renderWith(fakeApi(), <ImportPage />);
    type("Ou cole o conteúdo", "telefone\n11987654321");
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    expect(await screen.findByText(/coluna “nome”/)).toBeInTheDocument();
  });
});

describe("módulo no app (demonstração sem servidor)", () => {
  it("rota /app/clientes mostra clientes de exemplo, banner e formulários bloqueados", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/app/clientes"] });
    render(
      <SessionProvider client={null}>
        <RouterProvider router={router} />
      </SessionProvider>,
    );
    expect(await screen.findByText(DEMO_CUSTOMERS[0]!.name)).toBeInTheDocument();
    expect(screen.getByText(/nada é salvo\. Os formulários ficam bloqueados/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo cliente" })).toBeDisabled();
    fireEvent.click(screen.getByRole("link", { name: "Serviços" }));
    expect(await screen.findByText("Barba")).toBeInTheDocument();
  });

  it("demonstração recusa gravação mesmo se chamada diretamente", async () => {
    await expect(createDemoCrmApi().upsertCustomer({ name: "X" }, "k".repeat(16))).rejects.toMatchObject({
      code: "POLICY_REJECTED",
    });
  });
});
