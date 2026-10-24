// EMULAÇÃO de Notas fiscais para a demonstração sem servidor: homologação simulada, sempre rotulada. Mesmas regras do
// banco: elegibilidade com motivos (perfil MEI, CNPJ válido, representação pelos termos, credencial válida); uma nota
// viva por recebível; emitir não mexe no recebível; cancelamento com motivo; pasta do mês. Nada sai do navegador.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, FiscalEmitInput, FiscalProfileSaveInput, RETRYABLE } from "@contracts";
import { FIXED_NOW } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { FiscalDocument, FiscalFolder, FiscalOverview, FiscalPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const TERMS = "Autorizo a Tinindo a emitir, em meu nome, Notas Fiscais de Serviço eletrônicas (NFS-e) dos atendimentos que eu pedir, usando a credencial que eu mesmo cadastrei no provedor fiscal. Cada nota é emitida só quando eu pedir, com os dados que eu conferir. Emitir a nota não confirma pagamento. Posso revogar esta autorização a qualquer momento; a revogação não cancela notas já emitidas.";
const RECEIVABLES = [
  { id: "70000000-0000-4000-8000-0000000000d1", description: "Corte", amount_cents: 6000, customer_name: "Ana Beatriz (exemplo)" },
  { id: "70000000-0000-4000-8000-0000000000d2", description: "Corte e barba", amount_cents: 10000, customer_name: "Carlos (exemplo)" },
];
interface State {
  profile: FiscalOverview["profile"];
  representation: FiscalOverview["representation"];
  credential: FiscalOverview["credential"];
  docs: FiscalDocument[];
  idem: Map<string, unknown>;
  seq: number;
  clock: number;
  termsHash: string | null;
}
let shared: State | null = null;
const state = (): State => (shared ??= { profile: null, representation: null, credential: null, docs: [], idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW), termsHash: null });
const ts = () => new Date((state().clock += 1000)).toISOString().replace(/\.\d{3}Z$/, "Z");
const id = () => `f1f1f1f1-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}

async function termsHash(): Promise<string> {
  const s = state();
  if (s.termsHash) return s.termsHash;
  const bytes = new TextEncoder().encode(TERMS);
  s.termsHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return s.termsHash;
}
function cnpjOk(v: string): boolean {
  if (!/^\d{14}$/.test(v) || /^(\d)\1{13}$/.test(v)) return false;
  const calc = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + Number(v[i]) * x, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return calc(12) === Number(v[12]) && calc(13) === Number(v[13]);
}
function cpfOk(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^(\d)\1{10}$/.test(v)) return false;
  const calc = (n: number) => {
    const s = [...v.slice(0, n)].reduce((a, d, i) => a + Number(d) * (n + 1 - i), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return calc(9) === Number(v[9]) && calc(10) === Number(v[10]);
}
const live = (d: FiscalDocument) => ["submitting", "processing", "authorized", "unknown", "cancel_requested"].includes(d.status);

async function overview(): Promise<FiscalOverview> {
  const s = state();
  const hash = await termsHash();
  const reasons: FiscalOverview["eligibility"]["reasons"] = [];
  if (!s.profile) reasons.push("profile_missing");
  else {
    if (s.profile.regime !== "mei") reasons.push("regime_not_eligible");
    if (!cnpjOk(s.profile.cnpj)) reasons.push("cnpj_invalid");
  }
  if (!s.representation?.active) reasons.push("representation_missing");
  if (s.credential?.status !== "valid") reasons.push("credential_invalid");
  return clone({
    profile: s.profile, terms: { text: TERMS, hash }, representation: s.representation, credential: s.credential,
    eligibility: { eligible: reasons.length === 0, reasons, environment: "homologacao" },
    homologated: s.docs.some((d) => d.authorized_at),
    documents: [...s.docs].reverse().slice(0, 50),
    receivables: RECEIVABLES.filter((r) => !s.docs.some((d) => d.receivable_id === r.id && live(d))).map((r) => ({ id: r.id, description: r.description, amount_cents: r.amount_cents,
      status: "open", customer_id: null, customer_name: r.customer_name, created_at: FIXED_NOW })),
  });
}
async function once<T>(key: string, run: () => Promise<T> | T): Promise<T> {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = await run();
  s.idem.set(key, clone(v));
  return clone(v);
}

export function createDemoPort(): FiscalPort {
  return {
    kind: "demo",
    overview,
    saveProfile: (draft, key) => once(key, async () => {
      const d = FiscalProfileSaveInput.parse(draft);
      const s = state();
      if (!cnpjOk(d.cnpj)) fail("VALIDATION_ERROR", "cnpj");
      if ((s.profile?.version ?? 0) !== d.expected_version) fail("STALE_VERSION");
      s.profile = { legal_name: d.legal_name, cnpj: d.cnpj, regime: d.regime, municipality_ibge: d.municipality_ibge, service_code: d.service_code,
        production_enabled: false, version: (s.profile?.version ?? 0) + 1 };
      return overview();
    }),
    grant: (hash, key) => once(key, async () => {
      if (hash !== (await termsHash())) fail("STALE_VERSION", "terms_hash");
      const at = ts();
      state().representation = { id: id(), granted_at: at, valid_until: new Date(Date.parse(at) + 365 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), current_terms: true, active: true };
      return overview();
    }),
    revoke: (key) => once(key, async () => {
      if (!state().representation) fail("POLICY_REJECTED", "representation");
      state().representation = null;
      return overview();
    }),
    async checkCredential() {
      if (!state().profile) fail("POLICY_REJECTED", "profile");
      state().credential = { status: "valid", valid_until: new Date(state().clock + 365 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), environment: "homologacao", checked_at: ts() };
      return overview();
    },
    emit: (draft, key) => once(key, async () => {
      const d = FiscalEmitInput.parse(draft);
      const o = await overview();
      if (!o.eligibility.eligible) fail("POLICY_REJECTED", "eligibility");
      if (d.taker_document && !(cpfOk(d.taker_document) || cnpjOk(d.taker_document))) fail("VALIDATION_ERROR", "taker_document");
      const rec = RECEIVABLES.find((r) => r.id === d.receivable_id);
      if (d.receivable_id && !rec) fail("NOT_FOUND", "receivable_id");
      if (rec && d.amount_cents > rec.amount_cents) fail("POLICY_REJECTED", "amount_cents");
      const s = state();
      if (rec && s.docs.some((x) => x.receivable_id === rec.id && live(x))) fail("POLICY_REJECTED", "receivable_has_document");
      const n = s.docs.length + 1;
      const doc: FiscalDocument = {
        id: id(), environment: "homologacao", status: "authorized", receivable_id: d.receivable_id, customer_id: null, taker_name: d.taker_name,
        taker_document_masked: d.taker_document ? "•".repeat(d.taker_document.length - 2) + d.taker_document.slice(-2) : null,
        service_code: o.profile!.service_code, description: d.description, amount_cents: d.amount_cents, competence_date: d.competence_date,
        protocol: `SIM-H${String(n).padStart(6, "0")}`, number: `H${String(n).padStart(6, "0")}`, verification_code: `HOMOLOG${String(n).padStart(4, "0")}`,
        pdf_url: null, xml_url: null, reject_reason: null, cancel_reason: null, authorized_at: ts(), cancelled_at: null, created_at: ts(), version: 2,
      };
      s.docs.push(doc);
      return doc;
    }),
    cancel: (draft, key) => once(key, () => {
      const s = state();
      const doc = s.docs.find((x) => x.id === draft.document_id);
      if (!doc) fail("NOT_FOUND");
      if (doc.version !== draft.expected_version) fail("STALE_VERSION");
      if (doc.status !== "authorized") fail("POLICY_REJECTED", "status");
      if (draft.reason.trim().length < 15) fail("VALIDATION_ERROR", "reason");
      Object.assign(doc, { status: "cancelled", cancel_reason: draft.reason.trim(), cancelled_at: ts(), version: doc.version + 2 });
      return doc;
    }),
    async folder(month): Promise<FiscalFolder> {
      const s = state();
      const docs = s.docs.filter((d) => d.competence_date.startsWith(month) && ["authorized", "cancel_requested", "cancelled"].includes(d.status));
      const ok = docs.filter((d) => d.status !== "cancelled");
      return clone({
        month, profile: s.profile ? { legal_name: s.profile.legal_name, cnpj: s.profile.cnpj, regime: s.profile.regime, municipality_ibge: s.profile.municipality_ibge } : null,
        documents: docs, totals: { authorized_count: ok.length, authorized_cents: ok.reduce((a, d) => a + d.amount_cents, 0), cancelled_count: docs.length - ok.length,
          homologacao_count: docs.filter((d) => d.environment === "homologacao").length },
      });
    },
  };
}
