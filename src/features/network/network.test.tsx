import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { SessionProvider } from "../../app/session.tsx";
import { ApiError } from "../../lib/api/client.ts";
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

  it("perfil no ar: cartão com o endereço completo, WhatsApp com texto pronto e Copiar com retorno", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await publishDemoProfile();
    const card = await screen.findByRole("region", { name: "Seu perfil está no ar!" });
    const url = `${window.location.origin}/p/barbearia-exemplo`;
    expect(within(card).getByLabelText("Endereço do seu perfil")).toHaveValue(url);
    const wa = within(card).getByRole("link", { name: "Mandar no WhatsApp" });
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(new URL(wa.getAttribute("href")!).search.slice(6))).toContain(url);
    fireEvent.click(within(card).getByRole("button", { name: "Copiar link" }));
    expect(await within(card).findByRole("button", { name: "Copiado" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(url);
    expect(within(card).getByRole("status")).toHaveTextContent("Link copiado");
    // "Ver como o cliente vê" continua no cartão do perfil.
    expect(screen.getByRole("link", { name: "Ver como o cliente vê" })).toBeInTheDocument();
  });

  it("perfil no ar: falha ao copiar avisa para copiar manualmente", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("negado"); }) }, configurable: true });
    await publishDemoProfile();
    const card = await screen.findByRole("region", { name: "Seu perfil está no ar!" });
    fireEvent.click(within(card).getByRole("button", { name: "Copiar link" }));
    expect(await within(card).findByText(/Não foi possível copiar/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
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
  it("perfil público mostra só a projeção publicada e horários livres", async () => {
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
    // Escolher o horário não reserva nada: só abre o pedido.
    expect(screen.getByRole("form", { name: "Pedir horário" })).toBeInTheDocument();
  });

  it("reserva pelo link: pedido → código → confirmação; código errado não confirma; horário some da lista", async () => {
    await publishDemoProfile();
    cleanup();
    renderAt("/p/barbearia-exemplo");
    const slots = await screen.findByRole("list", { name: "Horários livres" });
    fireEvent.click(within(slots).getByRole("button", { name: "12:00" }));
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Maria" } });
    const phone = screen.getByLabelText("WhatsApp com DDD");
    fireEvent.change(phone, { target: { value: "1197" } });
    expect(screen.getByText(/Use o número com DDD/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pedir este horário" })).toBeDisabled();
    fireEvent.change(phone, { target: { value: "(11) 97777-4343" } });
    // O código vai para o WhatsApp de quem pede, não do profissional.
    expect(screen.getByText(/código de 6 dígitos para o\s+seu WhatsApp/)).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp do profissional/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pedir este horário" }));

    expect(await screen.findByRole("heading", { name: "Confirme o horário" })).toBeInTheDocument();
    expect(screen.getByText("+5511977774343")).toBeInTheDocument();
    const shown = /O código seria (\d{6})/.exec(screen.getByText(/nenhuma mensagem é enviada/).textContent ?? "")![1]!;
    const wrong = String((Number(shown) + 1) % 1_000_000).padStart(6, "0");
    fireEvent.change(screen.getByLabelText("Código recebido"), { target: { value: wrong } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar horário" }));
    expect(await screen.findByText(/Código incorreto/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Código recebido"), { target: { value: shown } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar horário" }));
    expect(await screen.findByRole("heading", { name: "Horário confirmado" })).toBeInTheDocument();
    expect(screen.getByText(/Corte · terça-feira, 20\/10 às/)).toBeInTheDocument();

    cleanup();
    renderAt("/p/barbearia-exemplo");
    const again = await screen.findByRole("list", { name: "Horários livres" });
    expect(within(again).queryByRole("button", { name: "12:00" })).not.toBeInTheDocument();
  });

  it("toE164 aceita os formatos comuns e recusa número sem DDD", async () => {
    const { toE164 } = await import("./PublicProfileView.tsx");
    expect(toE164("(11) 97777-4343")).toBe("+5511977774343");
    expect(toE164("+55 11 97777-4343")).toBe("+5511977774343");
    expect(toE164("5511977774343")).toBe("+5511977774343");
    expect(toE164("97777-4343")).toBeNull();
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
  });

  it("reserva pelo link: serviços, pedido e confirmação por POST; chave no cabeçalho, contato só no corpo", async () => {
    const call = vi.fn(async (..._args: unknown[]) => ({ data: { services: [] } }));
    const api = createHttpNetworkApi(call as never, null);
    await api.publicServices("barbearia-a");
    expect(call.mock.calls[0]).toEqual(["/network/public.services", expect.anything(), { method: "POST", body: { slug: "barbearia-a" } }]);
    const contact = { name: "Maria", phone_e164: "+5511977774343" };
    await api.book({ slug: "barbearia-a", service_id: FX.services.corteA, starts_at: "2026-10-27T13:00:00Z", contact }, "key-0000000000000002");
    const [path, , opts] = call.mock.calls[1] as unknown as [string, unknown, Record<string, unknown>];
    expect(path).toBe("/network/public.book");
    expect(opts).toMatchObject({ method: "POST", idempotencyKey: "key-0000000000000002", body: { contact } });
    await api.confirmBooking({ request_id: FX.tenants.A, code: "123456" }, "key-0000000000000003");
    expect(call.mock.calls[2]![0]).toBe("/network/public.confirm");
  });
});

describe("demonstração não finge agenda real", () => {
  it("perfil sem link de reserva: cliente HTTP mostra lista vazia em vez de erro", async () => {
    const call = vi.fn(async () => {
      throw new ApiError("NOT_FOUND", "Não encontrado.", 404, null, false);
    });
    const api = createHttpNetworkApi(call as never, null);
    await waitFor(async () => expect(await api.publicServices("barbearia-a")).toEqual([]));
  });
});
