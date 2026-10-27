// Perfil público do profissional + horários do link de reserva. Usado na página pública
// e na prévia do dono. Mostra só a projeção publicada: nada de CRM, contatos ou agenda alheia.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Field, StatusBanner } from "../../components/ui/index.tsx";
import { ApiError } from "../../lib/api/client.ts";
import type { BookConfirmed, BookRequest, NetworkApi, PublicProfileData, PublicService, SlotsData } from "./api.ts";
import { CATEGORY_LABEL, errorMessage, formatTime, newIdempotencyKey } from "./useNetworkApi.ts";

/** Dia da demonstração (fixtures do piloto). Com servidor, o visitante escolhe a partir de hoje. */
const DEMO_DAY = "2026-10-20";
const OFFSET = "-03:00"; // America/Sao_Paulo, sem horário de verão.
const dayWindow = (day: string) => ({ starts_at: `${day}T00:00:00${OFFSET}`, ends_at: `${day}T23:59:59${OFFSET}` });
const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const formatDay = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/** Aceita "(11) 97777-4343", "11977774343" ou "+55 11 97777-4343"; devolve E.164 ou null. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (/^\d{10,11}$/.test(digits)) return `+55${digits}`;
  if (/^55\d{10,11}$/.test(digits)) return `+${digits}`;
  return null;
}

/** Mensagens do pedido e da confirmação, sem detalhes técnicos. */
function bookingError(e: unknown): string {
  if (!(e instanceof ApiError)) return "Falha inesperada. Tente novamente.";
  if (e.code === "SLOT_CONFLICT") return "Este horário acabou de ser reservado por outra pessoa. Escolha outro.";
  if (e.code === "QUOTA_EXCEEDED") return "Muitos pedidos em pouco tempo. Tente mais tarde ou fale direto com o profissional.";
  if (e.code === "POLICY_REJECTED" && e.field === "channel") {
    return "Este profissional ainda não recebe reservas on-line. Combine o horário diretamente com ele.";
  }
  if (e.code === "POLICY_REJECTED" && e.field === "code") return "Código incorreto. Confira a mensagem e tente de novo.";
  if (e.code === "POLICY_REJECTED" && e.field === "attempts") return "Muitas tentativas com código errado. Peça o horário de novo.";
  if (e.code === "POLICY_REJECTED" && e.field === "expires_at") return "O prazo para confirmar venceu e o horário foi liberado. Escolha de novo.";
  if (e.code === "VALIDATION_ERROR" && e.field?.startsWith("contact")) return "Confira o nome e o WhatsApp com DDD.";
  return errorMessage(e);
}

export function PublicProfileView({ profile, api }: { profile: PublicProfileData; api: NetworkApi }) {
  const name = profile.fields.display_name ?? CATEGORY_LABEL[profile.category];
  return (
    <div className="tn-stack">
      <Card as="article" aria-labelledby="perfil-nome">
        <p className="tn-caps">{CATEGORY_LABEL[profile.category]}</p>
        <h1 id="perfil-nome">{name}</h1>
        <p className="tn-net-muted">{profile.area}</p>
        <ul className="tn-net-badges" aria-label="Reputação">
          <li>{profile.reputation.identity_verified ? "Identidade verificada" : "Identidade não verificada"}</li>
          <li>
            {profile.reputation.reviews_count === 0 ? (
              "Perfil novo · ainda sem avaliações"
            ) : (
              <Link to={`/avaliacoes/${profile.slug}`}>{profile.reputation.reviews_count} avaliações de clientes</Link>
            )}
          </li>
        </ul>
        {/* Avaliar exige login e só lista atendimentos concluídos do próprio cliente (regra do servidor). */}
        <p className="tn-net-small">
          Já foi atendido aqui? <Link to="/avaliar">Avaliar meu atendimento</Link> ·{" "}
          <Link to="/app/conta/reservas">Minhas reservas</Link>
        </p>
        {profile.fields.bio ? <p>{profile.fields.bio}</p> : null}
        {profile.fields.services_summary ? <p>{profile.fields.services_summary}</p> : null}
      </Card>
      {profile.fields.booking_link ? <BookingSlots slug={profile.slug} api={api} /> : null}
      <p className="tn-net-muted tn-net-small">
        Informações publicadas pelo próprio profissional. A Tinindo não garante habilidade nem resultado. Algo
        errado ou indevido? Fale com a equipe Tinindo para pedir correção ou remoção.
      </p>
    </div>
  );
}

