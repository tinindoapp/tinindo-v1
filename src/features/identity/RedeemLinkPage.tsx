// Cliente resgata o código que recebeu do profissional (POST; o código nunca vai na URL).
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import type { CustomerLinkRedeemOutput } from "@contracts";
import { Button, Field, PageHeader, StatusBanner, useFormErrors } from "../../components/ui/index.tsx";
import { messageFor } from "./errors.ts";
import { useIdempotencyKey } from "./idempotency.ts";
import { useIdentityServices } from "./services.tsx";

export function RedeemLinkPage() {
  const services = useIdentityServices();
  const idem = useIdempotencyKey();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<CustomerLinkRedeemOutput | null>(null);
  const { formRef, errors, show, clear } = useFormErrors<"code">();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    const ok = show({
      code: !code ? "Cole o código que o profissional enviou." : /^[A-Za-z0-9_-]{43}$/.test(code) ? null : "Confira o código: ele tem 43 letras, números, - ou _.",
    });
    if (!ok) return;
    setPending(true);
    setError(null);
    try {
      setLinked(await services.redeemLink(code, idem.keyFor(code)));
      idem.reset();
    } catch (err) {
      setError(messageFor(err, "link"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="tn-stack">
      <PageHeader id="redeem-title" eyebrow="Conta" title="Vincular ao seu profissional" />
      {linked ? (
        <>
          <StatusBanner tone="success">
            Pronto: sua conta agora está ligada a <strong>{linked.tenant_name}</strong>.
          </StatusBanner>
          <Link to="/app/conta">Voltar para a conta</Link>
        </>
      ) : (
        <form className="tn-stack" onSubmit={onSubmit} ref={formRef} noValidate>
          <p>
            Cole o código que o profissional enviou para o seu contato. Ele vale uma vez, por 72 horas. A Tinindo não
            junta cadastros só porque o telefone é igual.
          </p>
          <Field
            label="Código"
            name="code"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={64}
            required
            error={errors.code}
            onChange={() => clear("code")}
          />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <div className="tn-actions">
            <Button type="submit" loading={pending} loadingText="Vinculando…" disabled={!services.online}>
              Vincular
            </Button>
            <Link to="/app/conta">Voltar</Link>
          </div>
        </form>
      )}
    </div>
  );
}
