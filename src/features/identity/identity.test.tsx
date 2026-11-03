import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inline, parseLegal } from "./legalMarkdown.tsx";
import { Profession } from "@contracts";
import { FX, tenantA } from "@contracts/fixtures.ts";
import { OnboardingGoal, type Onboarding } from "@contracts";
import { SessionProvider } from "../../app/session.tsx";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { ApiError } from "../../lib/api/client.ts";
import { AccountPage } from "./AccountPage.tsx";
import { NewPasswordPage, RecoverPasswordPage, SignUpPage } from "./AuthPages.tsx";
import { CreateBusinessPage } from "./CreateBusinessPage.tsx";
import { identityModule } from "./module.tsx";
import { MyBookingsPage } from "./MyBookingsPage.tsx";
import { detectTimezone, POLICY_VERSIONS, PROFESSION_PRESETS } from "./presets.ts";
import { RedeemLinkPage } from "./RedeemLinkPage.tsx";
import { AuthFlowError, type IdentityServices, IdentityServicesProvider } from "./services.tsx";

const NEW_TENANT = "7d3b8f30-9f5e-4c51-8a0e-2a1c3b4d5e6f";
const empty: Onboarding = {
  tenant_id: FX.tenants.A, goal: null, cancellation_notice_hours: null, late_cancellation_fee_bps: null,
  completed_at: null, version: 1,
};

function fakeServices(over: Partial<IdentityServices> = {}): IdentityServices {
  return {
    online: true,
    createBusiness: vi.fn(async () => ({
      tenant: { ...tenantA, id: NEW_TENANT, name: "Salão Exemplo C", profession: "hairdresser" as const },
      resource_id: "8e4c9a41-0b6f-4d62-9b1f-3b2d4c5e6f70",
    })),
    loadBusiness: vi.fn(async () => ({ name: tenantA.name, profession: "barber" as const })),
    loadOnboarding: vi.fn(async () => empty),
    loadSetup: vi.fn(async () => ({ services: true, hours: false, profile: null })),
    saveOnboarding: vi.fn(async (_t, input) => ({
      ...empty, goal: input.goal ?? null, cancellation_notice_hours: input.cancellation_notice_hours ?? null,
      completed_at: "2026-10-20T12:00:00.000Z", version: 2,
    })),
    loadMyLinks: vi.fn(async () => []),
    loadMyBookings: vi.fn(async () => ({ now: "2026-10-20T12:00:00Z", bookings: [] })),
    redeemLink: vi.fn(async () => ({
      link_id: "0b1c2d3e-4f50-4a61-8b72-c3d4e5f60718", tenant_id: FX.tenants.A, tenant_name: tenantA.name,
      verified_at: "2026-10-20T12:00:00.000Z",
    })),
    revokeLink: vi.fn(async () => {}),
    signUp: vi.fn(async () => ({ needsConfirmation: true })),
    requestPasswordReset: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => {}),
    refreshSession: vi.fn(async () => {}),
    ...over,
  };
}

/** Sessão de demonstração (dono do tenant A) + serviços fake + roteador em memória. */
function renderPage(element: ReactNode, services: IdentityServices, path = "/app/conta") {
  const router = createMemoryRouter(
    [
      { path: "/app/conta", element: <IdentityServicesProvider value={services}>{element}</IdentityServicesProvider> },
      { path: "/app/conta/novo-negocio", element: <IdentityServicesProvider value={services}>{element}</IdentityServicesProvider> },
      { path: "/app/conta/vincular", element: <IdentityServicesProvider value={services}>{element}</IdentityServicesProvider> },
      { path: "/app/conta/reservas", element: <IdentityServicesProvider value={services}>{element}</IdentityServicesProvider> },
    ],
    { initialEntries: [path] },
  );
  render(
    <SessionProvider client={null}>
      <RouterProvider router={router} />
      <Toaster />
    </SessionProvider>,
  );
  return router;
}

afterEach(() => dismissToast());

const CODE = "Q2hhdmUtZGUtdGVzdGUtc2ludGV0aWNhLTAwMDAwMDA";

