// Clientes: listar, buscar, criar, editar e arquivar. Duplicado é só sugerido, nunca mesclado.
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type Profession } from "@contracts";
import {
  type CrmCustomer,
  CrmCustomerUpsertInput,
  DeclaredSource,
} from "@contracts";
import { Button, Card, Field, StatusBanner } from "../../components/ui/index.tsx";
import { createKeyRing, errorMessage, useCrmApi } from "./api.ts";
import { formatPhone, normalizePhoneBR, SOURCE_LABEL } from "./format.ts";
import { PROFESSION_CONFIG } from "./profession.ts";
import { fieldErrors, SelectField, Tag } from "./shared.tsx";

type Draft = { id?: string; version?: number; name: string; phone: string; email: string; source: string };
const EMPTY: Draft = { name: "", phone: "", email: "", source: "" };
const SOURCE_OPTIONS = [
  { value: "", label: "Não informado" },
  ...DeclaredSource.options.map((v) => ({ value: v, label: SOURCE_LABEL[v] })),
];

export function useProfession(): Profession | null {
  const api = useCrmApi();
  const [profession, setProfession] = useState<Profession | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.profession().then(
      (p) => !cancelled && setProfession(p),
      () => !cancelled && setProfession("other"),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);
  return profession;
}

export function CustomersPage() {
  const api = useCrmApi();
  const profession = useProfession();
  const noun = PROFESSION_CONFIG[profession ?? "other"].customer;
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [items, setItems] = useState<CrmCustomer[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      try {
        const page = await api.listCustomers({ q: query.trim() || undefined, include_archived: showArchived, cursor });
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
        setNext(page.next_cursor);
        setLoadError(null);
      } catch (e) {
        setLoadError(errorMessage(e));
      }
    },
    [api, query, showArchived],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const archiveKeys = useMemo(() => createKeyRing(), []);
  async function toggleArchive(c: CrmCustomer) {
    const input = { customer_id: c.id, expected_version: c.version, archived: !c.archived_at };
    try {
      await api.archiveCustomer(input, archiveKeys.keyFor(input));
      archiveKeys.reset();
      setNotice({ tone: "success", text: c.archived_at ? `${c.name} voltou para a lista.` : `${c.name} foi arquivado.` });
      await load();
    } catch (e) {
      setNotice({ tone: "danger", text: errorMessage(e) });
    }
  }

  return (
    <div className="crm-stack">
      <Card aria-labelledby="crm-customers-title">
        <div className="crm-head">
          <div>
            <p className="tn-caps">Clientes e catálogo</p>
            <h1 id="crm-customers-title">{capitalize(noun.many)}</h1>
          </div>
          <Button onClick={() => setDraft(EMPTY)} disabled={api.readOnly}>
            Novo {noun.one}
          </Button>
        </div>
        <div className="crm-toolbar">
          <Field
            label="Buscar por nome, e-mail ou telefone"
            type="search"
            value={query}
            maxLength={120}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="crm-check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Mostrar arquivados
          </label>
        </div>
      </Card>

      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}

      {draft ? (
        <CustomerForm
          draft={draft}
          noun={noun.one}
          onCancel={() => setDraft(null)}
          onSaved={async (text, tone) => {
            setDraft(null);
            setNotice({ tone, text });
            await load();
          }}
        />
      ) : null}

      <Card aria-labelledby="crm-customers-list">
        <h2 id="crm-customers-list" className="tn-visually-hidden">
          Lista de {noun.many}
        </h2>
        {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
        {!loadError && items.length === 0 ? (
          <p className="crm-note">Nenhum {noun.one} encontrado. Cadastre o primeiro ou importe uma planilha.</p>
        ) : null}
        <ul className="crm-list">
          {items.map((c) => (
            <li key={c.id} className="crm-item">
              <div className="crm-item__main">
                <span className="crm-item__title">{c.name}</span>
                {c.archived_at ? <Tag>Arquivado</Tag> : null}
                <div className="crm-item__meta">
                  {[formatPhone(c.phone), c.email, c.declared_source ? `Origem: ${SOURCE_LABEL[c.declared_source]}` : null]
                    .filter(Boolean)
                    .join(" · ") || "Sem contato cadastrado"}
                </div>
              </div>
              <div className="crm-item__actions">
                <Button
                  variant="secondary"
                  disabled={api.readOnly}
                  aria-label={`Editar ${c.name}`}
                  onClick={() =>
                    setDraft({
                      id: c.id,
                      version: c.version,
                      name: c.name,
                      phone: formatPhone(c.phone),
                      email: c.email ?? "",
                      source: c.declared_source ?? "",
                    })
                  }
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  disabled={api.readOnly}
                  aria-label={`${c.archived_at ? "Desarquivar" : "Arquivar"} ${c.name}`}
                  onClick={() => void toggleArchive(c)}
                >
                  {c.archived_at ? "Desarquivar" : "Arquivar"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {next ? (
          <Button variant="secondary" onClick={() => void load(next)}>
            Carregar mais
          </Button>
        ) : null}
      </Card>
    </div>
  );
}

function CustomerForm({
  draft,
  noun,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  noun: string;
  onCancel: () => void;
  onSaved: (text: string, tone: "success" | "warning") => Promise<void>;
}) {
  const api = useCrmApi();
  const [form, setForm] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useMemo(() => createKeyRing(), []);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const phone = normalizePhoneBR(form.phone);
    if ("error" in phone) {
      setErrors({ phone: "Telefone inválido. Use DDD + número, ex.: (11) 98765-4321." });
      return;
    }
    const parsed = CrmCustomerUpsertInput.safeParse({
      ...(form.id ? { customer_id: form.id, expected_version: form.version } : {}),
      name: form.name,
      phone: phone.value,
      email: form.email.trim() ? form.email.trim().toLowerCase() : null,
      declared_source: form.source || null,
    });
    if (!parsed.success) {
      const raw = fieldErrors(parsed.error.issues);
      setErrors({
        ...(raw.name ? { name: "Informe o nome (até 120 caracteres)." } : {}),
        ...(raw.email ? { email: "E-mail inválido." } : {}),
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const out = await api.upsertCustomer(parsed.data, keys.keyFor(parsed.data));
      keys.reset();
      if (out.possible_duplicates.length > 0) {
        await onSaved(
          `${out.customer.name} foi salvo. Há ${out.possible_duplicates.length} cadastro(s) parecido(s) neste negócio; nada foi mesclado. Confira na lista.`,
          "warning",
        );
      } else await onSaved(`${out.customer.name} foi salvo.`, "success");
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-labelledby="crm-customer-form">
      <form className="crm-form" onSubmit={submit} noValidate>
        <h2 id="crm-customer-form">{form.id ? `Editar ${noun}` : `Novo ${noun}`}</h2>
        <div className="crm-grid">
          <Field label="Nome" value={form.name} onChange={set("name")} maxLength={120} required error={errors.name} />
          <Field label="Telefone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} error={errors.phone} />
          <Field label="E-mail" type="email" value={form.email} onChange={set("email")} error={errors.email} />
          <SelectField
            label="Como chegou até você"
            value={form.source}
            onChange={(v) => setForm({ ...form, source: v })}
            options={SOURCE_OPTIONS}
          />
        </div>
        <p className="crm-note">A origem é o que você declara. O telefone não liga cadastros de outros negócios.</p>
        {serverError ? <StatusBanner tone="danger">{serverError}</StatusBanner> : null}
        <div className="crm-actions">
          <Button type="submit" disabled={busy || api.readOnly}>
            {busy ? "Salvando…" : "Salvar"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
