import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderService } from "@contracts";
import { FX, services } from "@contracts/fixtures.ts";
import type { CrmCustomer } from "@contracts";
import { ApiError } from "../../lib/api/client.ts";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { SessionProvider } from "../../app/session.tsx";
import { routes } from "../../app/router.tsx";
import { type CrmApi, CrmApiContext, createDemoCrmApi, type CustomerHistory, DEMO_CUSTOMERS } from "./api.ts";
import { CustomersPage } from "./CustomersPage.tsx";
import { ImportPage } from "./ImportPage.tsx";
import { ServicesPage } from "./ServicesPage.tsx";

const ana: CrmCustomer = {
  id: FX.customers.abInA, tenant_id: FX.tenants.A, name: "Ana Exemplo", phone: "+5511987654321",
  email: "ana@exemplo.test", declared_source: "instagram", archived_at: null, version: 3,
};

const history: CustomerHistory = {
  timezone: "America/Sao_Paulo",
  now: "2026-10-20T12:00:00.000Z",
  complete: true,
  items: [
    { id: "b3", starts_at: "2026-10-27T13:00:00.000Z", service: "Corte", status: "confirmed", price_cents: 6000 },
    { id: "b2", starts_at: "2026-10-13T13:00:00.000Z", service: "Barba", status: "no_show", price_cents: 4000 },
    { id: "b1", starts_at: "2026-10-06T13:00:00.000Z", service: "Corte", status: "completed", price_cents: 6000 },
  ],
};

/** Abre o menu "⋯" do cartão e escolhe a ação. */
async function menuAction(customer: string, action: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Mais ações para ${customer}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}

function fakeApi(over: Partial<CrmApi> = {}): CrmApi {
  return {
    readOnly: false,
    profession: vi.fn(async () => "barber" as const),
    listCustomers: vi.fn(async () => ({ items: [ana], next_cursor: null })),
    getCustomer: vi.fn(async (id: string) => (id === ana.id ? ana : null)),
    customerHistory: vi.fn(async () => history),
    visitSummary: vi.fn(async () => ({ timezone: "America/Sao_Paulo", now: "2026-10-20T12:00:00.000Z", since: "2026-04-23T00:00:00Z", complete: true, byCustomer: {} })),
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

type Page = { items: CrmCustomer[]; next_cursor: string | null };

const renderWith = (api: CrmApi, ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <CrmApiContext.Provider value={api}>{ui}</CrmApiContext.Provider>
      <Toaster />
    </MemoryRouter>,
  );
afterEach(() => dismissToast());
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
    expect(within(await screen.findByRole("status")).getByText("Bruno Novo foi salvo.")).toBeInTheDocument();
  });

  it("Salvar fica ativo; no envio mostra todos os erros embaixo dos campos e foca o primeiro", async () => {
    const api = fakeApi();
    renderWith(api, <CustomersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    type("Telefone", "1199");
    type("E-mail", "sem-arroba");
    const save = screen.getByRole("button", { name: "Salvar" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(await screen.findByText("Informe o nome.")).toBeInTheDocument();
    expect(screen.getByText(/Telefone inválido/)).toBeInTheDocument();
    expect(screen.getByText(/E-mail inválido/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveFocus());
    expect(screen.getByLabelText("Nome")).toHaveAttribute("aria-invalid", "true");
    expect(api.upsertCustomer).not.toHaveBeenCalled();
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
    expect(await screen.findByText(/1 cadastro parecido.*nada foi mesclado/)).toBeInTheDocument();
  });

  it("edita com a versão carregada e mostra conflito de versão do servidor", async () => {
    const api = fakeApi({
      upsertCustomer: vi.fn(async () => {
        throw new ApiError("STALE_VERSION", "Este registro foi alterado por outra pessoa. Recarregue e tente de novo.", 409, null, false);
      }),
    });
    renderWith(api, <CustomersPage />);
    await menuAction("Ana Exemplo", "Editar");
    expect(screen.getByLabelText("Telefone")).toHaveValue("(11) 98765-4321");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/alterado por outra pessoa/)).toBeInTheDocument();
    expect(vi.mocked(api.upsertCustomer).mock.calls[0]![0]).toMatchObject({ customer_id: ana.id, expected_version: 3 });
  });

  it("arquiva com expected_version", async () => {
    const api = fakeApi();
    renderWith(api, <CustomersPage />);
    await menuAction("Ana Exemplo", "Arquivar");
    await waitFor(() =>
      expect(api.archiveCustomer).toHaveBeenCalledWith(
        { customer_id: ana.id, expected_version: 3, archived: true },
        expect.any(String),
      ),
    );
    expect(within(await screen.findByRole("status")).getByText("Ana Exemplo foi arquivado.")).toBeInTheDocument();
  });

  it("Desfazer depois de arquivar desarquiva com a versão nova", async () => {
    const api = fakeApi();
    renderWith(api, <CustomersPage />);
    await menuAction("Ana Exemplo", "Arquivar");
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(api.archiveCustomer).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.archiveCustomer).mock.calls[1]![0]).toEqual({ customer_id: ana.id, expected_version: 4, archived: false });
    expect(await screen.findByText("Ana Exemplo voltou para a lista.")).toBeInTheDocument();
  });

  it("erro ao arquivar aparece no aviso, sem Desfazer", async () => {
    const api = fakeApi({
      archiveCustomer: vi.fn(async () => {
        throw new ApiError("STALE_VERSION", "Este registro foi alterado por outra pessoa. Recarregue e tente de novo.", 409, null, false);
      }),
    });
    renderWith(api, <CustomersPage />);
    await menuAction("Ana Exemplo", "Arquivar");
    expect(within(await screen.findByRole("status")).getByText(/alterado por outra pessoa/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeInTheDocument();
  });
});

