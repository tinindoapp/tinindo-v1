import { fireEvent, render, screen } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SessionProvider } from "../session.tsx";
import { SignIn } from "./SignIn.tsx";

function renderSignIn() {
  const signInWithPassword = vi.fn(async () => ({ error: { message: "Invalid login credentials" } }));
  // Cliente mínimo: sem sessão (tela de login) e sem servidor de verdade.
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword,
    },
  } as unknown as SupabaseClient;
  render(
    <SessionProvider client={client}>
      <MemoryRouter>
        <SignIn />
      </MemoryRouter>
    </SessionProvider>,
  );
  return { signInWithPassword };
}

describe("entrar", () => {
  it("botão sempre ativo; ao enviar vazio mostra o erro embaixo de cada campo e foca o primeiro", async () => {
    const { signInWithPassword } = renderSignIn();
    const button = await screen.findByRole("button", { name: "Entrar" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByText("Informe o e-mail.")).toBeInTheDocument();
    expect(screen.getByText("Informe a senha.")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveFocus();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("e-mail sem domínio: explica o que falta e não chama o servidor", async () => {
    const { signInWithPassword } = renderSignIn();
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "ana@" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo123" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText(/Confira o e-mail/)).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveFocus();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
