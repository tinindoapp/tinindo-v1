// Preços (P05): simulador de desconto/margem (cálculo real), regras por horário com prévia, aprovação
// explícita do dono (presa ao conteúdo e à versão) e publicação. Cotação não segura horário.
import { createContext, type FormEvent, useContext, useEffect, useState } from "react";
import type { PricingRule, PricingRuleProposal, ProviderService } from "@contracts";
import { Button, Card, ConfirmAction, Field, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { computePrice } from "../../../supabase/functions/_shared/domain/pricing/price.ts";
import { endOfLocalDayExclusive, formatBps, formatCents, formatDate, localDate, parsePercent, WEEKDAYS } from "./format.ts";
import { newKey, type PricingPort } from "./port.ts";

const PortContext = createContext<PricingPort | null>(null);
export const PricingPortProvider = PortContext.Provider;
const usePort = () => useContext(PortContext)!;

const REASON: Record<string, string> = {
  BASE_PRICE: "Sem desconto: preço base.",
  OFF_PEAK_APPROVED: "Desconto de horário dentro do teto.",
  FLOOR_APPLIED: "Desconto limitado ao preço mínimo (piso).",
};

function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  if (e?.code === "POLICY_REJECTED") {
    if (e.field === "floor") return "O piso deste serviço fica acima do preço base com essa margem. Revise custos ou margem; nada foi criado.";
    if (e.field === "target_margin_bps") return "Taxa + margem chegam a 100% ou mais: configuração inválida. Nada foi criado.";
    if (e.field === "approval_id" || e.field === "payload_hash") return "A aprovação não vale mais para esta proposta (mudou, venceu ou já foi usada). Gere a prévia de novo.";
    if (e.field === "preview") return "O serviço mudou depois da prévia. Gere uma nova proposta.";
    return "As regras não permitem esta ação agora. Nada foi alterado.";
  }
  if (e?.code === "STALE_VERSION") return "Isto mudou em outro lugar. Atualizamos a lista.";
  if (e?.code === "VALIDATION_ERROR") return "Confira os campos. Nada foi gravado.";
  if (e?.code === "FORBIDDEN") return "Só o dono do negócio altera preços.";
  return "Não foi possível concluir agora. Tentar de novo é seguro.";
}

