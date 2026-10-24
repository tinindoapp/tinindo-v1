// Tela do dono: onboarding progressivo, perfil público opt-in e convite de colega.
// Convite de colega é atribuição de aquisição: não gera avaliação, nota nem posição em ranking.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { Profession, PublicProfileField as PublicProfileFieldSchema } from "@contracts";
import type { z } from "zod";
import { Button, Card, Field, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import type { NetworkApi, OwnerProfile, ReferralLinkData, ReferralSummary } from "./api.ts";
import { ShareLink } from "./ShareLink.tsx";
import { CATEGORY_LABEL, errorMessage, formatDateTime, newIdempotencyKey, useNetworkApi } from "./useNetworkApi.ts";
import "./network.css";

type PublicProfileField = z.infer<typeof PublicProfileFieldSchema>;

/** Campos que o profissional pode publicar hoje. Bio e resumo de serviços aguardam contrato. */
const SELECTABLE: { field: PublicProfileField; label: string }[] = [
  { field: "display_name", label: "Nome do negócio" },
  { field: "booking_link", label: "Link para ver horários" },
];

export function NetworkHome() {
  const api = useNetworkApi();
  const [profile, setProfile] = useState<OwnerProfile | null | undefined>(undefined);
  const [referrals, setReferrals] = useState<ReferralSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([api.getOwnProfile(), api.listReferrals()]).then(
        ([p, r]) => {
          setProfile(p);
          setReferrals(r);
          setLoadError(null);
        },
        (e: unknown) => {
          setLoadError(errorMessage(e));
          setProfile(null);
        },
      ),
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getOwnProfile(), api.listReferrals()]).then(
      ([p, r]) => {
        if (cancelled) return;
        setProfile(p);
        setReferrals(r);
      },
      (e: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(e));
        setProfile(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const published = !!profile?.published_at;
  const bookingOn = published && !!profile?.public_fields.includes("booking_link");
  const invited = referrals.some((r) => r.kind === "professional_invites_peer");

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="perfil-titulo" title="Seu perfil público" eyebrow="Perfil e convites" />
        <p>
          Você decide o que aparece. Clientes, telefones, valores combinados e sua agenda nunca entram no perfil.
        </p>
        {api.demo ? (
          <StatusBanner tone="info">Demonstração: nada é salvo e nenhum link funciona fora desta aba.</StatusBanner>
        ) : null}
        {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
        <Onboarding published={published} bookingOn={bookingOn} invited={invited} />
      </div>
      {profile !== undefined ? <ProfileEditor api={api} profile={profile} onSaved={reload} /> : <p role="status">Carregando…</p>}
      {published ? <InvitePeer api={api} referrals={referrals} onCreated={reload} /> : null}
    </div>
  );
}

function Onboarding({ published, bookingOn, invited }: { published: boolean; bookingOn: boolean; invited: boolean }) {
  // Progressivo: o convite a colega só aparece depois do primeiro valor (perfil no ar).
  const steps = [
    { done: published, label: "Publicar seu perfil" },
    { done: bookingOn, label: "Mostrar o link de horários no perfil" },
    ...(published ? [{ done: invited, label: "Convidar um colega (opcional)" }] : []),
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <section aria-labelledby="passos-titulo" className="tn-net-steps">
      <h2 id="passos-titulo">
        Primeiros passos <span className="tn-num tn-net-muted">· {doneCount} de {steps.length}</span>
      </h2>
      <ol>
        {steps.map((s) => (
          <li key={s.label} data-done={s.done}>
            <span aria-hidden="true" className="tn-net-check">
              {s.done ? "✓" : ""}
            </span>
            <span>
              {s.label}
              <span className="tn-visually-hidden">{s.done ? " (feito)" : " (pendente)"}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function ProfileEditor({ api, profile, onSaved }: { api: NetworkApi; profile: OwnerProfile | null; onSaved: () => Promise<void> }) {
  const [slug, setSlug] = useState(profile?.slug ?? "");
  const [category, setCategory] = useState<Profession>(profile?.category ?? "barber");
  const [area, setArea] = useState(profile?.area ?? "");
  const [fields, setFields] = useState<PublicProfileField[]>(
    profile?.public_fields.filter((f) => f !== "area" && f !== "category") ?? ["display_name", "booking_link"],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  // Mesma chave enquanto o formulário não muda: um retry não publica duas vezes.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  const touch = () => setIdemKey(newIdempotencyKey());
  const slugValid = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug);

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!slugValid || !area.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.publishProfile({ slug, category, area: area.trim(), public_fields: ["area", ...fields] }, idemKey);
      setMessage({ tone: "success", text: "Perfil publicado." });
      touch();
      await onSaved();
    } catch (err) {
      setMessage({ tone: "danger", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    setMessage(null);
    try {
      await api.unpublishProfile(newIdempotencyKey());
      setMessage({ tone: "success", text: "Perfil removido do ar. Ninguém mais o encontra pelo link." });
      await onSaved();
    } catch (err) {
      setMessage({ tone: "danger", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-labelledby="editor-titulo">
      <h2 id="editor-titulo">{profile?.published_at ? "Perfil no ar" : "Montar perfil"}</h2>
      {profile?.published_at ? (
        <p>
          Publicado em <span className="tn-num">{formatDateTime(profile.published_at)}</span> ·{" "}
          <Link to="previa">Ver como o cliente vê</Link> · <Link to={`/p/${profile.slug}`}>Abrir perfil público</Link>
        </p>
      ) : null}
      <form className="tn-stack" onSubmit={publish}>
        <Field
          label="Endereço do perfil"
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            touch();
          }}
          placeholder="ex.: barbearia-do-centro"
          error={slug && !slugValid ? "Use de 3 a 50 letras minúsculas, números ou hífen." : undefined}
          required
        />
        <div className="tn-field">
          <label htmlFor="categoria">Categoria</label>
          <select
            id="categoria"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as Profession);
              touch();
            }}
          >
            {(Object.keys(CATEGORY_LABEL) as Profession[]).map((p) => (
              <option key={p} value={p}>
                {CATEGORY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Bairro ou região"
          value={area}
          maxLength={80}
          onChange={(e) => {
            setArea(e.target.value);
            touch();
          }}
          placeholder="ex.: Centro, Campinas"
          required
        />
        <fieldset className="tn-net-fieldset">
          <legend>O que aparece no perfil</legend>
          {SELECTABLE.map(({ field, label }) => (
            <label key={field} className="tn-net-check-row">
              <input
                type="checkbox"
                checked={fields.includes(field)}
                onChange={(e) => {
                  setFields((cur) => (e.target.checked ? [...cur, field] : cur.filter((f) => f !== field)));
                  touch();
                }}
              />
              {label}
            </label>
          ))}
          <p className="tn-net-muted tn-net-small">
            Categoria e região sempre aparecem no perfil publicado. Não use endereço residencial nem telefone pessoal.
          </p>
        </fieldset>
        {message ? <StatusBanner tone={message.tone}>{message.text}</StatusBanner> : null}
        <div className="tn-net-actions">
          <Button type="submit" disabled={busy || !slugValid || !area.trim()}>
            {profile?.published_at ? "Atualizar perfil" : "Publicar perfil"}
          </Button>
          {profile?.published_at ? (
            <Button variant="secondary" onClick={() => void unpublish()} disabled={busy}>
              Tirar do ar
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

const STATE_LABEL: Record<ReferralSummary["state"], string> = {
  pending: "Aguardando",
  claimed: "Aceito",
  expired: "Vencido",
  revoked: "Cancelado",
};

function InvitePeer({ api, referrals, onCreated }: { api: NetworkApi; referrals: ReferralSummary[]; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Profession | "">("");
  const [link, setLink] = useState<ReferralLinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createReferral(
        { kind: "professional_invites_peer", invitee_name: name.trim(), invitee_category: category || undefined, origin: "web" },
        idemKey,
      );
      setLink(created);
      setName("");
      setIdemKey(newIdempotencyKey());
      await onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const peers = referrals.filter((r) => r.kind === "professional_invites_peer");
  return (
    <Card aria-labelledby="convite-titulo">
      <h2 id="convite-titulo">Convidar um colega</h2>
      <p>
        Gere um link pessoal e envie você mesmo. A Tinindo não manda mensagem para ninguém. O convite não é avaliação e
        não muda a posição de nenhum perfil.
      </p>
      <form className="tn-stack" onSubmit={create}>
        <Field
          label="Nome do colega (só você vê)"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setIdemKey(newIdempotencyKey());
          }}
          required
        />
        <div className="tn-field">
          <label htmlFor="categoria-colega">Categoria (opcional)</label>
          <select id="categoria-colega" value={category} onChange={(e) => setCategory(e.target.value as Profession | "")}>
            <option value="">Não informar</option>
            {(Object.keys(CATEGORY_LABEL) as Profession[]).map((p) => (
              <option key={p} value={p}>
                {CATEGORY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <div className="tn-net-actions">
          <Button type="submit" disabled={busy || !name.trim()}>
            Gerar link de convite
          </Button>
        </div>
      </form>
      {link ? <ShareLink link={link} demo={api.demo} /> : null}
      {peers.length > 0 ? (
        <section aria-labelledby="enviados-titulo">
          <h3 id="enviados-titulo">Convites gerados</h3>
          <ul className="tn-net-list">
            {peers.map((r) => (
              <li key={r.referral_id}>
                <span>{r.invitee_name}</span>
                <span className="tn-net-muted">{STATE_LABEL[r.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
