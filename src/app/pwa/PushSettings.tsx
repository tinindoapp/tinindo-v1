// "Avisos no celular" (P34, item 3): o profissional liga os avisos NESTE aparelho e escolhe por tipo. Cada tipo liga e
// desliga na hora; "Desligar neste aparelho" cancela a assinatura. O aviso mostra só serviço, primeiro nome e hora.
// A tela de destino (Calendário e avisos, src/features/calendar) monta este painel com a porta do servidor.
import { useEffect, useState } from "react";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
import { platformOf } from "./install.ts";
import "./pwa.css";
import { DEFAULT_PREFS, deviceLabel, keyBytes, type PushDevice, type PushPort, type PushPrefs, pushSupport, type Support } from "./push-client.ts";

const LABELS: { key: keyof PushPrefs; label: string; hint: string }[] = [
  { key: "booking_new", label: "Reserva nova pelo link", hint: "Quando um cliente marca pelo seu link." },
  { key: "booking_cancelled", label: "Cancelamento", hint: "Quando um atendimento é cancelado (não avisa o que você mesmo cancelou)." },
  { key: "reminder_30", label: "Lembrete 30 min antes", hint: "Do próximo atendimento." },
  { key: "daily_summary", label: "Resumo do dia", hint: "Às 7h, quantos atendimentos e o primeiro horário." },
];

export interface PushEnv {
  support: Support;
  /** Assinatura atual do navegador neste aparelho (null = não assinado aqui). */
  current(): Promise<PushSubscription | null>;
  /** Pede permissão e assina com a chave pública do servidor. */
  subscribe(publicKey: string): Promise<PushSubscription | null>;
  permission(): NotificationPermission | "unsupported";
  userAgent: string;
}

export function browserPushEnv(): PushEnv {
  const ua = navigator.userAgent;
  const platform = platformOf({ userAgent: ua, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone: false });
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const support = pushSupport({
    hasSw: "serviceWorker" in navigator, hasPush: "PushManager" in window, hasNotification: "Notification" in window,
    ios: platform === "ios" || platform === "ios-other-browser", standalone: !!standalone,
  });
  const reg = () => navigator.serviceWorker.ready;
  return {
    support,
    userAgent: ua,
    current: async () => (support === "ok" ? (await reg()).pushManager.getSubscription() : null),
    permission: () => ("Notification" in window ? Notification.permission : "unsupported"),
    subscribe: async (publicKey) => {
      const answer = await Notification.requestPermission();
      if (answer !== "granted") return null;
      return (await reg()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
    },
  };
}

type View =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: "demo" | "server" | Support | "denied" }
  | { kind: "off" }
  | { kind: "on"; device: PushDevice; endpoint: string };

export function PushSettings({ port, env }: { port: PushPort; env: PushEnv }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (port.demo) return setView({ kind: "unavailable", reason: "demo" });
      if (env.support !== "ok") return setView({ kind: "unavailable", reason: env.support });
      const cfg = await port.config();
      if (!cfg.available || !cfg.public_key) return setView({ kind: "unavailable", reason: "server" });
      setPublicKey(cfg.public_key);
      const sub = await env.current();
      const device = sub ? await port.device(sub.endpoint) : null;
      if (!alive) return;
      if (sub && device) {
        setPrefs(device.prefs);
        setView({ kind: "on", device, endpoint: sub.endpoint });
      } else setView(env.permission() === "denied" ? { kind: "unavailable", reason: "denied" } : { kind: "off" });
    })().catch(() => alive && setView({ kind: "unavailable", reason: "server" }));
    return () => {
      alive = false;
    };
  }, [port, env]);

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setNote(null);
    try {
      const sub = await env.subscribe(publicKey);
      if (!sub) {
        setView({ kind: "unavailable", reason: "denied" });
        return;
      }
      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      const device = await port.subscribe({
        endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        device_label: deviceLabel(env.userAgent), prefs,
      });
      if (device) {
        setView({ kind: "on", device, endpoint: sub.endpoint });
        setNote({ tone: "success", text: "Avisos ligados neste aparelho." });
      }
    } catch {
      setNote({ tone: "danger", text: "Não foi possível ligar os avisos agora. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: keyof PushPrefs, value: boolean) {
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    if (view.kind !== "on") return;
    try {
      const device = await port.prefs(view.endpoint, { [key]: value });
      if (device) setPrefs(device.prefs);
    } catch {
      setPrefs(before);
      setNote({ tone: "danger", text: "Não foi possível salvar. Nada mudou." });
    }
  }

  async function turnOff() {
    if (view.kind !== "on") return;
    setBusy(true);
    try {
      await port.unsubscribe(view.endpoint);
      await (await env.current())?.unsubscribe().catch(() => false);
      setView({ kind: "off" });
      setNote({ tone: "info", text: "Avisos desligados neste aparelho." });
    } catch {
      setNote({ tone: "danger", text: "Não foi possível desligar agora. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (view.kind !== "on") return;
    const r = await port.test(view.endpoint).catch(() => null);
    setNote(r?.queued
      ? { tone: "success", text: "Teste a caminho: o aviso chega em até um minuto." }
      : { tone: "info", text: "Um teste por minuto. Espere um pouco e tente de novo." });
  }

  return (
    <section className="tn-stack" data-gap="sm" aria-labelledby="tn-push-title">
      <h2 id="tn-push-title">Avisos no celular</h2>
      <p className="tn-muted">Cada aparelho escolhe o que recebe. O aviso mostra só o serviço, o primeiro nome do cliente e a hora.</p>
      {view.kind === "loading" ? <p role="status">Conferindo este aparelho…</p> : null}
      {view.kind === "unavailable" ? <StatusBanner tone="info">{unavailableText(view.reason)}</StatusBanner> : null}
      {view.kind === "off" || view.kind === "on" ? (
        <fieldset className="tn-stack" data-gap="xs">
          <legend className="tn-visually-hidden">O que avisar neste aparelho</legend>
          {LABELS.map((l) => (
            <label key={l.key} className="tn-push-pref">
              <input type="checkbox" checked={prefs[l.key]} disabled={busy} onChange={(e) => void toggle(l.key, e.target.checked)} />
              <span><strong>{l.label}</strong><br /><span className="tn-muted">{l.hint}</span></span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {view.kind === "off" ? <Button loading={busy} loadingText="Ligando…" onClick={() => void turnOn()}>Ligar avisos neste aparelho</Button> : null}
      {view.kind === "on" ? (
        <div className="tn-actions">
          <Button variant="secondary" onClick={() => void test()}>Enviar um teste</Button>
          <Button variant="ghost" loading={busy} loadingText="Desligando…" onClick={() => void turnOff()}>Desligar neste aparelho</Button>
        </div>
      ) : null}
      {note ? <StatusBanner tone={note.tone}>{note.text}</StatusBanner> : null}
    </section>
  );
}

function unavailableText(reason: "demo" | "server" | Support | "denied"): string {
  switch (reason) {
    case "demo": return "Na demonstração os avisos não são enviados. Com a sua conta, você liga aqui os avisos de cada aparelho.";
    case "server": return "Os avisos no celular ainda não estão ligados neste ambiente.";
    case "ios-needs-install": return "No iPhone, os avisos chegam só pelo app instalado: adicione a Tinindo à tela de início (iOS 16.4 ou mais novo) e abra por ela.";
    case "denied": return "Os avisos estão bloqueados para este site nas configurações do navegador. Libere lá e volte aqui.";
    default: return "Este navegador não recebe avisos. Use o Chrome no Android ou o app instalado no iPhone.";
  }
}
