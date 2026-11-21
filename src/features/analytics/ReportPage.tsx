// P32 bloco 4 · "Sua semana" e "Seu mês": o relatório do negócio, com período, denominador e "dados insuficientes"
// quando não há base. Compartilhar como texto (WhatsApp, e-mail) ou como imagem, sem nome de cliente.
import { useEffect, useState } from "react";
import { Button, Card, PageHeader, StatusBanner, toast } from "../../components/ui/index.tsx";
import { addDays, localParts } from "../../lib/time.ts";
import type { ReportKind, ReportOutput, ReportPort } from "./reportPort.ts";
import { periodText, reportLines, reportShareText, reportTitle } from "./reportText.ts";

/** Data de referência do período anterior ou seguinte. */
export function shiftRef(kind: ReportKind, ref: string, dir: -1 | 1): string {
  if (kind === "week") return addDays(ref, 7 * dir);
  const [y, m] = ref.split("-").map(Number) as [number, number];
  const mm = m + dir;
  const yy = mm === 0 ? y - 1 : mm === 13 ? y + 1 : y;
  return `${yy}-${String(((mm + 11) % 12) + 1).padStart(2, "0")}-01`;
}

/** Desenha o relatório numa imagem (PNG) para compartilhar. Null quando o navegador não desenha (canvas ausente). */
export async function reportImage(r: ReportOutput, business: string | null): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  const lines = reportLines(r);
  canvas.width = 1080;
  canvas.height = 260 + lines.length * 120 + 100;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.fillText(reportTitle(r), 72, 120);
  ctx.font = "36px system-ui, sans-serif";
  ctx.fillStyle = "#555555";
  ctx.fillText(`${business ? `${business} · ` : ""}${periodText(r)}`, 72, 180);
  lines.forEach((l, i) => {
    const y = 290 + i * 120;
    ctx.fillStyle = "#555555";
    ctx.font = "32px system-ui, sans-serif";
    ctx.fillText(l.label, 72, y);
    ctx.fillStyle = "#111111";
    ctx.font = "bold 48px system-ui, sans-serif";
    ctx.fillText(l.value, 72, y + 56);
  });
  ctx.fillStyle = "#555555";
  ctx.font = "28px system-ui, sans-serif";
  ctx.fillText("Feito na Tinindo.", 72, canvas.height - 60);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function ReportPage({ port, business }: { port: ReportPort; business: string | null }) {
  const today = localParts(port.now(), "America/Sao_Paulo").date;
  const [kind, setKind] = useState<ReportKind>("week");
  const [ref, setRef] = useState(today);
  const [loaded, setLoaded] = useState<{ key: string; report: ReportOutput } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${kind}|${ref}`;
  useEffect(() => {
    let alive = true;
    port.report(kind, ref).then(
      (r) => { if (alive) { setLoaded({ key: `${kind}|${ref}`, report: r }); setError(null); } },
      () => { if (alive) setError("Não foi possível montar o relatório agora. Tentar de novo é seguro."); },
    );
    return () => { alive = false; };
  }, [port, kind, ref]);
  const report = loaded?.key === key ? loaded.report : null;
  const next = shiftRef(kind, ref, 1);
  const canNext = next <= today;

  async function shareText() {
    if (!report) return;
    const text = reportShareText(report, business);
    try {
      if (navigator.share) await navigator.share({ title: reportTitle(report), text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Texto copiado. Cole onde quiser enviar.");
      }
    } catch {
      // Compartilhar cancelado: nada a fazer.
    }
  }

  async function shareImage() {
    if (!report) return;
    const blob = await reportImage(report, business);
    if (!blob) {
      toast({ tone: "warning", message: "Este navegador não gera a imagem. Use o texto." });
      return;
    }
    const name = `${kind === "week" ? "sua-semana" : "seu-mes"}-${ref}.png`;
    const file = new File([blob], name, { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: reportTitle(report) });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch {
      // Compartilhar cancelado.
    }
  }

  return (
    <div className="tn-page-intro tn-an-report">
      <PageHeader id="an-report-title" title={kind === "week" ? "Sua semana" : "Seu mês"}
        subtitle="Os números do seu negócio no período, com a base de cada um." />
      {port.kind === "demo" ? <StatusBanner tone="info">Demonstração: números da base de exemplo.</StatusBanner> : null}
      <div className="tn-an-report__bar">
        <div role="group" aria-label="Período">
          <Button size="compact" variant={kind === "week" ? "primary" : "secondary"} aria-pressed={kind === "week"} onClick={() => { setKind("week"); setRef(today); }}>Sua semana</Button>
          <Button size="compact" variant={kind === "month" ? "primary" : "secondary"} aria-pressed={kind === "month"} onClick={() => { setKind("month"); setRef(today); }}>Seu mês</Button>
        </div>
        <div role="group" aria-label="Navegar">
          <Button size="compact" variant="ghost" onClick={() => setRef(shiftRef(kind, ref, -1))}>{kind === "week" ? "Semana anterior" : "Mês anterior"}</Button>
          <Button size="compact" variant="ghost" disabled={!canNext} onClick={() => setRef(next)}>{kind === "week" ? "Semana seguinte" : "Mês seguinte"}</Button>
        </div>
      </div>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      {!report && !error ? <p role="status">Carregando…</p> : null}
      {report ? (
        <Card aria-labelledby="an-report-period">
          <h2 id="an-report-period" className="tn-num">{periodText(report)}</h2>
          <dl className="tn-an-report__list">
            {reportLines(report).map((l) => (
              <div key={l.key} className="tn-an-report__row" data-insufficient={l.value === "dados insuficientes" || undefined}>
                <dt>{l.label}</dt>
                <dd><strong className="tn-num">{l.value}</strong> <span className="tn-muted">{l.detail}</span></dd>
              </div>
            ))}
          </dl>
          <div className="tn-an-report__share">
            <Button variant="secondary" onClick={() => void shareText()}>Compartilhar como texto</Button>
            <Button variant="secondary" onClick={() => void shareImage()}>Compartilhar como imagem</Button>
          </div>
          <p className="tn-muted">O que sai no texto e na imagem: só estes números, sem nome de cliente.</p>
        </Card>
      ) : null}
    </div>
  );
}
