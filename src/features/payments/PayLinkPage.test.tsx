import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoLinkPort, createDemoPort, resetDemoState } from "./demoPort.ts";
import { PayLinkPage } from "./PayLinkPage.tsx";
import { type LinkView, newKey, type PaymentLinkPort } from "./port.ts";
import { setPublicBusinessReader } from "./public-kit.tsx";

const TOKEN = "t".repeat(43);

/** Abre a página como a cliente: o token chega no fragmento e o endereço do negócio (se houver) no caminho. */
function open(port: PaymentLinkPort, path = "/pagar", token: string | null = TOKEN) {
  window.history.replaceState(null, "", `${path}${token ? `#t=${token}` : ""}`);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pagar" element={<PayLinkPage port={port} />} />
        <Route path="/pagar/:slug" element={<PayLinkPage port={port} />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
}

const charge = (over: Partial<LinkView> = {}): LinkView => ({
  charge_id: "70000000-0000-4000-8000-000000000001", business_name: "Barbearia do Léo", description: "Corte · Ana Beatriz", amount_cents: 6000,
  provider: "psp", simulated: false, status: "pending", pix_code: "00020126PIXDEVERDADE", checkout_url: null,
  expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), paid_at: null, ...over,
});
const serverPort = (view: LinkView | null): PaymentLinkPort & { simPay: ReturnType<typeof vi.fn> } => ({
  kind: "server",
  view: async () => view ?? Promise.reject(Object.assign(new Error("x"), { code: "NOT_FOUND" })),
  simPay: vi.fn(async () => ({ status: "paid" as const, applied: 1, duplicates: 0 })),
});

beforeEach(() => {
  resetDemoState();
  sessionStorage.clear();
  setPublicBusinessReader(async (slug) => (slug === "barbearia-do-leo"
    ? { name: "Léo Barbeiro", slug, lead: "Barbearia · Centro", photo: null, whatsapp_e164: "+5511977774343" } : null));
});
afterEach(() => {
  act(() => dismissToast());
  setPublicBusinessReader(null);
});

describe("página do link de pagamento", () => {
  it("cobrança de verdade: quem recebe, valor, prazo, copiar de largura total e conferência do nome no banco", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
    const port = serverPort(charge());
    open(port, "/pagar/barbearia-do-leo");
    // O título fala da cobrança, sem o nome de quem deve (05 #19); a Tinindo só aparece no rodapé.
    expect(await screen.findByRole("heading", { level: 1, name: "Cobrança de Corte" })).toBeInTheDocument();
    expect(screen.queryByText(/Ana Beatriz/)).not.toBeInTheDocument();
    expect(screen.getByText("Página feita com a Tinindo")).toBeInTheDocument();
    // O nome da cobrança vale mais que o do perfil; o cabeçalho leva ao perfil.
    expect(screen.getByRole("link", { name: "Barbearia do Léo" })).toHaveAttribute("href", "/p/barbearia-do-leo");
    expect(screen.getByText("Quem recebe").nextElementSibling).toHaveTextContent("Barbearia do Léo");
    expect(screen.getByText(/R\$\s60,00/)).toHaveClass("tn-pay-amount");
    expect(screen.getByText("Aguardando pagamento")).toBeInTheDocument();
    expect(screen.getByText(/^Pague até \d{2}:\d{2} de (hoje|\d{2}\/\d{2})$/)).toBeInTheDocument();
    expect(screen.getByText("No app do banco, confira se quem recebe é Barbearia do Léo. Se for outro nome, não pague e fale com Barbearia do Léo.")).toBeInTheDocument();
    // Sem simulação para a cliente (D22).
    expect(screen.queryByRole("button", { name: /simulação/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Simulação/)).not.toBeInTheDocument();
    // O token sai da barra de endereços e o caminho com o endereço do negócio fica.
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/pagar/barbearia-do-leo");

    expect(screen.queryByText("Abra o app do seu banco e escolha Pix copia e cola.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copiar código Pix" }));
    expect(await screen.findByText("Abra o app do seu banco e escolha Pix copia e cola.")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("00020126PIXDEVERDADE");
  });

  it("D22: com servidor, cobrança simulada vira aviso de teste, sem código Pix e sem botão de pagar", async () => {
    const port = serverPort(charge({ provider: "simulated", simulated: true, pix_code: "00020126SIMULADO123" }));
    open(port);
    expect(await screen.findByText("Esta cobrança é um teste e não pode ser paga. Peça a Barbearia do Léo um link de pagamento de verdade.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Cobrança de Corte" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copiar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pagar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /expirar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/SIMULADO/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ver código")).not.toBeInTheDocument();
    expect(port.simPay).not.toHaveBeenCalled();
  });

  it("D22: com servidor, cobrança simulada já “paga” não vira tela de pagamento confirmado", async () => {
    open(serverPort(charge({ provider: "simulated", simulated: true, status: "paid", paid_at: new Date().toISOString() })));
    expect(await screen.findByText(/Esta cobrança é um teste e não pode ser paga/)).toBeInTheDocument();
    expect(screen.queryByText("Pagamento confirmado")).not.toBeInTheDocument();
  });

  it("demonstração offline: a simulação aparece, rotulada; pagar leva à tela própria de pagamento confirmado", async () => {
    const owner = createDemoPort();
    const [receivable] = await owner.openReceivables();
    const created = await owner.createCharge(receivable!.id, "simulated", newKey());
    const token = new URL(created.pay_url!).hash.slice(3);
    open(createDemoLinkPort(), "/pagar", token);
    expect(await screen.findByRole("heading", { level: 1, name: /^Cobrança de / })).toBeInTheDocument();
    expect(screen.getByText(/Nenhum dinheiro é movimentado/)).toBeInTheDocument();
    // O prazo segue o relógio de exemplo: a cobrança vence em 1 h, no mesmo dia.
    expect(screen.getByText(/^Pague até \d{2}:\d{2} de hoje$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código Pix" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Simular aviso do banco perdido" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deixar expirar (simulação)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pagar (simulação)" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Pagamento confirmado" })).toBeInTheDocument();
    expect(screen.getByText("Não precisa mandar comprovante.")).toBeInTheDocument();
    expect(screen.getByText("Pago em").nextElementSibling).toHaveTextContent(/^\d{2}\/\d{2} às \d{2}:\d{2}$/);
    expect(screen.queryByRole("button", { name: /simulação/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Pagamento confirmado" })).toHaveFocus());
  });

  it("pago (servidor): tela própria com valor e hora, sem pedir comprovante", async () => {
    open(serverPort(charge({ status: "paid", pix_code: null, paid_at: "2026-10-20T16:05:00Z" })));
    expect(await screen.findByRole("heading", { level: 1, name: "Pagamento confirmado" })).toBeInTheDocument();
    expect(screen.getByText(/R\$\s60,00/)).toBeInTheDocument();
    expect(screen.getByText("Não precisa mandar comprovante.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copiar/ })).not.toBeInTheDocument();
  });

  it.each(["expired", "cancelled"] as const)("link %s: diz que não vale mais e dá saída para o negócio", async (status) => {
    open(serverPort(charge({ status, pix_code: null })), "/pagar/barbearia-do-leo");
    expect(await screen.findByRole("heading", { level: 1, name: "Este link de pagamento não vale mais" })).toBeInTheDocument();
    expect(screen.getByText("Ele venceu ou foi cancelado. Não pague por outro caminho sem falar com Barbearia do Léo: peça um novo link.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Falar com Barbearia do Léo no WhatsApp" }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5511977774343\?text=/);
    expect(screen.getByRole("link", { name: "Ver a página de Barbearia do Léo" })).toHaveAttribute("href", "/p/barbearia-do-leo");
    expect(screen.queryByRole("button", { name: /Copiar/ })).not.toBeInTheDocument();
  });

  it("link desconhecido com o endereço do negócio no caminho: cabeçalho e saídas vêm do perfil", async () => {
    open(serverPort(null), "/pagar/barbearia-do-leo");
    expect(await screen.findByRole("heading", { level: 1, name: "Este link de pagamento não vale mais" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Falar com Léo Barbeiro no WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText(/sem falar com Léo Barbeiro: peça um novo link\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("sem token e sem endereço: não culpa a cliente e ainda oferece tentar de novo", async () => {
    open(serverPort(null), "/pagar", null);
    expect(screen.getByRole("heading", { level: 1, name: "Este link de pagamento não vale mais" })).toBeInTheDocument();
    expect(screen.getByText(/sem falar com quem te cobrou: peça um novo link\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});
