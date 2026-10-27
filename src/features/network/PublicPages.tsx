// Páginas públicas do módulo (perfil por slug, convite e indicação) e a prévia do dono.
// As públicas ficam fora do shell autenticado; o integrador as monta no roteador
// a partir de `networkPublicRoutes` (module.tsx).
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { Profession } from "@contracts";
import { useSession } from "../../app/session.tsx";
import { Button, Card, Field, PageHeader, StatusBanner, useFormErrors, Wordmark } from "../../components/ui/index.tsx";
import type { NetworkApi, PublicProfileData, ReferralInspectOutput, ReferralLinkData } from "./api.ts";
import { PublicProfileView } from "./PublicProfileView.tsx";
import { ShareLink } from "./ShareLink.tsx";
import { CATEGORY_LABEL, errorMessage, formatDateTime, newIdempotencyKey, useNetworkApi } from "./useNetworkApi.ts";
import "./network.css";

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="tn-net-public">
      <header className="tn-net-public__header">
        <Wordmark width={120} />
      </header>
      <main className="tn-net-public__main" id="conteudo">
        {children}
      </main>
    </div>
  );
}

type Load<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "error"; message: string };

function ProfileBySlug({ slug, api }: { slug: string; api: NetworkApi }) {
  const [state, setState] = useState<Load<PublicProfileData>>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    api
      .getPublicProfile(slug)
      .then((data) => !cancelled && setState({ kind: "ok", data }))
      .catch((e: unknown) => !cancelled && setState({ kind: "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [api, slug]);

  if (state.kind === "loading") return <p role="status">Carregando…</p>;
  if (state.kind === "error") {
    return <PageHeader title="Perfil não encontrado" subtitle="O endereço pode estar errado ou o profissional tirou o perfil do ar." />;
  }
  return <PublicProfileView profile={state.data} api={api} />;
}

/** /p/:slug — perfil público. Sem login. */
export function PublicProfilePage() {
  const { slug = "" } = useParams();
  const api = useNetworkApi();
  return (
    <PublicLayout>
      <ProfileBySlug slug={slug} api={api} />
    </PublicLayout>
  );
}

/** /app/perfil/previa — o dono vê o perfil como o cliente vê. */
export function ProfilePreviewPage() {
  const api = useNetworkApi();
  const [slug, setSlug] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void api
      .getOwnProfile()
      .then((p) => setSlug(p?.published_at ? p.slug : null))
      .catch(() => setSlug(null));
  }, [api]);

  return (
    <div className="tn-stack">
      <p>
        <Link to="..">Voltar ao perfil</Link>
      </p>
      <StatusBanner tone="info">Prévia: é assim que clientes veem seu perfil publicado.</StatusBanner>
      {slug === undefined ? <p role="status">Carregando…</p> : null}
      {slug === null ? <PageHeader title="Perfil ainda não publicado" subtitle="Publique o perfil para ver a prévia." /> : null}
      {slug ? <ProfileBySlug slug={slug} api={api} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convite: o token chega no fragmento (#t=…), sai da URL na hora e só vai ao servidor por POST.
// Abrir a página não aceita nada; aceitar exige login com contato confirmado.
// ---------------------------------------------------------------------------

const INVITE_KEY = "tinindo.invite";

function takeInviteToken(): string | null {
  const match = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
  if (match?.[1]) {
    try {
      sessionStorage.setItem(INVITE_KEY, match[1]);
    } catch {
      /* sem armazenamento: o token vale só enquanto a página estiver aberta */
    }
    // Remove o token da barra de endereço e do histórico.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return match[1];
  }
  try {
    return sessionStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
}

function forgetInviteToken() {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    /* nada a limpar */
  }
}

const INVITE_TEXT: Record<ReferralInspectOutput["kind"], { title: string; body: string; action: string }> = {
  professional_invites_peer: {
    title: "Você recebeu um convite de um colega",
    body: "Um profissional convidou você para organizar agenda, clientes e recebimentos na Tinindo. O convite não é avaliação e não mexe em nenhum perfil.",
    action: "Aceitar convite",
  },
  customer_recommends_professional: {
    title: "Um cliente indicou você",
    body: "A indicação fica privada. Nada é publicado sem a sua decisão, e ninguém recebe seu telefone.",
    action: "Confirmar que sou eu",
  },
};

/** /convite — inspeciona e, por ação explícita, aceita um convite. */
export function InvitePage() {
  const api = useNetworkApi();
  const { state: session } = useSession();
  const [token] = useState(takeInviteToken);
  const [info, setInfo] = useState<Load<ReferralInspectOutput>>(token ? { kind: "loading" } : { kind: "error", message: "Link inválido ou removido." });
  const [claim, setClaim] = useState<{ kind: "idle" | "busy" | "done" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [idemKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .inspectReferral(token)
      .then((data) => !cancelled && setInfo({ kind: "ok", data }))
      .catch((e: unknown) => !cancelled && setInfo({ kind: "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [api, token]);

  async function accept() {
    if (!token) return;
    setClaim({ kind: "busy" });
    try {
      await api.claimReferral(token, idemKey);
      forgetInviteToken();
      setClaim({ kind: "done" });
    } catch (e) {
      setClaim({ kind: "error", message: errorMessage(e) });
    }
  }

  const canAct = session.status === "signed_in" || session.status === "offline_demo";

  return (
    <PublicLayout>
      {info.kind === "loading" ? <p role="status">Carregando…</p> : null}
      {info.kind === "error" ? <PageHeader title="Convite indisponível" subtitle={info.message} /> : null}
      {info.kind === "ok" ? (
        <div className="tn-stack">
          <PageHeader id="convite-titulo" eyebrow="Convite pessoal" title={INVITE_TEXT[info.data.kind].title} />
          <Card aria-labelledby="convite-titulo">
            <p>{INVITE_TEXT[info.data.kind].body}</p>
            {info.data.invitee_category ? <p className="tn-muted">Categoria: {CATEGORY_LABEL[info.data.invitee_category]}</p> : null}
            {info.data.inviter_profile_slug ? (
              <p>
                <Link to={`/p/${info.data.inviter_profile_slug}`}>Ver o perfil de quem convidou</Link>
              </p>
            ) : null}
            {info.data.state === "used" ? <StatusBanner tone="warning">Este convite já foi usado.</StatusBanner> : null}
            {info.data.state === "expired" ? <StatusBanner tone="warning">Este convite venceu. Peça um novo link.</StatusBanner> : null}
            {info.data.state === "open" && claim.kind !== "done" ? (
              <div className="tn-stack">
                <p className="tn-muted">
                  Válido até <span className="tn-num">{formatDateTime(info.data.expires_at)}</span>.
                </p>
                {canAct ? (
                  <div className="tn-actions">
                    <Button onClick={() => void accept()} loading={claim.kind === "busy"}>
                      {INVITE_TEXT[info.data.kind].action}
                    </Button>
                  </div>
                ) : (
                  <StatusBanner tone="info">
                    Para aceitar, <Link to="/entrar">entre com seu e-mail confirmado</Link> e volte a esta página.
                  </StatusBanner>
                )}
                {claim.kind === "error" ? <StatusBanner tone="danger">{claim.message}</StatusBanner> : null}
              </div>
            ) : null}
            {claim.kind === "done" ? (
              <StatusBanner tone="success">
                Convite aceito.{api.demo ? " Demonstração: nada foi salvo." : " Você já pode montar seu negócio na Tinindo."}
              </StatusBanner>
            ) : null}
          </Card>
        </div>
      ) : null}
    </PublicLayout>
  );
}

/** /indicar — cliente indica um profissional com link pessoal, sem envio automático. */
export function RecommendPage() {
  const api = useNetworkApi();
  const { state: session } = useSession();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Profession>("barber");
  const [link, setLink] = useState<ReferralLinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const canAct = session.status === "signed_in" || session.status === "offline_demo";
  const { formRef, errors, show, clear } = useFormErrors<"name">();

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!show({ name: name.trim() ? null : "Informe o nome do profissional." })) return;
    setBusy(true);
    setError(null);
    try {
      setLink(await api.createReferral({ kind: "customer_recommends_professional", invitee_name: name.trim(), invitee_category: category, origin: "web" }, idemKey));
      setName("");
      setIdemKey(newIdempotencyKey());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <div className="tn-stack">
        <PageHeader id="indicar-titulo" eyebrow="Indicação" title="Indicar um profissional" />
        <Card aria-labelledby="indicar-titulo">
          <p>
            Gere um link pessoal e entregue você mesmo ao profissional. A Tinindo não pede o telefone dele e não manda
            mensagem. A indicação não vira avaliação nem é publicada.
          </p>
          {canAct ? (
            <form className="tn-stack" onSubmit={create} ref={formRef} noValidate>
              <Field
                label="Nome do profissional (só você vê)"
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
              <Field as="select" label="Categoria" value={category} onChange={(e) => setCategory(e.target.value as Profession)}>
                {(Object.keys(CATEGORY_LABEL) as Profession[]).map((p) => (
                  <option key={p} value={p}>
                    {CATEGORY_LABEL[p]}
                  </option>
                ))}
              </Field>
              {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
              <div className="tn-actions">
                <Button type="submit" loading={busy}>
                  Gerar link de indicação
                </Button>
              </div>
            </form>
          ) : (
            <StatusBanner tone="info">
              Para indicar, <Link to="/entrar">entre na sua conta</Link>. Assim só você vê as suas indicações.
            </StatusBanner>
          )}
          {link ? <ShareLink link={link} demo={api.demo} /> : null}
        </Card>
      </div>
    </PublicLayout>
  );
}
