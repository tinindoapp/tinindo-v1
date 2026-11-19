// Cartão "Deixe seu negócio pronto · N de 8" (P44) para a Home: o próximo passo em destaque, com por quê e o botão
// que leva à tela que resolve. Passo opcional pode ser dispensado ("Agora não"). Some quando os 8 estão feitos ou
// dispensados. O estado vem do servidor (ou da emulação da demonstração); a Home só liga o componente.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, LinkButton, toast } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { explain, specOf } from "./labels.ts";
import { newKey, type SetupPort, type SetupProgress } from "./port.ts";
import "./setup.css";

/**
 * `compact` (P48, decisão D6): com atendimento no dia, a Hoje mostra a configuração numa linha fina, com a contagem, a
 * barra e o próximo passo como link; o cartão inteiro fica para quando o dia está vazio e na tela Configuração.
 */
export function SetupCard({ port, compact = false }: { port: SetupPort; compact?: boolean }) {
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    port.progress().then((p) => alive && setProgress(p), () => alive && setProgress(null));
    return () => {
      alive = false;
    };
  }, [port]);

  // Nada a mostrar: carregando, falhou (as outras seções da Home continuam) ou tudo resolvido.
  if (!progress || progress.resolved_count >= progress.total) return null;
  const next = progress.next ? progress.steps.find((s) => s.step === progress.next)! : null;
  const spec = next ? specOf(next.step) : null;
  const needsBasics = progress.steps.some((s) => (s.step === "hours" || s.step === "service") && !s.done);

  async function dismiss() {
    if (!next || next.required) return;
    setBusy(true);
    try {
      const p = await port.dismiss(next.step, true, newKey());
      setProgress(p);
      toast({ message: `“${next.title}” fica para depois. Você encontra o passo em Configuração.`, action: { label: "Desfazer", onAction: async () => {
        try {
          setProgress(await port.dismiss(next.step, false, newKey()));
        } catch (err) {
          toast({ tone: "danger", message: explain(err) });
        }
      } } });
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      setBusy(false);
    }
  }

  const bar = (
    <div className="tn-setup-card__bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done_count} aria-label="Passos feitos">
      <span style={{ width: `${Math.round((progress.done_count / progress.total) * 100)}%` }} />
    </div>
  );

  if (compact) {
    return (
      <section className="tn-setup-line" aria-labelledby="setup-card-title" data-ready={progress.ready || undefined}>
        <h2 id="setup-card-title" className="tn-setup-line__title">
          <Link to="/app/configurar">Deixe seu negócio pronto</Link> <span className="tn-num tn-muted">· {progress.done_count} de {progress.total}</span>
        </h2>
        {next && spec ? (
          <Link to={next.link} className="tn-setup-line__next">
            {spec.cta}<span className="tn-visually-hidden">: próximo passo{next.required ? "" : " (opcional)"}, {next.title}</span>
          </Link>
        ) : null}
        {bar}
      </section>
    );
  }

  return (
    <section className="tn-card tn-setup-card" aria-labelledby="setup-card-title" data-ready={progress.ready || undefined}>
      <div className="tn-setup-card__head">
        <h2 id="setup-card-title" className="tn-setup-card__title">
          Deixe seu negócio pronto <span className="tn-num tn-muted">· {progress.done_count} de {progress.total}</span>
        </h2>
        {bar}
        {progress.ready ? <p className="tn-setup-card__ready">Seu link público já recebe reservas. O que falta é opcional.</p> : null}
      </div>
      {next && spec ? (
        <div className="tn-setup-card__next">
          <span className="tn-setup-card__icon" aria-hidden="true"><Icon name={spec.icon} /></span>
          <div>
            <p className="tn-setup-card__step">
              <span className="tn-muted">Próximo{next.required ? "" : " (opcional)"}:</span> {next.title}
            </p>
            {next.why ? <p className="tn-setup-card__why">{next.why}</p> : null}
          </div>
        </div>
      ) : null}
      <div className="tn-actions">
        {next && spec ? <LinkButton to={next.link}>{spec.cta}</LinkButton> : null}
        {next && !next.required ? <Button variant="secondary" onClick={() => void dismiss()} loading={busy} loadingText="Guardando…">Agora não</Button> : null}
        <Link to="/app/configurar" className="tn-setup-card__all">Ver os {progress.total} passos</Link>
      </div>
      {needsBasics ? (
        <p className="tn-setup-card__describe">
          Ou <Link to="/app/configurar#descrever">descreva seu negócio em uma frase</Link> e revise o rascunho de horários e serviços.
        </p>
      ) : null}
    </section>
  );
}
