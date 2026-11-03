// Tela do dono: onboarding progressivo, perfil público opt-in e convite de colega.
// Convite de colega é atribuição de aquisição: não gera avaliação, nota nem posição em ranking.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { Profession, PublicProfileField as PublicProfileFieldSchema } from "@contracts";
import type { z } from "zod";
import { Button, Card, ChoiceCard, Field, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import type { BusinessBasics, NetworkApi, OwnerProfile, ReferralLinkData, ReferralSummary } from "./api.ts";
import { ProfileMediaEditor } from "./ProfileMedia.tsx";
import { ShareActions, ShareLink } from "./ShareLink.tsx";
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
  // Nome e profissão dados ao criar o negócio (E9): sugerem o endereço e a categoria, sem perguntar de novo.
  const [business, setBusiness] = useState<BusinessBasics | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api.getBusiness().then(
      (b) => !cancelled && setBusiness(b),
      () => !cancelled && setBusiness(null),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

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
      </div>
      {/* Os primeiros passos do negócio ficam numa lista só, em Conta (E9); aqui, só o perfil. */}
      {profile !== undefined && business !== undefined ? (
        <ProfileEditor api={api} profile={profile} business={business} onSaved={reload} />
      ) : (
        <p role="status">Carregando…</p>
      )}
      {/* Depois de salvar, a versão muda e o formulário recomeça do que está gravado. */}
      {profile ? <ProfileMediaEditor key={profile.version} api={api} profile={profile} onSaved={reload} /> : null}
      {published && profile ? <ProfileLive slug={profile.slug} bookingOn={bookingOn} demo={api.demo} /> : null}
      {published ? <InvitePeer api={api} referrals={referrals} onCreated={reload} /> : null}
    </div>
  );
}

