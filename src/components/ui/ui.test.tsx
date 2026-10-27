// Padrões do sistema (auditoria de UX, onda 2): Toast, confirmar/desfazer, IconButton, Field, seleção e Button ocupado.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type FormEvent, useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Button,
  ChipNav,
  ChoiceCard,
  ConfirmAction,
  dismissToast,
  Field,
  IconButton,
  Segmented,
  StatusBanner,
  toast,
  Toaster,
  useFormErrors,
} from "./index.tsx";

afterEach(() => {
  act(() => dismissToast());
  vi.useRealTimers();
});

describe("Toast", () => {
  it("anuncia numa região viva que já existia e some sozinho", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    act(() => toast("Cliente salvo."));
    expect(region).toHaveTextContent("Cliente salvo.");
    act(() => vi.advanceTimersByTime(5100));
    expect(region).toBeEmptyDOMElement();
  });

  it("Desfazer roda a ação e fecha o aviso", () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => toast({ message: "Ana foi arquivada.", action: { label: "Desfazer", onAction: undo } }));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Ana foi arquivada.")).toBeNull();
  });

  it("um aviso por vez: o novo substitui o anterior; fechar tem nome acessível", () => {
    render(<Toaster />);
    act(() => toast("Primeiro"));
    act(() => toast({ message: "Segundo", tone: "danger" }));
    expect(screen.queryByText("Primeiro")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByText("Segundo")).toBeNull();
  });
});

describe("ConfirmAction", () => {
  it("pergunta com o verbo e a consequência, foca a pergunta e Voltar devolve o foco", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmAction trigger="Cancelar orçamento" title="Cancelar orçamento?" consequence="O link do Carlos para de funcionar." confirmLabel="Sim, cancelar" onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar orçamento" }));
    const group = screen.getByRole("group", { name: "Cancelar orçamento?" });
    expect(group).toHaveTextContent("O link do Carlos para de funcionar.");
    expect(screen.getByText("Cancelar orçamento?")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancelar orçamento" })).toHaveFocus();
  });

  it("confirma com o botão de perigo e fecha", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmAction trigger="Revogar" title="Revogar acesso?" consequence="Ela deixa de ver." confirmLabel="Sim, revogar" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Revogar" }));
    const yes = screen.getByRole("button", { name: "Sim, revogar" });
    expect(yes).toHaveAttribute("data-variant", "danger");
    await act(async () => fireEvent.click(yes));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("campo obrigatório vazio: explica em vez de confirmar", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmAction trigger="Estornar" title="Estornar?" consequence="Volta ao caixa." confirmLabel="Sim, estornar" onConfirm={onConfirm} canConfirm={false}>
        <Field label="Motivo" />
      </ConfirmAction>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Estornar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, estornar" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Preencha o que falta acima para confirmar.")).toBeInTheDocument();
  });
});

describe("Field", () => {
  it("input, select e textarea com rótulo, dica e erro ligados por aria-describedby", () => {
    render(
      <>
        <Field label="Nome" hint="Como aparece na agenda" error="Informe o nome." />
        <Field as="select" label="Origem" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Field>
        <Field as="textarea" label="Observação" />
      </>,
    );
    const nome = screen.getByLabelText("Nome");
    expect(nome).toHaveAttribute("aria-invalid", "true");
    expect(nome).toHaveAccessibleDescription("Como aparece na agenda Informe o nome.");
    expect(screen.getByLabelText("Origem").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Observação").tagName).toBe("TEXTAREA");
  });

  it("no envio, mostra todos os erros e foca o primeiro campo com erro", async () => {
    function Form() {
      const { formRef, errors, show } = useFormErrors<"a" | "b">();
      const [a, setA] = useState("");
      return (
        <form
          ref={formRef}
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            show({ a: a ? null : "Falta A.", b: "Falta B." });
          }}
        >
          <Field label="A" value={a} onChange={(e) => setA(e.target.value)} error={errors.a} />
          <Field label="B" error={errors.b} />
          <Button type="submit">Enviar</Button>
        </form>
      );
    }
    render(<Form />);
    const send = screen.getByRole("button", { name: "Enviar" });
    expect(send).toBeEnabled();
    await act(async () => fireEvent.click(send));
    expect(screen.getByText("Falta A.")).toBeInTheDocument();
    expect(screen.getByText("Falta B.")).toBeInTheDocument();
    expect(screen.getByLabelText("A")).toHaveFocus();
  });
});

describe("Button, IconButton e avisos", () => {
  it("ocupado: aria-busy, desligado e texto de carregando", () => {
    render(<Button loading loadingText="Salvando…">Salvar</Button>);
    const b = screen.getByRole("button", { name: "Salvando…" });
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(b).toBeDisabled();
  });

  it("botão de ícone tem nome acessível", () => {
    render(<IconButton icon="fechar" label="Fechar menu" />);
    expect(screen.getByRole("button", { name: "Fechar menu" })).toHaveClass("tn-icon-button");
  });

  it("aviso diz o tom em texto, não só pela cor", () => {
    render(<StatusBanner tone="warning">Confira o horário.</StatusBanner>);
    expect(screen.getByRole("status")).toHaveTextContent("Atenção: Confira o horário.");
  });
});

describe("selecionado", () => {
  it("Segmented é um grupo de rádios; ChoiceCard e ChipNav marcam o atual", () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <Segmented label="Visão" value="dia" onChange={onChange} options={[{ value: "dia", label: "Dia" }, { value: "semana", label: "Semana" }]} />
        <ChoiceCard name="p" value="x" checked onChange={() => {}} title="Barbeiro" />
        <ChipNav label="Telas" items={[{ to: "/a", label: "A", current: true }, { to: "/b", label: "B" }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("radio", { name: "Dia" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(onChange).toHaveBeenCalledWith("semana");
    expect(screen.getByRole("radio", { name: "Barbeiro" })).toBeChecked();
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("aria-current", "page");
  });
});
