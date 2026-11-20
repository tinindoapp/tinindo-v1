// /p/:slug — a página pública única do negócio (D19): perfil, reserva e o conteúdo do site publicado. Sem login.
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import type { NetworkApi, PublicProfileData } from "../api.ts";
import { type ProfileSiteExtras, PublicProfileView } from "../PublicProfileView.tsx";
import { type PublicSite, PublicSiteOutput } from "@contracts";
import { usePublicNetworkApi } from "./anon.ts";
import { anonCall, PublicFooter, PublicMissing, PublicSkeleton } from "../public-kit.tsx";
import "../network.css";

type Load = { slug: string } & ({ kind: "ok"; profile: PublicProfileData; site: ProfileSiteExtras | null } | { kind: "missing" });

const extrasOf = (s: PublicSite["site"]): ProfileSiteExtras => ({ headline: s.headline, services: s.services, hours: s.hours, timezone: s.timezone });

/**
 * Site publicado sem perfil legível (acontece na demonstração, em que o site de exemplo não depende do perfil da aba):
 * a página mostra o que o site tem, sem reserva.
 */
function profileFromSite(s: PublicSite): PublicProfileData {
  return {
    slug: s.site.slug,
    category: s.site.category,
    area: s.site.area,
    fields: { ...(s.site.display_name ? { display_name: s.site.display_name } : {}), ...(s.site.bio ? { bio: s.site.bio } : {}) },
    published_at: s.published_at,
    reputation: { identity_verified: false, reviews_count: 0 },
    photo: null,
    whatsapp_e164: null,
  };
}

/** Site publicado (P17), lido pela API pública do módulo Site. Na demonstração não há servidor: o perfil vai sem ele. */
async function readSite(slug: string): Promise<PublicSite | null> {
  const call = anonCall();
  if (!call) return null;
  return call("/presence/presence.public_site", PublicSiteOutput, { method: "POST", body: { slug } }).then((r) => r.data, () => null);
}

async function load(api: NetworkApi, slug: string, site$: Promise<PublicSite | null>): Promise<Load> {
  const [profile, site] = await Promise.all([api.getPublicProfile(slug).catch(() => null), site$]);
  if (profile) return { slug, kind: "ok", profile, site: site ? extrasOf(site.site) : null };
  if (site) return { slug, kind: "ok", profile: profileFromSite(site), site: extrasOf(site.site) };
  return { slug, kind: "missing" };
}

let readSiteOverride: ((slug: string) => Promise<PublicSite | null>) | null = null;
/** Só para testes: troca a leitura do site publicado. */
export function setPublicSiteReader(fn: typeof readSiteOverride) {
  readSiteOverride = fn;
}

export function PublicProfilePage() {
  const { slug = "" } = useParams();
  const api = usePublicNetworkApi();
  // Vindo de /s na demonstração, o site de exemplo chega no estado da navegação (ver presence/public-routes.tsx).
  const navState: unknown = useLocation().state;
  const carriedSite = useMemo(() => {
    const parsed = PublicSiteOutput.safeParse((navState as { site?: unknown } | null)?.site);
    return parsed.success && parsed.data.site.slug === slug ? parsed.data : null;
  }, [navState, slug]);
  const [state, setState] = useState<Load | null>(null);
  useEffect(() => {
    let alive = true;
    const site$ = carriedSite ? Promise.resolve(carriedSite) : (readSiteOverride ?? readSite)(slug);
    void load(api, slug, site$).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [api, slug, carriedSite]);
  const current = state?.slug === slug ? state : null;

  return (
    <div className="tn-pub tn-net-public">
      {current?.kind === "ok" ? (
        <PublicProfileView profile={current.profile} api={api} site={current.site} as="main" />
      ) : (
        <main className="tn-pub-main tn-pub__col" data-bare id="conteudo">
          {current ? (
            <PublicMissing title="Perfil não encontrado">
              <p>O endereço pode estar errado ou o profissional tirou o perfil do ar. Confira o link com quem te mandou.</p>
            </PublicMissing>
          ) : (
            <PublicSkeleton />
          )}
        </main>
      )}
      <PublicFooter />
    </div>
  );
}
