import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteMessage } from "../../features/sales/QuotesPage.tsx";
import { COPY_FAILED, CopyButton, ShareActions, whatsappHref } from "./share.tsx";

const link = "https://app.tinindo.test/orcamento#t=abc";

function setClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "share");
});

describe("ShareActions (compartilhar um texto pronto)", () => {
  it("wa.me com o telefone (só dígitos) ou sem número, e a mensagem pronta leva o link", () => {
    const msg = quoteMessage("Corte e barba", link);
    expect(msg).toContain(link);
    expect(whatsappHref("+55 (11) 98888-7777", msg)).toBe(`https://wa.me/5511988887777?text=${encodeURIComponent(msg)}`);
    expect(whatsappHref(null, msg)).toBe(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  });

  it("botão do WhatsApp aponta para wa.me com o link do orçamento", () => {
    render(<ShareActions message={quoteMessage(null, link)} copyText={link} copyLabel="Copiar link" />);
    const href = screen.getByRole("link", { name: "Enviar pelo WhatsApp" }).getAttribute("href")!;
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(new URL(href).searchParams.get("text")).toContain(link);
  });

  it("copiar: 'Copiado ✓' por ~2 s e só então avisa que compartilhou", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const onShared = vi.fn();
    render(<ShareActions message="m" copyText={link} copyLabel="Copiar link" onShared={onShared} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar link" })); });
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole("status")).toHaveTextContent("Copiado ✓");
    expect(onShared).toHaveBeenCalledWith("copy");
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("cópia que falha não marca como compartilhado e explica o que fazer", async () => {
    setClipboard(() => Promise.reject(new Error("negado")));
    const onShared = vi.fn();
    render(<ShareActions message="m" copyText={link} copyLabel="Copiar link" onShared={onShared} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar link" })); });
    expect(onShared).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(COPY_FAILED);
  });

  it("'Compartilhar…' só aparece com navigator.share; fechar a folha não conta como compartilhado", async () => {
    const { unmount } = render(<ShareActions message="m" copyText={link} copyLabel="Copiar link" />);
    expect(screen.queryByRole("button", { name: "Compartilhar…" })).toBeNull();
    unmount();
    const share = vi.fn((): Promise<void> => Promise.reject(Object.assign(new Error("cancelou"), { name: "AbortError" })));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const onShared = vi.fn();
    render(<ShareActions message="msg" copyText={link} copyLabel="Copiar link" onShared={onShared} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Compartilhar…" })); });
    expect(share).toHaveBeenCalledWith({ text: "msg" });
    expect(onShared).not.toHaveBeenCalled();
    share.mockImplementation(() => Promise.resolve());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Compartilhar…" })); });
    expect(onShared).toHaveBeenCalledWith("share");
    expect(screen.getByRole("status")).toHaveTextContent("Compartilhado ✓");
  });
});

describe("CopyButton", () => {
  it("troca o texto do botão por 'Copiado ✓' e anuncia o que foi copiado", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const onCopied = vi.fn();
    render(<CopyButton text="000201pix" label="Copiar Pix" what="Pix" onCopied={onCopied} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar Pix" })); });
    expect(writeText).toHaveBeenCalledWith("000201pix");
    expect(screen.getByRole("button", { name: "Copiado ✓" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Pix copiado.");
    expect(onCopied).toHaveBeenCalledOnce();
  });

  it("sem área de transferência: explica onde copiar à mão e não chama onCopied", async () => {
    const onCopied = vi.fn();
    render(<CopyButton text="x" label="Copiar Pix" what="Pix" failHint='Abra "Ver código" e copie à mão.' onCopied={onCopied} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar Pix" })); });
    expect(screen.getByRole("status")).toHaveTextContent('Não deu para copiar. Abra "Ver código" e copie à mão.');
    expect(onCopied).not.toHaveBeenCalled();
  });
});
