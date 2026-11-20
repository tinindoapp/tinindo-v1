import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ActionBar, ActionRow, Button, CappedList, PageHeader, Section, StatusBadge, Summary, SummaryHero, SummaryRows } from "./index.tsx";

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("abertura de tela (PageHeader)", () => {
  it("mantém a ordem: rótulo, título, apoio, ação, filtro e ajuda recolhida", () => {
    const { container } = wrap(
      <PageHeader eyebrow="Outubro" title="Caixa" subtitle="Apoio" actions={<Button>Registrar</Button>}
        filter={<span>filtro</span>} help={<p>Explicação longa</p>} />,
    );
    const header = container.querySelector("header")!;
    const order = [...header.querySelectorAll(".tn-caps, h1, .tn-page-header__sub, button, .tn-page-header__filter, details")].map((e) => e.className || e.tagName);
    expect(order).toEqual(["tn-caps", "H1", "tn-page-header__sub", "tn-button", "tn-page-header__filter", "tn-help"]);
    expect(within(header).getByText("Explicação longa").closest("details")).not.toHaveAttribute("open");
  });
});

describe("seção", () => {
  it("mostra a contagem junto do título e recolhe a secundária", () => {
    wrap(<Section title="Anteriores" id="s1" count={16} collapsed><p>itens</p></Section>);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2).toHaveTextContent("Anteriores · 16");
    expect(h2.closest("details")).not.toHaveAttribute("open");
  });
});

describe("resumo de número", () => {
  it("número principal com rótulo e linhas com rótulo e valor", () => {
    wrap(
      <Summary label="Resumo do mês">
        <SummaryHero label="Sobrou no mês" value="R$ 1.425,00" id="h" />
        <SummaryRows label="Totais" rows={[{ label: "Recebido", value: "R$ 1.740,00" }, { label: "A receber", value: "R$ 130,98", to: "/app/caixa" }]} />
      </Summary>,
    );
    const group = screen.getByRole("group", { name: "Resumo do mês" });
    expect(within(group).getByText("R$ 1.425,00")).toHaveClass("tn-summary__hero-value", "tn-num");
    expect(within(group).getByRole("link", { name: /A receber/ })).toHaveAttribute("href", "/app/caixa");
  });
});

describe("lista com teto", () => {
  const items = Array.from({ length: 8 }, (_, i) => `Item ${i + 1}`);
  it("mostra 5, oferece 'Ver todos (8)' e abre o resto", () => {
    wrap(<CappedList items={items} label="Lista" render={(t) => <li key={t}>{t}</li>} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Ver todos (8)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /Ver todos/ })).toBeNull();
  });
  it("lista cortada pelo servidor avisa", () => {
    wrap(<CappedList items={items.slice(0, 2)} label="Lista" truncated render={(t) => <li key={t}>{t}</li>} />);
    expect(screen.getByRole("note")).toHaveTextContent("Mostrando os 200 mais recentes.");
  });
});

describe("linha com ação e barra de ações", () => {
  it("link e ação são irmãos; o resto vai para o menu", () => {
    const onPay = vi.fn();
    const onCancel = vi.fn();
    wrap(
      <ul>
        <ActionRow to="/app/x" title="Corte" meta="Ana" value="R$ 60,00"
          action={<Button size="compact" onClick={onPay}>Recebi</Button>}
          more={[{ label: "Cobrar depois", onSelect: onCancel }]} moreLabel="Mais ações de Corte" />
      </ul>,
    );
    const link = screen.getByRole("link", { name: /Corte/ });
    expect(within(link).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recebi" }));
    expect(onPay).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mais ações de Corte" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cobrar depois" }));
    expect(onCancel).toHaveBeenCalled();
  });
  it("barra de ações: principal, secundária e menu", () => {
    wrap(<ActionBar primary={<Button>Agendar</Button>} more={[{ label: "Arquivar", onSelect: () => {} }]}><Button variant="ghost">WhatsApp</Button></ActionBar>);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Agendar", "WhatsApp", ""]);
  });
});

describe("selo de estado", () => {
  it("tem tom, ícone e texto; o neutro não tem ícone", () => {
    const { container } = wrap(<><StatusBadge tone="success">Concluído</StatusBadge><StatusBadge tone="neutral">Confirmado</StatusBadge></>);
    const [ok, neutral] = container.querySelectorAll(".tn-badge");
    expect(ok).toHaveAttribute("data-tone", "success");
    expect(ok!.querySelector("svg")).not.toBeNull();
    expect(neutral!.querySelector("svg")).toBeNull();
  });
});
