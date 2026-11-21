// Preços (P05): simulador de desconto/margem (cálculo real), regras por horário com prévia, aprovação
// explícita do dono (presa ao conteúdo e à versão) e publicação. Cotação não segura horário.
// P54 (doc 07 §4.10): primeiro o que está valendo ("Regras ativas"), depois as prévias aguardando aprovação; "Nova regra"
// é a ação principal da abertura e abre o formulário numa folha; o simulador fica recolhido numa linha.
import { createContext, type FormEvent, useContext, useEffect, useState } from "react";
import type { PricingRule, PricingRuleProposal, ProviderService } from "@contracts";
import { Button, ChipGroup, ConfirmAction, Field, FormPanel, PageHeader, Section, StatusBanner, Summary, SummaryHero, SummaryRows, toast, useFormErrors, WEEKDAY_CHIPS, WEEKDAY_SHORTCUTS } from "../../components/ui/index.tsx";
import { computePrice } from "../../../supabase/functions/_shared/domain/pricing/price.ts";
import { endOfLocalDayExclusive, formatBps, formatCents, formatDate, localDate, parsePercent, WEEKDAYS } from "./format.ts";
import type { PricingPort } from "./port.ts";
import { errorExplainer } from "../../lib/errors.ts";
import { useCommand, useIdempotencyKey } from "../../lib/idempotency.ts";

const PortContext = createContext<PricingPort | null>(null);
export const PricingPortProvider = PortContext.Provider;
const usePort = () => useContext(PortContext)!;

const REASON: Record<string, string> = {
  BASE_PRICE: "Sem desconto: preço base.",
  OFF_PEAK_APPROVED: "Desconto de horário dentro do máximo.",
  FLOOR_APPLIED: "Desconto limitado ao menor preço que você aceita.",
};

const explain = errorExplainer({
  "POLICY_REJECTED.floor": "Com essa margem, o menor preço que você aceita neste serviço fica acima do preço base. Revise custos ou margem; nada foi criado.",
  "POLICY_REJECTED.target_margin_bps": "Taxa + margem chegam a 100% ou mais: configuração inválida. Nada foi criado.",
  "POLICY_REJECTED.approval_id": "A aprovação não vale mais para esta proposta (mudou, venceu ou já foi usada). Gere a prévia de novo.",
  "POLICY_REJECTED.payload_hash": "A aprovação não vale mais para esta proposta (mudou, venceu ou já foi usada). Gere a prévia de novo.",
  "POLICY_REJECTED.preview": "O serviço mudou depois da prévia. Gere uma nova proposta.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a lista.",
  VALIDATION_ERROR: "Confira os campos. Nada foi gravado.",
  FORBIDDEN: "Só o dono do negócio altera preços.",
});

export function PricingPage() {
  const port = usePort();
  const [services, setServices] = useState<ProviderService[] | null>(null);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [data, setData] = useState<Awaited<ReturnType<PricingPort["list"]>> | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  // Prévia recém-gerada: aparece primeiro na lista de aprovação, mesmo antes de a lista recarregar.
  const [preview, setPreview] = useState<PricingRuleProposal | null>(null);

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

  const ready = services && data && services.length > 0;
  const proposals = data ? (preview ? [preview, ...data.proposals.filter((p) => p.proposal_id !== preview.proposal_id)] : data.proposals) : [];
  return (
    <section aria-labelledby="pr-title" className="tn-pr">
      <PageHeader id="pr-title" title="Preços" subtitle="Descontos por horário, sem passar do menor preço que você aceita."
        actions={ready ? <Button onClick={() => setCreating(true)}>Nova regra</Button> : undefined}
        help={
          <>
            <p>Uma regra ativa por serviço: publicar substitui a anterior. Nada é publicado sem a sua aprovação, e a aprovação vale para exatamente a prévia que você viu.</p>
            <p>Ver o valor não segura horário. Reservas já feitas mantêm o preço combinado.</p>
          </>
        } />
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {!services || !data ? (
        <p role="status">Carregando preços…</p>
      ) : services.length === 0 ? (
        <StatusBanner tone="info">Cadastre um serviço em Clientes → Serviços para criar regras de preço.</StatusBanner>
      ) : (
        <>
          {creating ? (
            <FormPanel title="Nova regra por horário" onClose={() => setCreating(false)}>
              <NewRule services={services} tz={tz} onCancel={() => setCreating(false)}
                onProposed={(p) => { setPreview(p); setCreating(false); reload(); }} />
            </FormPanel>
          ) : null}
          <Rules rules={data.rules} truncated={data.truncated?.rules ?? false} name={name} tz={tz} onChange={reload} />
          {proposals.length ? (
            <Proposals proposals={proposals} truncated={data.truncated?.proposals ?? false} name={name}
              onDone={(p) => { if (preview?.proposal_id === p) setPreview(null); reload(); }} />
          ) : null}
          <Simulator services={services} />
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
    <Section id="pr-sim-title" title="Simular um desconto" collapsed>
      <p className="tn-muted">Cálculo real com os dados do serviço (preço base, menor preço que você aceita, custo e taxa). Não publica nada.</p>
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
            ? `Com essa margem, o menor preço que você aceita seria ${formatCents(r.floor_cents)}, acima do preço base (${formatCents(svc.base_price_cents)}). A oferta fica bloqueada até revisar custos ou margem.`
            : "Taxa + margem chegam a 100% ou mais: não existe preço que cubra isso."}
        </StatusBanner>
      ) : (
        <Summary label="Resultado da simulação">
          <SummaryHero id="pr-sim-final" label="Valor final" value={formatCents(r.final_cents)} hint={REASON[r.reason]} />
          <SummaryRows label="Detalhes da simulação" rows={[
            { key: "base", label: "Preço base", value: formatCents(svc.base_price_cents) },
            {
              key: "floor", label: "Menor preço que você aceita", value: formatCents(r.floor_cents),
              hint: r.floor_is_manual_only
                ? "O que você definiu; sem o custo do serviço, não dá para saber se cobre os custos."
                : `Para cobrir custos e margem: ${formatCents(r.economic_floor_cents)}.`,
            },
            {
              key: "left", label: "Sobra depois dos custos",
              value: r.contribution_cents === null ? "—" : formatCents(r.contribution_cents),
              hint: r.contribution_cents === null ? "Informe o custo do serviço." : "Estimativa; não é lucro.",
            },
          ]} />
        </Summary>
      )}
    </Section>
  );
}

