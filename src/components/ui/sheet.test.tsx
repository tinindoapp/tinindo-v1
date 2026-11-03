// Folha inferior, painel de formulário e menu "⋯" do sistema (onda 3 da auditoria de UX, itens 20 e 44).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionsMenu, Button, Field, FormPanel, Sheet } from "./index.tsx";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}
afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  delete document.body.dataset.sheetOpen;
});

function WithSheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Editar Ana</Button>
      {open ? (
        <Sheet title="Editar cliente" onClose={() => setOpen(false)}>
          <form>
            <Field label="Nome" defaultValue="Ana" />
            <div data-sheet-footer>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}

describe("Sheet", () => {
  it("abre como diálogo modal com título, foco no primeiro campo e rolagem da página travada", async () => {
    render(<WithSheet />);
    const opener = screen.getByRole("button", { name: "Editar Ana" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Editar cliente" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByLabelText("Nome")).toHaveFocus();
    expect(document.body.dataset.sheetOpen).toBe("true");
    expect(within(dialog).getByRole("button", { name: "Salvar" }).closest("[data-sheet-footer]")).not.toBeNull();
  });

  it("Tab fica preso dentro da folha", () => {
    render(<WithSheet />);
    fireEvent.click(screen.getByRole("button", { name: "Editar Ana" }));
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Fechar" });
    const save = within(dialog).getByRole("button", { name: "Salvar" });
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
  });

  it("Esc e “Fechar” fecham e devolvem o foco ao botão que abriu", async () => {
    render(<WithSheet />);
    const opener = screen.getByRole("button", { name: "Editar Ana" });
    for (const how of ["esc", "fechar"] as const) {
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole("dialog");
      if (how === "esc") fireEvent.keyDown(within(dialog).getByLabelText("Nome"), { key: "Escape" });
      else fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(opener).toHaveFocus());
      expect(document.body.dataset.sheetOpen).toBeUndefined();
    }
  });
});

describe("FormPanel", () => {
  const Panel = ({ onClose = () => {} }) => (
    <FormPanel title="Novo serviço" onClose={onClose}>
      <form>
        <Field label="Nome" />
      </form>
    </FormPanel>
  );

  it("no celular abre a folha", () => {
    mockMatchMedia(true);
    render(<Panel />);
    expect(screen.getByRole("dialog", { name: "Novo serviço" })).toBeInTheDocument();
  });

  it("no desktop fica no cartão, rola até ele e foca o primeiro campo", () => {
    mockMatchMedia(false);
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Panel />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Novo serviço" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });
});

describe("ActionsMenu", () => {
  it("item de cuidado leva o tom e escolher devolve o foco ao “⋯” antes da ação", () => {
    const seen: (Element | null)[] = [];
    render(<ActionsMenu label="Mais ações" actions={[{ label: "Denunciar…", tone: "danger", onSelect: () => seen.push(document.activeElement) }]} />);
    const button = screen.getByRole("button", { name: "Mais ações" });
    fireEvent.click(button);
    const item = screen.getByRole("menuitem", { name: "Denunciar…" });
    expect(item).toHaveAttribute("data-tone", "danger");
    fireEvent.click(item);
    expect(seen).toEqual([button]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
