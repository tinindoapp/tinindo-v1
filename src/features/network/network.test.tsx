import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { SessionProvider } from "../../app/session.tsx";
import { createDemoNetworkApi, createHttpNetworkApi, resetDemoNetwork } from "./api.ts";
import { networkModule, networkPublicRoutes } from "./module.tsx";

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: "/app/perfil", children: networkModule.routes }, ...networkPublicRoutes],
    { initialEntries: [path] },
  );
  return render(
    <SessionProvider client={null}>
      <RouterProvider router={router} />
    </SessionProvider>,
  );
}

async function publishDemoProfile() {
  renderAt("/app/perfil");
  fireEvent.change(await screen.findByLabelText("Endereço do perfil"), { target: { value: "Barbearia Exemplo" } });
  fireEvent.change(screen.getByLabelText("Bairro ou região"), { target: { value: "Centro" } });
  fireEvent.click(screen.getByRole("button", { name: "Publicar perfil" }));
  await screen.findByText("Perfil publicado.");
}

beforeEach(() => {
  resetDemoNetwork();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("perfil do dono (demonstração)", () => {
  it("onboarding progressivo: convite de colega só aparece depois do perfil no ar", async () => {
    renderAt("/app/perfil");
    expect(await screen.findByText(/Demonstração: nada é salvo/)).toBeInTheDocument();
    const steps = screen.getByRole("region", { name: /Primeiros passos/ });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Convidar um colega" })).not.toBeInTheDocument();
  });

  it("publica com slug normalizado e só campos escolhidos; endereço inválido bloqueia", async () => {
    renderAt("/app/perfil");
    const slug = await screen.findByLabelText("Endereço do perfil");
    fireEvent.change(slug, { target: { value: "a" } });
    expect(screen.getByText(/Use de 3 a 50 letras/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar perfil" })).toBeDisabled();
    fireEvent.change(slug, { target: { value: "Barbearia São João" } });
    expect(slug).toHaveValue("barbearia-sao-joao");
    fireEvent.change(screen.getByLabelText("Bairro ou região"), { target: { value: "Centro" } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar perfil" }));
    expect(await screen.findByText("Perfil publicado.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Convidar um colega" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Primeiros passos/ })).toHaveTextContent("2 de 3");
  });

  it("convite de colega gera link com token só no fragmento e sem o nome", async () => {
    await publishDemoProfile();
    fireEvent.change(await screen.findByLabelText("Nome do colega (só você vê)"), { target: { value: "Fulano Exemplo" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar link de convite" }));
    const input = (await screen.findByLabelText("Link para compartilhar")) as HTMLInputElement;
    const url = new URL(input.value);
    expect(url.pathname).toBe("/convite");
    expect(url.search).toBe("");
    expect(url.hash).toMatch(/^#t=[A-Za-z0-9_-]{43}$/);
    expect(input.value).not.toContain("Fulano");
    expect(await screen.findByText("Aguardando")).toBeInTheDocument();
    expect(screen.getByText(/A Tinindo não manda mensagem/)).toBeInTheDocument();
  });
});

describe("páginas públicas (demonstração)", () => {
  it("perfil público mostra só a projeção publicada e horários livres sem reservar", async () => {
    await publishDemoProfile();
    cleanup();
    renderAt("/p/barbearia-exemplo");
    expect(await screen.findByRole("heading", { name: "Barbearia Exemplo A" })).toBeInTheDocument();
    expect(screen.getByText("Perfil novo · ainda sem avaliações")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FX.tenants.A);
    expect(document.body.textContent).not.toMatch(/Tinindo garante/);
    const slots = await screen.findByRole("list", { name: "Horários livres" });
    // Manhã lotada nas fixtures: 09:00 ocupado; 12:00 livre.
    expect(within(slots).queryByRole("button", { name: "09:00" })).not.toBeInTheDocument();
    fireEvent.click(within(slots).getByRole("button", { name: "12:00" }));
    expect(screen.getByText(/Demonstração: nada foi reservado/)).toBeInTheDocument();
  });

  it("perfil tirado do ar some do link público", async () => {
    await publishDemoProfile();
    fireEvent.click(screen.getByRole("button", { name: "Tirar do ar" }));
    await screen.findByText(/Perfil removido do ar/);
    cleanup();
    renderAt("/p/barbearia-exemplo");
    expect(await screen.findByRole("heading", { name: "Perfil não encontrado" })).toBeInTheDocument();
  });

  it("convite: token sai da URL, abrir não aceita, aceitar é ação explícita e de uso único", async () => {
    const api = createDemoNetworkApi("http://localhost");
    const link = await api.createReferral({ kind: "professional_invites_peer", invitee_name: "Colega", origin: "web" }, "k".repeat(16));
    const token = new URL(link.share_url).hash.slice(3);
    window.history.replaceState(null, "", `/convite#t=${token}`);

    renderAt("/convite");
    expect(window.location.hash).toBe("");
    expect(await screen.findByRole("heading", { name: "Você recebeu um convite de um colega" })).toBeInTheDocument();
    expect((await api.listReferrals())[0]?.state).toBe("pending");

    fireEvent.click(screen.getByRole("button", { name: "Aceitar convite" }));
    expect(await screen.findByText(/Convite aceito/)).toBeInTheDocument();
    expect((await api.listReferrals())[0]?.state).toBe("claimed");
    await expect(api.claimReferral(token, "k".repeat(16))).rejects.toMatchObject({ code: "POLICY_REJECTED" });
  });

  it("convite sem token ou com token desconhecido → indisponível", async () => {
    window.history.replaceState(null, "", `/convite#t=${"x".repeat(43)}`);
    renderAt("/convite");
    expect(await screen.findByRole("heading", { name: "Convite indisponível" })).toBeInTheDocument();
  });

  it("cliente indica profissional com link pessoal, sem pedir telefone", async () => {
    renderAt("/indicar");
    expect(screen.queryByLabelText(/telefone/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome do profissional (só você vê)"), { target: { value: "Profissional Exemplo" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar link de indicação" }));
    const input = (await screen.findByLabelText("Link para compartilhar")) as HTMLInputElement;
    expect(input.value).toMatch(/\/convite#t=/);
    expect(input.value).not.toContain("Profissional");
  });
});

describe("cliente HTTP do módulo", () => {
  it("usa as rotas da função network; token do convite só no corpo de POST", async () => {
    const call = vi.fn(async () => ({ data: { referral_id: FX.tenants.A, kind: "professional_invites_peer", state: "claimed" } }));
    const api = createHttpNetworkApi(call as never, FX.tenants.A);
    await api.claimReferral("t".repeat(43), "key-0000000000000001");
    const [path, , opts] = call.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>];
    expect(path).toBe("/network/referral.claim");
    expect(path).not.toContain("t".repeat(43));
    expect(opts).toMatchObject({ method: "POST", body: { token: "t".repeat(43) }, idempotencyKey: "key-0000000000000001" });
    expect(await api.publicServices("x")).toEqual([]);
  });
});

describe("demonstração não finge agenda real", () => {
  it("cliente HTTP não inventa serviços públicos enquanto o catálogo não existe", async () => {
    const api = createHttpNetworkApi(vi.fn() as never, null);
    await waitFor(async () => expect(await api.publicServices("barbearia-a")).toEqual([]));
  });
});