function windowsText(w: { weekday: number; local_start: string; local_end: string }[]) {
  return w.map((x) => `${WEEKDAYS[x.weekday]} ${x.local_start}–${x.local_end}`).join(", ");
}

function Rules({ rules, truncated, name, tz, onChange }: {
  rules: PricingRule[]; truncated: boolean; name: (id: string) => string; tz: string; onChange: () => void;
}) {
  const port = usePort();
  const active = rules.filter((r) => r.active);
  const command = useCommand();
  async function deactivate(r: PricingRule) {
    try {
      const input = { rule_id: r.rule_id, expected_version: r.version };
      await command({ deactivate: input }, (key) => port.deactivate(input, key));
      toast(`Regra de ${name(r.service_id)} desativada. Novos valores usam o preço base. Reservas já feitas não mudam.`);
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      onChange();
    }
  }
  return (
    <Section id="pr-rules-title" title="Regras ativas" count={active.length}>
      {active.length === 0 ? (
        <p className="tn-muted">Nenhuma regra ativa: todas as cotações usam o preço base.</p>
      ) : (
        <ul className="tn-list" aria-label="Regras valendo">
          {active.map((r) => (
            <li key={r.rule_id}>
              <div className="tn-list__row tn-pr-row">
                <span className="tn-list__text">
                  <span className="tn-list__title">{name(r.service_id)} · {windowsText(r.windows)}</span>
                  <span className="tn-list__meta tn-num">
                    Desconto {formatBps(Math.min(r.discount_bps, r.max_discount_bps))} (máximo {formatBps(r.max_discount_bps)})
                    {" "}· válida até {formatDate(new Date(Date.parse(r.valid.ends_at) - 1000).toISOString(), tz)}
                  </span>
                </span>
                {/* Não há "reativar" no port: voltar exige nova proposta e aprovação. Por isso confirma antes. */}
                <ConfirmAction
                  trigger="Desativar"
                  triggerLabel={`Desativar regra de ${name(r.service_id)}`}
                  title={`Desativar a regra de ${name(r.service_id)}?`}
                  consequence={`Novos valores de ${name(r.service_id)} voltam ao preço base. Reservas já feitas não mudam. Para voltar, é preciso criar e aprovar a regra de novo.`}
                  confirmLabel="Sim, desativar"
                  onConfirm={() => deactivate(r)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {truncated ? <p className="tn-muted">Mostrando as 100 regras mais recentes.</p> : null}
    </Section>
  );
}

/** Prévias aguardando aprovação: aprovar publica exatamente o que está escrito na linha. */
function Proposals({ proposals, truncated, name, onDone }: {
  proposals: PricingRuleProposal[]; truncated: boolean; name: (id: string) => string; onDone: (proposalId: string) => void;
}) {
  const port = usePort();
  const [publishing, setPublishing] = useState<string | null>(null);
  const approveCommand = useCommand();
  const publishCommand = useCommand();

  async function approveAndPublish(p: PricingRuleProposal) {
    setPublishing(p.proposal_id);
    try {
      const approve = { proposal_id: p.proposal_id, payload_hash: p.payload_hash!, expected_version: p.version };
      const approval = await approveCommand({ approve }, (key) => port.approve(approve, key));
      const publish = { proposal_id: p.proposal_id, approval_id: approval.approval_id, expected_version: p.version };
      const rule = await publishCommand({ publish }, (key) => port.publish(publish, key));
      toast(`Regra publicada para ${name(rule.service_id)}. Vale para os próximos agendamentos; reservas já feitas mantêm o preço.`);
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      setPublishing(null);
      onDone(p.proposal_id);
    }
  }

  return (
    <Section id="pr-proposals-title" title="Aguardando sua aprovação" count={proposals.length}>
      <p className="tn-muted">Ainda não valem. Ao aprovar, você aprova exatamente a prévia; a aprovação vale 15 minutos.</p>
      <ul className="tn-list" aria-label="Propostas aguardando aprovação">
        {proposals.map((p) => (
          <li key={p.proposal_id}>
            <div className="tn-list__row tn-pr-row">
              <span className="tn-list__text">
                <span className="tn-list__title">Prévia · {name(p.service_id)} · {windowsText(p.windows ?? [])}</span>
                <span className="tn-list__meta tn-num">
                  {formatCents(p.preview.example_base_cents)} → <strong>{formatCents(p.preview.example_final_cents)}</strong>
                  {" "}(desconto aplicado {formatBps(p.preview.effective_discount_bps ?? Math.min(p.discount_bps, p.max_discount_bps ?? p.discount_bps))}).
                  {" "}Menor preço que você aceita: {formatCents(p.preview.floor_cents)}.
                  {p.preview.reason ? ` ${REASON[p.preview.reason]}` : ""}
                </span>
              </span>
              <Button variant="secondary" size="compact" loading={publishing === p.proposal_id} disabled={publishing !== null} onClick={() => void approveAndPublish(p)}>Aprovar e publicar</Button>
            </div>
          </li>
        ))}
      </ul>
      {truncated ? <p className="tn-muted">Mostrando as 20 prévias mais recentes.</p> : null}
    </Section>
  );
}

function NewRule({ services, tz, onProposed, onCancel }: {
  services: ProviderService[]; tz: string; onProposed: (p: PricingRuleProposal) => void; onCancel: () => void;
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
  const { formRef, errors, show } = useFormErrors<"days" | "to" | "discount" | "cap" | "margin" | "until">();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Mesma chave enquanto a proposta for a mesma (o instante de início não conta): repetir a prévia não cria outra.
  const proposeKey = useIdempotencyKey();

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
    const key = proposeKey.keyFor({ ...input, valid: until });
    setPending(true);
    try {
      onProposed(await port.propose(input, key));
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="tn-form-grid" onSubmit={(e) => void propose(e)} noValidate aria-label="Nova regra">
      <p className="tn-muted" data-span="full">Uma regra ativa por serviço: publicar substitui a anterior. A prévia não publica nada.</p>
      <Field as="select" label="Serviço da regra" id="nr-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
        {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Field>
      <div data-span="full">
        <ChipGroup label="Dias" options={WEEKDAY_CHIPS} shortcuts={WEEKDAY_SHORTCUTS} value={days} onChange={setDays}
          error={errors.days} errorId="nr-days-error" />
      </div>
      <Field label="Das" id="nr-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
      <Field label="Até" id="nr-to" type="time" step={900} value={to} error={errors.to} onChange={(e) => setTo(e.target.value)} />
      <Field label="Desconto pedido (%)" id="nr-disc" inputMode="decimal" value={discount} error={errors.discount} onChange={(e) => setDiscount(e.target.value)} />
      <Field label="Desconto máximo (%)" id="nr-cap" hint="O desconto nunca passa disso, nem do menor preço que você aceita." inputMode="decimal" value={cap} error={errors.cap} onChange={(e) => setCap(e.target.value)} />
      <Field label="Margem alvo da regra (%)" id="nr-margin" inputMode="decimal" value={margin} error={errors.margin} onChange={(e) => setMargin(e.target.value)} />
      <Field label="Válida até" id="nr-until" type="date" min={today} value={until} error={errors.until} onChange={(e) => setUntil(e.target.value)} />
      {error ? <div data-span="full"><StatusBanner tone="danger">{error}</StatusBanner></div> : null}
      {/* No celular, a ação fica presa no rodapé da folha. */}
      <div className="tn-actions" data-span="full" data-sheet-footer>
        <Button type="submit" loading={pending}>Ver prévia</Button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}
