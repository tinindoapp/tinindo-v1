// Importação CSV mínima: arquivo → preview com problemas e possíveis duplicados → decisão por
// linha → relatório do servidor (criadas, puladas, rejeitadas). Nada é mesclado.
import { type ChangeEvent, useMemo, useState } from "react";
import type { ImportOutput, ImportPreviewOutput } from "@contracts";
import { Button, Card, Field, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createKeyRing, errorMessage, useCrmApi } from "./api.ts";
import { CSV_MAX_BYTES, type PreviewRow, readCustomerCsv } from "./csv.ts";
import { formatPhone, REJECT_LABEL } from "./format.ts";
import { CrmDemoNotice } from "./shared.tsx";

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
  const [textError, setTextError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
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
    setTextError(null);
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
    setBusy("preview");
    try {
      const out = await api.importPreview(clean.map(({ line, name, phone, email }) => ({ line, name, phone, email })));
      setMatches(new Map(out.rows.filter((r) => r.matches.length > 0).map((r) => [r.line, r.matches])));
    } catch (err) {
      setError(`Não foi possível procurar duplicados: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }

  /** Botão sempre ativo: sem conteúdo, explica embaixo do campo e leva o foco até ele. */
  function askPreview() {
    if (!text.trim()) {
      setTextError("Cole o conteúdo da planilha ou escolha um arquivo CSV.");
      document.getElementById("crm-import-text")?.focus();
      return;
    }
    setTextError(null);
    void preview(text);
  }

  async function commit() {
    if (!rows) return;
    if (rows.every((r) => r.problem)) {
      setError("Nenhuma linha pronta para importar. Corrija a planilha e veja a prévia de novo.");
      return;
    }
    // Todas as linhas vão ao servidor, inclusive as com problema: ele confirma e relata cada uma.
    const payload = rows.map((r) => ({
      line: r.line,
      name: r.name,
      phone: r.phone,
      email: r.email,
      declared_source: r.declared_source,
      on_duplicate: decisions.get(r.line) ?? ("skip" as const),
    }));
    setBusy("import");
    setError(null);
    try {
      setReport(await api.importCustomers(payload, keys.keyFor(payload)));
      keys.reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const problems = rows?.filter((r) => r.problem).length ?? 0;
  const ready = rows ? rows.length - problems : 0;

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="crm-import-title" title="Importar clientes de planilha" />
        <CrmDemoNotice />
        <p>
          CSV com cabeçalho na primeira linha: <strong>nome</strong> (obrigatório), telefone, e-mail e origem. Até 500
          clientes por vez. Exporte do Excel ou do Google Planilhas como CSV.
        </p>
      </div>
      <div className="tn-stack">
        <Field
          id="crm-import-file"
          className="crm-import-file"
          label="Arquivo CSV"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e)}
        />
        <Field
          as="textarea"
          id="crm-import-text"
          className="crm-import-text"
          label="Ou cole o conteúdo"
          value={text}
          error={textError}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) setTextError(null);
          }}
        />
        <div className="tn-actions">
          <Button variant="secondary" loading={busy === "preview"} disabled={busy === "import"} onClick={askPreview}>
            Ver prévia
          </Button>
        </div>
      </div>

      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}

      {rows && !report ? (
        <Card aria-labelledby="crm-import-preview">
          <h2 id="crm-import-preview">Prévia</h2>
          <StatusBanner tone={problems ? "warning" : "info"}>
            {ready} linha(s) prontas, {problems} com problema (não serão importadas e entram no relatório) e{" "}
            {matches.size} parecida(s) com cadastros existentes.
            {ignored.length ? ` Colunas ignoradas: ${ignored.join(", ")}.` : ""}
          </StatusBanner>
          <ul className="tn-item-list">
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
                    <div className="tn-actions crm-item__actions">
                      <Field
                        as="select"
                        label={`Linha ${r.line}`}
                        value={decisions.get(r.line) ?? "skip"}
                        onChange={(e) => setDecisions(new Map(decisions).set(r.line, e.target.value === "create" ? "create" : "skip"))}
                      >
                        <option value="skip">Pular (já existe)</option>
                        <option value="create">Criar mesmo assim</option>
                      </Field>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="tn-actions">
            <Button
              loading={busy === "import"}
              loadingText="Importando…"
              disabled={api.readOnly || busy === "preview"}
              onClick={() => void commit()}
            >
              Importar
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
              <ul className="tn-item-list" aria-label="Linhas rejeitadas">
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
              <ul className="tn-item-list" aria-label="Linhas puladas">
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
