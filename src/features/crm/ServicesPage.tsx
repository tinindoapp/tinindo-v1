// Catálogo do prestador: duração, intervalos, preço base, piso e custos. Arquivar = inativo.
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type ProviderService, ServiceSaveInput } from "@contracts";
import { Button, Card, Field, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { createKeyRing, errorMessage, useCrmApi } from "./api.ts";
import { useProfession } from "./CustomersPage.tsx";
import { centsToInput, formatCents, parseBRL, parsePercentToBps } from "./format.ts";
import { PROFESSION_CONFIG, type ServiceTemplate } from "./profession.ts";
import { CrmDemoNotice, fieldErrors, Tag } from "./shared.tsx";

type Draft = {
  id?: string;
  version?: number;
  active: boolean;
  name: string;
  duration: string;
  before: string;
  after: string;
  base: string;
  floor: string;
  cost: string;
  fee: string;
};
const EMPTY: Draft = { active: true, name: "", duration: "", before: "0", after: "0", base: "", floor: "", cost: "", fee: "" };

const MESSAGES: Record<string, string> = {
  name: "Informe um nome de até 120 caracteres, diferente dos serviços ativos.",
  duration_min: "Duração entre 5 minutos e 24 horas, em minutos inteiros.",
  buffer_before_min: "Intervalo entre 0 e 240 minutos.",
  buffer_after_min: "Intervalo entre 0 e 240 minutos.",
  base_price_cents: "Informe o preço em reais, ex.: 60,00.",
  min_price_cents: "O piso precisa ser um valor em reais e não pode passar do preço base.",
  estimated_cost_cents: "Custo em reais, ex.: 15,00, ou deixe em branco.",
  fee_bps: "Taxa entre 0% e 100%, ex.: 4,99, ou deixe em branco.",
};

function fromService(s: ProviderService): Draft {
  return {
    id: s.id,
    version: s.version,
    active: s.active,
    name: s.name,
    duration: String(s.duration_min),
    before: String(s.buffer_before_min),
    after: String(s.buffer_after_min),
    base: centsToInput(s.base_price_cents),
    floor: centsToInput(s.min_price_cents),
    cost: centsToInput(s.estimated_cost_cents),
    fee: s.fee_bps === null ? "" : String(s.fee_bps / 100).replace(".", ","),
  };
}

const intOf = (v: string) => (/^\s*\d+\s*$/.test(v) ? Number(v) : v.trim() === "" ? undefined : Number.NaN);

export function ServicesPage() {
  const api = useCrmApi();
  const profession = useProfession();
  const config = PROFESSION_CONFIG[profession ?? "other"];
  const [showInactive, setShowInactive] = useState(false);
  const [items, setItems] = useState<ProviderService[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.listServices({ include_inactive: showInactive });
      setItems(page.items);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [api, showInactive]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const archiveKeys = useMemo(() => createKeyRing(), []);
  async function setActive(s: ProviderService, active: boolean): Promise<ProviderService> {
    const input = ServiceSaveInput.parse({ ...s, service_id: s.id, expected_version: s.version, active });
    const out = await api.saveService(input, archiveKeys.keyFor(input));
    archiveKeys.reset();
    await load();
    return out.service;
  }

  // Arquivar e reativar são o inverso um do outro: executa na hora e o aviso oferece "Desfazer".
  async function toggleActive(s: ProviderService) {
    const archiving = s.active;
    const done = (name: string, nowActive: boolean) => (nowActive ? `${name} voltou ao catálogo.` : `${name} foi arquivado.`);
    try {
      const saved = await setActive(s, !archiving);
      toast({
        message: done(s.name, !archiving),
        action: {
          label: "Desfazer",
          onAction: async () => {
            try {
              await setActive(saved, archiving);
              toast(done(s.name, archiving));
            } catch (e) {
              toast({ tone: "danger", message: errorMessage(e) });
            }
          },
        },
      });
    } catch (e) {
      toast({ tone: "danger", message: errorMessage(e) });
    }
  }

  const applyTemplate = (t: ServiceTemplate) =>
    setDraft({ ...EMPTY, name: t.name, duration: String(t.duration_min), before: String(t.buffer_before_min), after: String(t.buffer_after_min) });

  return (
    <div className="tn-stack">
      <PageHeader
        title="Serviços"
        id="crm-services-title"
        actions={
          <Button onClick={() => setDraft(EMPTY)} disabled={api.readOnly}>
            Novo serviço
          </Button>
        }
      />
      <CrmDemoNotice />
      <div className="tn-stack" data-gap="sm">
        <div className="crm-toolbar">
          <label className="crm-check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Mostrar arquivados
          </label>
        </div>
        {profession ? (
          <div className="tn-actions" role="group" aria-label="Modelos para começar">
            {config.templates.map((t) => (
              <Button key={t.name} variant="ghost" disabled={api.readOnly} onClick={() => applyTemplate(t)}>
                Modelo: {t.name} ({t.duration_min} min)
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {draft ? (
        <ServiceForm
          draft={draft}
          bufferHint={config.bufferHint}
          onCancel={() => setDraft(null)}
          onSaved={async (text) => {
            setDraft(null);
            toast(text);
            await load();
          }}
        />
      ) : null}

      <Card aria-labelledby="crm-services-list">
        <h2 id="crm-services-list" className="tn-visually-hidden">
          Lista de serviços
        </h2>
        {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
        {!loadError && items.length === 0 ? <p className="tn-muted">Nenhum serviço ainda. Comece por um modelo.</p> : null}
        <ul className="tn-item-list">
          {items.map((s) => (
            <li key={s.id} className="crm-item">
              <div className="crm-item__main">
                <span className="crm-item__title">{s.name}</span>
                {s.active ? null : <Tag>Arquivado</Tag>}
                <div className="crm-item__meta">
                  <span className="tn-num">{s.duration_min} min</span>
                  {s.buffer_before_min || s.buffer_after_min
                    ? ` · intervalo ${s.buffer_before_min} antes / ${s.buffer_after_min} depois`
                    : ""}
                  {" · "}
                  <span className="tn-num">{formatCents(s.base_price_cents)}</span> (piso{" "}
                  <span className="tn-num">{formatCents(s.min_price_cents)}</span>)
                  {s.estimated_cost_cents === null ? " · custo não informado" : ` · custo ${formatCents(s.estimated_cost_cents)}`}
                </div>
              </div>
              <div className="tn-actions crm-item__actions">
                <Button variant="secondary" disabled={api.readOnly} aria-label={`Editar ${s.name}`} onClick={() => setDraft(fromService(s))}>
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  disabled={api.readOnly}
                  aria-label={`${s.active ? "Arquivar" : "Reativar"} ${s.name}`}
                  onClick={() => void toggleActive(s)}
                >
                  {s.active ? "Arquivar" : "Reativar"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ServiceForm({
  draft,
  bufferHint,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  bufferHint: string;
  onCancel: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const api = useCrmApi();
  const [form, setForm] = useState(draft);
  const { formRef, errors, show } = useFormErrors();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useMemo(() => createKeyRing(), []);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ServiceSaveInput.safeParse({
      ...(form.id ? { service_id: form.id, expected_version: form.version } : {}),
      name: form.name,
      duration_min: intOf(form.duration),
      buffer_before_min: intOf(form.before) ?? 0,
      buffer_after_min: intOf(form.after) ?? 0,
      base_price_cents: parseBRL(form.base) ?? undefined,
      min_price_cents: parseBRL(form.floor) ?? undefined,
      estimated_cost_cents: parseBRL(form.cost) ?? (form.cost.trim() ? Number.NaN : null),
      fee_bps: parsePercentToBps(form.fee) ?? (form.fee.trim() ? Number.NaN : null),
      active: form.active,
    });
    if (!parsed.success) {
      // Todos os erros de uma vez, cada um embaixo do seu campo; o foco vai para o primeiro.
      const raw = fieldErrors(parsed.error.issues);
      show(Object.fromEntries(Object.keys(raw).map((k) => [k, MESSAGES[k] ?? raw[k]!])));
      return;
    }
    show({});
    setServerError(null);
    setBusy(true);
    try {
      const out = await api.saveService(parsed.data, keys.keyFor(parsed.data));
      keys.reset();
      await onSaved(`${out.service.name} foi salvo.`);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-labelledby="crm-service-form">
      <form ref={formRef} className="tn-stack" onSubmit={submit} noValidate>
        <h2 id="crm-service-form">{form.id ? "Editar serviço" : "Novo serviço"}</h2>
        <div className="tn-form-grid">
          <Field label="Nome" value={form.name} onChange={set("name")} maxLength={120} required error={errors.name} />
          <Field label="Duração (min)" inputMode="numeric" value={form.duration} onChange={set("duration")} required error={errors.duration_min} />
          <Field label="Intervalo antes (min)" inputMode="numeric" value={form.before} onChange={set("before")} error={errors.buffer_before_min} />
          <Field label="Intervalo depois (min)" inputMode="numeric" value={form.after} onChange={set("after")} error={errors.buffer_after_min} />
        </div>
        <p className="tn-muted">{bufferHint}</p>
        <div className="tn-form-grid">
          <Field label="Preço base (R$)" inputMode="decimal" value={form.base} onChange={set("base")} required error={errors.base_price_cents} />
          <Field label="Piso (R$)" inputMode="decimal" value={form.floor} onChange={set("floor")} required error={errors.min_price_cents} />
          <Field label="Custo estimado (R$)" inputMode="decimal" value={form.cost} onChange={set("cost")} error={errors.estimated_cost_cents} />
          <Field label="Taxa de pagamento (%)" inputMode="decimal" value={form.fee} onChange={set("fee")} error={errors.fee_bps} />
        </div>
        {form.cost.trim() === "" ? (
          <StatusBanner tone="warning">
            Sem custo informado, o piso é manual: ele não comprova que o serviço dá lucro.
          </StatusBanner>
        ) : null}
        {serverError ? <StatusBanner tone="danger">{serverError}</StatusBanner> : null}
        <div className="tn-actions">
          <Button type="submit" loading={busy} loadingText="Salvando…" disabled={api.readOnly}>
            Salvar
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
