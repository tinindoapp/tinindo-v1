import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDemoPushPort, type PushDevice, type PushPort } from "./push-client.ts";
import { type PushEnv, PushSettings } from "./PushSettings.tsx";

const EP = "https://fcm.googleapis.com/fcm/send/aparelho-1";
const device = (prefs: Partial<PushDevice["prefs"]> = {}): PushDevice => ({
  id: "d0000000-0000-4000-8000-000000000001", device_label: "Celular Android", created_at: "2026-11-21T12:00:00Z", last_sent_at: null,
  prefs: { booking_new: true, booking_cancelled: true, reminder_30: true, daily_summary: false, ...prefs },
});

function port(over: Partial<PushPort> = {}): PushPort {
  return {
    demo: false,
    config: vi.fn(async () => ({ available: true, public_key: "BAAA" })),
    subscribe: vi.fn(async () => device()),
    prefs: vi.fn(async (_e, p) => device(p)),
    unsubscribe: vi.fn(async () => ({ removed: true })),
    device: vi.fn(async () => null),
    test: vi.fn(async () => ({ queued: true })),
    ...over,
  };
}
function sub(): PushSubscription {
  return { endpoint: EP, toJSON: () => ({ endpoint: EP, keys: { p256dh: `B${"A".repeat(86)}`, auth: "C".repeat(22) } }), unsubscribe: vi.fn(async () => true) } as unknown as PushSubscription;
}
function env(over: Partial<PushEnv> = {}): PushEnv {
  return { support: "ok", current: vi.fn(async () => null), subscribe: vi.fn(async () => sub()), permission: () => "default", userAgent: "Android", ...over };
}

describe("Avisos no celular", () => {
  it("demonstração: explica e não pede permissão ao navegador", async () => {
    const e = env();
    render(<PushSettings port={createDemoPushPort()} env={e} />);
    expect(await screen.findByText(/Na demonstração os avisos não são enviados/)).toBeInTheDocument();
    expect(e.subscribe).not.toHaveBeenCalled();
  });

  it("ambiente sem VAPID e iPhone fora do app instalado: mensagem certa", async () => {
    const a = render(<PushSettings port={port({ config: async () => ({ available: false, public_key: null }) })} env={env()} />);
    expect(await screen.findByText(/não estão ligados neste ambiente/)).toBeInTheDocument();
    a.unmount();
    render(<PushSettings port={port()} env={env({ support: "ios-needs-install" })} />);
    expect(await screen.findByText(/adicione a Tinindo à tela de início/)).toBeInTheDocument();
  });

  it("ligar: escolhe os tipos, pede permissão e assina com as escolhas; resumo do dia começa desligado", async () => {
    const p = port();
    const e = env();
    render(<PushSettings port={p} env={e} />);
    const summary = await screen.findByRole("checkbox", { name: /Resumo do dia/ });
    expect(summary).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /Cancelamento/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ligar avisos neste aparelho" }));
    });
    expect(e.subscribe).toHaveBeenCalledWith("BAAA");
    expect(p.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: EP, device_label: "Celular Android", prefs: { booking_new: true, booking_cancelled: false, reminder_30: true, daily_summary: false },
    }));
    expect(await screen.findByText("Avisos ligados neste aparelho.")).toBeInTheDocument();
  });

  it("permissão negada: diz onde liberar, sem assinar no servidor", async () => {
    const p = port();
    render(<PushSettings port={p} env={env({ subscribe: async () => null })} />);
    const on = await screen.findByRole("button", { name: "Ligar avisos neste aparelho" });
    await act(async () => {
      fireEvent.click(on);
    });
    expect(screen.getByText(/bloqueados para este site/)).toBeInTheDocument();
    expect(p.subscribe).not.toHaveBeenCalled();
  });

  it("já ligado: desliga um tipo na hora; teste; desligar neste aparelho cancela no servidor e no navegador", async () => {
    const s = sub();
    const p = port({ device: vi.fn(async () => device()) });
    render(<PushSettings port={p} env={env({ current: async () => s })} />);
    const reminder = await screen.findByRole("checkbox", { name: /Lembrete 30 min antes/ });
    await act(async () => {
      fireEvent.click(reminder);
    });
    expect(p.prefs).toHaveBeenCalledWith(EP, { reminder_30: false });
    await waitFor(() => expect(reminder).not.toBeChecked());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar um teste" }));
    });
    expect(await screen.findByText(/Teste a caminho/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Desligar neste aparelho" }));
    });
    expect(p.unsubscribe).toHaveBeenCalledWith(EP);
    expect(s.unsubscribe).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Ligar avisos neste aparelho" })).toBeInTheDocument();
  });

  it("falha ao salvar um tipo: volta como estava e avisa", async () => {
    const p = port({ device: vi.fn(async () => device()), prefs: vi.fn(async () => { throw new Error("rede"); }) });
    render(<PushSettings port={p} env={env({ current: async () => sub() })} />);
    const box = await screen.findByRole("checkbox", { name: /Reserva nova pelo link/ });
    await act(async () => {
      fireEvent.click(box);
    });
    expect(box).toBeChecked();
    expect(screen.getByText("Não foi possível salvar. Nada mudou.")).toBeInTheDocument();
  });
});
