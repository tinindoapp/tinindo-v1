// Perfil público do profissional + horários do link de reserva. Usado na página pública
// e na prévia do dono. Mostra só a projeção publicada: nada de CRM, contatos ou agenda alheia.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, StatusBanner } from "../../components/ui/index.tsx";
import type { NetworkApi, PublicProfileData, PublicService, SlotsData } from "./api.ts";
import { CATEGORY_LABEL, errorMessage, formatTime } from "./useNetworkApi.ts";

const DEMO_WINDOW = { starts_at: "2026-10-20T09:00:00-03:00", ends_at: "2026-10-20T18:00:00-03:00" };

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
          Já foi atendido aqui? <Link to="/avaliar">Avaliar meu atendimento</Link>
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

type SlotsState = { serviceId: string } & ({ kind: "ok"; data: SlotsData } | { kind: "error"; message: string });

function BookingSlots({ slug, api }: { slug: string; api: NetworkApi }) {
  const [services, setServices] = useState<PublicService[] | null>(null);
  const [serviceId, setServiceId] = useState<string>("");
  const [result, setResult] = useState<SlotsState | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.publicServices(slug).then((list) => {
      if (cancelled) return;
      setServices(list);
      setServiceId(list[0]?.id ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [api, slug]);

  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    api
      .publicSlots(slug, serviceId, DEMO_WINDOW)
      .then((data) => !cancelled && setResult({ serviceId, kind: "ok", data }))
      .catch((e: unknown) => !cancelled && setResult({ serviceId, kind: "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [api, slug, serviceId]);

  // Resultado de outro serviço ainda na tela = carregando o serviço atual.
  const slots = result && result.serviceId === serviceId ? result : { kind: "loading" as const };

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
              }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.duration_min} min
                </option>
              ))}
            </select>
          </div>
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
                    onClick={() => setChosen(s.starts_at)}
                  >
                    <span className="tn-num">{formatTime(s.starts_at)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {chosen ? (
            <StatusBanner tone="info">
              {/* Reserva pelo link ainda não existe (sem public.book; docs/handoffs/P10): nada é criado nem simulado. */}
              Horário das <span className="tn-num">{formatTime(chosen)}</span> selecionado, mas nada foi reservado: a
              reserva on-line ainda não está disponível. Combine este horário diretamente com o profissional.
            </StatusBanner>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
