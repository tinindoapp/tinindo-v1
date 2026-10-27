import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { GoalsPage } from "./GoalsPage.tsx";
import { newKey } from "./port.ts";

beforeEach(() => resetDemoState());
afterEach(() => act(() => dismissToast()));

const renderPage = (port: ReturnType<typeof createDemoPort>) =>
  render(<MemoryRouter><GoalsPage port={port} /><Toaster /></MemoryRouter>);

describe("Metas e conteúdo: desfazer e confirmar", () => {
  it("Remover a apresentação executa na hora e o Desfazer publica o mesmo texto de novo", async () => {
    const port = createDemoPort();
    const bio = (await port.content()).templates.find((t) => t.kind === "bio")!;
    await port.publish(bio.code, newKey());
    const publish = vi.spyOn(port, "publish");
    const unpublish = vi.spyOn(port, "unpublish");
    renderPage(port);
    await screen.findByText(/Publicado no perfil:/, {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Remover a apresentação/ })); });
    expect(unpublish).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Apresentação removida do perfil.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
    expect(publish).toHaveBeenCalledWith(bio.code, expect.any(String));
    expect(await screen.findByText(/Publicado no perfil:/)).toBeInTheDocument();
  });

  it("Arquivar meta pede confirmação: sem confirmar, nada é arquivado", async () => {
    const port = createDemoPort();
    await port.saveGoal({ metric_key: "no_show", target: 0.1, note: null }, newKey());
    const archive = vi.spyOn(port, "archiveGoal");
    renderPage(port);
    const goals = within(await screen.findByRole("list", { name: "Metas" }));
    fireEvent.click(await goals.findByRole("button", { name: /Arquivar a meta/ }));
    const confirm = goals.getByRole("group", { name: /Arquivar a meta de .*\?/ });
    expect(confirm).toHaveTextContent("não volta");
    expect(archive).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Sim, arquivar" })); });
    expect(archive).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Meta arquivada.")).toBeInTheDocument();
  });

  it("meta sem valor: erro embaixo do campo e foco nele", async () => {
    const port = createDemoPort();
    const save = vi.spyOn(port, "saveGoal");
    renderPage(port);
    const form = within(await screen.findByRole("form", { name: "Nova meta" }));
    fireEvent.change(form.getByLabelText("Meta (%)"), { target: { value: "" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Criar meta" })); });
    expect(form.getByText("Informe a meta em %.")).toBeInTheDocument();
    expect(form.getByLabelText("Meta (%)")).toHaveFocus();
    expect(save).not.toHaveBeenCalled();
  });
});