/** Depois de publicar: o endereço completo e os jeitos de mandar. A pessoa envia; a Tinindo não manda nada sozinha. */
function ProfileLive({ slug, bookingOn, demo }: { slug: string; bookingOn: boolean; demo: boolean }) {
  const url = `${window.location.origin}/p/${slug}`;
  const text = bookingOn ? "Oi! Este é o meu perfil, com os horários livres para marcar:" : "Oi! Este é o meu perfil:";
  return (
    <Card aria-labelledby="no-ar-titulo">
      <div className="tn-stack">
        <h2 id="no-ar-titulo">Seu perfil está no ar!</h2>
        <p>Mande o link para seus clientes ou coloque na bio do Instagram e no status do WhatsApp.</p>
        {demo ? <p className="tn-muted">Demonstração: o link só funciona nesta aba.</p> : null}
        <ShareActions url={url} label="Endereço do seu perfil" whatsappText={text} />
      </div>
    </Card>
  );
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function ProfileEditor({
  api,
  profile,
  business,
  onSaved,
}: {
  api: NetworkApi;
  profile: OwnerProfile | null;
  business: BusinessBasics | null;
  onSaved: () => Promise<void>;
}) {
  // Endereço sugerido pelo nome do negócio; a pessoa pode trocar.
  const [slug, setSlug] = useState(profile?.slug ?? (business ? slugify(business.name) : ""));
  // O contrato pede a categoria: vem da profissão do negócio (a pessoa já disse), com a troca recolhida.
  const [category, setCategory] = useState<Profession>(profile?.category ?? business?.profession ?? "barber");
  const [area, setArea] = useState(profile?.area ?? "");
  const [fields, setFields] = useState<PublicProfileField[]>(
    profile?.public_fields.filter((f) => f !== "area" && f !== "category") ?? ["display_name", "booking_link"],
  );
  const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show, clear } = useFormErrors<"slug" | "area">();
  // Mesma chave enquanto o formulário não muda: um retry não publica duas vezes.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  const touch = () => setIdemKey(newIdempotencyKey());

  async function publish(e: FormEvent) {
    e.preventDefault();
    const ok = show({
      slug: !slug ? "Informe o endereço do perfil." : SLUG_RE.test(slug) ? null : "Use de 3 a 50 letras minúsculas, números ou hífen.",
      area: area.trim() ? null : "Informe o bairro ou a região.",
    });
    if (!ok) return;
    setBusy("publish");
    setError(null);
    try {
      await api.publishProfile({ slug, category, area: area.trim(), public_fields: ["area", ...fields] }, idemKey);
      toast("Perfil publicado.");
      touch();
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // Tirar do ar volta atrás com a mesma publicação (mesmo endereço, categoria, região e campos): executa e oferece Desfazer.
  async function unpublish() {
    if (!profile) return;
    const before = { slug: profile.slug, category: profile.category, area: profile.area, public_fields: profile.public_fields };
    setBusy("unpublish");
    setError(null);
    try {
      await api.unpublishProfile(newIdempotencyKey());
      await onSaved();
      toast({
        message: "Perfil removido do ar. Ninguém mais o encontra pelo link.",
        action: {
          label: "Desfazer",
          onAction: async () => {
            try {
              await api.publishProfile(before, newIdempotencyKey());
              await onSaved();
              toast("Perfil de volta no ar, no mesmo endereço.");
            } catch (err) {
              toast({ tone: "danger", message: errorMessage(err) });
            }
          },
        },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
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
      <form className="tn-stack" onSubmit={publish} ref={formRef} noValidate>
        <Field
          label="Endereço do perfil"
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            clear("slug");
            touch();
          }}
          placeholder="ex.: barbearia-do-centro"
          hint={
            <>
              Seu link: <span className="tn-net-url">{`${window.location.host}/p/${slug || "…"}`}</span>. Letras minúsculas,
              números e hífen.
            </>
          }
          error={errors.slug}
          required
        />
        {business ? (
          <div className="tn-net-category">
            <p>
              Categoria: <strong>{CATEGORY_LABEL[category]}</strong>
              {category === business.profession ? <span className="tn-muted"> · a profissão do seu negócio</span> : null}
            </p>
            <details>
              <summary>Trocar a categoria do perfil</summary>
              <CategorySelect
                value={category}
                onChange={(p) => {
                  setCategory(p);
                  touch();
                }}
              />
            </details>
          </div>
        ) : (
          <CategorySelect
            value={category}
            onChange={(p) => {
              setCategory(p);
              touch();
            }}
          />
        )}
        <Field
          label="Bairro ou região"
          value={area}
          maxLength={80}
          onChange={(e) => {
            setArea(e.target.value);
            clear("area");
            touch();
          }}
          placeholder="ex.: Centro, Campinas"
          error={errors.area}
          required
        />
        <fieldset className="tn-net-fieldset">
          <legend>O que aparece no perfil</legend>
          {SELECTABLE.map(({ field, label }) => (
            <ChoiceCard
              key={field}
              type="checkbox"
              name="campos-perfil"
              value={field}
              checked={fields.includes(field)}
              onChange={(on) => {
                setFields((cur) => (on ? [...cur, field] : cur.filter((f) => f !== field)));
                touch();
              }}
              title={label}
            />
          ))}
          <p className="tn-muted">
            Categoria e região sempre aparecem no perfil publicado. Não use endereço residencial nem telefone pessoal.
          </p>
        </fieldset>
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <div className="tn-actions">
          <Button type="submit" loading={busy === "publish"} disabled={busy === "unpublish"}>
            {profile?.published_at ? "Atualizar perfil" : "Publicar perfil"}
          </Button>
          {profile?.published_at ? (
            <Button variant="secondary" onClick={() => void unpublish()} loading={busy === "unpublish"} disabled={busy === "publish"}>
              Tirar do ar
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function CategorySelect({ value, onChange }: { value: Profession; onChange: (p: Profession) => void }) {
  return (
    <Field as="select" label="Categoria" value={value} onChange={(e) => onChange(e.target.value as Profession)}>
      {(Object.keys(CATEGORY_LABEL) as Profession[]).map((p) => (
        <option key={p} value={p}>
          {CATEGORY_LABEL[p]}
        </option>
      ))}
    </Field>
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
  const { formRef, errors, show, clear } = useFormErrors<"name">();

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!show({ name: name.trim() ? null : "Informe o nome do colega." })) return;
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
      <form className="tn-stack" onSubmit={create} ref={formRef} noValidate>
        <Field
          label="Nome do colega (só você vê)"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            clear("name");
            setIdemKey(newIdempotencyKey());
          }}
          error={errors.name}
          required
        />
        <Field as="select" label="Categoria (opcional)" value={category} onChange={(e) => setCategory(e.target.value as Profession | "")}>
          <option value="">Não informar</option>
          {(Object.keys(CATEGORY_LABEL) as Profession[]).map((p) => (
            <option key={p} value={p}>
              {CATEGORY_LABEL[p]}
            </option>
          ))}
        </Field>
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <div className="tn-actions">
          <Button type="submit" loading={busy}>
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
                <span className="tn-muted">{STATE_LABEL[r.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
