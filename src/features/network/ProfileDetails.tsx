// Campos opcionais do perfil (P55, D21): onde atende (endereço ou domicílio), horário de funcionamento e política de
// cancelamento curta. O cliente vê na página e antes de confirmar a reserva (D23). Em branco = não aparece.
import { type FormEvent, useState } from "react";
import { Button, ChoiceCard, Field, Section, StatusBanner, toast } from "../../components/ui/index.tsx";
import type { NetworkApi, OwnerProfile } from "./api.ts";
import { useIdempotencyKey } from "../../lib/idempotency.ts";
import { errorMessage } from "./useNetworkApi.ts";

/** `collapsed`: com o perfil no ar, a seção nasce recolhida (P54: duas alturas de celular); sem ele, aberta e sem dobra. */
export function ProfileDetailsEditor({ api, profile, onSaved, collapsed }: { api: NetworkApi; profile: OwnerProfile; onSaved: () => Promise<void>; collapsed?: boolean }) {
  const d = profile.details;
  const [where, setWhere] = useState<"address" | "home" | "none">(d?.address ? "address" : d?.home_service ? "home" : "none");
  const [address, setAddress] = useState(d?.address ?? "");
  const [hours, setHours] = useState(d?.opening_hours ?? "");
  const [policy, setPolicy] = useState(d?.cancellation_policy ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Mesmo formulário depois de uma falha: mesma chave; mudou algo ou deu certo: outra.
  const idem = useIdempotencyKey();

  async function save(e: FormEvent) {
    e.preventDefault();
    if (where === "address" && address.trim().length < 3) {
      setProblem("Escreva o endereço (rua e número) ou escolha outra opção.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const input = {
        address: where === "address" ? address.trim() : null,
        home_service: where === "home",
        opening_hours: hours.trim() || null,
        cancellation_policy: policy.trim() || null,
      };
      await api.setProfileDetails(input, idem.keyFor(input));
      idem.reset();
      toast("Endereço, horário e política salvos.");
      await onSaved();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section id="detalhes-titulo" title="Onde, quando e cancelamento" collapsed={collapsed}>
      <p className="tn-muted">Opcional. O cliente vê na sua página e antes de confirmar o horário.</p>
      <form className="tn-stack" aria-label="Endereço, horário e política" onSubmit={(e) => void save(e)} noValidate>
        <fieldset className="tn-net-fieldset">
          <legend>Onde você atende</legend>
          <ChoiceCard name="onde" value="address" checked={where === "address"} onChange={() => setWhere("address")} title="No meu endereço" />
          <ChoiceCard name="onde" value="home" checked={where === "home"} onChange={() => setWhere("home")} title="Em domicílio"
            description="O link de reserva pergunta o bairro do cliente." />
          <ChoiceCard name="onde" value="none" checked={where === "none"} onChange={() => setWhere("none")} title="Prefiro não mostrar" />
        </fieldset>
        {where === "address" ? (
          <Field label="Endereço" autoComplete="street-address" maxLength={160} value={address} onChange={(e) => setAddress(e.target.value)} />
        ) : null}
        <Field label="Horário de funcionamento (opcional)" placeholder="Seg a sex, 9h às 18h" maxLength={160} value={hours} onChange={(e) => setHours(e.target.value)} />
        <Field as="textarea" label="Política de cancelamento (opcional)" placeholder="Cancele com 2 horas de antecedência." maxLength={280}
          value={policy} onChange={(e) => setPolicy(e.target.value)} />
        {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
        <div className="tn-actions">
          <Button type="submit" loading={busy} loadingText="Salvando…">Salvar</Button>
        </div>
      </form>
    </Section>
  );
}
