// Cliente resgata o código que recebeu do profissional (POST; o código nunca vai na URL).
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import type { CustomerLinkRedeemOutput } from "../../../supabase/functions/identity/schemas.ts";
import { Button, Card, Field, StatusBanner } from "../../components/ui/index.tsx";
import { messageFor } from "./errors.ts";
import { useIdempotencyKey } from "./idempotency.ts";
import { useIdentityServices } from "./services.tsx";

export function RedeemLinkPage() {
  const services = useIdentityServices();
  const idem = useIdempotencyKey();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<CustomerLinkRedeemOutput | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
      setError("Confira o código: ele tem 43 letras, números, - ou _.");
      return;
    }
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
    <Card aria-labelledby="redeem-title">
      <p className="tn-caps">Conta</p>
      <h1 id="redeem-title">Vincular ao seu profissional</h1>
      {linked ? (
        <>
          <StatusBanner tone="success">
            Pronto: sua conta agora está ligada a <strong>{linked.tenant_name}</strong>.
          </StatusBanner>
          <Link to="/app/conta">Voltar para a conta</Link>
        </>
      ) : (
        <form className="tn-stack" onSubmit={onSubmit} noValidate>
          <p>
            Cole o código que o profissional enviou para o seu contato. Ele vale uma vez, por 72 horas. A Tinindo não
            junta cadastros só porque o telefone é igual.
          </p>
          <Field label="Código" name="code" autoComplete="one-time-code" spellCheck={false} maxLength={64} required />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <div className="tn-id-actions">
            <Button type="submit" disabled={pending || !services.online}>
              {pending ? "Vinculando…" : "Vincular"}
            </Button>
            <Link to="/app/conta">Voltar</Link>
          </div>
        </form>
      )}
    </Card>
  );
}
