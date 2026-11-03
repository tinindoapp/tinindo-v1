// Componentes da onda 3 da auditoria de UX: ChipGroup (item 18) e ActionButton (ação assíncrona de um toque).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type FormEvent, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ActionButton, Button, ChipGroup, useFormErrors, WEEKDAY_CHIPS, WEEKDAY_SHORTCUTS } from "./index.tsx";

function Days({ initial = [] as number[], onChange = (_: number[]) => {} }) {
  const [days, setDays] = useState<number[]>(initial);
  return <ChipGroup label="Dias" options={WEEKDAY_CHIPS} shortcuts={WEEKDAY_SHORTCUTS} value={days} onChange={(d) => { setDays(d); onChange(d); }} />;
}

describe("ChipGroup", () => {
  it("cada chip é uma caixa de seleção com o nome inteiro do dia; marcar põe o ✓ e mantém a ordem da semana", () => {
    const onChange = vi.fn();
    render(<Days onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Dias" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Quarta" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Segunda" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 3]);
    expect(screen.getByRole("checkbox", { name: "Segunda" })).toBeChecked();
    expect(screen.getByText("Seg").closest(".tn-chip")).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Segunda" }));
    expect(onChange).toHaveBeenLastCalledWith([3]);
  });

  it("atalho troca a seleção inteira e fica marcado quando bate com o valor", () => {
    const onChange = vi.fn();
    render(<Days onChange={onChange} />);
    const weekdays = screen.getByRole("button", { name: "Dias úteis" });
    expect(weekdays).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(weekdays);
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 3, 4, 5]);
    expect(weekdays).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Sábado" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sábado" }));
    expect(weekdays).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Seg a sáb" })).toHaveAttribute("aria-pressed", "true");
  });

  it("erro no envio: mensagem ligada ao grupo e foco no primeiro chip", async () => {
    function Form() {
      const [days, setDays] = useState<number[]>([]);
      const { formRef, errors, show } = useFormErrors<"days">();
      return (
        <form ref={formRef} onSubmit={(e: FormEvent) => { e.preventDefault(); show({ days: days.length === 0 && "Escolha pelo menos um dia." }); }}>
          <ChipGroup label="Dias" options={WEEKDAY_CHIPS} value={days} onChange={setDays} error={errors.days} />
          <Button type="submit">Salvar</Button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const monday = await screen.findByRole("checkbox", { name: "Segunda" });
    expect(monday).toHaveAttribute("aria-invalid", "true");
    expect(monday).toHaveFocus();
    expect(screen.getByRole("group", { name: "Dias" })).toHaveAccessibleDescription("Escolha pelo menos um dia.");
  });
});

describe("ActionButton", () => {
  it("fica em carregando enquanto a ação roda, ignora o segundo toque e volta mesmo se a ação falhar", async () => {
    let finish: (v?: unknown) => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const onAct = vi.fn(() => new Promise((res, rej) => { finish = res; fail = rej; }));
    render(<ActionButton onAct={onAct}>Ver pasta</ActionButton>);
    const btn = screen.getByRole("button", { name: "Ver pasta" });
    await act(async () => { fireEvent.click(btn); });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onAct).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(btn).not.toHaveAttribute("aria-busy");
    await act(async () => { fireEvent.click(btn); });
    await act(async () => { fail(new Error("x")); });
    expect(btn).not.toHaveAttribute("aria-busy");
    expect(onAct).toHaveBeenCalledTimes(2);
  });
});
