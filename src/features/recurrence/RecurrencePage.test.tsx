import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";
import { newKey } from "./port.ts";
import { RecurrencePage } from "./RecurrencePage.tsx";

beforeEach(() => resetDemoState());
afterEach(() => act(() => dismissToast()));

async function withSubscriber() {
  const port = createDemoPort();
  const [plan] = await port.plans();
  await port.subscribe(plan!.id, DEMO_CUSTOMERS[0]!.id, newKey());
  render(<><RecurrencePage port={port} /><Toaster /></>);
  const subs = await screen.findByRole("list", { name: "Assinaturas" });
  await within(subs).findByText(/Ativa/);
  return { port, subs: within(subs) };
}

describe("Assinaturas: desfazer e confirmar", () => {
  it("Cancelar no fim do ciclo executa na hora e o Desfazer do aviso chama a operação inversa (resume)", async () => {
    const { port, subs } = await withSubscriber();
    const resume = vi.spyOn(port, "resume");
    await act(async () => { fireEvent.click(subs.getByRole("button", { name: "Cancelar no fim do ciclo" })); });
    expect(screen.getByText(/não renova\. Saldo e termos preservados\./).closest(".tn-toaster")).not.toBeNull();
    expect(await subs.findByText(/não renova no fim do ciclo/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Pronto: a assinatura volta a renovar.")).toBeInTheDocument();
  });

  it("Cancelar agora não encerra sem a confirmação; Voltar devolve o foco ao botão", async () => {
    const { port, subs } = await withSubscriber();
    const cancel = vi.spyOn(port, "cancel");
    fireEvent.click(subs.getByRole("button", { name: /Cancelar agora/ }));
    const confirm = subs.getByRole("group", { name: /Encerrar a assinatura de .* agora\?/ });
    expect(confirm).toHaveTextContent("deixa de assinar hoje");
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Voltar" }));
    expect(cancel).not.toHaveBeenCalled();
    expect(subs.getByRole("button", { name: /Cancelar agora/ })).toHaveFocus();
    fireEvent.click(subs.getByRole("button", { name: /Cancelar agora/ }));
    await act(async () => { fireEvent.click(subs.getByRole("button", { name: "Sim, encerrar agora" })); });
    expect(cancel).toHaveBeenCalledWith(expect.anything(), false, null, expect.any(String));
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