export function PricingPage() {
  const port = usePort();
  const [services, setServices] = useState<ProviderService[] | null>(null);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [data, setData] = useState<{ rules: PricingRule[]; proposals: PricingRuleProposal[] } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([port.services(), port.timezone()]).then(
      ([s, t]) => { if (alive) { setServices(s.filter((x) => x.active)); setTz(t); } },
      (e: unknown) => alive && setError(e ?? new Error("erro")),
    );
    return () => { alive = false; };
  }, [port]);
  useEffect(() => {
    let alive = true;
    port.list().then((d) => alive && setData(d), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);

  const reload = () => setNonce((n) => n + 1);
  const name = (id: string) => services?.find((s) => s.id === id)?.name ?? "Serviço";

  return (
    <section aria-labelledby="pr-title" className="tn-pr">
      <PageHeader id="pr-title" title="Preços" subtitle="Regras de preço por horário com piso e aprovação. Ver o valor não segura horário." />
      {port.kind === "demo" ? (
        <StatusBanner tone="info">
          <strong>Dados de exemplo.</strong> Demonstração sem servidor: esta tela ainda não guarda nem altera dados no servidor;
          as mudanças valem só nesta aba.
        </StatusBanner>
      ) : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {!services || !data ? (
        <p role="status">Carregando preços…</p>
      ) : services.length === 0 ? (
        <StatusBanner tone="info">Cadastre um serviço em Clientes → Serviços para criar regras de preço.</StatusBanner>
      ) : (
        <>
          <Simulator services={services} />
          <Rules rules={data.rules} name={name} tz={tz} onChange={reload} />
          <NewRule services={services} tz={tz} proposals={data.proposals} name={name} onChange={reload} />
        </>
      )}
    </section>
  );
}

function Simulator({ services }: { services: ProviderService[] }) {
  const [serviceId, setServiceId] = useState(services[0]!.id);
  const [discount, setDiscount] = useState("15");
  const [margin, setMargin] = useState("0");
  const svc = services.find((s) => s.id === serviceId) ?? services[0]!;
  const d = parsePercent(discount);
  const m = parsePercent(margin);
  const r = d === undefined || m === undefined ? null : computePrice({
    base_cents: svc.base_price_cents, manual_floor_cents: svc.min_price_cents, estimated_cost_cents: svc.estimated_cost_cents,
    fee_bps: svc.fee_bps, target_margin_bps: m, discount_bps: d, max_discount_bps: d,
  });
  return (
    <Card aria-labelledby="pr-sim-title">
      <h2 id="pr-sim-title">Simulador de desconto</h2>
      <p className="tn-muted">Cálculo real com os dados do serviço (base, piso, custo e taxa). Não publica nada.</p>
      <div className="tn-form-grid">
        <Field as="select" label="Serviço" id="sim-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Field>
        <Field label="Desconto (%)" id="sim-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        <Field label="Margem alvo (%)" id="sim-margin" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
      </div>
      {!r ? (
        <StatusBanner tone="danger">Use percentuais entre 0 e 100.</StatusBanner>
      ) : !r.ok ? (
        <StatusBanner tone="warning">
          {r.error === "FLOOR_ABOVE_BASE"
            ? `Com essa margem o piso seria ${formatCents(r.floor_cents)}, acima do preço base (${formatCents(svc.base_price_cents)}). A oferta fica bloqueada até revisar custos ou margem.`
            : "Taxa + margem chegam a 100% ou mais: não existe preço que cubra isso."}
        </StatusBanner>
      ) : (
        <dl className="tn-pr-dl" aria-label="Resultado da simulação">
          <dt>Preço base</dt><dd className="tn-num">{formatCents(svc.base_price_cents)}</dd>
          <dt>Piso</dt>
          <dd className="tn-num">
            {formatCents(r.floor_cents)}{" "}
            <span className="tn-muted">
              {r.floor_is_manual_only ? "(manual; sem custo informado, não prova rentabilidade)" : `(econômico ${formatCents(r.economic_floor_cents)})`}
            </span>
          </dd>
          <dt>Valor final</dt><dd className="tn-num"><strong>{formatCents(r.final_cents)}</strong> <span className="tn-muted">{REASON[r.reason]}</span></dd>
          <dt>Contribuição estimada</dt>
          <dd className="tn-num">{r.contribution_cents === null ? "Informe o custo do serviço" : `${formatCents(r.contribution_cents)} (não é lucro)`}</dd>
        </dl>
      )}
    </Card>
  );
}

function windowsText(w: { weekday: number; local_start: string; local_end: string }[]) {
  return w.map((x) => `${WEEKDAYS[x.weekday]} ${x.local_start}–${x.local_end}`).join(", ");
}

function Rules({ rules, name, tz, onChange }: {
  rules: PricingRule[]; name: (id: string) => string; tz: string; onChange: () => void;
}) {
  const port = usePort();
  const active = rules.filter((r) => r.active);
  async function deactivate(r: PricingRule) {
    try {
      await port.deactivate({ rule_id: r.rule_id, expected_version: r.version }, newKey());
      toast(`Regra v${r.rule_version} desativada. Novas cotações usam o preço base. Reservas já feitas não mudam.`);
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      onChange();
    }
  }
  return (
    <section aria-labelledby="pr-rules-title" className="tn-pr-section">
      <h2 id="pr-rules-title">Regras ativas</h2>
      {active.length === 0 ? (
        <p className="tn-muted">Nenhuma regra ativa: todas as cotações usam o preço base.</p>
      ) : (
        <ul className="tn-item-list">
          {active.map((r) => (
            <li key={r.rule_id} className="tn-pr-item">
              <div>
                <strong>{name(r.service_id)}</strong> · {windowsText(r.windows)}
                <div className="tn-muted">
                  Desconto {formatBps(Math.min(r.discount_bps, r.max_discount_bps))} (teto {formatBps(r.max_discount_bps)}) · regra v{r.rule_version}
                  {" "}· válida até {formatDate(new Date(Date.parse(r.valid.ends_at) - 1000).toISOString(), tz)}
                </div>
              </div>
              {/* Não há "reativar" no port: voltar exige nova proposta e aprovação. Por isso confirma antes. */}
              <ConfirmAction
                trigger="Desativar"
                triggerLabel={`Desativar regra de ${name(r.service_id)}`}
                title={`Desativar a regra v${r.rule_version} de ${name(r.service_id)}?`}
                consequence={`Novas cotações de ${name(r.service_id)} voltam ao preço base. Reservas já feitas não mudam. Para voltar, é preciso criar e aprovar a regra de novo.`}
                confirmLabel="Sim, desativar"
                onConfirm={() => deactivate(r)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewRule({ services, tz, proposals, name, onChange }: {
  services: ProviderService[]; tz: string; proposals: PricingRuleProposal[]; name: (id: string) => string; onChange: () => void;
}) {
  const port = usePort();
  const today = localDate(port.now(), tz);
  const [serviceId, setServiceId] = useState(services[0]!.id);
  const [days, setDays] = useState<number[]>([2]);
  const [from, setFrom] = useState("13:00");
  const [to, setTo] = useState("17:00");
  const [discount, setDiscount] = useState("15");
  const [cap, setCap] = useState("15");
  const [margin, setMargin] = useState("0");
  const [until, setUntil] = useState(() => {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) + 90 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [preview, setPreview] = useState<PricingRuleProposal | null>(null);
  const { formRef, errors, show } = useFormErrors<"days" | "to" | "discount" | "cap" | "margin" | "until">();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [proposeKey] = useState(() => ({ sig: "", key: newKey() }));

  async function propose(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = parsePercent(discount), c = parsePercent(cap), m = parsePercent(margin);
    const percent = "Use um percentual entre 0 e 100.";
    setError(null);
    const ok = show({
      days: days.length === 0 ? "Escolha pelo menos um dia." : null,
      to: !from || !to || to <= from ? "O fim da faixa deve ser depois do início." : null,
      discount: d === undefined ? percent : null,
      cap: c === undefined ? percent : null,
      margin: m === undefined ? percent : null,
      until: !until || until < today ? "A validade precisa terminar no futuro." : null,
    });
    if (!ok || d === undefined || c === undefined || m === undefined) return;
    const input = {
      service_id: serviceId, discount_bps: d, max_discount_bps: c, target_margin_bps: m,
      windows: [...days].sort().map((weekday) => ({ weekday, local_start: from, local_end: to })),
      valid: { starts_at: port.now().toISOString(), ends_at: endOfLocalDayExclusive(until, tz) },
    };
    const sig = JSON.stringify({ ...input, valid: until });
    if (proposeKey.sig !== sig) Object.assign(proposeKey, { sig, key: newKey() });
    setPending(true);
    try {
      setPreview(await port.propose(input, proposeKey.key));
      onChange();
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  async function approveAndPublish(p: PricingRuleProposal) {
    setPublishing(p.proposal_id);
    try {
      const approval = await port.approve({ proposal_id: p.proposal_id, payload_hash: p.payload_hash!, expected_version: p.version }, newKey());
      const rule = await port.publish({ proposal_id: p.proposal_id, approval_id: approval.approval_id, expected_version: p.version }, newKey());
      toast(`Regra v${rule.rule_version} publicada para ${name(rule.service_id)}. Vale para novas cotações; reservas já feitas mantêm o preço.`);
      setPreview(null);
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      setPublishing(null);
      onChange();
    }
  }

  const open = preview ? [preview, ...proposals.filter((p) => p.proposal_id !== preview.proposal_id)] : proposals;
  return (
    <section aria-labelledby="pr-new-title" className="tn-pr-section">
      <h2 id="pr-new-title">Nova regra por horário</h2>
      <p className="tn-muted">Uma regra ativa por serviço: publicar substitui a anterior. Nada é publicado sem a sua aprovação.</p>
      <form ref={formRef} className="tn-form-grid" onSubmit={(e) => void propose(e)} noValidate aria-label="Nova regra">
        <Field as="select" label="Serviço da regra" id="nr-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Field>
        <fieldset className="tn-pr-days" data-span="full" aria-describedby={errors.days ? "nr-days-error" : undefined}>
          <legend>Dias</legend>
          {[1, 2, 3, 4, 5, 6, 0].map((d, i) => (
            <label key={d} className="tn-pr-check">
              <input type="checkbox" checked={days.includes(d)} aria-invalid={errors.days && i === 0 ? true : undefined}
                onChange={(e) => setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))} />
              {WEEKDAYS[d]}
            </label>
          ))}
          {errors.days ? <span id="nr-days-error" className="tn-field__error">{errors.days}</span> : null}
        </fieldset>
        <Field label="Das" id="nr-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="Até" id="nr-to" type="time" step={900} value={to} error={errors.to} onChange={(e) => setTo(e.target.value)} />
        <Field label="Desconto pedido (%)" id="nr-disc" inputMode="decimal" value={discount} error={errors.discount} onChange={(e) => setDiscount(e.target.value)} />
        <Field label="Teto aprovado (%)" id="nr-cap" inputMode="decimal" value={cap} error={errors.cap} onChange={(e) => setCap(e.target.value)} />
        <Field label="Margem alvo da regra (%)" id="nr-margin" inputMode="decimal" value={margin} error={errors.margin} onChange={(e) => setMargin(e.target.value)} />
        <Field label="Válida até" id="nr-until" type="date" min={today} value={until} error={errors.until} onChange={(e) => setUntil(e.target.value)} />
        {error ? <div data-span="full"><StatusBanner tone="danger">{error}</StatusBanner></div> : null}
        <div className="tn-actions" data-span="full">
          <Button type="submit" loading={pending}>Ver prévia</Button>
        </div>
      </form>
      {open.length ? (
        <ul className="tn-item-list" aria-label="Propostas aguardando aprovação">
          {open.map((p) => (
            <li key={p.proposal_id} className="tn-pr-proposal">
              <div>
                <strong>Prévia · {name(p.service_id)}</strong> · {windowsText(p.windows ?? [])}
                <p className="tn-num">
                  {formatCents(p.preview.example_base_cents)} → <strong>{formatCents(p.preview.example_final_cents)}</strong>
                  {" "}(desconto efetivo {formatBps(p.preview.effective_discount_bps ?? Math.min(p.discount_bps, p.max_discount_bps ?? p.discount_bps))}).
                  {" "}Piso {formatCents(p.preview.floor_cents)}{p.preview.floor_is_manual_only ? " (manual)" : ""}.
                  {p.preview.reason ? ` ${REASON[p.preview.reason]}` : ""}
                </p>
                <p className="tn-muted">
                  Ainda inativa. Ao aprovar, você aprova exatamente este conteúdo (código {p.payload_hash?.slice(0, 8)}). A aprovação vale 15 minutos.
                </p>
              </div>
              <Button loading={publishing === p.proposal_id} disabled={publishing !== null} onClick={() => void approveAndPublish(p)}>Aprovar e publicar</Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
