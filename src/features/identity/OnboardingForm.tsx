// Onboarding mínimo do negócio: objetivo e política de cancelamento, com sugestões por profissão.
// Sem score de maturidade e sem dados de saúde. Salva com expected_version (onboarding.save).
import { type FormEvent, useState } from "react";
import type { Profession } from "@contracts";
import type { Onboarding, OnboardingGoal } from "../../../supabase/functions/identity/schemas.ts";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
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
  const [saved, setSaved] = useState(false);
  const done = onboarding.completed_at !== null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!goal) {
      setError("Escolha o objetivo principal.");
      return;
    }
    const input = {
      expected_version: onboarding.version,
      goal,
      cancellation_notice_hours: notice,
      late_cancellation_fee_bps: fee,
      mark_complete: true,
    };
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const next = await services.saveOnboarding(tenantId, input, idem.keyFor({ tenantId, input }));
      idem.reset();
      setSaved(true);
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
    <form className="tn-stack" onSubmit={onSubmit} noValidate aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">{done ? "Objetivo e política de cancelamento" : "Dois passos para começar"}</h2>

      <fieldset className="tn-id-choices">
        <legend>O que você mais quer resolver agora?</legend>
        {preset.goalOrder.map((g) => (
          <label key={g} className="tn-id-choice">
            <input type="radio" name="goal" value={g} checked={goal === g} onChange={() => setGoal(g)} />
            <span>{goalLabel(g, preset)}</span>
          </label>
        ))}
      </fieldset>

      <div className="tn-field">
        <label htmlFor="notice-hours">Até quando {preset.clientNoun.one} pode cancelar sem multa?</label>
        <select id="notice-hours" value={notice} onChange={(e) => setNotice(Number(e.target.value))}>
          {noticeOptions.map((h) => (
            <option key={h} value={h}>
              {noticeLabel(h)}
              {h === preset.suggestedNoticeHours ? " (comum para " + preset.label.toLowerCase() + ")" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="tn-field">
        <label htmlFor="late-fee">Se cancelar depois disso</label>
        <select
          id="late-fee"
          value={fee === null ? "" : String(fee)}
          onChange={(e) => setFee(e.target.value === "" ? null : Number(e.target.value))}
        >
          {feeOptions.map((bps) => (
            <option key={bps ?? "none"} value={bps === null ? "" : String(bps)}>
              {lateFeeLabel(bps)}
            </option>
          ))}
        </select>
        <span className="tn-id-hint">A Tinindo não cobra ninguém sozinha: a multa fica registrada para você combinar.</span>
      </div>

      {preset.serviceExamples.length > 0 ? (
        <p className="tn-id-hint">
          Próximo passo: cadastrar serviços, por exemplo{" "}
          {preset.serviceExamples.map((s) => `${s.name} (${s.duration_min} min)`).join(" e ")}. O preço é você quem
          define.
        </p>
      ) : null}

      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      {saved ? <StatusBanner tone="success">Salvo.</StatusBanner> : null}
      <div className="tn-id-actions">
        <Button type="submit" disabled={pending || !services.online}>
          {pending ? "Salvando…" : done ? "Salvar alterações" : "Concluir"}
        </Button>
      </div>
    </form>
  );
}