describe("clientes: três estados da lista (item 40) e formulário perto do foco (item 20)", () => {
  it("carregando mostra o esqueleto, não “nenhum cliente”", async () => {
    let resolve: (v: { items: CrmCustomer[]; next_cursor: null }) => void = () => {};
    const api = fakeApi({ listCustomers: vi.fn(() => new Promise<{ items: CrmCustomer[]; next_cursor: null }>((r) => (resolve = r))) });
    renderWith(api, <CustomersPage />);
    expect(await screen.findByText("Carregando clientes…")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum cliente/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.listCustomers).toHaveBeenCalled());
    resolve({ items: [], next_cursor: null });
    expect(await screen.findByText("Nenhum cliente ainda")).toBeInTheDocument();
    expect(screen.queryByText("Carregando clientes…")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Importar planilha" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cadastrar cliente" })).toBeEnabled();
  });

  it("busca sem resultado diz o que foi buscado e “Cadastrar” já traz o nome", async () => {
    const api = fakeApi({ listCustomers: vi.fn(async (q: { q?: string }) => ({ items: q.q ? [] : [ana], next_cursor: null })) });
    renderWith(api, <CustomersPage />);
    expect(await screen.findByText("Ana Exemplo")).toBeInTheDocument();
    type("Buscar por nome, e-mail ou telefone", "zzz");
    expect(await screen.findByText("Ninguém com “zzz”")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum cliente ainda")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar" }));
    expect(screen.getByRole("heading", { name: "Novo cliente" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("zzz");
  });

  it("resposta atrasada de uma busca antiga não sobrescreve a busca nova", async () => {
    const joao: CrmCustomer = { ...ana, id: FX.customers.guestInA, name: "João Exemplo" };
    let soltarJo: (v: Page) => void = () => {};
    const api = fakeApi({
      listCustomers: vi.fn((q: { q?: string }) =>
        q.q === "jo"
          ? new Promise<Page>((r) => (soltarJo = r))
          : Promise.resolve({ items: q.q === "joao" ? [joao] : [ana], next_cursor: null })),
    });
    renderWith(api, <CustomersPage />);
    expect(await screen.findByText("Ana Exemplo")).toBeInTheDocument();
    type("Buscar por nome, e-mail ou telefone", "jo");
    await waitFor(() => expect(api.listCustomers).toHaveBeenCalledWith(expect.objectContaining({ q: "jo" })));
    type("Buscar por nome, e-mail ou telefone", "joao");
    expect(await screen.findByText("João Exemplo")).toBeInTheDocument();
    soltarJo({ items: [ana], next_cursor: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("João Exemplo")).toBeInTheDocument();
    expect(screen.queryByText("Ana Exemplo")).not.toBeInTheDocument();
  });

  it("“Carregar mais” não anexa página de outra busca nem repete a mesma página", async () => {
    const bia: CrmCustomer = { ...ana, id: FX.customers.guestInA, name: "Bia Exemplo" };
    const carla: CrmCustomer = { ...ana, id: "c0000000-0000-4000-8000-0000000000c1", name: "Carla Exemplo" };
    const pendentes: ((v: Page) => void)[] = [];
    const api = fakeApi({
      listCustomers: vi.fn((q: { q?: string; cursor?: string }) =>
        q.cursor
          ? new Promise<Page>((r) => pendentes.push(r))
          : Promise.resolve(q.q === "bia" ? { items: [bia], next_cursor: null } : { items: [ana], next_cursor: "c1" })),
    });
    renderWith(api, <CustomersPage />);
    expect(await screen.findByText("Ana Exemplo")).toBeInTheDocument();

    // Dois cliques na mesma página: anexa uma vez só.
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(pendentes).toHaveLength(2));
    pendentes[0]!({ items: [carla], next_cursor: "c2" });
    pendentes[1]!({ items: [carla], next_cursor: "c2" });
    expect(await screen.findByText("Carla Exemplo")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByText("Carla Exemplo")).toHaveLength(1);

    // Pede a página seguinte e troca a busca antes de ela chegar: a página antiga é descartada.
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(pendentes).toHaveLength(3));
    expect(api.listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined, cursor: "c2" }));
    type("Buscar por nome, e-mail ou telefone", "bia");
    expect(await screen.findByText("Bia Exemplo")).toBeInTheDocument();
    pendentes[2]!({ items: [{ ...carla, id: "c0000000-0000-4000-8000-0000000000c2", name: "Dora Exemplo" }], next_cursor: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Dora Exemplo")).not.toBeInTheDocument();
    expect(screen.queryByText("Ana Exemplo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("no desktop, Editar abre o formulário com o foco no primeiro campo; Cancelar devolve o foco ao “⋯”", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderWith(fakeApi(), <CustomersPage />);
    await menuAction("Ana Exemplo", "Editar");
    const panel = screen.getByRole("region", { name: "Editar cliente" });
    await waitFor(() => expect(within(panel).getByLabelText("Nome")).toHaveFocus());
    expect(within(panel).getByLabelText("Nome")).toHaveValue("Ana Exemplo");
    expect(scroll).toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mais ações para Ana Exemplo" })).toHaveFocus());
  });
});

