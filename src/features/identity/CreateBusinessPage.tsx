// Criação do negócio (business.create): tenant, dono e recurso inicial numa transação no servidor.
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Profession } from "@contracts";
import { Button, Card, ChoiceCard, Field, PageHeader, StatusBanner, useFormErrors } from "../../components/ui/index.tsx";
import { useSession } from "../../app/session.tsx";
import { messageFor } from "./errors.ts";
import { useIdempotencyKey } from "./idempotency.ts";
import { LegalSheet, type LegalDoc } from "./LegalSheet.tsx";
import { BRAZIL_TIMEZONES, detectTimezone, POLICY_VERSIONS, PROFESSION_PRESETS, SEGMENT_LABEL, type Segment } from "./presets.ts";
import { useIdentityServices } from "./services.tsx";

const SEGMENTS: Segment[] = ["beleza", "personal", "outro"];

export function CreateBusinessPage() {
  const services = useIdentityServices();
  const session = useSession();
  const navigate = useNavigate();
  const idem = useIdempotencyKey();
  const [error, setError] = useState<string | null>(null);
  const [profession, setProfession] = useState<Profession | null>(null);
  const [terms, setTerms] = useState(false);
  const [reading, setReading] = useState<LegalDoc | null>(null);
  // Fuso do aparelho (E9): só aparece para trocar quando a pessoa abre "Trocar o fuso".
  const [detected] = useState(detectTimezone);
  const [timezone, setTimezone] = useState(detected.id);
  const { formRef, errors, show, clear } = useFormErrors<"name" | "profession" | "terms">();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const ok = show({
      name: name ? null : "Informe o nome do negócio.",
      profession: profession ? null : "Escolha a profissão.",
      terms: terms ? null : "Para criar o negócio, aceite os termos e a política de privacidade.",
    });
    if (!ok || !profession) return;

    const input = {
      name,
      profession,
      timezone,
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
    <div className="tn-stack">
      <PageHeader
        id="new-business-title"
        eyebrow="Conta"
        title="Criar meu negócio"
        subtitle="Só o nome e a profissão. Horários, serviços e preços vêm depois, no seu ritmo."
      />
      {!services.online ? (
        <StatusBanner tone="info">Demonstração sem servidor: o cadastro fica desabilitado.</StatusBanner>
      ) : null}
      <Card aria-labelledby="new-business-title">
        <form className="tn-stack" onSubmit={onSubmit} ref={formRef} noValidate>
          <Field
            label="Nome do negócio"
            name="name"
            maxLength={120}
            autoComplete="organization"
            required
            error={errors.name}
            onChange={() => clear("name")}
          />

          {/* Faltou escolher: os cartões ficam marcados como inválidos e o foco vai para o primeiro. */}
          <fieldset className="tn-id-choices">
            <legend>Profissão</legend>
            <p className="tn-id-choices__segment">Ela também vira a categoria do seu perfil público.</p>
            {SEGMENTS.map((segment) => (
              <div key={segment} className="tn-id-choices__group">
                <p className="tn-id-choices__segment">{SEGMENT_LABEL[segment]}</p>
                {Profession.options
                  .filter((p) => PROFESSION_PRESETS[p].segment === segment)
                  .map((p) => (
                    <ChoiceCard
                      key={p}
                      name="profession"
                      invalid={!!errors.profession}
                      describedBy={errors.profession ? "profession-error" : undefined}
                      value={p}
                      checked={profession === p}
                      onChange={() => {
                        setProfession(p);
                        clear("profession");
                      }}
                      title={PROFESSION_PRESETS[p].label}
                    />
                  ))}
              </div>
            ))}
            {errors.profession ? (
              <span id="profession-error" className="tn-field__error">
                {errors.profession}
              </span>
            ) : null}
          </fieldset>

          <div className="tn-id-tz">
            <p>
              Fuso horário: <strong>{BRAZIL_TIMEZONES.find((tz) => tz.id === timezone)?.label ?? timezone}</strong>
              {timezone === detected.id ? (
                <span className="tn-muted">{detected.fromDevice ? " · o mesmo do seu aparelho" : " · o mais comum"}</span>
              ) : null}
            </p>
            <details>
              <summary>Trocar o fuso</summary>
              <Field as="select" label="Fuso horário" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {BRAZIL_TIMEZONES.map((tz) => (
                  <option key={tz.id} value={tz.id}>
                    {tz.label}
                  </option>
                ))}
              </Field>
            </details>
          </div>

          <div className="tn-id-terms">
            <label className="tn-id-check">
              <input
                type="checkbox"
                name="terms"
                checked={terms}
                onChange={(e) => {
                  setTerms(e.target.checked);
                  clear("terms");
                }}
                aria-invalid={errors.terms ? true : undefined}
                aria-describedby={errors.terms ? "terms-error" : undefined}
              />
              <span>Li e aceito os termos de uso e a política de privacidade da fase piloto.</span>
            </label>
            {errors.terms ? (
              <span id="terms-error" className="tn-field__error">
                {errors.terms}
              </span>
            ) : null}
            <p className="tn-id-terms__read">
              Ler:
              <button type="button" className="tn-id-link" aria-haspopup="dialog" onClick={() => setReading("terms")}>
                Termos de uso
              </button>
              ·
              <button type="button" className="tn-id-link" aria-haspopup="dialog" onClick={() => setReading("privacy")}>
                Política de privacidade
              </button>
            </p>
          </div>
          <StatusBanner tone="info">
            Não cadastre dados de saúde de ninguém (diagnósticos, lesões, prescrições), nem nas observações.
          </StatusBanner>

          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <div className="tn-actions">
            <Button type="submit" loading={pending} loadingText="Criando…" disabled={!services.online}>
              Criar negócio
            </Button>
            <Link to="/app/conta">Voltar</Link>
          </div>
        </form>
      </Card>
      <LegalSheet doc={reading} onClose={() => setReading(null)} />
    </div>
  );
}
