// Perfil público do profissional + horários do link de reserva. Usado na página pública
// e na prévia do dono. Mostra só a projeção publicada: nada de CRM, contatos ou agenda alheia.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Card, ChoiceCard, Field, StatusBanner, toast, useFormErrors, whatsappHref } from "../../components/ui/index.tsx";
import { ApiError } from "../../lib/api/client.ts";
import { phoneToE164 } from "../../lib/phone.ts";
import { addDays, dayWindow, formatTime, localParts } from "../../lib/time.ts";
import type { BookConfirmed, BookRequest, NetworkApi, PublicProfileData, PublicService, RequestState, SlotsData } from "./api.ts";
import { buildIcs } from "./ics.ts";
import { BusinessHeader, businessOf } from "../../components/public/public-kit.tsx";
import { errorMessage, formatPhoneBr, newIdempotencyKey } from "./public/labels.ts";

/** Dia da demonstração (fixtures do piloto). Com servidor, o visitante escolhe a partir de hoje. */
const DEMO_DAY = "2026-10-20";
/**
 * Fuso usado só no primeiro pedido de horários, antes de o servidor dizer o do negócio. Toda resposta de horários e a
 * confirmação trazem o `timezone` do negócio (o cadastro oferece nove fusos); a janela do dia, o "hoje" e os horários
 * mostrados seguem esse fuso, nunca o do aparelho.
 */
const FIRST_GUESS_TZ = "America/Sao_Paulo";
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const todayIn = (timeZone: string) => localParts(new Date(), timeZone).date;
/** "terça-feira, 20/10" no fuso do negócio. */
const formatDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone }).format(new Date(iso));

/** Pedido que aguarda código (error.details de PENDING_REQUEST_EXISTS). Só id e prazo: o servidor não diz qual é. */
interface PendingSummary {
  request_id: string;
  expires_at: string;
}
function pendingSummary(e: unknown): PendingSummary | null {
  if (!(e instanceof ApiError) || e.code !== "PENDING_REQUEST_EXISTS" || !e.details) return null;
  const d = e.details;
  return typeof d.request_id === "string" && typeof d.expires_at === "string"
    ? { request_id: d.request_id, expires_at: d.expires_at }
    : null;
}
/** "R$ 60,00": preço "a partir de" dos serviços, quando o dono liga "Mostrar preços". */
export const formatPrice = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
/** Botão do WhatsApp do perfil: abre a conversa com o número do negócio e uma mensagem pronta (a pessoa envia). */
export const WHATSAPP_GREETING = "Olá! Vi seu perfil na Tinindo.";
export const whatsappLink = (e164: string) => `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(WHATSAPP_GREETING)}`;