describe("serviços", () => {
  it("item 45: lista duração, intervalos e o preço à direita; piso e custo só na edição; modelos fora da lista", async () => {
    renderWith(fakeApi(), <ServicesPage />);
    const item = (await screen.findByText("Corte")).closest("li")!;
    expect(within(item).getByText(/30 min/)).toBeInTheDocument();
    expect(item).toHaveTextContent(/intervalo 0 antes \/ 10 depois/);
    expect(within(item).getByText(/R\$\s60,00/)).toHaveClass("crm-price");
    expect(item).not.toHaveTextContent(/piso|custo/);
    expect(screen.queryByRole("group", { name: "Começar de um modelo" })).not.toBeInTheDocument();
    fireEvent.click(within(item).getByRole("button", { name: "Editar Corte" }));
    expect(screen.getByLabelText("Piso (R$)")).toHaveValue("45,00");
    // Editar não oferece modelos (só "Novo serviço").
    expect(screen.queryByRole("group", { name: "Começar de um modelo" })).not.toBeInTheDocument();
  });

  it("item 40: esqueleto enquanto carrega; lista vazia de verdade mostra os modelos e o cadastrar", async () => {
    let resolve: (v: { items: ProviderService[]; next_cursor: null }) => void = () => {};
    const api = fakeApi({ listServices: vi.fn(() => new Promise<{ items: ProviderService[]; next_cursor: null }>((r) => (resolve = r))) });
    renderWith(api, <ServicesPage />);
    expect(screen.getByText("Carregando serviços…").closest('[role="status"]')).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum serviço/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.listServices).toHaveBeenCalled());
    resolve({ items: [], next_cursor: null });
    expect(await screen.findByText("Nenhum serviço ainda")).toBeInTheDocument();
    expect(screen.queryByText("Carregando serviços…")).not.toBeInTheDocument();
    const models = screen.getByRole("group", { name: "Começar de um modelo" });
    fireEvent.click(within(models).getByRole("button", { name: "Modelo: Corte (30 min)" }));
    expect(screen.getByLabelText("Nome")).toHaveValue("Corte");
    expect(screen.getByLabelText("Duração (min)")).toHaveValue("30");
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
    // Com a lista cheia, os modelos ficam dentro de "Novo serviço".
    fireEvent.click(await screen.findByRole("button", { name: "Novo serviço" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Começar de um modelo" })).getByRole("button", { name: "Modelo: Corte e barba (50 min)" }));
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

  it("arquivar serviço executa na hora e Desfazer reativa", async () => {
    const api = fakeApi();
    renderWith(api, <ServicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar Corte" }));
    await waitFor(() => expect(api.saveService).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveService).mock.calls[0]![0]).toMatchObject({ active: false });
    expect(within(screen.getByRole("status")).getByText("Corte foi arquivado.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(api.saveService).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.saveService).mock.calls[1]![0]).toMatchObject({ active: true });
    expect(await screen.findByText("Corte voltou ao catálogo.")).toBeInTheDocument();
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
    expect(screen.getByText(/2 linhas prontas, 1 com problema/)).toBeInTheDocument();
    expect(screen.getByText("Problema: Telefone inválido")).toBeInTheDocument();
    // Preview só consulta linhas sem problema.
    expect(vi.mocked(api.importPreview).mock.calls[0]![0].map((r) => r.line)).toEqual([2, 3]);
    expect(screen.getByLabelText("Linha 3")).toHaveValue("skip");

    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    expect(await screen.findByText(/1 criado, 1 pulado.*1 rejeitado/)).toBeInTheDocument();
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

  it("Ver prévia sem conteúdo explica embaixo do campo e foca nele", async () => {
    renderWith(fakeApi(), <ImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    expect(await screen.findByText(/Cole o conteúdo da planilha/)).toBeInTheDocument();
    expect(screen.getByLabelText("Ou cole o conteúdo")).toHaveFocus();
  });

  it("arquivo sem coluna nome é recusado com mensagem", async () => {
    renderWith(fakeApi(), <ImportPage />);
    type("Ou cole o conteúdo", "telefone\n11987654321");
    fireEvent.click(screen.getByRole("button", { name: "Ver prévia" }));
    expect(await screen.findByText(/coluna “nome”/)).toBeInTheDocument();
  });
});

describe("retorno na lista de clientes (P49)", () => {
  const bia: CrmCustomer = { ...ana, id: FX.customers.guestInA, name: "Bia Exemplo", phone: "+5511912345678", email: null, declared_source: null };
  const caio: CrmCustomer = { ...ana, id: "30000000-0000-4000-8000-0000000000c1", name: "Caio Exemplo", phone: null, email: null, declared_source: null };
  const duda: CrmCustomer = { ...ana, id: "30000000-0000-4000-8000-0000000000c2", name: "Duda Exemplo", phone: null, email: null, declared_source: null };
  const visits = {
    timezone: "America/Sao_Paulo",
    now: "2026-10-20T12:00:00.000Z",
    since: "2026-04-23T00:00:00Z",
    complete: true,
    byCustomer: {
      [ana.id]: { last_visit_at: "2026-10-06T13:00:00.000Z", next_at: null },
      [bia.id]: { last_visit_at: "2026-08-01T13:00:00.000Z", next_at: null },
      [caio.id]: { last_visit_at: "2026-07-01T13:00:00.000Z", next_at: "2026-10-27T13:00:00.000Z" },
    },
  };
  const api = (over: Partial<CrmApi> = {}) =>
    fakeApi({ listCustomers: vi.fn(async () => ({ items: [ana, bia, caio, duda], next_cursor: null })), visitSummary: vi.fn(async () => visits), ...over });
  const row = (name: string) => screen.getByRole("link", { name }).closest("li")!;

  it("cada linha diz a última visita há N dias ou o próximo dia marcado", async () => {
    renderWith(api(), <CustomersPage />);
    await screen.findByText("Última visita há 14 dias");
    expect(row("Ana Exemplo")).toHaveTextContent("Última visita há 14 dias");
    expect(row("Bia Exemplo")).toHaveTextContent("Última visita há 80 dias");
    // Com horário marcado, vale o próximo (mesmo tendo sumido antes).
    expect(row("Caio Exemplo")).toHaveTextContent("Próximo: ter., 27/10");
    expect(row("Duda Exemplo")).toHaveTextContent("Sem visita nos últimos 6 meses");
  });

  it("filtro “Sem voltar há 30+ dias” mostra só quem veio, sumiu e não tem horário; WhatsApp à mão", async () => {
    renderWith(api(), <CustomersPage />);
    await screen.findByText("Última visita há 14 dias");
    fireEvent.click(screen.getByRole("radio", { name: "Sem voltar há 30+ dias" }));
    const list = screen.getByRole("list", { name: "Sem voltar há 30+ dias" });
    expect(within(list).getAllByRole("listitem").map((li) => within(li).getAllByRole("link")[0]!.textContent)).toEqual(["Bia Exemplo"]);
    expect(within(list).getByRole("link", { name: "WhatsApp de Bia Exemplo (abre o WhatsApp)" })).toHaveAttribute("href", "https://wa.me/5511912345678");
    fireEvent.click(screen.getByRole("radio", { name: "Todos" }));
    expect(screen.getByRole("link", { name: "Duda Exemplo" })).toBeInTheDocument();
  });

  it("filtro vazio tem frase", async () => {
    renderWith(api({ listCustomers: vi.fn(async () => ({ items: [ana], next_cursor: null })) }), <CustomersPage />);
    await screen.findByText("Última visita há 14 dias");
    fireEvent.click(screen.getByRole("radio", { name: "Sem voltar há 30+ dias" }));
    expect(screen.getByText("Ninguém sem voltar há 30 dias ou mais")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ana Exemplo" })).not.toBeInTheDocument();
  });

  it("sem a leitura da agenda, a lista aparece e o aviso explica", async () => {
    renderWith(api({ visitSummary: vi.fn(async () => Promise.reject(new Error("fora"))) }), <CustomersPage />);
    expect(await screen.findByText(/Não deu para ler a agenda agora/)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Ana Exemplo" })).toBeInTheDocument();
    expect(screen.queryByText(/Última visita/)).not.toBeInTheDocument();
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
    // P49: a base de exemplo tem os dois com horário hoje (terça 20/10).
    expect(await screen.findAllByText("Próximo: ter., 20/10")).toHaveLength(2);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Telas de Clientes" })).getByRole("link", { name: "Serviços" }));
    expect(await screen.findByText("Barba")).toBeInTheDocument();
  });

  it("demonstração busca como o servidor: sem acento nem caixa, e-mail e dígitos do telefone", async () => {
    const demo = createDemoCrmApi();
    const nomes = async (q: string) => (await demo.listCustomers({ q })).items.map((c) => c.name);
    expect(await nomes("CLIENTE ÁB")).toEqual(["Cliente AB (exemplo)"]);
    expect(await nomes("visitante sem login")).toEqual(["Visitante sem login (exemplo)"]);
    expect(await nomes("cliente.ab@")).toEqual(["Cliente AB (exemplo)"]);
    expect(await nomes("7777")).toEqual(["Cliente AB (exemplo)"]);
    expect(await nomes("777")).toEqual([]);
  });

  it("demonstração recusa gravação mesmo se chamada diretamente", async () => {
    await expect(createDemoCrmApi().upsertCustomer({ name: "X" }, "k".repeat(16))).rejects.toMatchObject({
      code: "POLICY_REJECTED",
    });
  });
});
