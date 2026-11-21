// "Faz comigo" no Assistente (revisão 06/11, §2.2, T4 e T5): o dono escolhe o formulário, escreve do jeito dele e
// confere o que vai ficar preenchido. "Preencher o formulário" abre a tela de sempre com o rascunho no estado da
// navegação (`assistDraft`, fora da URL); lá cada campo ganha o selo e quem grava é o botão de sempre da tela.
import { useState } from "react";
import { useNavigate } from "react-router";
import { AssistHint } from "../../components/ui/assist.tsx";
import { Field } from "../../components/ui/index.tsx";
import { formatCents } from "../../lib/money.ts";
import { FORM_IDS, FORM_SCREEN, type FormId } from "../../../supabase/functions/_shared/domain/agent/forms.ts";
import { type AgentPort, newKey } from "./port.ts";

/** O que vai junto na navegação para a tela de destino (contrato com as telas, ver recado do pacote). */
export interface AssistDraftState {
  assistDraft: { form: FormId; draft: Record<string, unknown>; filled: string[] };
}

const EXAMPLE: Record<FormId, string> = {
  "lifecycle.settings": "lembrete no dia anterior e duas horas antes, e chama de volta quem sumiu há dois meses",
  "schedule.rules": "terça a sábado das 9 às 19, almoço de meio-dia à uma, domingo e segunda fechado",
  service: "progressiva, 2 horas e meia, 280 reais, 15 minutos para limpar depois",
  "recurrence.plan": "plano de 8 treinos por mês a 640, sessão individual",
};
const HINT: Record<FormId, string> = {
  "lifecycle.settings": "Os lembretes saem antes de cada atendimento. Diga quando, e eu preencho a régua para você conferir.",
  "schedule.rules": "Seu expediente é o que aparece no link para o cliente escolher. Cada dia pode ter o seu horário.",
  service: "A duração vira o tamanho do horário na agenda. O preço só entra se você disser o valor.",
  "recurrence.plan": "Assinatura é cobrança a cada ciclo, com sessões por ciclo. O preço só entra se você disser o valor.",
};
const LABEL: Record<string, string> = {
  enabled: "régua ligada ou desligada", confirmation: "confirmação ao agendar", reminder_hours: "lembretes",
  quote_followup_days: "acompanhamento de orçamento", receivable_reminder: "lembrete de pagamento", reactivation_days: "chamar de volta",
  daily_budget: "envios por dia", days: "dias", rules: "horários", name: "nome", duration_min: "duração",
  buffer_before_min: "intervalo antes", buffer_after_min: "intervalo depois", base_price_cents: "preço", min_price_cents: "preço mínimo",
  service_name: "serviço", sessions_per_cycle: "sessões por ciclo", cycle_days: "ciclo", price_cents: "preço",
};
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const CYCLE: Record<number, string> = { 7: "semanal", 14: "quinzenal", 30: "mensal" };

/** O rascunho em palavras, campo a campo, para o dono conferir antes de abrir a tela. */
export function describeDraft(draft: Record<string, unknown>): string[] {
  const out: string[] = [];
  const d = draft as Record<string, never>;
  if (Array.isArray(d.reminder_hours)) out.push(`Lembretes: ${(d.reminder_hours as number[]).map((h) => `${h} h`).join(" e ")} antes`);
  if (typeof d.reactivation_days === "number") out.push(`Chamar de volta quem não volta há ${d.reactivation_days} dias`);
  if (typeof d.quote_followup_days === "number") out.push(`Acompanhar orçamento depois de ${d.quote_followup_days} dias`);
  if (typeof d.confirmation === "boolean") out.push(d.confirmation ? "Confirmação ao agendar: ligada" : "Confirmação ao agendar: desligada");
  if (typeof d.receivable_reminder === "boolean") out.push(d.receivable_reminder ? "Lembrete de pagamento: ligado" : "Lembrete de pagamento: desligado");
  if (typeof d.enabled === "boolean") out.push(d.enabled ? "Régua ligada" : "Régua desligada");
  if (typeof d.daily_budget === "number") out.push(`Até ${d.daily_budget} envios por dia`);
  if (Array.isArray(d.days)) {
    const rules = (d.rules ?? []) as { weekday: number; local_start: string; local_end: string }[];
    for (const day of d.days as number[]) {
      const ws = rules.filter((r) => r.weekday === day).map((r) => `${r.local_start} às ${r.local_end}`);
      out.push(`${WEEKDAY[day]}: ${ws.length ? ws.join(" e ") : "fechado"}`);
    }
  }
  if (typeof d.name === "string") out.push(`Nome: ${d.name}`);
  if (typeof d.service_name === "string") out.push(`Serviço: ${d.service_name}`);
  if (typeof d.duration_min === "number") out.push(`Duração: ${d.duration_min} min`);
  if (typeof d.buffer_before_min === "number") out.push(`Intervalo antes: ${d.buffer_before_min} min`);
  if (typeof d.buffer_after_min === "number") out.push(`Intervalo depois: ${d.buffer_after_min} min`);
  if (typeof d.sessions_per_cycle === "number") out.push(`Sessões por ciclo: ${d.sessions_per_cycle}`);
  if (typeof d.cycle_days === "number") out.push(`Ciclo: ${CYCLE[d.cycle_days] ?? `${d.cycle_days} dias`}`);
  for (const k of ["base_price_cents", "price_cents"] as const) if (typeof d[k] === "number") out.push(`Preço: ${formatCents(d[k])}`);
  if (typeof d.min_price_cents === "number") out.push(`Preço mínimo: ${formatCents(d.min_price_cents)}`);
  return out;
}

export function FormAssistPanel({ port }: { port: AgentPort }) {
  const [form, setForm] = useState<FormId>("lifecycle.settings");
  const navigate = useNavigate();
  return (
    <div className="tn-ag-panel-body">
      <Field as="select" label="O que você quer configurar" value={form} onChange={(e) => setForm(e.target.value as FormId)}>
        {FORM_IDS.map((f) => <option key={f} value={f}>{FORM_SCREEN[f].label}</option>)}
      </Field>
      <AssistHint
        key={form}
        hint={HINT[form]}
        example={EXAMPLE[form]}
        onRequest={(text) => port.formDraft(form, text, newKey())}
        describe={(draft) => <ul>{describeDraft(draft as Record<string, unknown>).map((l) => <li key={l}>{l}</li>)}</ul>}
        fieldLabel={(f) => LABEL[f] ?? f}
        onApply={(draft, filled) => {
          const state: AssistDraftState = { assistDraft: { form, draft: draft as Record<string, unknown>, filled } };
          navigate(FORM_SCREEN[form].path, { state });
        }}
      />
    </div>
  );
}