/** Quantos dias a fileira de chips mostra a partir de hoje. */
export const DAYS_AHEAD = 14;
/** "ter 20/10": rótulo curto de um dia de calendário. */
export function shortDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return `${weekday} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/**
 * Aceita "(11) 97777-4343", "011 97777-4343", "11977774343" ou "+55 11 97777-4343"; devolve E.164 ou null.
 * Mesmo analisador de Clientes e da Agenda (src/lib/phone.ts).
 */
export function toE164(raw: string): string | null {
  return phoneToE164(raw) ?? null;
}

/** Mensagens do pedido e da confirmação, sem detalhes técnicos. */
function bookingError(e: unknown): string {
  if (!(e instanceof ApiError)) return "Falha inesperada. Tente novamente.";
  if (e.code === "SLOT_CONFLICT") return "Este horário acabou de ser reservado por outra pessoa. Escolha outro.";
  if (e.code === "QUOTA_EXCEEDED" && e.field === "resend_wait") return "Espere alguns segundos para pedir outro envio.";
  if (e.code === "QUOTA_EXCEEDED" && e.field === "resend") return "Já reenviamos o código o máximo de vezes. Se não chegou, fale com o profissional.";
  if (e.code === "QUOTA_EXCEEDED") return "Muitos pedidos em pouco tempo. Tente mais tarde ou fale direto com o profissional.";
  if (e.code === "POLICY_REJECTED" && e.field === "channel") {
    return "Este profissional ainda não recebe reservas on-line. Combine o horário diretamente com ele.";
  }
  if (e.code === "POLICY_REJECTED" && e.field === "code") {
    const left = typeof e.details?.attempts_left === "number" ? e.details.attempts_left : null;
    return `Código não confere. Use o último código que chegou no WhatsApp.${left != null ? ` ${left === 1 ? "Resta 1 tentativa." : `Restam ${left} tentativas.`}` : ""}`;
  }
  if (e.code === "POLICY_REJECTED" && e.field === "attempts") {
    return "Muitos códigos errados. Por segurança, o horário foi liberado. Escolha o horário de novo ou fale com o profissional.";
  }
  if (e.code === "VALIDATION_ERROR" && e.field === "neighborhood") return "Informe o bairro onde vai ser o atendimento.";
  if (e.code === "POLICY_REJECTED" && e.field === "expires_at") return "O prazo para confirmar venceu e o horário foi liberado. Escolha de novo.";
  if (e.code === "VALIDATION_ERROR" && e.field?.startsWith("contact")) return "Confira o nome e o WhatsApp com DDD.";
  return errorMessage(e);
}

/** Âncora da reserva no perfil: o "Ver horários" do diretório e o link antigo do site (/s) levam até ela. */
export const BOOKING_ANCHOR = "agendar";

/** O que o site publicado (P17) acrescenta ao perfil: frase, serviços com preço e horários de atendimento (D19). */
export interface ProfileSiteExtras {
  headline: string | null;
  services: { name: string; duration_min: number; price_cents: number | null }[];
  hours: { weekday: number; start: string; end: string }[];
  timezone: string;
}

const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
/** "Hoje: 09:00–18:00" ou "Hoje: fechado", no fuso do negócio. */
export function todayHours(hours: ProfileSiteExtras["hours"], timeZone: string, now = new Date()): string {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
  const today = hours.filter((h) => h.weekday === weekday);
  return today.length ? `Hoje: ${today.map((h) => `${h.start}–${h.end}`).join(" e ")}` : "Hoje: fechado";
}

/**
 * Perfil público: o negócio no topo (D18), a reserva logo abaixo e, depois, o que o site publicado acrescenta.
 * `as="main"` na página pública (a moldura é do chamador); `as="div"` na prévia do dono, dentro do shell.
 */
export function PublicProfileView({ profile, api, site = null, as: Tag = "div" }: {
  profile: PublicProfileData;
  api: NetworkApi;
  site?: ProfileSiteExtras | null;
  as?: "main" | "div";
}) {
  const business = businessOf(profile);
  const name = business.name;
  const booking = !!profile.fields.booking_link;
  // Do passo 2 em diante o cabeçalho recolhe e o resto da página sai da frente (auditoria 14, achado 07).
  const [reserving, setReserving] = useState(false);
  const reviews = profile.reputation.reviews_count;
  const about = [site?.headline, profile.fields.bio, profile.fields.services_summary].filter((t): t is string => !!t);
  return (
    <>
      <BusinessHeader business={business} nameAs="h1" compact={reserving} />
      <Tag className="tn-pub-main tn-pub__col" id={Tag === "main" ? "conteudo" : undefined}>
        {reserving ? null : (
          <>
            {/* Só selos positivos (BRAND.md, Reputação): o que falta não vira selo. Sem "Tinindo garante". */}
            <ul className="tn-net-badges" aria-label="Reputação">
              {profile.reputation.identity_verified ? <li>Identidade verificada</li> : null}
              <li>
                {reviews === 0 ? (
                  "Perfil novo · ainda sem avaliações"
                ) : (
                  <Link to={`/avaliacoes/${profile.slug}`}>{reviews === 1 ? "1 avaliação de cliente" : `${reviews} avaliações de clientes`}</Link>
                )}
              </li>
            </ul>
            {/* Linha de fatos: só o que existe. */}
            <ul className="tn-net-badges" aria-label="Informações">
              {profile.details?.address ? (
                <li>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.details.address)}`} target="_blank" rel="noopener noreferrer">
                    {profile.details.address}
                  </a>
                </li>
              ) : profile.details?.home_service ? (
                <li>Atende em domicílio</li>
              ) : null}
              {profile.details?.opening_hours ? <li>{profile.details.opening_hours}</li> : site?.hours.length ? <li>{todayHours(site.hours, site.timezone)}</li> : null}
              <li>Pagamento direto ao profissional</li>
            </ul>
            {about.length ? (
              <div className="tn-net-about">
                {about.map((t) => (
                  <p key={t}>{t}</p>
                ))}
              </div>
            ) : null}
          </>
        )}
        {booking ? (
          <div id={BOOKING_ANCHOR} className="tn-net-booking">
            <BookingSlots slug={profile.slug} api={api} professional={name} whatsapp={profile.whatsapp_e164 ?? null} details={profile.details ?? null} onReserving={setReserving} />
          </div>
        ) : null}
        {reserving ? null : (
          <>
            {profile.whatsapp_e164 ? (
              booking ? (
                <p className="tn-net-wa">
                  Prefere combinar por mensagem?{" "}
                  <a href={whatsappLink(profile.whatsapp_e164)} target="_blank" rel="noopener noreferrer">
                    Conversar no WhatsApp
                  </a>
                </p>
              ) : (
                <div className="tn-pub-cta" data-inline>
                  <a className="tn-button" data-variant="primary" href={whatsappLink(profile.whatsapp_e164)} target="_blank" rel="noopener noreferrer">
                    Conversar no WhatsApp
                  </a>
                </div>
              )
            ) : null}
            {/* Com a reserva ligada, os serviços já estão no passo 1; sem ela, a lista do site aparece aqui. */}
            {site?.services.length && !booking ? (
              <section aria-labelledby="perfil-servicos">
                <h2 id="perfil-servicos">Serviços</h2>
                <ul className="tn-net-list">
                  {site.services.map((s) => (
                    <li key={s.name}>
                      <span>
                        {s.name} <small className="tn-muted">{s.duration_min} min</small>
                      </span>
                      {s.price_cents != null ? <strong className="tn-num">{formatPrice(s.price_cents)}</strong> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {site?.hours.length ? (
              <details className="tn-net-hours">
                <summary>Horários de atendimento</summary>
                <ul className="tn-net-list">
                  {site.hours.map((h) => (
                    <li key={`${h.weekday}-${h.start}`}>
                      <span>{WEEKDAY[h.weekday]}</span>
                      <span className="tn-num">
                        {h.start}–{h.end}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {profile.details?.cancellation_policy ? <p className="tn-net-policy"><strong>Cancelamento:</strong> {profile.details.cancellation_policy}</p> : null}
            <p className="tn-muted tn-net-legal">
              Informações publicadas pelo próprio profissional. A Tinindo não garante habilidade nem resultado.
            </p>
          </>
        )}
      </Tag>
    </>
  );
}

/** Mensagem pronta para falar com o profissional depois de reservar. Só o que a própria pessoa marcou. */
export function bookedMessage(service: string, startsAt: string, timeZone: string): string {
  return `Olá! Marquei ${service} para ${formatDay(startsAt, timeZone)} às ${formatTime(startsAt, timeZone)} pelo seu perfil na Tinindo.`;
}

const placeOf = (d: PublicProfileData["details"] | null | undefined): PlaceData =>
  d?.address ? { kind: "address", text: d.address } : d?.home_service ? { kind: "home" } : null;
type PlaceData = { kind: "address"; text: string } | { kind: "home" } | null;

/** Serviço, preço, local e política: o que a pessoa confirma (D23). Só o que existe aparece. */
export function BookingFacts({ price, priceFrom = false, place, policy, duration }: {
  price: number | null;
  priceFrom?: boolean;
  place: PlaceData;
  policy: string | null;
  duration: number | null;
}) {
  if (price == null && !place && !policy && duration == null) return null;
  return (
    <dl className="tn-pub-facts tn-net-facts" aria-label="O que você está pedindo">
      {duration != null ? (
        <div><dt>Duração</dt><dd className="tn-num">{duration} min</dd></div>
      ) : null}
      {price != null ? (
        <div><dt>Preço</dt><dd className="tn-num">{priceFrom ? "a partir de " : ""}{formatPrice(price)} · pago direto ao profissional</dd></div>
      ) : null}
      {place ? (
        <div><dt>Onde</dt><dd>{place.kind === "address" ? place.text : "Em domicílio (o profissional vai até você)"}</dd></div>
      ) : null}
      {policy ? (
        <div><dt>Cancelamento</dt><dd>{policy}</dd></div>
      ) : null}
    </dl>
  );
}

/** Situação do envio do código, em palavras. "Enviado" não quer dizer "entregue". */
function DeliveryNotice({ delivery, phone, professional }: { delivery: BookRequest["delivery"]; phone: string; professional: string }) {
  if (delivery === "failed") {
    return (
      <StatusBanner tone="danger">
        Não conseguimos enviar o código para <span className="tn-num">{phone}</span>. Confira o número (Corrigir) ou fale com {professional}.
      </StatusBanner>
    );
  }
  if (delivery === "queued" || delivery === "sending") {
    return <StatusBanner tone="info">Enviando o código de 6 dígitos para o seu WhatsApp <span className="tn-num">{phone}</span>…</StatusBanner>;
  }
  if (delivery === "delivery_unknown") {
    return <StatusBanner tone="warning">Mandamos o código para <span className="tn-num">{phone}</span>, mas o WhatsApp ainda não confirmou a entrega.</StatusBanner>;
  }
  return <StatusBanner tone="info">Mandamos um código de 6 dígitos para o seu WhatsApp <span className="tn-num">{phone}</span>.</StatusBanner>;
}

/** Baixa o .ics da reserva (gerado aqui no navegador; nada vai para o servidor). */
function downloadIcs(filename: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

function BookingSlots({ slug, api, professional, whatsapp, details, onReserving }: {
  slug: string;
  api: NetworkApi;
  professional: string;
  whatsapp: string | null;
  /** P55 (D21): local e política do perfil; com `home_service`, o pedido pergunta o bairro. */
  details: PublicProfileData["details"] | null;
  /** true do passo 2 até antes da confirmação: a página recolhe o cabeçalho e esconde o resto. */
  onReserving?: (on: boolean) => void;
}) {
  const [services, setServices] = useState<PublicService[] | null>(null);
  const [serviceId, setServiceId] = useState<string>("");
  // Fuso do negócio, informado pelo servidor em cada resposta de horários.
  const [zone, setZone] = useState<string>(FIRST_GUESS_TZ);
  const [firstDay, setFirstDay] = useState<string>(() => (api.demo ? DEMO_DAY : todayIn(FIRST_GUESS_TZ)));
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
  // O mesmo WhatsApp já tem pedido aguardando código: a pessoa escolhe trocar ou manter.
  const [pending, setPending] = useState<PendingSummary | null>(null);
  // Mantido o anterior (pedido de outra aba ou de antes): o resumo mostra ele, não a escolha nova.
  const [kept, setKept] = useState<PendingSummary | null>(null);
  const [booking, setBooking] = useState<BookConfirmed | null>(null);
  const [code, setCode] = useState("");
  const [hood, setHood] = useState("");
  // Estado real do envio do código (P55): atualizado enquanto está na fila ou sendo enviado.
  const [sendState, setSendState] = useState<RequestState | null>(null);
  const [resending, setResending] = useState(false);
  // Relógio da tela (para o "Reenviar código em N s"): atualizado por timer, não lido durante a renderização.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { formRef: requestRef, errors: requestErrors, show: showRequest, clear: clearRequest } = useFormErrors<"name" | "phone" | "hood">();
  const { formRef: codeRef, errors: codeErrors, show: showCode, clear: clearCode } = useFormErrors<"code">();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  // "Corrigir" o número: ao voltar para os dados, o foco vai direto para o WhatsApp.
  const fixPhone = useRef(false);
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
    if (phase === "contact" && fixPhone.current) {
      fixPhone.current = false;
      phoneRef.current?.focus();
      phoneRef.current?.select();
    } else titleRef.current?.focus();
    if (phase === "slot") {
      daysRef.current?.querySelector("input:checked")?.closest("label")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [phase]);

  const inFlow = phase === "slot" || phase === "contact" || phase === "code";
  useEffect(() => {
    onReserving?.(inFlow);
  }, [inFlow, onReserving]);

  // Chegou pelo "Ver horários" do diretório (/p/slug#agendar): depois de carregar, mostra a reserva.
  const loaded = services !== null;
  useEffect(() => {
    if (loaded && window.location.hash === `#${BOOKING_ANCHOR}`) document.getElementById(BOOKING_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [loaded]);

  const slotsKey = `${serviceId}|${day}|${zone}|${reload}`;
  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    api
      .publicSlots(slug, serviceId, dayWindow(day, zone))
      .then((data) => {
        if (cancelled) return;
        if (data.timezone !== zone && isTimeZone(data.timezone)) {
          // O negócio está em outro fuso: pede de novo a janela do dia local dele (e "hoje" passa a ser o dia de lá).
          if (!api.demo) {
            const today = todayIn(data.timezone);
            setFirstDay(today);
            setDay((d) => (d === firstDay ? today : d));
          }
          setZone(data.timezone);
          return;
        }
        setResult({ key: slotsKey, kind: "ok", data });
      })
      .catch((e: unknown) => !cancelled && setResult({ key: slotsKey, kind: "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [api, slug, serviceId, day, zone, firstDay, slotsKey]);

  // Resultado de outra escolha ainda na tela = carregando a atual.
  const slots = result && result.key === slotsKey ? result : { kind: "loading" as const };
  const e164 = toE164(phone);
  const service = services?.find((s) => s.id === serviceId);
  const resetRequest = () => {
    setBookKey(null);
    setProblem(null);
    setPending(null);
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
    setPending(null);
    setKept(null);
    setReload((n) => n + 1);
    setPhase("slot");
    setProblem(message);
  };

  async function requestSlot(replaceExisting = false) {
    const ok = showRequest({
      name: name.trim() ? null : "Informe seu nome.",
      phone: !phone.trim() ? "Informe seu WhatsApp com DDD." : e164 ? null : "Use o número com DDD, por exemplo (11) 97777-4343.",
      hood: !details?.home_service || hood.trim().length >= 2 ? null : "Informe o bairro onde vai ser o atendimento.",
    });
    if (!chosen || !ok || !e164) return;
    // "Corrigir o número" (05 #2): o pedido anterior desta tela é liberado no mesmo pedido, sem concorrer consigo mesmo.
    // Só quando o número mudou: com o mesmo número, o aviso "Já existe um pedido…" pergunta se troca (decisão do P43).
    const supersedes = !bookKey && request && !kept && request.phone !== e164 ? request.data.request_id : undefined;
    const key = bookKey ?? newIdempotencyKey();
    setBookKey(key);
    setBusy(true);
    setProblem(null);
    try {
      const data = await api.book(
        {
          slug, service_id: serviceId, starts_at: chosen, contact: { name: name.trim(), phone_e164: e164 }, replace_existing: replaceExisting,
          ...(supersedes ? { supersedes_request_id: supersedes } : {}),
          ...(details?.home_service ? { neighborhood: hood.trim() } : {}),
        },
        key,
      );
      setRequest({ data, phone: e164 });
      setNowMs(Date.now());
      setSendState(data.attempts_left != null && data.resend_available_at ? {
        request_id: data.request_id, status: "pending", delivery: data.delivery, expires_at: data.expires_at,
        attempts_left: data.attempts_left, resends_left: data.resends_left ?? 0, resend_available_at: data.resend_available_at,
      } : null);
      setPending(null);
      setKept(null);
      setCode("");
      setPhase("code");
    } catch (e) {
      const summary = pendingSummary(e);
      if (summary) setPending(summary);
      else if (e instanceof ApiError && e.code === "SLOT_CONFLICT") backToSlots(bookingError(e));
      else setProblem(bookingError(e));
    } finally {
      setBusy(false);
    }
  }

  /** "Manter o anterior": segue para o código do pedido que já existe; o novo não é pedido. */
  function keepPrevious() {
    if (!pending || !e164) return;
    if (request?.data.request_id !== pending.request_id) {
      setRequest({
        data: { request_id: pending.request_id, slot: { starts_at: pending.expires_at, ends_at: pending.expires_at }, expires_at: pending.expires_at, delivery: "sent" },
        phone: e164,
      });
    }
    setKept(pending);
    setPending(null);
    setBookKey(null);
    setCode("");
    go("code");
  }

  async function confirmCode() {
    if (!request) return;
    if (!showCode({ code: /^\d{6}$/.test(code) ? null : "Digite os 6 números do código." })) {
      setProblem(null);
      return;
    }
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

  // Estado do envio (05 #3): enquanto está na fila ou sendo enviado, consulta a cada 4 s (só com servidor).
  const requestId = request?.data.request_id ?? null;
  const delivering = phase === "code" && !kept && (sendState?.delivery === "queued" || sendState?.delivery === "sending");
  useEffect(() => {
    if (!delivering || !requestId || api.demo) return;
    const t = setInterval(() => {
      api.requestState(requestId).then(setSendState, () => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [delivering, requestId, api]);
  // Relógio do botão "Reenviar código" (libera depois de 30 s).
  const waitMs = sendState ? Date.parse(sendState.resend_available_at) - nowMs : 0;
  useEffect(() => {
    if (phase !== "code" || waitMs <= 0) return;
    const t = setTimeout(() => setNowMs(Date.now()), Math.min(waitMs, 1000));
    return () => clearTimeout(t);
  }, [phase, waitMs]);

  async function resend() {
    if (!request) return;
    setResending(true);
    setProblem(null);
    try {
      setSendState(await api.resendCode(request.data.request_id, newIdempotencyKey()));
      setNowMs(Date.now());
      toast("Pedimos um novo envio do mesmo código.");
    } catch (e) {
      setProblem(bookingError(e));
    } finally {
      setResending(false);
    }
  }

  if (phase === "done" && booking) {
    return (
      <Card aria-labelledby="horarios-titulo">
        <h2 id="horarios-titulo" ref={titleRef} tabIndex={-1}>
          Horário confirmado
        </h2>
        <StatusBanner tone="success">
          {booking.service_name} · {formatDay(booking.slot.starts_at, booking.timezone)} às <span className="tn-num">{formatTime(booking.slot.starts_at, booking.timezone)}</span>.
          {api.demo ? " Demonstração: a reserva entrou só na Agenda desta aba." : null}
        </StatusBanner>
        <BookingFacts price={booking.price_cents ?? null} place={booking.place ?? null} policy={booking.policy ?? null} duration={booking.duration_min ?? null} />
        <div className="tn-actions">
          <Button
            variant="secondary"
            onClick={() => {
              downloadIcs(
                `horario-${slug}.ics`,
                buildIcs({
                  uid: `${request?.data.request_id ?? newIdempotencyKey()}@tinindo`,
                  starts_at: booking.slot.starts_at,
                  ends_at: booking.slot.ends_at,
                  summary: `${booking.service_name} · ${professional}`,
                  description: "Horário confirmado pelo link da Tinindo. Para remarcar ou cancelar, fale com o profissional.",
                  url: booking.booking_token ? `${window.location.origin}/reserva/${slug}#t=${booking.booking_token}` : `${window.location.origin}/p/${slug}`,
                  ...(booking.place?.kind === "address" ? { location: booking.place.text } : {}),
                }),
              );
              toast("Arquivo da agenda baixado. Abra para salvar no seu calendário.");
            }}
          >
            Adicionar à agenda
          </Button>
          {whatsapp ? (
            <a
              className="tn-button"
              data-variant="secondary"
              href={whatsappHref(whatsapp, bookedMessage(booking.service_name, booking.slot.starts_at, booking.timezone))}
              target="_blank"
              rel="noopener noreferrer"
            >
              Falar com {professional} no WhatsApp
            </a>
          ) : null}
        </div>
        {/* D20: sem conta. O link da reserva serve para ver o horário e, depois do atendimento, avaliar. */}
        {booking.booking_token ? (
          <p>
            <Link to={`/reserva/${slug}#t=${booking.booking_token}`}>Ver minha reserva</Link>{" "}
            <span className="tn-muted">· guarde este link para avaliar depois do atendimento.</span>
          </p>
        ) : null}
        <p className="tn-muted">
          Para remarcar ou cancelar, fale com {professional}{whatsapp ? " pelo WhatsApp" : ""}.
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
  const summary = kept && step === "code"
    ? "Seu pedido anterior: o serviço e o horário estão na mensagem com o código"
    : [service?.name, shortDay(day), chosen ? formatTime(chosen, zone) : null].filter(Boolean).join(" · ");
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
                description={
                  s.price_from_cents != null ? `${s.duration_min} min · a partir de ${formatPrice(s.price_from_cents)}` : `${s.duration_min} min`
                }
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
                    {formatTime(s.starts_at, zone)}
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
          {/* D23: o que vai ser confirmado, com preço, local e política, antes de pedir. */}
          <BookingFacts price={service?.price_from_cents ?? null} priceFrom place={placeOf(details)} policy={details?.cancellation_policy ?? null} duration={service?.duration_min ?? null} />
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
            ref={phoneRef}
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
          {details?.home_service ? (
            <Field
              label="Bairro do atendimento"
              hint="O profissional atende em domicílio. O endereço completo você combina com ele."
              autoComplete="address-level3"
              maxLength={80}
              value={hood}
              error={requestErrors.hood}
              onChange={(e) => {
                setHood(e.target.value);
                clearRequest("hood");
                resetRequest();
              }}
            />
          ) : null}
          {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
          {pending ? (
            <div className="tn-stack" data-gap="sm" role="alert">
              <StatusBanner tone="warning">
                Já existe um pedido aguardando confirmação para este WhatsApp. Se continuar, ele será trocado por este.
              </StatusBanner>
              <div className="tn-actions">
                <Button variant="secondary" onClick={keepPrevious}>
                  Manter o anterior
                </Button>
                <Button loading={busy} loadingText="Trocando…" onClick={() => void requestSlot(true)}>
                  Trocar pelo novo
                </Button>
              </div>
            </div>
          ) : (
            <div className="tn-actions">
              <Button variant="secondary" onClick={() => go("slot")}>
                Voltar
              </Button>
              <Button type="submit" loading={busy} loadingText="Pedindo…">
                Pedir este horário
              </Button>
            </div>
          )}
        </form>
      ) : null}

      {step === "code" && request ? (
        <div className="tn-stack">
          {request.data.replaced ? (
            <StatusBanner tone="success">
              Seu pedido anterior foi cancelado e substituído por este.
            </StatusBanner>
          ) : null}
          {/* D23: antes de digitar o código, o que vai ser confirmado (o preço é o que o servidor congela). */}
          {kept ? null : (
            <BookingFacts price={request.data.price_cents ?? null} place={request.data.place ?? placeOf(details)}
              policy={request.data.policy ?? details?.cancellation_policy ?? null} duration={request.data.duration_min ?? null} />
          )}
          {/* 05 #3: o texto acompanha o estado real do envio. */}
          <DeliveryNotice delivery={kept ? "sent" : (sendState?.delivery ?? request.data.delivery)} phone={formatPhoneBr(request.phone)} professional={professional} />
          <p className="tn-muted">
            Guardamos este horário até as <span className="tn-num">{formatTime(request.data.expires_at, zone)}</span>. Confirme com o
            código antes disso.
          </p>
          {sendState && !kept && sendState.status === "pending" ? (
            <p className="tn-net-fix">
              Não recebeu?{" "}
              {sendState.resends_left > 0 ? (
                <button type="button" className="tn-net-linkbutton" disabled={resending || waitMs > 0} onClick={() => void resend()}>
                  {waitMs > 0 ? `Reenviar código (em ${Math.ceil(waitMs / 1000)} s)` : "Reenviar código"}
                </button>
              ) : (
                <span className="tn-muted">Já reenviamos o máximo de vezes.</span>
              )}
              {whatsapp ? (
                <>
                  {" "}·{" "}
                  <a href={whatsappHref(whatsapp, "Olá! Pedi um horário pelo seu link e o código não chegou.")} target="_blank" rel="noopener noreferrer">
                    Falar com {professional}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {/* Corrigir volta aos dados com serviço, dia e hora mantidos (E10). */}
          <p className="tn-net-fix">
            Número errado?{" "}
            <button
              type="button"
              className="tn-net-linkbutton"
              aria-label="Corrigir o número"
              onClick={() => {
                fixPhone.current = true;
                go("contact");
              }}
            >
              Corrigir
            </button>
          </p>
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

