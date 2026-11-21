import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";
import { newIdempotencyKey } from "../../lib/idempotency.ts";
import { RecurrencePage } from "./RecurrencePage.tsx";

beforeEach(() => resetDemoState());
afterEach(() => act(() => dismissToast()));

async function withSubscriber() {
  const port = createDemoPort();
  const [plan] = await port.plans();
  await port.subscribe(plan!.id, DEMO_CUSTOMERS[0]!.id, newIdempotencyKey());
  render(<><RecurrencePage port={port} /><Toaster /></>);
  const subs = await screen.findByRole("list", { name: "Assinaturas" });
  await within(subs).findByText(/Ativa/);
  return { port, subs: within(subs) };
}

/** Abre um item do "⋯" da linha da assinante (P54: uma ação visível por linha, o resto no menu). */
function pick(subs: ReturnType<typeof within>, item: string) {
  fireEvent.click(subs.getByRole("button", { name: /^Mais ações para / }));
  fireEvent.click(subs.getByRole("menuitem", { name: item }));
}

describe("Assinaturas: desfazer e confirmar", () => {
  it("Cancelar no fim do ciclo executa na hora e o Desfazer do aviso chama a operação inversa (resume)", async () => {
    const { port, subs } = await withSubscriber();
    const resume = vi.spyOn(port, "resume");
    pick(subs, "Cancelar no fim do ciclo…");
    await act(async () => { fireEvent.click(subs.getByRole("button", { name: "Cancelar no fim do ciclo" })); });
    expect(screen.getByText(/não renova\. Saldo e termos preservados\./).closest(".tn-toaster")).not.toBeNull();
    expect(await subs.findByText(/não renova no fim do ciclo/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Pronto: a assinatura volta a renovar.")).toBeInTheDocument();
  });

  it("Cancelar agora não encerra sem a confirmação; Voltar devolve o foco ao “⋯”", async () => {
    const { port, subs } = await withSubscriber();
    const cancel = vi.spyOn(port, "cancel");
    pick(subs, "Cancelar agora…");
    const confirm = subs.getByRole("group", { name: /Encerrar a assinatura de .* agora\?/ });
    expect(confirm).toHaveTextContent("deixa de assinar hoje");
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Voltar" }));
    expect(cancel).not.toHaveBeenCalled();
    expect(subs.getByRole("button", { name: /^Mais ações para / })).toHaveFocus();
    pick(subs, "Cancelar agora…");
    await act(async () => { fireEvent.click(subs.getByRole("button", { name: "Sim, encerrar agora" })); });
    expect(cancel).toHaveBeenCalledWith(expect.anything(), false, null, expect.any(String));
  });

  it("Cancelar no fim do ciclo: se o comando falha, tocar de novo manda a mesma chave", async () => {
    const { port, subs } = await withSubscriber();
    const cancel = vi.spyOn(port, "cancel").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    pick(subs, "Cancelar no fim do ciclo…");
    await act(async () => { fireEvent.click(subs.getByRole("button", { name: "Cancelar no fim do ciclo" })); });
    await act(async () => { fireEvent.click(await subs.findByRole("button", { name: "Cancelar no fim do ciclo" })); });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel.mock.calls[1]![3]).toBe(cancel.mock.calls[0]![3]);
  });

  it("lista cortada pelo servidor: avisa embaixo das assinantes; sem corte, nada", async () => {
    const port = createDemoPort();
    const [plan] = await port.plans();
    await port.subscribe(plan!.id, DEMO_CUSTOMERS[0]!.id, newIdempotencyKey());
    const list = port.subscriptions.bind(port);
    const spy = vi.spyOn(port, "subscriptions").mockImplementation(async () => ({ ...(await list()), truncated: true }));
    const { unmount } = render(<RecurrencePage port={port} />);
    const region = await screen.findByRole("region", { name: "Assinantes" });
    expect(await within(region).findByText("Mostrando as 200 assinaturas mais recentes.")).toBeInTheDocument();
    unmount();
    spy.mockRestore();
    render(<RecurrencePage port={port} />);
    const again = await screen.findByRole("region", { name: "Assinantes" });
    await within(again).findByText(/Ativa/);
    expect(within(again).queryByText(/Mostrando as/)).not.toBeInTheDocument();
  });

  it("criar plano: depois de uma falha de rede, repetir manda a mesma chave e o mesmo pedido", async () => {
    const port = createDemoPort();
    const save = vi.spyOn(port, "savePlan").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    render(<><RecurrencePage port={port} /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Novo plano" }));
    const form = within(screen.getByRole("form", { name: "Novo plano" }));
    fireEvent.change(form.getByLabelText("Nome do plano"), { target: { value: "Mensal 8 sessões" } });
    fireEvent.change(form.getByLabelText("Preço por ciclo (R$)"), { target: { value: "320,00" } });
    const submit = form.getByRole("button", { name: "Criar plano" });
    await act(async () => { fireEvent.click(submit); });
    await act(async () => { fireEvent.click(submit); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toBe(save.mock.calls[0]![1]);
    expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0]);
  });

  it("adesão: depois de uma falha de rede, repetir manda a mesma chave", async () => {
    const port = createDemoPort();
    const subscribe = vi.spyOn(port, "subscribe").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    render(<><RecurrencePage port={port} /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Nova assinatura" }));
    const form = within(screen.getByRole("form", { name: "Nova assinatura" }));
    fireEvent.click(form.getByRole("checkbox", { name: /A cliente aceitou/ }));
    const submit = form.getByRole("button", { name: "Registrar adesão" });
    await act(async () => { fireEvent.click(submit); });
    await act(async () => { fireEvent.click(submit); });
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[1]![2]).toBe(subscribe.mock.calls[0]![2]);
  });

  it("adesão sem o aceite: botão ativo, erro embaixo da caixa e foco nela", async () => {
    const port = createDemoPort();
    const subscribe = vi.spyOn(port, "subscribe");
    render(<RecurrencePage port={port} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova assinatura" }));
    const form = within(screen.getByRole("form", { name: "Nova assinatura" }));
    const submit = form.getByRole("button", { name: "Registrar adesão" });
    expect(submit).toBeEnabled();
    await act(async () => { fireEvent.click(submit); });
    expect(form.getByText("Confirme que a cliente aceitou estes termos.")).toBeInTheDocument();
    expect(form.getByRole("checkbox", { name: /A cliente aceitou/ })).toHaveFocus();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
