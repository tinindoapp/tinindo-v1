// Catálogo do prestador: duração, intervalos, preço base, piso e custos. Arquivar = inativo.
// P54 (doc 11 §3.8): lista sem cartão em volta, uma linha por serviço com o preço editável ali mesmo; Editar e Arquivar
// no "⋯". O formulário pede Nome, Duração e Preço à vista; intervalos, piso, custo e taxa ficam em "Mais opções", e o
// piso em branco é o próprio preço.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type ProviderService, ServiceSaveInput } from "@contracts";
import { ActionsMenu, Button, Field, FormPanel, PageHeader, SetupHint, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { useCrmApi } from "./api.ts";
import { useProfession } from "./CustomersPage.tsx";
import { parsePercentToBps } from "./format.ts";
import { PROFESSION_CONFIG, type ServiceTemplate } from "./profession.ts";
import { EmptyState, fieldErrors, ListSkeleton, Tag } from "./shared.tsx";
import { useIdempotencyKey } from "../../lib/idempotency.ts";
import { serverMessage } from "../../lib/errors.ts";
import { centsToInput, formatCents, parseBRL } from "../../lib/money.ts";

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
  min_price_cents: "O piso precisa ser um valor em reais e não pode passar do preço à vista.",
  estimated_cost_cents: "Custo em reais, ex.: 15,00, ou deixe em branco.",
  fee_bps: "Taxa entre 0% e 100%, ex.: 4,99, ou deixe em branco.",
};

/** Centavos → texto do campo; sem valor, campo vazio. */
const moneyInput = (cents: number | null) => (cents === null ? "" : centsToInput(cents));

function fromService(s: ProviderService): Draft {
  return {
    id: s.id,
    version: s.version,
    active: s.active,
    name: s.name,
    duration: String(s.duration_min),
    before: String(s.buffer_before_min),
    after: String(s.buffer_after_min),
    base: moneyInput(s.base_price_cents),
    floor: moneyInput(s.min_price_cents),
    cost: moneyInput(s.estimated_cost_cents),
    fee: s.fee_bps === null ? "" : String(s.fee_bps / 100).replace(".", ","),
  };
}

const fromTemplate = (t: ServiceTemplate): Draft => ({
  ...EMPTY,
  name: t.name,
  duration: String(t.duration_min),
  before: String(t.buffer_before_min),
  after: String(t.buffer_after_min),
});

/** Modelos da profissão (item 45): só na lista vazia e dentro de "Novo serviço", nunca para sempre na tela. */
function TemplateButtons({ templates, disabled, onPick }: { templates: ServiceTemplate[]; disabled?: boolean; onPick: (t: ServiceTemplate) => void }) {
  return (
    <div className="tn-actions" role="group" aria-label="Começar de um modelo">
      {templates.map((t) => (
        <Button key={t.name} variant="secondary" disabled={disabled} onClick={() => onPick(t)}>
          Modelo: {t.name} ({t.duration_min} min)
        </Button>
      ))}
    </div>
  );
}

const intOf = (v: string) => (/^\s*\d+\s*$/.test(v) ? Number(v) : v.trim() === "" ? undefined : Number.NaN);