type SlotsState = { key: string } & ({ kind: "ok"; data: SlotsData } | { kind: "error"; message: string });
type Step =
  | { kind: "choose" }
  | { kind: "code"; request: BookRequest; phone: string }
  | { kind: "done"; booking: BookConfirmed };

function BookingSlots({ slug, api }: { slug: string; api: NetworkApi }) {
  const [services, setServices] = useState<PublicService[] | null>(null);
  const [serviceId, setServiceId] = useState<string>("");
  const [day, setDay] = useState<string>(() => (api.demo ? DEMO_DAY : todayInSaoPaulo()));
  const [result, setResult] = useState<SlotsState | null>(null);
  const [reload, setReload] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Uma chave por pedido: clique duplo ou nova tentativa do MESMO pedido não cria outra provisória.
  const [bookKey, setBookKey] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.publicServices(slug).then((list) => {
      if (cancelled) return;
      setServices(list);
      setServiceId(list[0]?.id ?? "");
    }).catch(() => !cancelled && setServices([]));
    return () => {
      cancelled = true;
    };
  }, [api, slug]);

  const slotsKey = `${serviceId}|${day}|${reload}`;
  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    api
      .publicSlots(slug, serviceId, dayWindow(day))
      .then((data) => !cancelled && setResult({ key: slotsKey, kind: "ok", data }))
      .catch((e: unknown) => !cancelled && setResult({ key: slotsKey, kind: "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [api, slug, serviceId, day, slotsKey]);

  // Resultado de outra escolha ainda na tela = carregando a atual.
  const slots = result && result.key === slotsKey ? result : { kind: "loading" as const };
  const e164 = toE164(phone);
  const service = services?.find((s) => s.id === serviceId);
  const resetRequest = () => {
    setBookKey(null);
    setProblem(null);
  };

  async function requestSlot() {
    if (!chosen || !e164 || !name.trim()) return;
    const key = bookKey ?? newIdempotencyKey();
    setBookKey(key);
    setBusy(true);
    setProblem(null);
    try {
      const request = await api.book({ slug, service_id: serviceId, starts_at: chosen, contact: { name: name.trim(), phone_e164: e164 } }, key);
      setStep({ kind: "code", request, phone: e164 });
      setCode("");
    } catch (e) {
      setProblem(bookingError(e));
      if (e instanceof ApiError && e.code === "SLOT_CONFLICT") {
        setChosen(null);
        setBookKey(null);
        setReload((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (step.kind !== "code" || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setProblem(null);
    try {
      const booking = await api.confirmBooking({ request_id: step.request.request_id, code }, newIdempotencyKey());
      setStep({ kind: "done", booking });
    } catch (e) {
      setProblem(bookingError(e));
      if (e instanceof ApiError && e.code === "POLICY_REJECTED" && (e.field === "expires_at" || e.field === "attempts")) {
        setStep({ kind: "choose" });
        setChosen(null);
        setBookKey(null);
        setReload((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "done") {
    const b = step.booking;
    return (
      <Card aria-labelledby="horarios-titulo">
        <h2 id="horarios-titulo">Horário confirmado</h2>
        <StatusBanner tone="success">
          {b.service_name} · {formatDay(b.slot.starts_at)} às <span className="tn-num">{formatTime(b.slot.starts_at)}</span>.
          {api.demo ? " Demonstração: a reserva entrou só na Agenda desta aba." : null}
        </StatusBanner>
        <p className="tn-net-small">
          Para remarcar ou cancelar, fale com o profissional. Tem login? Veja em <Link to="/app/conta/reservas">Minhas reservas</Link>.
        </p>
      </Card>
    );
  }

  if (step.kind === "code") {
    const r = step.request;
    return (
      <Card aria-labelledby="horarios-titulo">
        <h2 id="horarios-titulo">Confirme o horário</h2>
        <p>
          {service?.name} · {formatDay(r.slot.starts_at)} às <span className="tn-num">{formatTime(r.slot.starts_at)}</span>
        </p>
        <StatusBanner tone="info">
          Enviamos um código de 6 dígitos para o seu WhatsApp <span className="tn-num">{step.phone}</span>. O horário fica
          guardado até as <span className="tn-num">{formatTime(r.expires_at)}</span>; depois disso, volta a ficar livre.
        </StatusBanner>
        {r.demoCode ? (
          <StatusBanner tone="warning">
            Demonstração: nenhuma mensagem é enviada. O código seria <span className="tn-num">{r.demoCode}</span>.
          </StatusBanner>
        ) : null}
        <form
          className="tn-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmCode();
          }}
        >
          <Field
            label="Código recebido"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Confirmando…" : "Confirmar horário"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setStep({ kind: "choose" });
              setProblem(null);
            }}
          >
            Voltar
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="horarios-titulo">
      <h2 id="horarios-titulo">Horários disponíveis</h2>
      {services === null ? <p role="status">Carregando…</p> : null}
      {services !== null && services.length === 0 ? (
        <StatusBanner tone="info">
          Os horários on-line ainda não estão disponíveis para este perfil. Combine diretamente com o profissional.
        </StatusBanner>
      ) : null}
      {services && services.length > 0 ? (
        <div className="tn-stack">
          <div className="tn-field">
            <label htmlFor="servico">Serviço</label>
            <select
              id="servico"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setChosen(null);
                resetRequest();
              }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.duration_min} min
                </option>
              ))}
            </select>
          </div>
          {api.demo ? null : (
            <Field
              label="Dia"
              type="date"
              min={todayInSaoPaulo()}
              value={day}
              onChange={(e) => {
                if (!e.target.value) return;
                setDay(e.target.value);
                setChosen(null);
                resetRequest();
              }}
            />
          )}
          {slots.kind === "loading" ? <p role="status">Carregando horários…</p> : null}
          {slots.kind === "error" ? <StatusBanner tone="warning">{slots.message}</StatusBanner> : null}
          {slots.kind === "ok" && slots.data.slots.length === 0 ? (
            <StatusBanner tone="info">Nenhum horário livre neste dia.</StatusBanner>
          ) : null}
          {slots.kind === "ok" && slots.data.slots.length > 0 ? (
            <ul className="tn-net-slots" aria-label="Horários livres">
              {slots.data.slots.map((s) => (
                <li key={s.starts_at}>
                  <Button
                    variant={chosen === s.starts_at ? "primary" : "secondary"}
                    aria-pressed={chosen === s.starts_at}
                    onClick={() => {
                      setChosen(s.starts_at);
                      resetRequest();
                    }}
                  >
                    <span className="tn-num">{formatTime(s.starts_at)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
          {chosen ? (
            <form
              className="tn-stack"
              aria-label="Pedir horário"
              onSubmit={(e) => {
                e.preventDefault();
                void requestSlot();
              }}
            >
              <p>
                Horário das <span className="tn-num">{formatTime(chosen)}</span>. Vamos mandar um código de 6 dígitos para o
                seu WhatsApp para confirmar. Seu número só vai para este profissional.
              </p>
              <Field
                label="Seu nome"
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  resetRequest();
                }}
              />
              <Field
                label="WhatsApp com DDD"
                type="tel"
                autoComplete="tel"
                placeholder="(11) 97777-4343"
                value={phone}
                error={phone.trim() && !e164 ? "Use o número com DDD, por exemplo (11) 97777-4343." : undefined}
                onChange={(e) => {
                  setPhone(e.target.value);
                  resetRequest();
                }}
              />
              <Button type="submit" disabled={busy || !e164 || !name.trim()}>
                {busy ? "Pedindo…" : "Pedir este horário"}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
