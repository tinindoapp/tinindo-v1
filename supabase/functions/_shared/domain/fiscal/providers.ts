// Porta do provedor fiscal (P16). O provedor emite a NFS-e no padrão nacional com a credencial que o próprio prestador
// cadastrou nele (certificado ou procuração); a Tinindo nunca recebe certificado ou senha. Dois adaptadores:
// - simulado: só HOMOLOGAÇÃO, determinístico, rotulado; serve para demonstração e testes;
// - REST genérico: desligado sem FISCAL_PROVIDER_URL/FISCAL_PROVIDER_KEY (produção é decisão e contrato do dono).
// Falha de rede ou tempo esgotado na emissão é "unknown": PODE ter sido emitida; consulta-se pela referência.

export type FiscalEnv = "homologacao" | "producao";

export interface FiscalEmitRequest {
  provider_ref: string;
  environment: FiscalEnv;
  cnpj: string;
  municipality_ibge: string;
  service_code: string;
  taker_name: string;
  taker_document: string | null;
  description: string;
  amount_cents: number;
  competence_date: string;
}
export type FiscalEmitResult =
  | { outcome: "authorized"; protocol: string; number: string; verification_code: string | null; pdf_url: string | null; xml_url: string | null }
  | { outcome: "processing"; protocol: string }
  | { outcome: "rejected"; reason: string }
  | { outcome: "unknown" };
export type CredentialStatus = { status: "missing" | "valid" | "expired" | "invalid"; valid_until: string | null };

export interface FiscalProviderPort {
  readonly name: "simulated" | "rest";
  readonly configured: boolean;
  /** Ambientes que este adaptador atende. */
  readonly environments: readonly FiscalEnv[];
  credential(cnpj: string, environment: FiscalEnv): Promise<CredentialStatus | null>;
  emit(req: FiscalEmitRequest): Promise<FiscalEmitResult>;
  /** Consulta pela referência (idempotente). null = o provedor não respondeu. */
  query(providerRef: string, environment: FiscalEnv): Promise<FiscalEmitResult | null>;
  cancel(providerRef: string, environment: FiscalEnv, reason: string): Promise<{ outcome: "cancelled" } | { outcome: "refused"; reason: string } | null>;
}

/**
 * Simulado (homologação): credencial válida por um ano, autoriza na hora com número sequencial por referência.
 * Guarda o que emitiu em memória (por instância), então repetir a mesma referência devolve a mesma nota.
 */
export function createSimulatedFiscalProvider(opts: { now?: () => Date } = {}): FiscalProviderPort {
  const now = opts.now ?? (() => new Date());
  const issued = new Map<string, Extract<FiscalEmitResult, { outcome: "authorized" }>>();
  let seq = 0;
  return {
    name: "simulated",
    configured: true,
    environments: ["homologacao"],
    async credential(_cnpj, environment) {
      if (environment !== "homologacao") return { status: "missing", valid_until: null };
      return { status: "valid", valid_until: new Date(now().getTime() + 365 * 86_400_000).toISOString() };
    },
    async emit(req) {
      if (req.environment !== "homologacao") return { outcome: "rejected", reason: "O provedor simulado só atende homologação." };
      const hit = issued.get(req.provider_ref);
      if (hit) return hit;
      seq += 1;
      const number = `H${String(seq).padStart(6, "0")}`;
      const r = { outcome: "authorized" as const, protocol: `SIM-${number}`, number, verification_code: `HOMOLOG${String(seq).padStart(4, "0")}`, pdf_url: null, xml_url: null };
      issued.set(req.provider_ref, r);
      return r;
    },
    async query(ref) {
      return issued.get(ref) ?? { outcome: "rejected", reason: "Referência desconhecida no provedor simulado." };
    },
    async cancel(ref) {
      return issued.has(ref) ? { outcome: "cancelled" } : { outcome: "refused", reason: "Referência desconhecida no provedor simulado." };
    },
  };
}

interface RestDeps { baseUrl: string | null; apiKey: string | null; fetch?: typeof fetch }

/** Adaptador REST genérico de provedor de NFS-e (contrato a confirmar com o provedor escolhido; desligado sem env). */
export function createRestFiscalProvider(deps: RestDeps): FiscalProviderPort {
  const doFetch = deps.fetch ?? fetch;
  const configured = !!deps.baseUrl && !!deps.apiKey;
  const base = (deps.baseUrl ?? "").replace(/\/$/, "");
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      const res = await doFetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) });
      return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null };
    } catch {
      return null;
    }
  };
  const asResult = (json: Record<string, unknown> | null): FiscalEmitResult | null => {
    const s = json?.status;
    if (s === "authorized" && typeof json?.number === "string" && typeof json?.protocol === "string") {
      return { outcome: "authorized", protocol: json.protocol, number: json.number, verification_code: typeof json.verification_code === "string" ? json.verification_code : null,
        pdf_url: typeof json.pdf_url === "string" && json.pdf_url.startsWith("https://") ? json.pdf_url : null,
        xml_url: typeof json.xml_url === "string" && json.xml_url.startsWith("https://") ? json.xml_url : null };
    }
    if (s === "processing" && typeof json?.protocol === "string") return { outcome: "processing", protocol: json.protocol };
    if (s === "rejected") return { outcome: "rejected", reason: typeof json?.reason === "string" ? json.reason.slice(0, 300) : "Rejeitada pelo provedor." };
    return null;
  };
  return {
    name: "rest",
    configured,
    environments: ["homologacao", "producao"],
    async credential(cnpj, environment) {
      if (!configured) return null;
      const r = await call(`/credentials/${cnpj}?environment=${environment}`);
      const st = r?.json?.status;
      if (st !== "missing" && st !== "valid" && st !== "expired" && st !== "invalid") return null;
      return { status: st, valid_until: typeof r?.json?.valid_until === "string" ? r.json.valid_until : null };
    },
    async emit(req) {
      if (!configured) return { outcome: "rejected", reason: "Provedor fiscal não configurado neste ambiente." };
      const r = await call("/nfse", { method: "POST", body: JSON.stringify(req) });
      if (!r) return { outcome: "unknown" };
      if (r.status >= 500) return { outcome: "unknown" };
      return asResult(r.json) ?? { outcome: "unknown" };
    },
    async query(ref, environment) {
      if (!configured) return null;
      const r = await call(`/nfse/${encodeURIComponent(ref)}?environment=${environment}`);
      return r ? asResult(r.json) : null;
    },
    async cancel(ref, environment, reason) {
      if (!configured) return null;
      const r = await call(`/nfse/${encodeURIComponent(ref)}/cancel`, { method: "POST", body: JSON.stringify({ environment, reason }) });
      if (!r) return null;
      if (r.json?.status === "cancelled") return { outcome: "cancelled" };
      if (r.json?.status === "refused") return { outcome: "refused", reason: typeof r.json.reason === "string" ? r.json.reason.slice(0, 300) : "Recusado pelo provedor." };
      return null;
    },
  };
}
