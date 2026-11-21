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

describe("entrar: Mostrar senha (E7)", () => {
  it("botão de alternância com aria-pressed mostra e esconde a senha", async () => {
    renderSignIn();
    const password = await screen.findByLabelText("Senha");
    const toggle = screen.getByRole("button", { name: "Mostrar senha" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", password.id);
    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "password");
  });
});

// Primeiro acesso de verdade: volta ao destino, avisos de por que caiu aqui e e-mail ainda não confirmado.
import { Route, Routes } from "react-router";
import { waitFor } from "@testing-library/react";
import { EMAIL_NOT_CONFIRMED, forgetDeviceData } from "../session.tsx";

function renderAt(path: string, signIn: (args: unknown) => Promise<{ error: unknown }>) {
  let listener: ((event: string, session: unknown) => void) | null = null;
  const resend = vi.fn(async () => ({ error: null }));
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        listener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: vi.fn(async (args: unknown) => {
        const r = await signIn(args);
        if (!r.error) listener?.("SIGNED_IN", { user: { id: "u1", email: "ana@exemplo.test" }, access_token: "t" });
        return r;
      }),
      resend,
    },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    rpc: async () => ({ data: false, error: null }),
  } as unknown as SupabaseClient;
  render(
    <SessionProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/entrar" element={<SignIn />} />
          <Route path="/app/*" element={<p>destino: <span data-testid="aqui">app</span></p>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
  return { resend };
}

async function fillAndSubmit(email = "ana@exemplo.test", password = "segredo1234") {
  fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("entrar: volta ao destino e avisos", () => {
  it("sessão expirada: avisa e, depois de entrar, volta para o link de onde a pessoa veio", async () => {
    renderAt("/entrar?volta=%2Fapp%2Fclientes%2F42&motivo=sessao", async () => ({ error: null }));
    expect(await screen.findByText("Sua sessão terminou. Entre de novo para continuar de onde parou.")).toBeInTheDocument();
    await fillAndSubmit();
    expect(await screen.findByTestId("aqui")).toBeInTheDocument();
  });

  it("destino de fora do app é ignorado: entra e vai para a Hoje", async () => {
    renderAt("/entrar?volta=https%3A%2F%2Fmal.example%2Fapp", async () => ({ error: null }));
    await fillAndSubmit();
    expect(await screen.findByTestId("aqui")).toBeInTheDocument();
  });

  it("saiu: diz que os dados do aparelho foram apagados", async () => {
    const { unmount } = render(<p />);
    unmount();
    renderAt("/entrar?motivo=saiu", async () => ({ error: null }));
    expect(await screen.findByText(/Você saiu da conta/)).toBeInTheDocument();
  });

  it("e-mail não confirmado: mensagem própria e reenviar o link, com resposta neutra", async () => {
    const { resend } = renderAt("/entrar", async () => ({ error: { code: "email_not_confirmed", status: 400 } }));
    await fillAndSubmit();
    expect(await screen.findByText(EMAIL_NOT_CONFIRMED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reenviar o link de confirmação" }));
    expect(await screen.findByText(/Se o e-mail puder ser usado, enviamos um link novo/)).toBeInTheDocument();
    expect(resend).toHaveBeenCalledWith(expect.objectContaining({ type: "signup", email: "ana@exemplo.test" }));
  });

  it("senha errada continua neutra (não diz se o e-mail existe)", async () => {
    renderAt("/entrar", async () => ({ error: { code: "invalid_credentials", status: 400 } }));
    await fillAndSubmit();
    expect(await screen.findByText("E-mail ou senha inválidos.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reenviar/ })).not.toBeInTheDocument();
  });
});

describe("saída limpa", () => {
  it("apaga do aparelho só o que é do app (prefixo tinindo.)", async () => {
    localStorage.setItem("tinindo.selectedTenant", "t1");
    localStorage.setItem("tinindo.agenda.series.t1", "[]");
    sessionStorage.setItem("tinindo.demo.modulos", "[]");
    localStorage.setItem("outro.app", "fica");
    forgetDeviceData();
    await waitFor(() => expect(localStorage.getItem("tinindo.selectedTenant")).toBeNull());
    expect(localStorage.getItem("tinindo.agenda.series.t1")).toBeNull();
    expect(sessionStorage.getItem("tinindo.demo.modulos")).toBeNull();
    expect(localStorage.getItem("outro.app")).toBe("fica");
    localStorage.removeItem("outro.app");
  });
});
