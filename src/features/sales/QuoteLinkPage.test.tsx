import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX, tenantA } from "@contracts/fixtures.ts";
import { createDemoLinkPort, createDemoPort, resetDemoState } from "./demoPort.ts";
import type { QuoteDraft, QuoteLinkPort } from "./port.ts";
import { setPublicBusinessReader } from "../../components/public/public-kit.tsx";
import { QuoteLinkPage } from "./QuoteLinkPage.tsx";
import { quoteLink, quoteMessage } from "./QuotesPage.tsx";

const SLUG = "barbearia-exemplo-a";

function open(port: QuoteLinkPort, path: string, token: string | null) {
  window.history.replaceState(null, "", `${path}${token ? `#t=${token}` : ""}`);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/orcamento" element={<QuoteLinkPage port={port} />} />
        <Route path="/orcamento/:slug" element={<QuoteLinkPage port={port} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const draft = (over: Partial<QuoteDraft> = {}): QuoteDraft => ({
  customer_id: FX.customers.abInA, title: "Corte e barba", valid_until: "2026-10-27T12:00:00Z", notes: "Trazer referência do corte.",
  items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 1, unit_price_cents: 6000 },
    { service_id: FX.services.barbaA, description: "Barba", quantity: 2, unit_price_cents: 4000 }],
  slot: { service_id: FX.services.corteA, starts_at: "2026-10-21T13:00:00Z" }, ...over,
});

async function sent(over: Partial<QuoteDraft> = {}) {
  const owner = createDemoPort();
  const q = await owner.create(draft(over), "k-create");
  const { token } = await owner.send(q, "k-send");
  return token!;
}

beforeEach(() => {
  resetDemoState();
  sessionStorage.clear();
  setPublicBusinessReader(async (slug) => (slug === SLUG ? { name: "Perfil A", slug, lead: "Barbearia · Centro", photo: null, whatsapp_e164: "+5511977774343" } : null));
});
afterEach(() => setPublicBusinessReader(null));

describe("página do link de orçamento", () => {
  it("negócio primeiro, título do orçamento, validade, itens em lista, total em faixa e o horário que o aceite reserva", async () => {
    const token = await sent();
    open(createDemoLinkPort(), `/orcamento/${SLUG}`, token);
    expect(await screen.findByRole("heading", { level: 1, name: "Orçamento: Corte e barba" })).toBeInTheDocument();
    // O nome do orçamento vale mais que o do perfil; o cabeçalho leva ao perfil. A Tinindo só no rodapé.
    expect(screen.getByRole("link", { name: tenantA.name })).toHaveAttribute("href", `/p/${SLUG}`);
    expect(screen.getByText("Página feita com a Tinindo")).toBeInTheDocument();
    expect(screen.getByText(/^Válido até/)).toHaveTextContent("Válido até 27/10");
    const items = within(screen.getByRole("list", { name: "Itens do orçamento" })).getAllByRole("listitem");
    // Quantidade só quando é maior que 1.
    expect(items[0]).toHaveTextContent(/^CorteR\$\s60,00$/);
    expect(items[1]).toHaveTextContent(/^Barba2 × R\$\s40,00R\$\s80,00$/);
    expect(screen.getByText("Total").parentElement).toHaveTextContent(/R\$\s140,00/);
    expect(screen.getByText("Ao aceitar, você reserva:").parentElement).toHaveTextContent("Ao aceitar, você reserva: quarta-feira, 21/10, das 10:00 às 10:30 (Corte)");
    expect(screen.getByText(/Trazer referência do corte\./)).toBeInTheDocument();
    expect(screen.getByText(/Abrir esta página não aceita nada\. Aceitar não é pagar/)).toBeInTheDocument();
    // 05 #15: sem código técnico; a versão fica pequena no rodapé.
    expect(screen.queryByText(/código/)).not.toBeInTheDocument();
    expect(screen.getByText("Versão 1").closest("footer")).not.toBeNull();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir ajuste pelo WhatsApp" }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5511977774343\?text=/);
    // O token sai da barra de endereços; o caminho com o endereço do negócio fica.
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe(`/orcamento/${SLUG}`);
  });

  it("Recusar pede confirmação: só recusa no “Sim, recusar”; Voltar não muda nada", async () => {
    const token = await sent({ slot: null });
    const port = createDemoLinkPort();
    const decline = vi.spyOn(port, "decline");
    open(port, "/orcamento", token);
    fireEvent.click(await screen.findByRole("button", { name: "Recusar" }));
    const confirm = screen.getByRole("group", { name: "Recusar este orçamento?" });
    expect(confirm).toHaveTextContent(`${tenantA.name} verá a recusa. Para mudar algo, fale com ele antes.`);
    expect(decline).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Voltar" }));
    expect(decline).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Aceitar orçamento" })).toBeInTheDocument();
    // Sem WhatsApp conhecido (link sem o endereço do negócio), não há "Pedir ajuste".
    expect(screen.queryByRole("link", { name: "Pedir ajuste pelo WhatsApp" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, recusar" }));
    await waitFor(() => expect(decline).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 1, name: "Orçamento recusado" })).toBeInTheDocument();
    expect(screen.getByText(`${tenantA.name} verá a sua resposta. Nada foi reservado nem cobrado.`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar orçamento" })).not.toBeInTheDocument();
  });

  it("aceitar leva à tela própria: orçamento aceito, horário reservado e pagamento combinado com o negócio", async () => {
    const token = await sent();
    open(createDemoLinkPort(), "/orcamento", token);
    fireEvent.click(await screen.findByRole("button", { name: "Aceitar orçamento" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Orçamento aceito" })).toBeInTheDocument();
    expect(screen.getByText("Horário reservado").nextElementSibling).toHaveTextContent("quarta-feira, 21/10, das 10:00 às 10:30 (Corte)");
    expect(screen.getByText(`O pagamento é combinado com ${tenantA.name}.`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar orçamento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recusar" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Orçamento aceito" })).toHaveFocus());
  });

  it("link inválido: não aceita nada e dá saída para o negócio do endereço", async () => {
    open(createDemoLinkPort(), `/orcamento/${SLUG}`, "x".repeat(43));
    expect(await screen.findByRole("heading", { level: 1, name: "Este orçamento não está mais disponível" })).toBeInTheDocument();
    expect(screen.getByText("Este link não é válido, foi substituído por outro ou o orçamento foi cancelado.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Falar com Perfil A no WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver a página de Perfil A" })).toHaveAttribute("href", `/p/${SLUG}`);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar orçamento" })).not.toBeInTheDocument();
  });

  it("o link e a mensagem do dono levam o endereço e o nome do negócio quando há perfil publicado", () => {
    const token = "a".repeat(43);
    expect(quoteLink(token)).toBe(`${window.location.origin}/orcamento#t=${token}`);
    expect(quoteLink(token, SLUG)).toBe(`${window.location.origin}/orcamento/${SLUG}#t=${token}`);
    expect(quoteMessage("Corte", "L", "Barbearia X")).toBe('Olá! Aqui é Barbearia X. Segue o orçamento "Corte". Para ver e aceitar, abra: L');
    expect(quoteMessage(null, "L")).toBe("Olá! Segue o orçamento. Para ver e aceitar, abra: L");
  });
});
