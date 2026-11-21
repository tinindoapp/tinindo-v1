// Primeiro acesso de verdade: o shell manda para /entrar com o destino quando a sessão cai sozinha, e sem destino
// quando a pessoa toca em Sair (aparelho dividido não reabre a tela anterior).
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell.tsx";
import { SessionProvider } from "./session.tsx";

function setup(start: string) {
  let listener: ((event: string, session: unknown) => void) | null = null;
  const signOut = vi.fn(async () => {
    listener?.("SIGNED_OUT", null);
    return { error: null };
  });
  const user = { user: { id: "u1", email: "ana@exemplo.test" }, access_token: "t" };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: user } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        listener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut,
    },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    rpc: async () => ({ data: false, error: null }),
  } as unknown as SupabaseClient;
  const router = createMemoryRouter(
    [
      { path: "/app/*", element: <AppShell />, children: [{ path: "*", element: <p>tela</p> }] },
      { path: "/entrar", element: <p>entrar</p> },
    ],
    { initialEntries: [start] },
  );
  render(
    <SessionProvider client={client}>
      <RouterProvider router={router} />
    </SessionProvider>,
  );
  return {
    router,
    expire: () => act(() => listener?.("SIGNED_OUT", null)),
    emit: (event: string) => act(() => listener?.(event, user)),
  };
}

describe("fim da sessão", () => {
  it("sessão que cai sozinha leva a /entrar com o destino e o motivo", async () => {
    const { router, expire } = setup("/app/conta/recursos?x=1");
    expect(await screen.findByRole("main")).toBeInTheDocument();
    expire();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    const q = new URLSearchParams(router.state.location.search);
    expect(q.get("volta")).toBe("/app/conta/recursos?x=1");
    expect(q.get("motivo")).toBe("sessao");
  });

  it("Sair leva a /entrar sem destino, com o aviso de saída", async () => {
    const { router } = setup("/app/conta");
    const sair = await screen.findAllByRole("button", { name: /Sair/ });
    fireEvent.click(sair[0]!);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    const q = new URLSearchParams(router.state.location.search);
    expect(q.get("volta")).toBeNull();
    expect(q.get("motivo")).toBe("saiu");
  });

  it("link de e-mail vencido (#error_code=otp_expired) leva a /entrar explicando o link", async () => {
    let listener: ((e: string, s: unknown) => void) | null = null;
    const client = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
          listener = cb;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    } as unknown as SupabaseClient;
    void listener;
    const router = createMemoryRouter(
      [{ path: "/app/*", element: <AppShell /> }, { path: "/entrar", element: <p>entrar</p> }],
      { initialEntries: ["/app/conta/nova-senha#error=access_denied&error_code=otp_expired"] },
    );
    render(<SessionProvider client={client}><RouterProvider router={router} /></SessionProvider>);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    expect(new URLSearchParams(router.state.location.search).get("motivo")).toBe("link");
  });

  it("link de \"Esqueci minha senha\" que cai na raiz do app leva à tela de nova senha", async () => {
    const { router, emit } = setup("/app");
    expect(await screen.findByRole("main")).toBeInTheDocument();
    emit("PASSWORD_RECOVERY");
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/app/conta/nova-senha"));
  });
});
