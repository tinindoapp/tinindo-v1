// Recado #88: o sinal `isOperator` vem de `my_is_operator()` e só esconde a tela da equipe de quem não é operador.
import { render, screen } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { OperatorGate } from "./OperatorGate.tsx";
import { SessionProvider } from "./session.tsx";

function fakeClient(rpcResult: () => Promise<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(rpcResult);
  const query = { select: () => query, eq: () => query, limit: async () => ({ data: [], error: null }) };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1", email: "a@b.c" }, access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => query,
    rpc,
  } as unknown as SupabaseClient;
  return { client, rpc };
}

function Screen() {
  return <p>tela da equipe</p>;
}

function renderGate(client: SupabaseClient | null) {
  render(
    <SessionProvider client={client}>
      <OperatorGate title="Custo por cliente" headingId="cost-title">
        <Screen />
      </OperatorGate>
    </SessionProvider>,
  );
}

describe("OperatorGate (recado #88)", () => {
  it("quem não é da equipe vê só o aviso; a tela nem monta", async () => {
    const { client, rpc } = fakeClient(async () => ({ data: false, error: null }));
    renderGate(client);
    expect(await screen.findByText("Só a equipe Tinindo acessa esta tela.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Custo por cliente" })).toBeInTheDocument();
    expect(screen.queryByText("tela da equipe")).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("my_is_operator");
  });

  it("operador vê a tela", async () => {
    const { client } = fakeClient(async () => ({ data: true, error: null }));
    renderGate(client);
    expect(await screen.findByText("tela da equipe")).toBeInTheDocument();
    expect(screen.queryByText("Só a equipe Tinindo acessa esta tela.")).not.toBeInTheDocument();
  });

  it("se a leitura do sinal falha, a tela monta e o servidor decide", async () => {
    const { client, rpc } = fakeClient(async () => ({ data: null, error: { message: "function not found" } }));
    renderGate(client);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(await screen.findByText("tela da equipe")).toBeInTheDocument();
  });

  it("demonstração offline: você também é a operadora", () => {
    renderGate(null);
    expect(screen.getByText("tela da equipe")).toBeInTheDocument();
  });
});
