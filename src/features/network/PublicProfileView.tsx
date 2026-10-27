// Perfil público do profissional + horários do link de reserva. Usado na página pública
// e na prévia do dono. Mostra só a projeção publicada: nada de CRM, contatos ou agenda alheia.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Card, ChoiceCard, Field, PageHeader, StatusBanner, useFormErrors } from "../../components/ui/index.tsx";
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

/** Quantos dias a fileira de chips mostra a partir de hoje. */
export const DAYS_AHEAD = 14;
/** "2026-10-20" + n dias, em data de calendário (meio-dia UTC evita virar o dia). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** "ter 20/10": rótulo curto de um dia de calendário. */
export function shortDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return `${weekday} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

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
      <PageHeader id="perfil-nome" eyebrow={CATEGORY_LABEL[profile.category]} title={name} subtitle={profile.area} />
      <Card as="article" aria-labelledby="perfil-nome">
        {/* Só selos positivos (BRAND.md, Reputação): o que falta não vira selo. Sem "Tinindo garante". */}
        <ul className="tn-net-badges" aria-label="Reputação">
          {profile.reputation.identity_verified ? <li>Identidade verificada</li> : null}
          <li>
            {profile.reputation.reviews_count === 0 ? (
              "Perfil novo · ainda sem avaliações"
            ) : (
              <Link to={`/avaliacoes/${profile.slug}`}>
                {profile.reputation.reviews_count === 1 ? "1 avaliação de cliente" : `${profile.reputation.reviews_count} avaliações de clientes`}
              </Link>
            )}
          </li>
        </ul>
        {/* Avaliar exige login e só lista atendimentos concluídos do próprio cliente (regra do servidor). */}
        <p className="tn-muted">
          Já foi atendido aqui? <Link to="/avaliar">Avaliar meu atendimento</Link> ·{" "}
          <Link to="/app/conta/reservas">Minhas reservas</Link>
        </p>
        {profile.fields.bio ? <p>{profile.fields.bio}</p> : null}
        {profile.fields.services_summary ? <p>{profile.fields.services_summary}</p> : null}
      </Card>
      {profile.fields.booking_link ? <BookingSlots slug={profile.slug} api={api} /> : null}
      <p className="tn-muted">
        Informações publicadas pelo próprio profissional. A Tinindo não garante habilidade nem resultado. Algo
        errado ou indevido? Fale com a equipe Tinindo para pedir correção ou remoção.
      </p>
    </div>
  );
}

type SlotsState = { key: string } & ({ kind: "ok"; data: SlotsData } | { kind: "error"; message: string });
/** Etapas da reserva pelo link (auditoria de UX, E4). "done" fica fora da contagem. */
type Phase = "service" | "slot" | "contact" | "code" | "done";
type StepPhase = Exclude<Phase, "done">;
const STEPS: { phase: StepPhase; label: string; title: string }[] = [
  { phase: "service", label: "Serviço", title: "Escolha o serviço" },
  { phase: "slot", label: "Dia e hora", title: "Escolha o dia e a hora" },
  { phase: "contact", label: "Seus dados", title: "Seus dados" },
  { phase: "code", label: "Código", title: "Confirme o horário" },
];

function StepIndicator({ phase }: { phase: StepPhase }) {
  const current = STEPS.findIndex((s) => s.phase === phase);
  return (
    <nav className="tn-net-wizard" aria-label="Etapas da reserva">
      <p className="tn-net-wizard__count">
        Passo {current + 1} de {STEPS.length}
      </p>
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.phase} aria-current={i === current ? "step" : undefined} data-done={i < current || undefined}>
            <span className="tn-net-wizard__mark" aria-hidden="true">
              {i < current ? "✓" : i + 1}
            </span>
            <span>
              {s.label}
              {i < current ? <span className="tn-visually-hidden"> (feito)</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function BookingSlots({ slug, api }: { slug: string; api: NetworkApi }) {
  const [services, setServices] = useState<PublicService[] | null>(null);
  const [serviceId, setServiceId] = useState<string>("");
  const [firstDay] = useState<string>(() => (api.demo ? DEMO_DAY : todayInSaoPaulo()));
  const [day, setDay] = useState<string>(firstDay);
  const [result, setResult] = useState<SlotsState | null>(null);
  const [reload, setReload] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Uma chave por pedido: clique duplo ou nova tentativa do MESMO pedido não cria outra provisória.
  const [bookKey, setBookKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("service");
  const [request, setRequest] = useState<{ data: BookRequest; phone: string } | null>(null);
  const [booking, setBooking] = useState<BookConfirmed | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { formRef: requestRef, errors: requestErrors, show: showRequest, clear: clearRequest } = useFormErrors<"name" | "phone">();
  const { formRef: codeRef, errors: codeErrors, show: showCode, clear: clearCode } = useFormErrors<"code">();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

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

  // Ao trocar de etapa, o foco vai para o título dela (o leitor de tela anuncia onde a pessoa está).
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    titleRef.current?.focus();
    if (phase === "slot") {
      daysRef.current?.querySelector("input:checked")?.closest("label")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [phase]);

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
  const go = (next: Phase) => {
    setProblem(null);
    setPhase(next);
  };
  /** Horário perdido (conflito, prazo vencido, tentativas): volta para a escolha do horário com o aviso. */
  const backToSlots = (message: string) => {
    setChosen(null);
    setBookKey(null);
    setRequest(null);
    setReload((n) => n + 1);
    setPhase("slot");
    setProblem(message);
  };

  async function requestSlot() {
    const ok = showRequest({
      name: name.trim() ? null : "Informe seu nome.",
      phone: !phone.trim() ? "Informe seu WhatsApp com DDD." : e164 ? null : "Use o número com DDD, por exemplo (11) 97777-4343.",
    });
    if (!chosen || !ok || !e164) return;
    const key = bookKey ?? newIdempotencyKey();
    setBookKey(key);
    setBusy(true);
    setProblem(null);
    try {
      const data = await api.book({ slug, service_id: serviceId, starts_at: chosen, contact: { name: name.trim(), phone_e164: e164 } }, key);
      setRequest({ data, phone: e164 });
      setCode("");
      setPhase("code");
    } catch (e) {
      if (e instanceof ApiError && e.code === "SLOT_CONFLICT") backToSlots(bookingError(e));
      else setProblem(bookingError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!request) return;
    if (!showCode({ code: /^\d{6}$/.test(code) ? null : "Digite os 6 números do código." })) return;
    setBusy(true);
    setProblem(null);
    try {
      setBooking(await api.confirmBooking({ request_id: request.data.request_id, code }, newIdempotencyKey()));
      setPhase("done");
    } catch (e) {
      if (e instanceof ApiError && e.code === "POLICY_REJECTED" && (e.field === "expires_at" || e.field === "attempts")) {
        backToSlots(bookingError(e));
      } else setProblem(bookingError(e));
    } finally {
      setBusy(false);
    }
  }

  if (phase === "done" && booking) {
    return (
      <Card aria-labelledby="horarios-titulo">
        <h2 id="horarios-titulo" ref={titleRef} tabIndex={-1}>
          Horário confirmado
        </h2>
        <StatusBanner tone="success">
          {booking.service_name} · {formatDay(booking.slot.starts_at)} às <span className="tn-num">{formatTime(booking.slot.starts_at)}</span>.
          {api.demo ? " Demonstração: a reserva entrou só na Agenda desta aba." : null}
        </StatusBanner>
        <p className="tn-muted">
          Para remarcar ou cancelar, fale com o profissional. Tem login? Veja em <Link to="/app/conta/reservas">Minhas reservas</Link>.
        </p>
      </Card>
    );
  }

  if (services === null || services.length === 0) {
    return (
      <Card aria-labelledby="horarios-titulo">
        <h2 id="horarios-titulo">Agendar horário</h2>
        {services === null ? (
          <p role="status">Carregando…</p>
        ) : (
          <StatusBanner tone="info">
            Os horários on-line ainda não estão disponíveis para este perfil. Combine diretamente com o profissional.
          </StatusBanner>
        )}
      </Card>
    );
  }

  const step: StepPhase = phase === "done" ? "code" : phase;
  const title = STEPS.find((s) => s.phase === step)?.title;
  // Resumo da escolha, à vista do passo 2 em diante: "Corte · ter 20/10 · 10:00".
  const summary = [service?.name, shortDay(day), chosen ? formatTime(chosen) : null].filter(Boolean).join(" · ");
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(firstDay, i));

  return (
    <Card aria-labelledby="horarios-titulo">
      <StepIndicator phase={step} />
      <h2 id="horarios-titulo" ref={titleRef} tabIndex={-1}>
        {title}
      </h2>
      {step !== "service" ? (
        <p className="tn-net-summary">
          <span className="tn-visually-hidden">Sua escolha: </span>
          <span className="tn-num">{summary}</span>
        </p>
      ) : null}

      {step === "service" ? (
        <form
          className="tn-stack"
          aria-label="Escolher serviço"
          onSubmit={(e) => {
            e.preventDefault();
            go("slot");
          }}
        >
          <fieldset className="tn-net-choices">
            <legend className="tn-visually-hidden">Serviço</legend>
            {services.map((s) => (
              <ChoiceCard
                key={s.id}
                name="servico-link"
                value={s.id}
                checked={s.id === serviceId}
                onChange={() => {
                  if (s.id === serviceId) return;
                  setServiceId(s.id);
                  setChosen(null);
                  resetRequest();
                }}
                title={s.name}
                description={`${s.duration_min} min`}
              />
            ))}
          </fieldset>
          <div className="tn-actions">
            <Button type="submit">Escolher dia e hora</Button>
          </div>
        </form>
      ) : null}

      {step === "slot" ? (
        <div className="tn-stack">
          <fieldset className="tn-net-days-group">
            <legend>Dia</legend>
            <div className="tn-net-days" ref={daysRef}>
              {days.map((d) => {
                const [weekday, date] = shortDay(d).split(" ");
                return (
                  <label key={d} className="tn-net-day" data-selected={d === day || undefined}>
                    <input
                      type="radio"
                      name="dia-link"
                      value={d}
                      checked={d === day}
                      onChange={() => {
                        setDay(d);
                        setChosen(null);
                        resetRequest();
                      }}
                    />
                    <span>{weekday}</span> <span className="tn-num">{date}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
          {slots.kind === "loading" ? <p role="status">Carregando horários…</p> : null}
          {slots.kind === "error" ? <StatusBanner tone="warning">{slots.message}</StatusBanner> : null}
          {slots.kind === "ok" && slots.data.slots.length === 0 ? (
            <StatusBanner tone="info">Nenhum horário livre neste dia. Tente outro dia.</StatusBanner>
          ) : null}
          {slots.kind === "ok" && slots.data.slots.length > 0 ? (
            <ul className="tn-net-slots" aria-label="Horários livres">
              {slots.data.slots.map((s) => (
                <li key={s.starts_at}>
                  <button
                    type="button"
                    className="tn-num"
                    aria-pressed={chosen === s.starts_at}
                    onClick={() => {
                      if (chosen !== s.starts_at) {
                        setChosen(s.starts_at);
                        resetRequest();
                      }
                      // Escolher o horário leva direto aos dados: um toque a menos no celular.
                      go("contact");
                    }}
                  >
                    {formatTime(s.starts_at)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="tn-actions">
            <Button variant="secondary" onClick={() => go("service")}>
              Voltar
            </Button>
            {chosen ? <Button onClick={() => go("contact")}>Continuar</Button> : null}
          </div>
        </div>
      ) : null}

      {step === "contact" ? (
        <form
          className="tn-stack"
          aria-label="Pedir horário"
          ref={requestRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void requestSlot();
          }}
        >
          <p>Vamos mandar um código de 6 dígitos para o seu WhatsApp para confirmar. Seu número só vai para este profissional.</p>
          <Field
            label="Seu nome"
            autoComplete="name"
            maxLength={80}
            value={name}
            error={requestErrors.name}
            onChange={(e) => {
              setName(e.target.value);
              clearRequest("name");
              resetRequest();
            }}
          />
          <Field
            label="WhatsApp com DDD"
            type="tel"
            autoComplete="tel"
            placeholder="(11) 97777-4343"
            value={phone}
            error={requestErrors.phone}
            onChange={(e) => {
              setPhone(e.target.value);
              clearRequest("phone");
              resetRequest();
            }}
          />
          {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
          <div className="tn-actions">
            <Button variant="secondary" onClick={() => go("slot")}>
              Voltar
            </Button>
            <Button type="submit" loading={busy} loadingText="Pedindo…">
              Pedir este horário
            </Button>
          </div>
        </form>
      ) : null}

      {step === "code" && request ? (
        <div className="tn-stack">
          <StatusBanner tone="info">
            Enviamos um código de 6 dígitos para o seu WhatsApp <span className="tn-num">{request.phone}</span>. O horário fica
            guardado até as <span className="tn-num">{formatTime(request.data.expires_at)}</span>; depois disso, volta a ficar livre.
          </StatusBanner>
          {request.data.demoCode ? (
            <StatusBanner tone="warning">
              Demonstração: nenhuma mensagem é enviada. O código seria <span className="tn-num">{request.data.demoCode}</span>.
            </StatusBanner>
          ) : null}
          <form
            className="tn-stack"
            ref={codeRef}
            noValidate
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
              error={codeErrors.code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                clearCode("code");
              }}
            />
            {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
            <div className="tn-actions">
              {/* Voltar guarda o pedido: pedir de novo sem mudar nada usa a mesma chave e o mesmo horário guardado. */}
              <Button variant="secondary" onClick={() => go("contact")}>
                Voltar
              </Button>
              <Button type="submit" loading={busy} loadingText="Confirmando…">
                Confirmar horário
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

