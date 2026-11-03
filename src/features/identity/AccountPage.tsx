// Tela principal da Conta: negócio ativo, onboarding, onde a pessoa é cliente e segurança.
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { MyCustomerLink, Onboarding } from "@contracts";
import { Card, ConfirmAction, LinkButton, PageHeader, StatusBanner, toast } from "../../components/ui/index.tsx";
import { useSession } from "../../app/session.tsx";
import { messageFor } from "./errors.ts";
import { OnboardingForm } from "./OnboardingForm.tsx";
import { PROFESSION_PRESETS } from "./presets.ts";
import { type BusinessSummary, type SetupProgress, useIdentityServices } from "./services.tsx";

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
  const [params, setParams] = useSearchParams();
  const memberships =
    session.state.status === "signed_in" || session.state.status === "offline_demo" ? session.state.memberships : [];
  const active = memberships.find((m) => m.tenant_id === session.tenantId) ?? null;
  const justCreated = params.get("novo") === "1" && active ? active.tenant_name : null;

  // Negócio recém-criado: confirmação em toast (uma vez) e o parâmetro sai da URL.
  useEffect(() => {
    if (!justCreated) return;
    toast({ message: <>Negócio criado. Você é dono(a) de <strong>{justCreated}</strong>.</> });
    setParams({}, { replace: true });
  }, [justCreated, setParams]);

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="account-title" title="Sua conta" eyebrow="Conta" />
        {active ? (
          <p>
            Negócio ativo: <strong>{active.tenant_name}</strong>, como {ROLE_LABEL[active.role]}.
          </p>
        ) : (
          <>
            <p>Você ainda não tem um negócio na Tinindo.</p>
            <div className="tn-actions">
              <LinkButton to="novo-negocio">Criar meu negócio</LinkButton>
            </div>
          </>
        )}
      </div>

      {active?.role === "owner" ? <BusinessOnboarding key={active.tenant_id} tenantId={active.tenant_id} /> : null}

      <MyLinks />

      <Card aria-labelledby="security-title">
        <h2 id="security-title">Segurança</h2>
        <div className="tn-actions">
          <Link to="nova-senha">Trocar senha</Link>
        </div>
      </Card>

      {/* Outro negócio é raro: fica no fim, sem destaque (E13). */}
      {active ? (
        <p className="tn-muted">
          Atende em outro lugar com outro nome? <Link to="novo-negocio">Criar outro negócio</Link>
        </p>
      ) : null}
    </div>
  );
}

/** Um único "Primeiros passos" (E9/E13), no topo da Conta enquanto falta algo. Cada passo leva à tela dele. */
function FirstSteps({ onboarded, setup }: { onboarded: boolean; setup: SetupProgress }) {
  const steps: { label: string; done: boolean | null; to?: string; href?: string }[] = [
    { label: "Criar o negócio", done: true },
    { label: "Dizer o que você quer resolver primeiro", done: onboarded, href: "#onboarding-title" },
    { label: "Cadastrar seus serviços", done: setup.services, to: "/app/clientes/servicos" },
    { label: "Definir seus horários de atendimento", done: setup.hours, to: "/app/agenda/horarios" },
    { label: "Publicar seu perfil e mandar o link", done: setup.profile, to: "/app/perfil" },
  ];
  const known = steps.every((s) => s.done !== null);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Card aria-labelledby="first-steps-title">
      <div className="tn-id-steps">
        <h2 id="first-steps-title">
          Primeiros passos
          {known ? (
            <span className="tn-num tn-muted">
              {" "}
              · {doneCount} de {steps.length}
            </span>
          ) : null}
        </h2>
        <ol>
          {steps.map((s) => (
            <li key={s.label} data-done={s.done || undefined}>
              <span aria-hidden="true" className="tn-id-steps__mark">
                {s.done ? "✓" : ""}
              </span>
              {s.done ? (
                <span>
                  {s.label}
                  <span className="tn-visually-hidden"> (feito)</span>
                </span>
              ) : s.to ? (
                <Link to={s.to}>{s.label}</Link>
              ) : (
                <a href={s.href} onClick={() => document.querySelector<HTMLElement>(s.href!)?.focus()}>
                  {s.label}
                </a>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function BusinessOnboarding({ tenantId }: { tenantId: string }) {
  const services = useIdentityServices();
  const [state, setState] = useState<Load<{ business: BusinessSummary; onboarding: Onboarding; setup: SetupProgress }>>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const unknown: SetupProgress = { services: null, hours: null, profile: null };
    Promise.all([
      services.loadBusiness(tenantId),
      services.loadOnboarding(tenantId),
      services.loadSetup(tenantId).catch(() => unknown),
    ])
      .then(([business, onboarding, setup]) => {
        if (cancelled) return;
        if (!business) setState({ kind: "error", message: "Não foi possível carregar o negócio." });
        else setState({ kind: "ready", value: { business, onboarding: onboarding ?? emptyOnboarding(tenantId), setup } });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: messageFor(e, "onboarding") });
      });
    return () => {
      cancelled = true;
    };
  }, [services, tenantId]);

  const ready = state.kind === "ready" ? state.value : null;
  // Mostra os passos para quem acabou de entrar: enquanto falta o objetivo ou um passo que sabemos não feito.
  const showSteps =
    ready !== null && (ready.onboarding.completed_at === null || Object.values(ready.setup).some((done) => done === false));
  return (
    <>
      {showSteps && ready ? <FirstSteps onboarded={ready.onboarding.completed_at !== null} setup={ready.setup} /> : null}
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
    </>
  );
}

function MyLinks() {
  const services = useIdentityServices();
  const [state, setState] = useState<Load<MyCustomerLink[]>>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    services
      .loadMyLinks()
      .then((value) => setState({ kind: "ready", value }))
      .catch((e: unknown) => setState({ kind: "error", message: messageFor(e, "link") }));
  }, [services]);
  useEffect(reload, [reload]);

  // Desvincular não tem volta pelo app (só com um código novo do profissional): pede confirmação.
  async function revoke(link: MyCustomerLink) {
    setError(null);
    try {
      // Chave por vínculo+versão: clicar de novo repete com segurança.
      await services.revokeLink(link.tenant_id, link.link_id, link.version, `revoke-${link.link_id}-v${link.version}`);
      toast(`Vínculo com ${link.tenant_name} desfeito.`);
      reload();
    } catch (e) {
      setError(messageFor(e, "link"));
      throw e;
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
              <ConfirmAction
                trigger="Desvincular"
                triggerVariant="secondary"
                triggerLabel={`Desvincular de ${link.tenant_name}`}
                title={`Desvincular de ${link.tenant_name}?`}
                consequence={`${link.tenant_name} deixa de ligar o cadastro dele à sua conta. Para ligar de novo, você vai precisar de um código novo do profissional.`}
                confirmLabel="Sim, desvincular"
                onConfirm={() => revoke(link)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <div className="tn-actions">
        <Link to="reservas">Minhas reservas</Link>
        <Link to="vincular">Tenho um código de vínculo</Link>
      </div>
    </Card>
  );
}
