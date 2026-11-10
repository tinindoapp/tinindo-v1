import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX, tenantA } from "@contracts/fixtures.ts";
import { SessionProvider } from "../../app/session.tsx";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { provideCustomerBookings } from "../../lib/demo/journey.ts";
import { createDemoCustomerPort, createDemoOwnerPort, resetDemoState } from "./demoPort.ts";
import { CustomerReviewPage, OwnerReviewsPage } from "./ReviewPages.tsx";

beforeEach(() => {
  resetDemoState();
  provideCustomerBookings(async (customerId) => customerId !== FX.customers.abInA ? [] : [{
    booking_id: "60000000-0000-4000-8000-000000000101", tenant_id: FX.tenants.A, tenant_name: tenantA.name, timezone: tenantA.timezone,
    service_name: "Corte", starts_at: "2026-10-19T14:00:00-03:00", ends_at: "2026-10-19T14:30:00-03:00", status: "completed", agreed_price_cents: 6000,
  }]);
});
afterEach(() => dismissToast());

const wrap = (ui: React.ReactNode) =>
  render(
    <SessionProvider client={null}>
      <MemoryRouter>
        {ui}
        <Toaster />
      </MemoryRouter>
    </SessionProvider>,
  );

describe("avaliações", () => {
  it("dono: Denunciar fica no “⋯”, pede o motivo e só denuncia no “Sim”; Voltar devolve o foco ao “⋯”", async () => {
    const port = createDemoOwnerPort();
    const report = vi.spyOn(port, "report");
    wrap(<OwnerReviewsPage port={port} />);
    expect(await screen.findAllByRole("button", { name: /^Responder$/ })).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Denunciar/ })).not.toBeInTheDocument();
    const more = screen.getAllByRole("button", { name: /^Mais ações para a avaliação/ })[0]!;
    more.focus();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "Denunciar…" }));
    const confirm = screen.getByRole("group", { name: "Denunciar esta avaliação?" });
    expect(confirm).toHaveTextContent(/continua visível/);
    await waitFor(() => expect(within(confirm).getByText("Denunciar esta avaliação?")).toHaveFocus());
    fireEvent.click(within(confirm).getByRole("button", { name: "Sim, denunciar" }));
    expect(await within(confirm).findByText("Escolha o motivo da denúncia.")).toBeInTheDocument();
    expect(within(confirm).getByLabelText("Motivo")).toHaveFocus();
    expect(report).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Mais ações para a avaliação/ })[0]).toHaveFocus());

    fireEvent.click(screen.getAllByRole("button", { name: /^Mais ações para a avaliação/ })[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Denunciar…" }));
    const again = screen.getByRole("group", { name: "Denunciar esta avaliação?" });
    fireEvent.change(within(again).getByLabelText("Motivo"), { target: { value: "personal_data" } });
    fireEvent.click(within(again).getByRole("button", { name: "Sim, denunciar" }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report.mock.calls[0]![1]).toBe("personal_data");
    expect(await screen.findByText(/Denúncia enviada/)).toBeInTheDocument();
  });

  it("dono: resumo “4,7 ★ · 3 avaliações”, selos só positivos e “Verifique sua identidade” como tarefa", async () => {
    const port = createDemoOwnerPort();
    await createDemoCustomerPort().submit("60000000-0000-4000-8000-000000000101", 5, null, "k-3");
    wrap(<OwnerReviewsPage port={port} />);
    const profile = await screen.findByRole("region", { name: "Seu perfil" });
    await waitFor(() => expect(profile).toHaveTextContent("4,7 ★ · 3 avaliações"));
    const badges = within(profile).getByRole("list", { name: "Selos" });
    expect(badges).not.toHaveTextContent(/não verificada|Competência|não/);
    expect(badges).toHaveTextContent("12 atendimentos concluídos na Tinindo");
    expect(within(profile).getByText("Verifique sua identidade")).toBeInTheDocument();
  });

  it("recado #89: o dono pede a verificação pelo app; depois vê o pedido aberto e não pede de novo", async () => {
    const port = createDemoOwnerPort();
    const request = vi.spyOn(port, "requestIdentity");
    wrap(<OwnerReviewsPage port={port} />);
    const profile = await screen.findByRole("region", { name: "Seu perfil" });
    fireEvent.click(within(profile).getByText("Verifique sua identidade"));
    fireEvent.click(within(profile).getByRole("radio", { name: "gov.br" }));
    fireEvent.click(within(profile).getByRole("button", { name: "Pedir verificação" }));
    expect(await within(profile).findByRole("status")).toHaveTextContent(/Pedido enviado em .*, pelo gov\.br\./);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe("gov_br");
    expect(within(profile).queryByRole("button", { name: "Pedir verificação" })).not.toBeInTheDocument();
  });

  it("dono: sem 3 avaliações, diz quando a média aparece", async () => {
    wrap(<OwnerReviewsPage port={createDemoOwnerPort()} />);
    const profile = await screen.findByRole("region", { name: "Seu perfil" });
    expect(profile).toHaveTextContent("2 avaliações · a média aparece a partir de 3");
  });

  it("dono: responder foca o campo, conta 0/600, oferece inícios rápidos e mostra a prévia pública", async () => {
    const port = createDemoOwnerPort();
    const reply = vi.spyOn(port, "reply");
    wrap(<OwnerReviewsPage port={port} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Responder" }))[0]!);
    const form = screen.getByRole("form", { name: "Responder avaliação" });
    const field = within(form).getByLabelText("Sua resposta (pública)");
    await waitFor(() => expect(field).toHaveFocus());
    expect(form).toHaveTextContent("0/600");
    expect(within(form).queryByRole("region", { name: "Prévia pública" })).not.toBeInTheDocument();
    fireEvent.click(within(within(form).getByRole("group", { name: "Começar com" })).getByRole("button", { name: "Obrigado pela avaliação!" }));
    expect(field).toHaveValue("Obrigado pela avaliação! ");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Obrigado pela avaliação! Volte sempre." } });
    expect(form).toHaveTextContent(`${"Obrigado pela avaliação! Volte sempre.".length}/600`);
    expect(within(form).getByRole("region", { name: "Prévia pública" })).toHaveTextContent("Resposta do profissional: Obrigado pela avaliação! Volte sempre.");
    fireEvent.click(within(form).getByRole("button", { name: "Publicar resposta" }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
  });

  it("cliente: sem nota explica e foca a nota; publicar e retirar (com confirmação)", async () => {
    const port = createDemoCustomerPort();
    const submit = vi.spyOn(port, "submit");
    const withdraw = vi.spyOn(port, "withdraw");
    wrap(<CustomerReviewPage port={port} />);
    const form = await screen.findByRole("form", { name: /Avaliar Corte/ });
    const publish = within(form).getByRole("button", { name: "Publicar avaliação" });
    expect(publish).toBeEnabled();
    fireEvent.click(publish);
    expect(await within(form).findByText("Escolha uma nota de 1 a 5.")).toBeInTheDocument();
    expect(within(form).getByRole("radio", { name: "1 – Ruim" })).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole("radio", { name: "5 – Excelente" }));
    fireEvent.click(publish);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Obrigado! Sua avaliação foi publicada sem o seu nome.")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /^Retirar avaliação de Corte/ }));
    expect(screen.getByRole("group", { name: "Retirar sua avaliação?" })).toHaveTextContent(/não pode ser avaliado de novo/);
    expect(withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim, retirar" }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Avaliação retirada.")).toBeInTheDocument();
  });
});
