// Tela principal da Conta: negócio ativo, onboarding, onde a pessoa é cliente e segurança.
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { MyCustomerLink, Onboarding } from "@contracts";
import { Button, Card, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { useSession } from "../../app/session.tsx";
import { messageFor } from "./errors.ts";
import { OnboardingForm } from "./OnboardingForm.tsx";
import { PROFESSION_PRESETS } from "./presets.ts";
import { type BusinessSummary, useIdentityServices } from "./services.tsx";

const ROLE_LABEL = { owner: "dono(a)", staff: "equipe" } as const;

const emptyOnboarding = (tenantId: string): Onboarding => ({
  tenant_id: tenantId,
  goal: null,
  cancellation_notice_hours: null,
  late_cancellation_fee_bps: null,
  completed_at: null,
  version: 1,
});

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; message: string };

export function AccountPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const memberships =
    session.state.status === "signed_in" || session.state.status === "offline_demo" ? session.state.memberships : [];
  const active = memberships.find((m) => m.tenant_id === session.tenantId) ?? null;

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="account-title" title="Sua conta" eyebrow="Conta" />
        {params.get("novo") === "1" && active ? (
          <StatusBanner tone="success">
            Negócio criado. Você é dono(a) de <strong>{active.tenant_name}</strong>.
          </StatusBanner>
        ) : null}
        {active ? (
          <p>
            Negócio ativo: <strong>{active.tenant_name}</strong>, como {ROLE_LABEL[active.role]}. O servidor confere este
            acesso em cada ação.
          </p>
        ) : (
          <p>Você ainda não tem um negócio na Tinindo.</p>
        )}
        <div className="tn-id-actions">
          <Link to="novo-negocio">{active ? "Criar outro negócio" : "Criar meu negócio"}</Link>
        </div>
      </div>

      {active?.role === "owner" ? <BusinessOnboarding key={active.tenant_id} tenantId={active.tenant_id} /> : null}

      <MyLinks />

      <Card aria-labelledby="security-title">
        <h2 id="security-title">Segurança</h2>
        <div className="tn-id-actions">
          <Link to="nova-senha">Trocar senha</Link>
        </div>
      </Card>
    </div>
  );
}

function BusinessOnboarding({ tenantId }: { tenantId: string }) {
  const services = useIdentityServices();
  const [state, setState] = useState<Load<{ business: BusinessSummary; onboarding: Onboarding }>>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([services.loadBusiness(tenantId), services.loadOnboarding(tenantId)])
      .then(([business, onboarding]) => {
        if (cancelled) return;
        if (!business) setState({ kind: "error", message: "Não foi possível carregar o negócio." });
        else setState({ kind: "ready", value: { business, onboarding: onboarding ?? emptyOnboarding(tenantId) } });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: messageFor(e, "onboarding") });
      });
    return () => {
      cancelled = true;
    };
  }, [services, tenantId]);

  return (
    <Card aria-labelledby="business-title">
      <p className="tn-caps" id="business-title">
        {state.kind === "ready" ? PROFESSION_PRESETS[state.value.business.profession].label : "Negócio"}
      </p>
      {state.kind === "loading" ? <p role="status">Carregando…</p> : null}
      {state.kind === "error" ? <StatusBanner tone="danger">{state.message}</StatusBanner> : null}
      {state.kind === "ready" ? (
        <>
          {!services.online ? (
            <StatusBanner tone="info">Demonstração sem servidor: você pode ver as opções, mas nada é salvo.</StatusBanner>
          ) : null}
          <OnboardingForm
            tenantId={tenantId}
            profession={state.value.business.profession}
            onboarding={state.value.onboarding}
            onSaved={(onboarding) => setState({ kind: "ready", value: { ...state.value, onboarding } })}
          />
        </>
      ) : null}
    </Card>
  );
}

function MyLinks() {
  const services = useIdentityServices();
  const [state, setState] = useState<Load<MyCustomerLink[]>>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    services
      .loadMyLinks()
      .then((value) => setState({ kind: "ready", value }))
      .catch((e: unknown) => setState({ kind: "error", message: messageFor(e, "link") }));
  }, [services]);
  useEffect(reload, [reload]);

  async function revoke(link: MyCustomerLink) {
    setBusy(link.link_id);
    setError(null);
    try {
      // Chave por vínculo+versão: clicar de novo repete com segurança.
      await services.revokeLink(link.tenant_id, link.link_id, link.version, `revoke-${link.link_id}-v${link.version}`);
      reload();
    } catch (e) {
      setError(messageFor(e, "link"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card aria-labelledby="links-title">
      <h2 id="links-title">Onde sou cliente</h2>
      <p>Profissionais que ligaram o cadastro deles à sua conta. Cada um vê só o que é dele.</p>
      {state.kind === "loading" ? <p role="status">Carregando…</p> : null}
      {state.kind === "error" ? <StatusBanner tone="danger">{state.message}</StatusBanner> : null}
      {state.kind === "ready" && state.value.length === 0 ? <p>Nenhum vínculo ainda.</p> : null}
      {state.kind === "ready" && state.value.length > 0 ? (
        <ul className="tn-id-list">
          {state.value.map((link) => (
            <li key={link.link_id}>
              <span>{link.tenant_name}</span>
              <Button variant="secondary" disabled={busy !== null} onClick={() => void revoke(link)}>
                {busy === link.link_id ? "Desvinculando…" : "Desvincular"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <div className="tn-id-actions">
        <Link to="vincular">Tenho um código de vínculo</Link>
      </div>
    </Card>
  );
}