export function ServicesPage() {
  const api = useCrmApi();
  const profession = useProfession();
  const config = PROFESSION_CONFIG[profession ?? "other"];
  const [showInactive, setShowInactive] = useState(false);
  // null = carregando (esqueleto, item 40), para a lista vazia não piscar antes dos dados.
  const [items, setItems] = useState<ProviderService[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.listServices({ include_inactive: showInactive });
      setItems(page.items);
      setNext(page.next_cursor);
      setLoadError(null);
    } catch (e) {
      setLoadError(serverMessage(e));
    }
  }, [api, showInactive]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  // A lista vem em páginas (50 por vez): "Carregar mais" em vez de cortar o catálogo sem avisar.
  async function loadMore() {
    if (!next) return;
    try {
      const page = await api.listServices({ include_inactive: showInactive, cursor: next });
      setItems((prev) => [...(prev ?? []), ...page.items.filter((s) => !prev?.some((p) => p.id === s.id))]);
      setNext(page.next_cursor);
    } catch (e) {
      toast({ tone: "danger", message: serverMessage(e) });
    }
  }

  const archiveKeys = useIdempotencyKey();
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
              toast({ tone: "danger", message: serverMessage(e) });
            }
          },
        },
      });
    } catch (e) {
      toast({ tone: "danger", message: serverMessage(e) });
    }
  }

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
        filter={
          <label className="crm-check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Mostrar arquivados
          </label>
        }
      />

      {draft ? (
        <FormPanel key={draft.id ?? "novo"} title={draft.id ? "Editar serviço" : "Novo serviço"} onClose={() => setDraft(null)}>
          <ServiceForm
            draft={draft}
            bufferHint={config.bufferHint}
            templates={draft.id || !profession ? [] : config.templates}
            onCancel={() => setDraft(null)}
            onSaved={async (text) => {
              setDraft(null);
              toast(text);
              await load();
            }}
          />
        </FormPanel>
      ) : null}

      <section className="tn-stack" data-gap="sm" aria-labelledby="crm-services-list">
        <h2 id="crm-services-list" className="tn-visually-hidden">
          Lista de serviços
        </h2>
        {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
        {!loadError && items === null ? <ListSkeleton label="Carregando serviços…" /> : null}
        {!loadError && items?.length === 0 ? (
          <EmptyState
            title={showInactive ? "Nenhum serviço, nem arquivado" : "Nenhum serviço ainda"}
            actions={
              <Button disabled={api.readOnly} onClick={() => setDraft(EMPTY)}>
                Cadastrar serviço
              </Button>
            }
          >
            {profession ? "Comece por um modelo da sua profissão (você põe o preço) ou cadastre do zero." : "Cadastre o primeiro serviço com duração e preço."}
          </EmptyState>
        ) : null}
        {!loadError && items?.length === 0 && profession ? (
          <TemplateButtons templates={config.templates} disabled={api.readOnly} onPick={(t) => setDraft(fromTemplate(t))} />
        ) : null}
        {!loadError && items?.length === 0 && !showInactive ? (
          <SetupHint to="/app/configurar#modelos" action="Usar modelos com preço">
            Ainda não configurado: os modelos da sua profissão trazem duração e faixa de preço, e você confirma cada um antes de criar.
          </SetupHint>
        ) : null}
        {items?.length ? (
          <ul className="tn-list" aria-label="Serviços do catálogo">
            {items.map((s) => (
              <li key={s.id}>
                <div className="tn-list__row tn-list__row--split crm-svc-row">
                  <span className="tn-list__main">
                    <span className="tn-list__text">
                      <span className="tn-list__title">
                        {s.name}
                        {s.active ? null : <> <Tag>Arquivado</Tag></>}
                      </span>
                      {/* Piso e custo ficam na edição (item 45): na lista, duração e intervalo. */}
                      <span className="tn-list__meta">
                        <span className="tn-num">{s.duration_min} min</span>
                        {s.buffer_before_min || s.buffer_after_min
                          ? ` · intervalo ${s.buffer_before_min} antes / ${s.buffer_after_min} depois`
                          : ""}
                      </span>
                    </span>
                  </span>
                  <span className="tn-list__actions">
                    {/* O preço é a ação da linha (doc 11 §3.8). Na demonstração não grava: fica como texto, e o "⋯" diz por quê. */}
                    {api.readOnly || !s.active ? (
                      <span className="crm-price tn-num">{formatCents(s.base_price_cents)}</span>
                    ) : (
                      <Button variant="ghost" size="compact" className="tn-button crm-price tn-num" aria-label={`Mudar o preço de ${s.name}, hoje ${formatCents(s.base_price_cents)}`}
                        aria-expanded={pricing === s.id} onClick={() => setPricing(pricing === s.id ? null : s.id)}>
                        {formatCents(s.base_price_cents)}
                      </Button>
                    )}
                    <ActionsMenu
                      label={`Mais ações para ${s.name}`}
                      hint={api.readOnly ? "Demonstração: editar, mudar o preço e arquivar ficam bloqueados." : undefined}
                      actions={[
                        { label: "Editar", disabled: api.readOnly, onSelect: () => setDraft(fromService(s)) },
                        { label: s.active ? "Arquivar" : "Reativar", disabled: api.readOnly, onSelect: () => void toggleActive(s) },
                      ]}
                    />
                  </span>
                </div>
                {pricing === s.id ? (
                  <PriceEdit service={s} onClose={() => setPricing(null)} onSaved={async (text) => { setPricing(null); toast(text); await load(); }} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {next ? (
          <Button variant="secondary" onClick={() => void loadMore()}>
            Carregar mais
          </Button>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Preço à vista direto na linha. O piso acompanha o preço quando era igual a ele (o padrão); um piso próprio fica, e se
 * passar do preço novo a tela diz para mudar o piso em Editar.
 */
function PriceEdit({ service, onClose, onSaved }: { service: ProviderService; onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const api = useCrmApi();
  const [value, setValue] = useState(centsToInput(service.base_price_cents));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useIdempotencyKey();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(value);
    if (cents === null || cents === undefined || cents < 0) {
      setError(MESSAGES.base_price_cents!);
      return;
    }
    const floor = service.min_price_cents === service.base_price_cents ? cents : service.min_price_cents;
    if (floor > cents) {
      setError(`O piso deste serviço é ${formatCents(floor)}, acima do preço novo. Mude o piso em Editar.`);
      return;
    }
    const parsed = ServiceSaveInput.safeParse({ ...service, service_id: service.id, expected_version: service.version, base_price_cents: cents, min_price_cents: floor });
    if (!parsed.success) {
      setError(MESSAGES.base_price_cents!);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const out = await api.saveService(parsed.data, keys.keyFor(parsed.data));
      keys.reset();
      await onSaved(`${out.service.name}: o preço agora é ${formatCents(out.service.base_price_cents)}.`);
    } catch (err) {
      setError(serverMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="crm-svc-price" aria-label={`Preço de ${service.name}`} onSubmit={(e) => void submit(e)} noValidate>
      <Field label={`Preço à vista de ${service.name} (R$)`} inputMode="decimal" value={value} error={error ?? undefined}
        onChange={(e) => setValue(e.target.value)} />
      <div className="tn-actions">
        <Button type="submit" variant="secondary" size="compact" loading={busy} loadingText="Salvando…">Salvar preço</Button>
        <Button variant="ghost" size="compact" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

function ServiceForm({
  draft,
  bufferHint,
  templates,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  bufferHint: string;
  /** Modelos da profissão: só ao criar. Escolher um preenche nome, duração e intervalos. */
  templates: ServiceTemplate[];
  onCancel: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const api = useCrmApi();
  const [form, setForm] = useState(draft);
  const { formRef, errors, show } = useFormErrors();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Mais opções" abre sozinho quando um campo dele tem erro (o foco precisa achar o campo).
  const [more, setMore] = useState(false);
  const moreError = Boolean(errors.buffer_before_min || errors.buffer_after_min || errors.min_price_cents || errors.estimated_cost_cents || errors.fee_bps);
  const keys = useIdempotencyKey();
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
      // Piso em branco é o próprio preço à vista (doc 11 §3.8).
      min_price_cents: parseBRL(form.floor.trim() ? form.floor : form.base) ?? undefined,
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
      setServerError(serverMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
      <form ref={formRef} className="tn-stack" onSubmit={submit} noValidate>
        {templates.length > 0 ? (
          <TemplateButtons
            templates={templates}
            onPick={(t) => {
              const next = fromTemplate(t);
              // Mantém o que já foi digitado de preço; o modelo traz só nome, duração e intervalos.
              setForm((f) => ({ ...f, name: next.name, duration: next.duration, before: next.before, after: next.after }));
              show({});
            }}
          />
        ) : null}
        <div className="tn-form-grid">
          <Field label="Nome" value={form.name} onChange={set("name")} maxLength={120} required error={errors.name} />
          <Field label="Duração (min)" inputMode="numeric" value={form.duration} onChange={set("duration")} required error={errors.duration_min} />
          <Field label="Preço à vista (R$)" inputMode="decimal" value={form.base} onChange={set("base")} required error={errors.base_price_cents} />
        </div>
        <details className="crm-more" open={more || moreError} onToggle={(e) => setMore(e.currentTarget.open)}>
          <summary>Mais opções</summary>
          <div className="tn-stack">
            <div className="tn-form-grid">
              <Field label="Intervalo antes (min)" inputMode="numeric" value={form.before} onChange={set("before")} error={errors.buffer_before_min} />
              <Field label="Intervalo depois (min)" inputMode="numeric" value={form.after} onChange={set("after")} error={errors.buffer_after_min} />
            </div>
            <p className="tn-muted">{bufferHint}</p>
            <div className="tn-form-grid">
              <Field label="Piso (R$)" hint="Menor preço que você aceita com desconto. Em branco, é o próprio preço." inputMode="decimal" value={form.floor} onChange={set("floor")} error={errors.min_price_cents} />
              <Field label="Custo estimado (R$)" inputMode="decimal" value={form.cost} onChange={set("cost")} error={errors.estimated_cost_cents} />
              <Field label="Taxa de pagamento (%)" inputMode="decimal" value={form.fee} onChange={set("fee")} error={errors.fee_bps} />
            </div>
            {form.cost.trim() === "" ? (
              <StatusBanner tone="warning">
                Sem custo informado, o piso é manual: ele não comprova que o serviço dá lucro.
              </StatusBanner>
            ) : null}
          </div>
        </details>
        {serverError ? <StatusBanner tone="danger">{serverError}</StatusBanner> : null}
        {/* No celular, Salvar fica preso no rodapé da folha. */}
        <div className="tn-actions" data-sheet-footer>
          <Button type="submit" loading={busy} loadingText="Salvando…" disabled={api.readOnly}>
            Salvar
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
  );
}
