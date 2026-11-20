// KIT DAS PÁGINAS DO CLIENTE FINAL (P55). Cópia idêntica em network, payments, sales e reputation: o lint do repositório
// não deixa um módulo importar outro, e src/app e src/lib são do integrador. `public-kit.sync.test.ts` (em network) falha
// se as cópias divergirem; para mudar, edite a de network e copie. Pedido de unificação: ver o handoff do P55.
//
// O que tem aqui: a moldura única (D18: o negócio no topo, a Tinindo só no rodapé), o "não encontrado" com saída, o
// estado final como tela própria, a leitura pública do negócio pelo endereço do link e os ajudantes do caminho.
// Sem sessão e sem o cliente Supabase: só fetch à função pública `network/public.profile`.
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { PublicProfile } from "@contracts";
import type { z } from "zod";
import { appEnv } from "../../app/env.ts";
import { BrandSymbol, whatsappHref } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import "./public-kit.css";

// ---------------------------------------------------------------------------
// Caminho do link
// ---------------------------------------------------------------------------

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;
export const isSlug = (s: string | null | undefined): s is string => !!s && SLUG.test(s);

/**
 * Põe o endereço do negócio no caminho de um link com token: `/pagar#t=…` vira `/pagar/barbearia-do-leo#t=…`.
 * O token continua no fragmento (não vai ao servidor). O endereço serve para a prévia do link no WhatsApp dizer quem
 * mandou (worker/og.ts) e para a página ter saída quando o link não vale mais. Sem perfil publicado, fica como veio.
 */
export function withBusinessSlug(url: string, slug: string | null | undefined): string {
  if (!isSlug(slug)) return url;
  return url.replace(/\/(pagar|orcamento|avaliar|reserva)(?=#|\?|$)/, `/$1/${slug}`);
}

// ---------------------------------------------------------------------------
// Negócio do link (só o que o dono publicou)
// ---------------------------------------------------------------------------

export interface PublicBusiness {
  name: string;
  slug?: string | null;
  /** "Barbearia · Centro, Campinas". */
  lead?: string | null;
  photo?: { url: string; alt: string } | null;
  whatsapp_e164?: string | null;
}

const CATEGORY: Record<string, string> = { barber: "Barbearia", hairdresser: "Cabeleireiro(a)", personal_trainer: "Personal trainer", other: "Outro serviço" };

export function businessOf(profile: z.infer<typeof PublicProfile>): PublicBusiness {
  const category = CATEGORY[profile.category] ?? CATEGORY.other!;
  return {
    name: profile.fields.display_name ?? category,
    slug: profile.slug,
    lead: [profile.fields.display_name ? category : null, profile.area].filter(Boolean).join(" · ") || null,
    photo: profile.photo ?? null,
    whatsapp_e164: profile.whatsapp_e164 ?? null,
  };
}

/** Cliente das Edge Functions sem `Authorization` (D20: o cliente final não tem conta); null na demonstração. */
export function anonCall() {
  if (!appEnv.supabase) return null;
  return createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null });
}

type BusinessReader = (slug: string) => Promise<PublicBusiness | null>;
const serverReader: BusinessReader = async (slug) => {
  const call = anonCall();
  // Demonstração sem servidor: o perfil vive na memória do módulo Perfil; as outras páginas usam o nome que o link traz.
  if (!call) return null;
  return call(`/network/public.profile?slug=${encodeURIComponent(slug)}`, PublicProfile).then((r) => businessOf(r.data), () => null);
};
let reader: BusinessReader = serverReader;
const cache = new Map<string, Promise<PublicBusiness | null>>();
/** O módulo Perfil troca a leitura pela própria (inclui a demonstração); também usado em testes. null volta ao padrão. */
export function setPublicBusinessReader(next: BusinessReader | null) {
  reader = next ?? serverReader;
  cache.clear();
}

/**
 * Negócio do endereço no caminho do link (`/pagar/:slug`). `undefined` enquanto carrega; null sem endereço ou sem
 * perfil publicado. As páginas com token usam isto para ter cabeçalho e saída mesmo quando o token não vale mais.
 */
export function usePublicBusiness(slug: string | null | undefined): PublicBusiness | null | undefined {
  const valid = isSlug(slug) ? slug : null;
  const [state, setState] = useState<{ slug: string; business: PublicBusiness | null } | null>(null);
  useEffect(() => {
    if (!valid) return;
    let alive = true;
    let hit = cache.get(valid);
    if (!hit) {
      hit = reader(valid).catch(() => null);
      cache.set(valid, hit);
    }
    void hit.then((business) => alive && setState({ slug: valid, business }));
    return () => {
      alive = false;
    };
  }, [valid]);
  if (!valid) return null;
  return state?.slug === valid ? state.business : undefined;
}

// ---------------------------------------------------------------------------
// Moldura
// ---------------------------------------------------------------------------