describe("presets por profissão", () => {
  it.each(Profession.options)("%s tem preset com todos os objetivos, uma vez cada", (p) => {
    const preset = PROFESSION_PRESETS[p];
    expect([...preset.goalOrder].sort()).toEqual([...OnboardingGoal.options].sort());
    expect(preset.suggestedNoticeHours).toBeGreaterThanOrEqual(0);
    expect(preset.suggestedNoticeHours).toBeLessThanOrEqual(168);
  });

  it("piloto cobre beleza e personal", () => {
    expect(PROFESSION_PRESETS.barber.segment).toBe("beleza");
    expect(PROFESSION_PRESETS.hairdresser.segment).toBe("beleza");
    expect(PROFESSION_PRESETS.personal_trainer.segment).toBe("personal");
  });

  it("exemplos de serviço não trazem preço nem termos de saúde", () => {
    for (const p of Profession.options) {
      for (const s of PROFESSION_PRESETS[p].serviceExamples) {
        expect(Object.keys(s).sort()).toEqual(["duration_min", "name"]);
        expect(s.name).not.toMatch(/avalia|f[ií]sic|les[aã]o|sa[uú]de|dieta/i);
      }
    }
  });
});

describe("criar negócio", () => {
  it("exige aceite dos termos antes de chamar o servidor", async () => {
    const services = fakeServices();
    renderPage(<CreateBusinessPage />, services, "/app/conta/novo-negocio");
    fireEvent.change(await screen.findByLabelText("Nome do negócio"), { target: { value: "Salão Exemplo C" } });
    fireEvent.click(screen.getByLabelText("Cabeleireiro(a)"));
    fireEvent.click(screen.getByRole("button", { name: "Criar negócio" }));
    expect(await screen.findByText(/aceite os termos/)).toBeInTheDocument();
    expect(services.createBusiness).not.toHaveBeenCalled();
  });

  it("botão sempre ativo: ao enviar vazio, mostra cada erro embaixo do campo e foca o primeiro", async () => {
    const services = fakeServices();
    renderPage(<CreateBusinessPage />, services, "/app/conta/novo-negocio");
    const submit = await screen.findByRole("button", { name: "Criar negócio" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText("Informe o nome do negócio.")).toBeInTheDocument();
    expect(screen.getByText("Escolha a profissão.")).toBeInTheDocument();
    expect(screen.getByText(/aceite os termos/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Nome do negócio")).toHaveFocus());
    expect(services.createBusiness).not.toHaveBeenCalled();
  });

  it("falha de rede → mesma chave no retry; sucesso → seleciona o negócio e recarrega a sessão", async () => {
    const createBusiness = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("PROVIDER_UNAVAILABLE", "x", 0, null, true))
      .mockResolvedValueOnce({
        tenant: { ...tenantA, id: NEW_TENANT, name: "Salão Exemplo C", profession: "hairdresser" },
        resource_id: "8e4c9a41-0b6f-4d62-9b1f-3b2d4c5e6f70",
      });
    const services = fakeServices({ createBusiness });
    const router = renderPage(<CreateBusinessPage />, services, "/app/conta/novo-negocio");

    fireEvent.change(await screen.findByLabelText("Nome do negócio"), { target: { value: "  Salão Exemplo C " } });
    fireEvent.click(screen.getByLabelText("Cabeleireiro(a)"));
    fireEvent.change(screen.getByLabelText("Fuso horário"), { target: { value: "America/Manaus" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Li e aceito/ }));
    fireEvent.click(screen.getByRole("button", { name: "Criar negócio" }));
    expect(await screen.findByText(/Sem conexão com o servidor/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Criar negócio" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/conta"));

    const [first, second] = createBusiness.mock.calls;
    expect(first?.[0]).toEqual({
      name: "Salão Exemplo C",
      profession: "hairdresser",
      timezone: "America/Manaus",
      accepted_policy_versions: [POLICY_VERSIONS.terms, POLICY_VERSIONS.privacy],
    });
    expect(second?.[1]).toBe(first?.[1]);
    expect(services.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("cota atingida mostra mensagem própria", async () => {
    const services = fakeServices({
      createBusiness: vi.fn().mockRejectedValue(new ApiError("QUOTA_EXCEEDED", "x", 429, null, true)),
    });
    renderPage(<CreateBusinessPage />, services, "/app/conta/novo-negocio");
    fireEvent.change(await screen.findByLabelText("Nome do negócio"), { target: { value: "Quarto" } });
    fireEvent.click(screen.getByLabelText("Barbearia"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Li e aceito/ }));
    fireEvent.click(screen.getByRole("button", { name: "Criar negócio" }));
    expect(await screen.findByText(/número máximo de negócios/)).toBeInTheDocument();
  });
});


describe("criar conta (E7)", () => {
  it("diz para quem é, mostra a regra da senha antes do erro e o botão Mostrar senha alterna as duas senhas", async () => {
    renderPage(<SignUpPage />, fakeServices(), "/app/conta");
    expect(await screen.findByText(/Para quem atende com hora marcada/)).toBeInTheDocument();
    const password = screen.getByLabelText("Senha");
    expect(password).toHaveAccessibleDescription("Pelo menos 10 caracteres, com letras e números.");
    const toggle = screen.getByRole("button", { name: "Mostrar senha" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Repita a senha")).toHaveAttribute("type", "text");
    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "password");
  });

  it("senha sem número: pede letras e números sem chamar o servidor", async () => {
    const services = fakeServices();
    renderPage(<SignUpPage />, services, "/app/conta");
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "ana@exemplo.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senhasemnumero" } });
    fireEvent.change(screen.getByLabelText("Repita a senha"), { target: { value: "senhasemnumero" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByText("Use letras e números na senha.")).toBeInTheDocument();
    expect(services.signUp).not.toHaveBeenCalled();
  });

  it("e-mail recusado: texto neutro com os caminhos de entrar e recuperar a senha", async () => {
    const services = fakeServices({ signUp: vi.fn().mockRejectedValue(new AuthFlowError("email_unavailable")) });
    renderPage(<SignUpPage />, services, "/app/conta");
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "ana@exemplo.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha12345" } });
    fireEvent.change(screen.getByLabelText("Repita a senha"), { target: { value: "senha12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(
      await screen.findByText(/Não deu para criar a conta com esse e-mail\. Se já tem conta, entre ou recupere a senha\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/já existe|já cadastrad|está em uso/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/entrar");
    expect(screen.getByRole("link", { name: "Recuperar a senha" })).toHaveAttribute("href", "/recuperar-senha");
  });

  it("nova senha também tem Mostrar senha", async () => {
    renderPage(<NewPasswordPage />, fakeServices(), "/app/conta");
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar senha" }));
    expect(screen.getByLabelText("Nova senha", { selector: "input" })).toHaveAttribute("type", "text");
  });
});

describe("criar negócio: termos e fuso (E8, E9)", () => {
  it("links abrem a folha com o texto do repositório; Fechar devolve o foco", async () => {
    renderPage(<CreateBusinessPage />, fakeServices(), "/app/conta/novo-negocio");
    const open = await screen.findByRole("button", { name: "Termos de uso" });
    open.focus();
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog", { name: "Termos de uso" });
    expect(await within(dialog).findByText(/RASCUNHO PARA REVISÃO JURÍDICA/)).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: /Quem somos/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(open).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Política de privacidade" }));
    const privacy = await screen.findByRole("dialog", { name: "Política de privacidade" });
    expect(await within(privacy).findByRole("heading", { name: /Seus direitos/ })).toBeInTheDocument();
    expect(within(privacy).getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("frase de saúde fica separada do aceite", async () => {
    renderPage(<CreateBusinessPage />, fakeServices(), "/app/conta/novo-negocio");
    const accept = await screen.findByRole("checkbox", { name: /Li e aceito/ });
    expect(accept).not.toHaveAccessibleName(/saúde/);
    expect(screen.getByText(/Não cadastre dados de saúde de ninguém/)).toBeInTheDocument();
  });

  it("fuso: usa o do aparelho quando é do Brasil, com a troca recolhida", async () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: "America/Manaus",
    });
    try {
      expect(detectTimezone()).toEqual({ id: "America/Manaus", fromDevice: true });
      const services = fakeServices();
      renderPage(<CreateBusinessPage />, services, "/app/conta/novo-negocio");
      expect(await screen.findByText(/Fuso horário:/)).toHaveTextContent("Amazonas (Manaus) · o mesmo do seu aparelho");
      expect(screen.getByText("Trocar o fuso").closest("details")).not.toHaveAttribute("open");
      fireEvent.change(screen.getByLabelText("Nome do negócio"), { target: { value: "Salão Exemplo C" } });
      fireEvent.click(screen.getByLabelText("Cabeleireiro(a)"));
      fireEvent.click(screen.getByRole("checkbox", { name: /Li e aceito/ }));
      fireEvent.click(screen.getByRole("button", { name: "Criar negócio" }));
      await waitFor(() => expect(services.createBusiness).toHaveBeenCalled());
      expect(vi.mocked(services.createBusiness).mock.calls[0]?.[0]).toMatchObject({ timezone: "America/Manaus" });
    } finally {
      spy.mockRestore();
    }
  });

  it("fuso fora do Brasil cai no de Brasília; fuso do Nordeste vira o da lista", () => {
    const at = (timeZone: string) => {
      const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
        ...new Intl.DateTimeFormat().resolvedOptions(),
        timeZone,
      });
      try {
        return detectTimezone();
      } finally {
        spy.mockRestore();
      }
    };
    expect(at("Europe/Lisbon")).toEqual({ id: "America/Sao_Paulo", fromDevice: false });
    expect(at("America/Recife")).toEqual({ id: "America/Sao_Paulo", fromDevice: true });
    expect(at("America/Eirunepe")).toEqual({ id: "America/Rio_Branco", fromDevice: true });
  });
});

describe("texto jurídico (E8)", () => {
  it("lê títulos, aviso, listas, tabela e marcas, sem HTML cru", () => {
    const blocks = parseLegal(
      "> **RASCUNHO**\n> linha 2\n\n# Título\n\n## 1. Seção\n\nTexto `[a definir]` <b>x</b>.\n\n- um\n- dois\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["notice", "title", "heading", "paragraph", "list", "table"]);
    expect(blocks[3]).toEqual({ kind: "paragraph", text: "Texto `[a definir]` <b>x</b>." });
    expect(blocks[5]).toEqual({ kind: "table", head: ["A", "B"], rows: [["1", "2"]] });
    render(<p data-testid="p">{inline("Texto **forte** e `marca` <b>x</b>")}</p>);
    const p = screen.getByTestId("p");
    expect(p.querySelector("strong")).toHaveTextContent("forte");
    expect(p.querySelector("code")).toHaveTextContent("marca");
    expect(p.querySelector("b")).toBeNull();
  });
});

describe("Sua conta (E13)", () => {
  it("primeiros passos no topo para quem acabou de entrar, sem texto técnico; criar outro negócio sem destaque", async () => {
    renderPage(<AccountPage />, fakeServices());
    const steps = await screen.findByRole("region", { name: /Primeiros passos/ });
    expect(screen.queryByText(/O servidor confere/)).not.toBeInTheDocument();
    expect(within(steps).getByText("Criar o negócio")).toHaveTextContent("(feito)");
    expect(within(steps).getByText(/Cadastrar seus serviços/)).toHaveTextContent("(feito)");
    expect(within(steps).getByRole("link", { name: "Definir seus horários de atendimento" })).toHaveAttribute("href", "/app/agenda/horarios");
    expect(within(steps).getByRole("link", { name: "Publicar seu perfil e mandar o link" })).toHaveAttribute("href", "/app/perfil");
    // Um passo sem resposta do servidor (perfil): sem contagem, para não dizer número errado.
    expect(steps).not.toHaveTextContent(/de 5/);
    // A lista vem antes do formulário do objetivo.
    const form = screen.getByRole("form", { name: "Objetivo e política de cancelamento" });
    expect(steps.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const other = screen.getByRole("link", { name: "Criar outro negócio" });
    expect(other).not.toHaveClass("tn-button");
    expect(other.closest("p")).toHaveClass("tn-muted");
  });

  it("tudo feito: os primeiros passos saem do topo", async () => {
    const services = fakeServices({
      loadOnboarding: vi.fn(async () => ({ ...empty, goal: "fill_schedule" as const, completed_at: "2026-10-20T12:00:00.000Z", version: 2 })),
      loadSetup: vi.fn(async () => ({ services: true, hours: true, profile: true })),
    });
    renderPage(<AccountPage />, services);
    expect(await screen.findByRole("button", { name: "Salvar alterações" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Primeiros passos/ })).not.toBeInTheDocument();
  });
});

describe("onboarding do negócio ativo", () => {
  it("personal trainer: ordem de objetivos e vocabulário próprios, sugestão de 12h", async () => {
    const services = fakeServices({ loadBusiness: vi.fn(async () => ({ name: "Personal B", profession: "personal_trainer" as const })) });
    renderPage(<AccountPage />, services);
    const goals = await screen.findByRole("group", { name: /O que você mais quer resolver/ });
    expect(within(goals).getAllByRole("radio")[0]).toHaveAccessibleName("Saber quem pagou e quem falta pagar");
    expect(within(goals).getByLabelText("Organizar meus alunos")).toBeInTheDocument();
    expect(screen.getByLabelText(/aluno\(a\) pode cancelar/)).toHaveValue("12");
  });

  it("salva com expected_version e conclui; versão antiga mostra aviso", async () => {
    const saveOnboarding = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("STALE_VERSION", "x", 409, null, false))
      .mockResolvedValueOnce({ ...empty, goal: "fill_schedule", cancellation_notice_hours: 2, completed_at: "2026-10-20T12:00:00.000Z", version: 2 });
    const services = fakeServices({ saveOnboarding });
    renderPage(<AccountPage />, services);

    fireEvent.click(await screen.findByRole("button", { name: "Concluir" }));
    expect(await screen.findByText("Escolha o objetivo principal.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("radio")[0]!).toHaveFocus());
    expect(saveOnboarding).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Ocupar horários vagos da agenda"));
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByText(/alteradas em outra tela/)).toBeInTheDocument();
    expect(saveOnboarding.mock.calls[0]?.[0]).toBe(FX.tenants.A);
    expect(saveOnboarding.mock.calls[0]?.[1]).toEqual({
      expected_version: 1, goal: "fill_schedule", cancellation_notice_hours: 2, late_cancellation_fee_bps: null,
      mark_complete: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(await screen.findByText("Salvo.")).toBeInTheDocument();
    expect(screen.getByText("Salvo.").closest(".tn-toaster")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeInTheDocument();
  });
});

describe("cliente em vários profissionais", () => {
  it("lista só o nome de cada negócio e permite desvincular", async () => {
    const links = [
      { link_id: "0b1c2d3e-4f50-4a61-8b72-c3d4e5f60718", tenant_id: FX.tenants.A, tenant_name: "Barbearia Exemplo A", verified_at: "2026-10-20T12:00:00Z", version: 1 },
      { link_id: "1c2d3e4f-5061-4b72-8c83-d4e5f6071829", tenant_id: FX.tenants.B, tenant_name: "Personal Exemplo B", verified_at: "2026-10-20T12:00:00Z", version: 1 },
    ];
    const services = fakeServices({ loadMyLinks: vi.fn(async () => links) });
    renderPage(<AccountPage />, services);
    const section = (await screen.findByRole("heading", { name: "Onde sou cliente" })).closest("section");
    if (!section) throw new Error("seção ausente");
    expect(await within(section).findByText("Personal Exemplo B")).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(within(section).getByRole("button", { name: "Desvincular de Personal Exemplo B" }));
    // Não volta atrás pelo app: pede confirmação com a consequência e não executa antes do "Sim".
    expect(within(section).getByText("Desvincular de Personal Exemplo B?")).toBeInTheDocument();
    expect(within(section).getByText(/código novo do profissional/)).toBeInTheDocument();
    expect(services.revokeLink).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole("button", { name: "Voltar" }));
    expect(services.revokeLink).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole("button", { name: "Desvincular de Personal Exemplo B" }));
    fireEvent.click(within(section).getByRole("button", { name: "Sim, desvincular" }));
    await waitFor(() =>
      expect(services.revokeLink).toHaveBeenCalledWith(FX.tenants.B, links[1]!.link_id, 1, `revoke-${links[1]!.link_id}-v1`),
    );
    expect(await screen.findByText("Vínculo com Personal Exemplo B desfeito.")).toBeInTheDocument();
  });

  it("minhas reservas: próximas e anteriores, fuso do negócio, avaliar só concluída no prazo, sem ações de alterar", async () => {
    const b = (id: string, tenant: string, tenant_name: string, service_name: string, starts_at: string, ends_at: string, status: "confirmed" | "completed" | "cancelled") =>
      ({ booking_id: id, tenant_id: tenant, tenant_name, timezone: "America/Sao_Paulo", service_name, starts_at, ends_at, status, agreed_price_cents: 6000 });
    const bookings = [
      b("6a000000-0000-4000-8000-000000000001", FX.tenants.A, "Barbearia Exemplo A", "Corte", "2026-10-22T12:00:00Z", "2026-10-22T12:30:00Z", "confirmed"),
      b("6a000000-0000-4000-8000-000000000002", FX.tenants.B, "Personal Exemplo B", "Sessão de treino", "2026-10-19T10:00:00Z", "2026-10-19T11:00:00Z", "completed"),
      b("6a000000-0000-4000-8000-000000000003", FX.tenants.A, "Barbearia Exemplo A", "Corte", "2026-08-01T12:00:00Z", "2026-08-01T12:30:00Z", "completed"),
      b("6a000000-0000-4000-8000-000000000004", FX.tenants.A, "Barbearia Exemplo A", "Barba", "2026-10-21T12:00:00Z", "2026-10-21T12:20:00Z", "cancelled"),
    ];
    renderPage(<MyBookingsPage />, fakeServices({ loadMyBookings: vi.fn(async () => ({ now: "2026-10-20T12:00:00Z", bookings })) }), "/app/conta/reservas");
    const next = await screen.findByRole("list", { name: "Próximas reservas" });
    expect(within(next).getAllByRole("listitem")).toHaveLength(1);
    expect(within(next).getByText(/qui\.?, 22\/10, 09:00–09:30/)).toBeInTheDocument();
    const past = screen.getByRole("list", { name: "Reservas anteriores" });
    expect(within(past).getAllByRole("listitem")).toHaveLength(3);
    expect(within(past).getByText(/Cancelada/)).toBeInTheDocument();
    // Avaliar: só a concluída dentro de 30 dias (a de agosto passou do prazo).
    expect(screen.getAllByRole("link", { name: "Avaliar" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Cancelar|Remarcar|Reagendar/ })).not.toBeInTheDocument();
  });

  it("minhas reservas vazias explicam o vínculo", async () => {
    renderPage(<MyBookingsPage />, fakeServices(), "/app/conta/reservas");
    expect(await screen.findByText(/Nenhuma reserva por aqui ainda/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tenho um código de vínculo" })).toHaveAttribute("href", "/app/conta/vincular");
  });

  it("código: formato errado não chama o servidor; código inválido dá mensagem neutra", async () => {
    const redeemLink = vi.fn().mockRejectedValue(new ApiError("NOT_FOUND", "x", 404, null, false));
    renderPage(<RedeemLinkPage />, fakeServices({ redeemLink }), "/app/conta/vincular");
    const input = await screen.findByLabelText("Código");
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));
    expect(await screen.findByText(/43 letras/)).toBeInTheDocument();
    expect(redeemLink).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: ` ${CODE} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));
    expect(await screen.findByText(/inválido, vencido ou já usado/)).toBeInTheDocument();
    expect(redeemLink.mock.calls[0]?.[0]).toBe(CODE);
  });

  it("código válido confirma o negócio vinculado", async () => {
    renderPage(<RedeemLinkPage />, fakeServices(), "/app/conta/vincular");
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));
    expect(await screen.findByText(/agora está ligada a/)).toHaveTextContent("Barbearia Exemplo A");
  });
});

describe("recuperação de conta", () => {
  it("resposta neutra: não revela se o e-mail existe", async () => {
    const services = fakeServices();
    renderPage(<RecoverPasswordPage />, services);
    fireEvent.change(await screen.findByLabelText("E-mail da conta"), { target: { value: "alguem@exemplo.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(await screen.findByText(/Se houver uma conta com esse e-mail/)).toBeInTheDocument();
    expect(services.requestPasswordReset).toHaveBeenCalledWith("alguem@exemplo.test");
  });
});

describe("demonstração sem servidor", () => {
  it("rota real do módulo: mostra o negócio de exemplo e não deixa salvar", async () => {
    const router = createMemoryRouter(
      [{ path: "/app/conta", children: identityModule.routes }],
      { initialEntries: ["/app/conta"] },
    );
    render(
      <SessionProvider client={null}>
        <RouterProvider router={router} />
      </SessionProvider>,
    );
    expect(await screen.findByText(/Negócio ativo:/)).toHaveTextContent("Barbearia Exemplo A");
    expect(await screen.findByText(/nada é salvo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeDisabled();
  });
});

describe("mensagens de erro neutras", () => {
  it("e-mail recusado no cadastro não diz se a conta existe", async () => {
    const { messageFor } = await import("./errors.ts");
    expect(messageFor(new AuthFlowError("email_unavailable"), "auth")).toBe(
      "Não deu para criar a conta com esse e-mail. Se já tem conta, entre ou recupere a senha.",
    );
  });
});
