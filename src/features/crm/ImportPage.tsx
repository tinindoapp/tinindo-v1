// Importação CSV mínima: arquivo → preview com problemas e possíveis duplicados → decisão por
// linha → relatório do servidor (criadas, puladas, rejeitadas). Nada é mesclado.
import { type ChangeEvent, useMemo, useState } from "react";
import type { ImportOutput, ImportPreviewOutput } from "../../../supabase/functions/crm/contract.ts";
import { Button, Card, StatusBanner } from "../../components/ui/index.tsx";
import { createKeyRing, errorMessage, useCrmApi } from "./api.ts";
import { CSV_MAX_BYTES, type PreviewRow, readCustomerCsv } from "./csv.ts";
import { formatPhone, REJECT_LABEL } from "./format.ts";
import { SelectField } from "./shared.tsx";

type Matches = ImportPreviewOutput["rows"][number]["matches"];
const REASON_LABEL = { phone: "telefone", email: "e-mail", name: "nome" } as const;

export function ImportPage() {
  const api = useCrmApi();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [matches, setMatches] = useState<Map<number, Matches>>(new Map());
  const [decisions, setDecisions] = useState<Map<number, "skip" | "create">>(new Map());
  const [report, setReport] = useState<ImportOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useMemo(() => createKeyRing(), []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) {
      setError("Arquivo maior que 1 MB.");
      return;
    }
    const content = await file.text();
    setText(content);
    await preview(content);
  }

  async function preview(content: string) {
    setReport(null);
    setError(null);
    setMatches(new Map());
    setDecisions(new Map());
    const parsed = readCustomerCsv(content);
    if (!parsed.ok) {
      setRows(null);
      setError(parsed.error);
      return;
    }
    setRows(parsed.rows);
    setIgnored(parsed.ignoredColumns);
    const clean = parsed.rows.filter((r) => !r.problem);
    if (clean.length === 0) return;
    setBusy(true);
    try {
      const out = await api.importPreview(clean.map(({ line, name, phone, email }) => ({ line, name, phone, email })));
      setMatches(new Map(out.rows.filter((r) => r.matches.length > 0).map((r) => [r.line, r.matches])));
    } catch (err) {
      setError(`Não foi possível procurar duplicados: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!rows) return;
    // Todas as linhas vão ao servidor, inclusive as com problema: ele confirma e relata cada uma.
    const payload = rows.map((r) => ({
      line: r.line,
      name: r.name,
      phone: r.phone,
      email: r.email,
      declared_source: r.declared_source,
      on_duplicate: decisions.get(r.line) ?? ("skip" as const),
    }));
    setBusy(true);
    setError(null);
    try {
      setReport(await api.importCustomers(payload, keys.keyFor(payload)));
      keys.reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const problems = rows?.filter((r) => r.problem).length ?? 0;
  const ready = rows ? rows.length - problems : 0;

  return (
    <div className="crm-stack">
      <Card aria-labelledby="crm-import-title">
        <p className="tn-caps">Clientes e catálogo</p>
        <h1 id="crm-import-title">Importar clientes de planilha</h1>
        <p className="crm-note">
          CSV com cabeçalho na primeira linha: <strong>nome</strong> (obrigatório), telefone, e-mail e origem. Até 500
          clientes por vez. Exporte do Excel ou do Google Planilhas como CSV.
        </p>
        <div className="tn-field">
          <label htmlFor="crm-import-file">Arquivo CSV</label>
          <input id="crm-import-file" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} />
        </div>
        <div className="tn-field">
          <label htmlFor="crm-import-text">Ou cole o conteúdo</label>
          <textarea id="crm-import-text" className="crm-textarea" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="crm-actions">
          <Button variant="secondary" disabled={!text.trim() || busy} onClick={() => void preview(text)}>
            Ver prévia
          </Button>
        </div>
      </Card>

      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}

      {rows && !report ? (
        <Card aria-labelledby="crm-import-preview">
          <h2 id="crm-import-preview">Prévia</h2>
          <StatusBanner tone={problems ? "warning" : "info"}>
            {ready} linha(s) prontas, {problems} com problema (não serão importadas e entram no relatório) e{" "}
            {matches.size} parecida(s) com cadastros existentes.
            {ignored.length ? ` Colunas ignoradas: ${ignored.join(", ")}.` : ""}
          </StatusBanner>
          <ul className="crm-list">
            {rows.map((r) => {
              const m = matches.get(r.line);
              return (
                <li key={r.line} className="crm-item">
                  <div className="crm-item__main">
                    <span className="crm-item__title">
                      <span className="tn-num">Linha {r.line}</span> · {r.name || "(sem nome)"}
                    </span>
                    <div className="crm-item__meta">
                      {[r.phone && !r.problem ? formatPhone(r.phone) : r.phone, r.email].filter(Boolean).join(" · ")}
                    </div>
                    {r.problem ? <div className="crm-item__meta">Problema: {REJECT_LABEL[r.problem.reason]}</div> : null}
                    {m ? (
                      <div className="crm-item__meta">
                        Parecido com:{" "}
                        {m.map((x) => `${x.name} (${x.reasons.map((k) => REASON_LABEL[k]).join(", ")})`).join("; ")}
                      </div>
                    ) : null}
                  </div>
                  {m && !r.problem ? (
                    <div className="crm-item__actions">
                      <SelectField
                        label={`Linha ${r.line}`}
                        value={decisions.get(r.line) ?? "skip"}
                        onChange={(v) => setDecisions(new Map(decisions).set(r.line, v === "create" ? "create" : "skip"))}
                        options={[
                          { value: "skip", label: "Pular (já existe)" },
                          { value: "create", label: "Criar mesmo assim" },
                        ]}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="crm-actions">
            <Button disabled={busy || api.readOnly || ready === 0} onClick={() => void commit()}>
              {busy ? "Importando…" : "Importar"}
            </Button>
          </div>
        </Card>
      ) : null}

      {report ? (
        <Card aria-labelledby="crm-import-report">
          <h2 id="crm-import-report">Resultado da importação</h2>
          <StatusBanner tone={report.rejected.length || report.skipped.length ? "warning" : "success"}>
            {report.created.length} criado(s), {report.skipped.length} pulado(s) por possível duplicado e{" "}
            {report.rejected.length} rejeitado(s).
          </StatusBanner>
          {report.rejected.length ? (
            <>
              <h3>Rejeitadas</h3>
              <ul className="crm-list" aria-label="Linhas rejeitadas">
                {report.rejected.map((r) => (
                  <li key={r.line} className="crm-item">
                    <span className="crm-item__main">
                      <span className="tn-num">Linha {r.line}</span>: {REJECT_LABEL[r.reason]}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {report.skipped.length ? (
            <>
              <h3>Puladas</h3>
              <ul className="crm-list" aria-label="Linhas puladas">
                {report.skipped.map((r) => (
                  <li key={r.line} className="crm-item">
                    <span className="crm-item__main">
                      <span className="tn-num">Linha {r.line}</span>: já existe cadastro parecido (
                      {r.duplicate_of.length})
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
