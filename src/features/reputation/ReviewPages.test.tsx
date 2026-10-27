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
  it("dono: Denunciar pede confirmação e só denuncia no “Sim”", async () => {
    const port = createDemoOwnerPort();
    const report = vi.spyOn(port, "report");
    wrap(<OwnerReviewsPage port={port} />);
    const first = (await screen.findAllByRole("button", { name: /^Denunciar a avaliação/ }))[0]!;
    fireEvent.click(first);
    const confirm = screen.getByRole("group", { name: "Denunciar esta avaliação?" });
    expect(confirm).toHaveTextContent(/continua visível/);
    expect(report).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Sim, denunciar" }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Denúncia enviada/)).toBeInTheDocument();
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
