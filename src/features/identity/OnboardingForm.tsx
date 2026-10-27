// Onboarding mínimo do negócio: objetivo e política de cancelamento, com sugestões por profissão.
// Sem score de maturidade e sem dados de saúde. Salva com expected_version (onboarding.save).
import { type FormEvent, useState } from "react";
import type { Profession } from "@contracts";
import type { Onboarding, OnboardingGoal } from "@contracts";
import { Button, ChoiceCard, Field, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { messageFor } from "./errors.ts";
import { useIdempotencyKey } from "./idempotency.ts";
import {
  goalLabel,
  LATE_FEE_OPTIONS,
  lateFeeLabel,
  NOTICE_OPTIONS,
  noticeLabel,
  PROFESSION_PRESETS,
} from "./presets.ts";
import { useIdentityServices } from "./services.tsx";

interface Props {
  tenantId: string;
  profession: Profession;
  onboarding: Onboarding;
  onSaved(next: Onboarding): void;
}

export function OnboardingForm({ tenantId, profession, onboarding, onSaved }: Props) {
  const services = useIdentityServices();
  const idem = useIdempotencyKey();
  const preset = PROFESSION_PRESETS[profession];
  const [goal, setGoal] = useState<OnboardingGoal | null>(onboarding.goal);
  const [notice, setNotice] = useState<number>(onboarding.cancellation_notice_hours ?? preset.suggestedNoticeHours);
  const [fee, setFee] = useState<number | null>(onboarding.late_cancellation_fee_bps);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show, clear } = useFormErrors<"goal">();
  const done = onboarding.completed_at !== null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!show({ goal: goal ? null : "Escolha o objetivo principal." }) || !goal) return;
    const input = {
      expected_version: onboarding.version,
      goal,
      cancellation_notice_hours: notice,
      late_cancellation_fee_bps: fee,
      mark_complete: true,
    };
    setPending(true);
    setError(null);
    try {
      const next = await services.saveOnboarding(tenantId, input, idem.keyFor({ tenantId, input }));
      idem.reset();
      toast("Salvo.");
      onSaved(next);
    } catch (err) {
      setError(messageFor(err, "onboarding"));
    } finally {
      setPending(false);
    }
  }

  const feeOptions = LATE_FEE_OPTIONS.includes(fee) ? LATE_FEE_OPTIONS : [...LATE_FEE_OPTIONS, fee];
  const noticeOptions = NOTICE_OPTIONS.includes(notice) ? NOTICE_OPTIONS : [...NOTICE_OPTIONS, notice];

  return (
    <form className="tn-stack" onSubmit={onSubmit} ref={formRef} noValidate aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">{done ? "Objetivo e política de cancelamento" : "Dois passos para começar"}</h2>

      {/* Faltou escolher: os cartões ficam marcados como inválidos e o foco vai para o primeiro. */}
      <fieldset className="tn-id-choices">
        <legend>O que você mais quer resolver agora?</legend>
        <div className="tn-id-choices__group">
          {preset.goalOrder.map((g) => (
            <ChoiceCard
              key={g}
              name="goal"
              invalid={!!errors.goal}
              describedBy={errors.goal ? "goal-error" : undefined}
              value={g}
              checked={goal === g}
              onChange={() => {
                setGoal(g);
                clear("goal");
              }}
              title={goalLabel(g, preset)}
            />
          ))}
        </div>
        {errors.goal ? (
          <span id="goal-error" className="tn-field__error">
            {errors.goal}
          </span>
        ) : null}
      </fieldset>

      <Field
        as="select"
        label={`Até quando ${preset.clientNoun.one} pode cancelar sem multa?`}
        value={notice}
        onChange={(e) => setNotice(Number(e.target.value))}
      >
        {noticeOptions.map((h) => (
          <option key={h} value={h}>
            {noticeLabel(h)}
            {h === preset.suggestedNoticeHours ? " (comum para " + preset.label.toLowerCase() + ")" : ""}
          </option>
        ))}
      </Field>

      <Field
        as="select"
        label="Se cancelar depois disso"
        value={fee === null ? "" : String(fee)}
        onChange={(e) => setFee(e.target.value === "" ? null : Number(e.target.value))}
        hint="A Tinindo não cobra ninguém sozinha: a multa fica registrada para você combinar."
      >
        {feeOptions.map((bps) => (
          <option key={bps ?? "none"} value={bps === null ? "" : String(bps)}>
            {lateFeeLabel(bps)}
          </option>
        ))}
      </Field>

      {preset.serviceExamples.length > 0 ? (
        <p className="tn-muted">
          Próximo passo: cadastrar serviços, por exemplo{" "}
          {preset.serviceExamples.map((s) => `${s.name} (${s.duration_min} min)`).join(" e ")}. O preço é você quem
          define.
        </p>
      ) : null}

      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <div className="tn-actions">
        <Button type="submit" loading={pending} loadingText="Salvando…" disabled={!services.online}>
          {done ? "Salvar alterações" : "Concluir"}
        </Button>
      </div>
    </form>
  );
}