/** Inicial do nome quando não há foto (ou a foto está desligada): o lugar da foto nunca fica vazio. */
export const initialOf = (name: string) => (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase();

export function BusinessHeader({ business, nameAs = "p", compact = false }: {
  business: PublicBusiness;
  /** "h1" só no perfil; nas páginas com token o h1 é a pergunta ou o documento da página. */
  nameAs?: "h1" | "p";
  /** Barra baixa (40 px): usada durante a reserva, para o formulário subir. */
  compact?: boolean;
}) {
  const Name = nameAs;
  const to = business.slug && nameAs === "p" ? `/p/${business.slug}` : null;
  return (
    <header className="tn-pub-head tn-pub__col" data-compact={compact || undefined}>
      {business.photo ? (
        <img className="tn-pub-avatar" src={business.photo.url} alt={business.photo.alt} width={72} height={72} />
      ) : (
        <span className="tn-pub-avatar" aria-hidden="true">{initialOf(business.name)}</span>
      )}
      <div className="tn-pub-head__text">
        {to ? (
          <Link className="tn-pub-head__name" to={to}>{business.name}</Link>
        ) : (
          <Name id="negocio-nome" className="tn-pub-head__name">{business.name}</Name>
        )}
        {business.lead ? <p className="tn-pub-head__lead">{business.lead}</p> : null}
      </div>
    </header>
  );
}

/** Rodapé discreto: a única menção à Tinindo na página. Sem promessa nem canal que não existe. */
export function PublicFooter({ note }: { note?: ReactNode }) {
  return (
    <footer className="tn-pub-foot tn-pub__col">
      <p className="tn-pub-foot__brand">
        <BrandSymbol size={18} />
        <span>Página feita com a Tinindo</span>
      </p>
      {note ? <p>{note}</p> : null}
    </footer>
  );
}

export function PublicFrame({ business, nameAs, compact, footNote, children }: {
  /** null: negócio desconhecido (link sem endereço e ainda sem resposta): a página abre sem cabeçalho. */
  business: PublicBusiness | null | undefined;
  nameAs?: "h1" | "p";
  compact?: boolean;
  footNote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tn-pub tn-net-public">
      {business ? <BusinessHeader business={business} nameAs={nameAs} compact={compact} /> : null}
      <main className="tn-pub-main tn-pub__col" data-bare={business ? undefined : true} id="conteudo">
        {children}
      </main>
      <PublicFooter note={footNote} />
    </div>
  );
}

/** Carregando: a forma do conteúdo, com o texto só para o leitor de tela. */
export function PublicSkeleton({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="tn-pub-skel" role="status">
      <span /><span /><span />
      <span className="tn-visually-hidden">{label}</span>
    </div>
  );
}

/** Mensagem pronta para pedir um link novo: diz o que a pessoa tentou abrir, sem dado nenhum dela. */
export const askAgainMessage = (what: string) => `Olá! Tentei abrir ${what} e o link não funcionou. Pode me mandar de novo?`;

/**
 * "Não encontrado" com saída (auditoria 14, "Erro sem saída"): fala com o negócio quando ele é conhecido, volta para a
 * página dele, ou tenta de novo. Nunca termina num beco.
 */
export function PublicMissing({ title, children, business, what }: {
  title: string;
  children: ReactNode;
  business?: PublicBusiness | null;
  /** "o link de pagamento", "o orçamento"… entra na mensagem pronta do WhatsApp. */
  what?: string;
}) {
  return (
    <section className="tn-pub-missing" aria-labelledby="pub-missing-title">
      <h1 id="pub-missing-title">{title}</h1>
      <div>{children}</div>
      <div className="tn-pub-cta" data-inline>
        {business?.whatsapp_e164 ? (
          <a className="tn-button" data-variant="primary" href={whatsappHref(business.whatsapp_e164, askAgainMessage(what ?? "o link que recebi"))} target="_blank" rel="noopener noreferrer">
            Falar com {business.name} no WhatsApp
          </a>
        ) : null}
        {business?.slug ? (
          <Link className="tn-button" data-variant={business.whatsapp_e164 ? "secondary" : "primary"} to={`/p/${business.slug}`}>
            Ver a página de {business.name}
          </Link>
        ) : null}
        <button type="button" className="tn-button" data-variant="secondary" onClick={() => window.location.reload()}>
          Tentar de novo
        </button>
      </div>
    </section>
  );
}

/** Estado final como tela própria (auditoria 14, achado 08): selo, título e o que acontece agora. */
export function PublicDone({ title, titleId, children }: { title: string; titleId?: string; children: ReactNode }) {
  return (
    <section className="tn-pub-done" aria-labelledby={titleId ?? "pub-done-title"}>
      <span className="tn-pub-seal" aria-hidden="true">✓</span>
      <h1 id={titleId ?? "pub-done-title"} tabIndex={-1}>{title}</h1>
      {children}
    </section>
  );
}
