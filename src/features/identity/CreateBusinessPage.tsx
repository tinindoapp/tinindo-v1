// Criação do negócio (business.create): tenant, dono e recurso inicial numa transação no servidor.
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Profession } from "@contracts";
import { Button, Card, Field, StatusBanner } from "../../components/ui/index.tsx";
import { useSession } from "../../app/session.tsx";
import { messageFor } from "./errors.ts";
import { useIdempotencyKey } from "./idempotency.ts";
import { BRAZIL_TIMEZONES, POLICY_VERSIONS, PROFESSION_PRESETS, SEGMENT_LABEL, type Segment } from "./presets.ts";
import { useIdentityServices } from "./services.tsx";

const SEGMENTS: Segment[] = ["beleza", "personal", "outro"];

export function CreateBusinessPage() {
  const services = useIdentityServices();
  const session = useSession();
  const navigate = useNavigate();
  const idem = useIdempotencyKey();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; profession?: string; terms?: string }>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const profession = Profession.safeParse(form.get("profession"));
    const errors = {
      name: name ? undefined : "Informe o nome do negócio.",
      profession: profession.success ? undefined : "Escolha a profissão.",
      terms: form.get("terms") === "on" ? undefined : "Para criar o negócio, aceite os termos e a política de privacidade.",
    };
    setFieldError(errors);
    if (errors.name || errors.profession || errors.terms || !profession.success) return;

    const input = {
      name,
      profession: profession.data,
      timezone: String(form.get("timezone") ?? "America/Sao_Paulo"),
      accepted_policy_versions: [POLICY_VERSIONS.terms, POLICY_VERSIONS.privacy],
    };
    setPending(true);
    setError(null);
    try {
      const created = await services.createBusiness(input, idem.keyFor(input));
      idem.reset();
      session.selectTenant(created.tenant.id);
      await services.refreshSession();
      navigate("/app/conta?novo=1", { replace: true });
    } catch (err) {
      setError(messageFor(err, "business"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="new-business-title">
      <p className="tn-caps">Conta</p>
      <h1 id="new-business-title">Criar meu negócio</h1>
      <p>Leva menos de um minuto. Horários, serviços e preços vêm depois, no seu ritmo.</p>
      {!services.online ? (
        <StatusBanner tone="info">Demonstração sem servidor: o cadastro fica desabilitado.</StatusBanner>
      ) : null}
      <form className="tn-stack" onSubmit={onSubmit} noValidate>
        <Field label="Nome do negócio" name="name" maxLength={120} autoComplete="organization" required error={fieldError.name} />

        <fieldset className="tn-id-choices" aria-describedby={fieldError.profession ? "profession-error" : undefined}>
          <legend>Profissão</legend>
          {SEGMENTS.map((segment) => (
            <div key={segment} className="tn-id-choices__group">
              <p className="tn-id-choices__segment">{SEGMENT_LABEL[segment]}</p>
              {Profession.options
                .filter((p) => PROFESSION_PRESETS[p].segment === segment)
                .map((p) => (
                  <label key={p} className="tn-id-choice">
                    <input type="radio" name="profession" value={p} required />
                    <span>{PROFESSION_PRESETS[p].label}</span>
                  </label>
                ))}
            </div>
          ))}
          {fieldError.profession ? (
            <span id="profession-error" role="alert" className="tn-id-error">
              {fieldError.profession}
            </span>
          ) : null}
        </fieldset>

        <div className="tn-field">
          <label htmlFor="business-timezone">Fuso horário</label>
          <select id="business-timezone" name="timezone" defaultValue="America/Sao_Paulo">
            {BRAZIL_TIMEZONES.map((tz) => (
              <option key={tz.id} value={tz.id}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>

        <label className="tn-id-choice">
          <input type="checkbox" name="terms" aria-describedby={fieldError.terms ? "terms-error" : undefined} />
          <span>
            Li e aceito os termos de uso e a política de privacidade da fase piloto. Não cadastro dados de saúde de
            ninguém.
          </span>
        </label>
        {fieldError.terms ? (
          <span id="terms-error" role="alert" className="tn-id-error">
            {fieldError.terms}
          </span>
        ) : null}

        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <div className="tn-id-actions">
          <Button type="submit" disabled={pending || !services.online}>
            {pending ? "Criando…" : "Criar negócio"}
          </Button>
          <Link to="/app/conta">Voltar</Link>
        </div>
      </form>
    </Card>
  );
}
