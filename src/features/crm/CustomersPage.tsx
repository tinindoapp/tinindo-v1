// Clientes: listar, buscar, criar, editar e arquivar. Duplicado é só sugerido, nunca mesclado. No cartão, ligar e
// WhatsApp à mão; editar e arquivar no menu "⋯"; o nome abre a ficha (CustomerPage).
// P49: cada linha diz a última visita ou o próximo horário, e o filtro "Sem voltar há 30+ dias" mostra quem sumiu.
// A data vem da agenda (lib/visits.ts), porque customer.list não traz a última visita.
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type Profession } from "@contracts";
import {
  type CrmCustomer,
  CrmCustomerUpsertInput,
  DeclaredSource,
} from "@contracts";
import { ActionsMenu, Button, Card, Field, FormPanel, LinkButton, PageHeader, Segmented, SetupHint, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { formatDayShort, localParts } from "../../lib/time.ts";
import { agoText, daysSince, isLapsed, LAPSED_DAYS, type VisitInfo } from "../../lib/visits.ts";
import { createKeyRing, type CustomerVisits, errorMessage, useCrmApi } from "./api.ts";
import { ContactButtons } from "./contact.tsx";
import { formatPhone, normalizePhoneBR, SOURCE_LABEL } from "./format.ts";
import { PROFESSION_CONFIG } from "./profession.ts";
import { CrmDemoNotice, EmptyState, fieldErrors, ListSkeleton, Tag } from "./shared.tsx";
import { plural } from "../../lib/text/plural.ts";

/** A busca que produziu uma página: o texto já aparado e se inclui arquivados. */
type CustomerSearch = { q: string; archived: boolean };
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

type Show = "todos" | "sumidos";
const SHOW_OPTIONS = [
  { value: "todos" as const, label: "Todos" },
  { value: "sumidos" as const, label: `Sem voltar há ${LAPSED_DAYS}+ dias` },
];

/** "Próximo: ter., 27/10", "Última visita há 14 dias" ou "Sem visita nos últimos 6 meses". */
export function visitLine(info: VisitInfo | undefined, visits: CustomerVisits): string {
  const now = new Date(visits.now);
  if (info?.next_at) return `Próximo: ${formatDayShort(localParts(info.next_at, visits.timezone).date)}`;
  if (info?.last_visit_at) return `Última visita ${agoText(daysSince(info.last_visit_at, now, visits.timezone))}`;
  return "Sem visita nos últimos 6 meses";
}

/** Última visita e próximo horário de todos (uma leitura da agenda por abertura da lista). */
function useVisits() {
  const api = useCrmApi();
  const [visits, setVisits] = useState<CustomerVisits | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.visitSummary().then(
      (v) => alive && setVisits(v),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [api]);
  return { visits, failed };
}

export function CustomersPage() {
  const api = useCrmApi();
  const { visits, failed: visitsFailed } = useVisits();
  const [show, setShow] = useState<Show>("todos");
  const profession = useProfession();
  const noun = PROFESSION_CONFIG[profession ?? "other"].customer;
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  // null = ainda carregando (esqueleto); depois, a lista e a busca que a produziu (item 40: busca vazia ≠ lista vazia).
  const [items, setItems] = useState<CrmCustomer[] | null>(null);
  const [shown, setShown] = useState<CustomerSearch>({ q: "", archived: false });
  const shownQuery = shown.q;
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Guarda de ordem: cada carga da primeira página tira uma senha nova; resposta com senha antiga (outra busca, ou
  // uma recarga mais nova já em curso) é descartada. "Carregar mais" usa a senha da lista exibida e só anexa se o
  // cursor ainda for o da lista na tela, então nunca junta página de outra busca nem repete a mesma página.
  const ticket = useRef(0);
  const shownNext = useRef<string | null>(null);
  const fetchPage = useCallback(
    async (search: CustomerSearch, cursor?: string) => {
      const mine = cursor ? ticket.current : ++ticket.current;
      try {
        const page = await api.listCustomers({ q: search.q || undefined, include_archived: search.archived, cursor });
        if (mine !== ticket.current || (cursor && cursor !== shownNext.current)) return;
        shownNext.current = page.next_cursor;
        setItems((prev) => (cursor && prev ? [...prev, ...page.items] : page.items));
        setShown(search);
        setNext(page.next_cursor);
        setLoadError(null);
      } catch (e) {
        if (mine === ticket.current) setLoadError(errorMessage(e));
      }
    },
    [api],
  );
  const load = useCallback(
    () => fetchPage({ q: query.trim(), archived: showArchived }),
    [fetchPage, query, showArchived],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  // Filtro de quem não volta: sobre as páginas já carregadas, com a mesma regra da aba Retorno.
  const listed = useMemo(() => {
    if (!items) return [];
    if (show === "todos") return items;
    if (!visits) return [];
    const now = new Date(visits.now);
    return items.filter((c) => isLapsed(visits.byCustomer[c.id], now, visits.timezone));
  }, [items, show, visits]);

  const archiveKeys = useMemo(() => createKeyRing(), []);
  async function setArchived(c: CrmCustomer, archived: boolean): Promise<CrmCustomer> {
    const input = { customer_id: c.id, expected_version: c.version, archived };
    const out = await api.archiveCustomer(input, archiveKeys.keyFor(input));
    archiveKeys.reset();
    await load();
    return out.customer;
  }

  // Arquivar volta atrás (desarquivar): executa na hora e o aviso oferece "Desfazer".
  async function toggleArchive(c: CrmCustomer) {
    const archiving = !c.archived_at;
    try {
      const saved = await setArchived(c, archiving);
      if (!archiving) {
        toast(`${c.name} voltou para a lista.`);
        return;
      }
      toast({
        message: `${c.name} foi arquivado.`,
        action: {
          label: "Desfazer",
          onAction: async () => {
            try {
              await setArchived(saved, false);
              toast(`${c.name} voltou para a lista.`);
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

  return (
    <div className="tn-stack">
      <PageHeader
        title={capitalize(noun.many)}
        id="crm-customers-title"
        actions={
          <>
            <Button onClick={() => setDraft(EMPTY)} disabled={api.readOnly}>
              Novo {noun.one}
            </Button>
            <LinkButton to="importar" variant="secondary">
              Importar planilha
            </LinkButton>
          </>
        }
      />
      <CrmDemoNotice />
      <div className="tn-stack" data-gap="sm">
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
        <Segmented label="Mostrar" hideLabel value={show} options={SHOW_OPTIONS} onChange={setShow} />
        {visitsFailed ? <StatusBanner tone="warning">Não deu para ler a agenda agora: a última visita não aparece e o filtro de quem não volta fica vazio.</StatusBanner> : null}
      </div>

      {draft ? (
        <FormPanel key={draft.id ?? "novo"} title={draft.id ? `Editar ${noun.one}` : `Novo ${noun.one}`} onClose={() => setDraft(null)}>
          <CustomerForm
            draft={draft}
            onCancel={() => setDraft(null)}
            onSaved={async (text, tone) => {
              setDraft(null);
              toast({ message: text, tone });
              await load();
            }}
          />
        </FormPanel>
      ) : null}

      <Card aria-labelledby="crm-customers-list">
        <h2 id="crm-customers-list" className="tn-visually-hidden">
          Lista de {noun.many}
        </h2>
        {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
        {!loadError && items === null ? <ListSkeleton label={`Carregando ${noun.many}…`} /> : null}
        {!loadError && items?.length === 0 && shownQuery ? (
          <EmptyState
            title={`Ninguém com “${shownQuery}”`}
            actions={
              <Button variant="secondary" disabled={api.readOnly} onClick={() => setDraft({ ...EMPTY, ...draftFromQuery(shownQuery) })}>
                Cadastrar
              </Button>
            }
          >
            {showArchived ? "Confira a grafia ou busque pelo telefone." : "Confira a grafia, busque pelo telefone ou marque “Mostrar arquivados”."}
          </EmptyState>
        ) : null}
        {!loadError && items?.length === 0 && !shownQuery ? (
          <EmptyState
            title={`Nenhum ${noun.one} ainda`}
            actions={
              <>
                <Button disabled={api.readOnly} onClick={() => setDraft(EMPTY)}>
                  Cadastrar {noun.one}
                </Button>
                <LinkButton to="importar" variant="secondary">
                  Importar planilha
                </LinkButton>
              </>
            }
          >
            Cadastre o primeiro ou traga a lista que você já tem numa planilha.
          </EmptyState>
        ) : null}
        {!loadError && items?.length === 0 && !shownQuery && !showArchived ? (
          <SetupHint to="/app/configurar" action="Ver os passos">
            Ainda não configurado: com o link público no ar, {noun.one === "aluno" ? "o primeiro aluno" : "o primeiro cliente"} pode chegar sozinho. Veja o que falta para o seu negócio ficar pronto.
          </SetupHint>
        ) : null}
        {!loadError && show === "sumidos" && items && items.length > 0 && listed.length === 0 ? (
          <EmptyState title={`Ninguém sem voltar há ${LAPSED_DAYS} dias ou mais`}>
            {visits ? "Quem veio nos últimos 6 meses voltou há menos tempo ou já tem horário marcado." : "Carregando as visitas da agenda…"}
          </EmptyState>
        ) : null}
        <ul className="tn-item-list" aria-label={show === "sumidos" ? `Sem voltar há ${LAPSED_DAYS}+ dias` : undefined}>
          {listed.map((c) => (
            <li key={c.id} className="crm-item">
              <div className="crm-item__main">
                <Link to={c.id} className="crm-item__name">
                  {c.name}
                </Link>
                {c.archived_at ? <Tag>Arquivado</Tag> : null}
                <div className="crm-item__meta">
                  {[formatPhone(c.phone), c.email, c.declared_source ? `Origem: ${SOURCE_LABEL[c.declared_source]}` : null]
                    .filter(Boolean)
                    .join(" · ") || "Sem contato cadastrado"}
                </div>
                {visits ? <div className="crm-item__visit tn-num">{visitLine(visits.byCustomer[c.id], visits)}</div> : null}
              </div>
              <div className="tn-actions crm-item__actions">
                <ContactButtons name={c.name} phone={c.phone} />
                {/* Editar e arquivar são menos usados que ligar: ficam no menu "⋯". */}
                <ActionsMenu
                  label={`Mais ações para ${c.name}`}
                  hint={api.readOnly ? "Demonstração: editar e arquivar ficam bloqueados." : undefined}
                  actions={[
                    {
                      label: "Editar",
                      disabled: api.readOnly,
                      onSelect: () =>
                        setDraft({
                          id: c.id,
                          version: c.version,
                          name: c.name,
                          phone: formatPhone(c.phone),
                          email: c.email ?? "",
                          source: c.declared_source ?? "",
                        }),
                    },
                    {
                      label: c.archived_at ? "Desarquivar" : "Arquivar",
                      disabled: api.readOnly,
                      onSelect: () => void toggleArchive(c),
                    },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
        {next ? (
          <Button variant="secondary" onClick={() => void fetchPage(shown, next)}>
            Carregar mais
          </Button>
        ) : null}
      </Card>
    </div>
  );
}

function CustomerForm({
  draft,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  onCancel: () => void;
  onSaved: (text: string, tone: "success" | "warning") => Promise<void>;
}) {
  const api = useCrmApi();
  const [form, setForm] = useState(draft);
  const { formRef, errors, show } = useFormErrors<"name" | "phone" | "email">();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useMemo(() => createKeyRing(), []);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Valida tudo de uma vez: cada erro embaixo do seu campo e o foco no primeiro.
    const phone = normalizePhoneBR(form.phone);
    const parsed = CrmCustomerUpsertInput.safeParse({
      ...(form.id ? { customer_id: form.id, expected_version: form.version } : {}),
      name: form.name,
      phone: "error" in phone ? null : phone.value,
      email: form.email.trim() ? form.email.trim().toLowerCase() : null,
      declared_source: form.source || null,
    });
    const raw = parsed.success ? {} : fieldErrors(parsed.error.issues);
    const ok = show({
      name: raw.name && (form.name.trim() ? "O nome pode ter até 120 caracteres." : "Informe o nome."),
      phone: "error" in phone && "Telefone inválido. Use DDD + número, ex.: (11) 98765-4321.",
      email: raw.email && "E-mail inválido. Confira o endereço, ex.: ana@exemplo.com.",
    });
    if (!ok || !parsed.success) return;
    setServerError(null);
    setBusy(true);
    try {
      const out = await api.upsertCustomer(parsed.data, keys.keyFor(parsed.data));
      keys.reset();
      if (out.possible_duplicates.length > 0) {
        await onSaved(
          `${out.customer.name} foi salvo. Há ${plural(out.possible_duplicates.length, "cadastro parecido", "cadastros parecidos")} neste negócio; nada foi mesclado. Confira na lista.`,
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
    <form ref={formRef} className="tn-stack" onSubmit={submit} noValidate>
        <div className="tn-form-grid">
          <Field label="Nome" value={form.name} onChange={set("name")} maxLength={120} required error={errors.name} />
          <Field label="Telefone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} error={errors.phone} />
          <Field label="E-mail" type="email" value={form.email} onChange={set("email")} error={errors.email} />
          <Field as="select" label="Como chegou até você" value={form.source} onChange={set("source")}>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Field>
        </div>
        <p className="tn-muted">A origem é o que você declara. O telefone não liga cadastros de outros negócios.</p>
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

/** "Cadastrar" a partir da busca sem resultado: o que foi digitado já entra no campo certo. */
function draftFromQuery(q: string): Partial<Draft> {
  const text = q.trim();
  if (/@/.test(text)) return { email: text };
  if (/^[\d\s()+-]+$/.test(text) && /\d{4}/.test(text.replace(/\D/g, ""))) return { phone: text };
  return { name: text };
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
