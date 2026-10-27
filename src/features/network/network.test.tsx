import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { SessionProvider } from "../../app/session.tsx";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { ApiError } from "../../lib/api/client.ts";
import { createDemoNetworkApi, createHttpNetworkApi, resetDemoNetwork } from "./api.ts";
import { networkModule, networkPublicRoutes } from "./module.tsx";
import { PublicProfileView } from "./PublicProfileView.tsx";

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: "/app/perfil", children: networkModule.routes }, ...networkPublicRoutes],
    { initialEntries: [path] },
  );
  return render(
    <SessionProvider client={null}>
      <RouterProvider router={router} />
      <Toaster />
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

/** Passo 1 da reserva pelo link: serviço (o primeiro já vem marcado) e segue para o dia e a hora. */
async function chooseService(name?: string) {
  if (name) fireEvent.click(await screen.findByRole("radio", { name: new RegExp(`^${name}`) }));
  fireEvent.click(await screen.findByRole("button", { name: "Escolher dia e hora" }));
}

beforeEach(() => {
  resetDemoNetwork();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  dismissToast();
});

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
    // Botão sempre ativo: ao enviar, cada erro aparece embaixo do seu campo e o foco vai para o primeiro.
    const submit = screen.getByRole("button", { name: "Publicar perfil" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText(/Use de 3 a 50 letras/)).toBeInTheDocument();
    expect(screen.getByText("Informe o bairro ou a região.")).toBeInTheDocument();
    await waitFor(() => expect(slug).toHaveFocus());
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Perfil publicado.")).not.toBeInTheDocument();
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
    expect(await screen.findByText(/Link copiado/)).toBeInTheDocument();
    // "Ver como o cliente vê" continua no cartão do perfil.
    expect(screen.getByRole("link", { name: "Ver como o cliente vê" })).toBeInTheDocument();
  });

  it("perfil no ar: falha ao copiar avisa para copiar manualmente", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("negado"); }) }, configurable: true });
    await publishDemoProfile();
    const card = await screen.findByRole("region", { name: "Seu perfil está no ar!" });
    fireEvent.click(within(card).getByRole("button", { name: "Copiar link" }));
    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument();
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
    // Só selos positivos: o que falta não vira selo (auditoria E5).
    expect(document.body.textContent).not.toMatch(/não verificada/);
    await chooseService();
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
    await chooseService();
    const slots = await screen.findByRole("list", { name: "Horários livres" });
    fireEvent.click(within(slots).getByRole("button", { name: "12:00" }));
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Maria" } });
    const phone = screen.getByLabelText("WhatsApp com DDD");
    fireEvent.change(phone, { target: { value: "1197" } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir este horário" }));
    expect(await screen.findByText(/Use o número com DDD/)).toBeInTheDocument();
    await waitFor(() => expect(phone).toHaveFocus());
    expect(screen.queryByRole("heading", { name: "Confirme o horário" })).not.toBeInTheDocument();
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
    await chooseService();
    const again = await screen.findByRole("list", { name: "Horários livres" });
    expect(within(again).queryByRole("button", { name: "12:00" })).not.toBeInTheDocument();
  });

  it("reserva em etapas: passo atual marcado, dia antes da hora, resumo da escolha e voltar sem perder nada", async () => {
    await publishDemoProfile();
    cleanup();
    renderAt("/p/barbearia-exemplo");
    const steps = await screen.findByRole("navigation", { name: "Etapas da reserva" });
    expect(steps).toHaveTextContent("Passo 1 de 4");
    expect(within(steps).getByText("Serviço").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("radio", { name: /^Corte/ })).toBeChecked();
    await chooseService("Barba");

    expect(await screen.findByRole("heading", { name: "Escolha o dia e a hora" })).toHaveFocus();
    expect(steps).toHaveTextContent("Passo 2 de 4");
    expect(within(steps).getByText("Dia e hora").closest("li")).toHaveAttribute("aria-current", "step");
    const days = screen.getByRole("group", { name: "Dia" });
    expect(within(days).getAllByRole("radio")).toHaveLength(14);
    expect(within(days).getByRole("radio", { name: "ter 20/10" })).toBeChecked();
    fireEvent.click(within(days).getByRole("radio", { name: "qua 21/10" }));
    expect(screen.getByText("Barba · qua 21/10")).toBeInTheDocument();
    const slots = await screen.findByRole("list", { name: "Horários livres" });
    // Outro dia: a manhã está livre (as reservas das fixtures são do dia 20).
    fireEvent.click(within(slots).getByRole("button", { name: "09:00" }));

    expect(await screen.findByRole("heading", { name: "Seus dados" })).toBeInTheDocument();
    expect(steps).toHaveTextContent("Passo 3 de 4");
    expect(screen.getByText("Barba · qua 21/10 · 09:00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Maria" } });

    // Voltar até o serviço e avançar de novo: serviço, dia, hora e nome continuam escolhidos.
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    const again = await screen.findByRole("list", { name: "Horários livres" });
    expect(within(again).getByRole("button", { name: "09:00" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "qua 21/10" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByRole("radio", { name: /^Barba/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Escolher dia e hora" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(await screen.findByLabelText("Seu nome")).toHaveValue("Maria");
    expect(screen.getByText("Barba · qua 21/10 · 09:00")).toBeInTheDocument();
  });

  it("selos: identidade só aparece quando verificada; com avaliações, link para elas e nada de perfil novo", async () => {
    const api = createDemoNetworkApi("http://localhost");
    const base = { slug: "x", category: "barber" as const, area: "Centro", fields: { display_name: "Barbearia X" }, published_at: "2026-10-20T12:00:00Z" };
    const { rerender } = render(
      <MemoryRouter>
        <PublicProfileView api={api} profile={{ ...base, reputation: { identity_verified: true, reviews_count: 1 } }} />
      </MemoryRouter>,
    );
    const badges = screen.getByRole("list", { name: "Reputação" });
    expect(badges).toHaveTextContent("Identidade verificada");
    expect(within(badges).getByRole("link", { name: "1 avaliação de cliente" })).toHaveAttribute("href", "/avaliacoes/x");
    expect(badges).not.toHaveTextContent("Perfil novo");
    rerender(
      <MemoryRouter>
        <PublicProfileView api={api} profile={{ ...base, reputation: { identity_verified: false, reviews_count: 0 } }} />
      </MemoryRouter>,
    );
    expect(within(badges).getAllByRole("listitem")).toHaveLength(1);
    expect(badges).toHaveTextContent("Perfil novo · ainda sem avaliações");
    expect(badges).not.toHaveTextContent(/Identidade/);
  });

  it("horário tomado por outra pessoa: volta ao passo 2 com o aviso, a lista recarrega e o nome continua", async () => {
    const book = vi.fn().mockRejectedValue(new ApiError("SLOT_CONFLICT", "x", 409, null, false, "slot"));
    const slotsCall = vi.fn().mockResolvedValue({ slots: [{ starts_at: "2026-10-20T15:00:00Z", ends_at: "2026-10-20T15:30:00Z" }], timezone: "America/Sao_Paulo" });
    const api = {
      ...createDemoNetworkApi("http://localhost"),
      publicServices: async () => [{ id: FX.services.corteA, name: "Corte", duration_min: 30 }],
      publicSlots: slotsCall,
      book,
    };
    const profile = { slug: "x", category: "barber" as const, area: "Centro", published_at: "2026-10-20T12:00:00Z",
      fields: { display_name: "Barbearia X", booking_link: "http://localhost/p/x" }, reputation: { identity_verified: false, reviews_count: 0 } };
    render(
      <MemoryRouter>
        <PublicProfileView api={api} profile={profile} />
      </MemoryRouter>,
    );
    await chooseService();
    fireEvent.click(within(await screen.findByRole("list", { name: "Horários livres" })).getByRole("button", { name: "12:00" }));
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("WhatsApp com DDD"), { target: { value: "(11) 97777-4343" } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir este horário" }));
    expect(await screen.findByText(/acabou de ser reservado por outra pessoa/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Etapas da reserva" })).toHaveTextContent("Passo 2 de 4");
    await waitFor(() => expect(slotsCall).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    fireEvent.click(within(await screen.findByRole("list", { name: "Horários livres" })).getByRole("button", { name: "12:00" }));
    expect(await screen.findByLabelText("Seu nome")).toHaveValue("Maria");
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

  it("Tirar do ar oferece Desfazer, que publica de novo no mesmo endereço", async () => {
    await publishDemoProfile();
    fireEvent.click(screen.getByRole("button", { name: "Tirar do ar" }));
    await screen.findByText(/Perfil removido do ar/);
    expect(await screen.findByRole("heading", { name: "Montar perfil" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(await screen.findByText(/Perfil de volta no ar/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Perfil no ar" })).toBeInTheDocument();
    cleanup();
    renderAt("/p/barbearia-exemplo");
    expect(await screen.findByRole("heading", { name: "Barbearia Exemplo A" })).toBeInTheDocument();
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
