import type { Page } from "@playwright/test";

/**
 * P54 (parte 2): no celular o Novo agendamento mostra um passo por vez (Cliente, Serviço, Horário, Revisão). Antes de
 * mexer num passo, a spec vai até ele pelos botões do topo. No largo (tudo numa tela) não faz nada.
 */
export type FlowStep = "Cliente" | "Serviço" | "Horário" | "Revisão";
export async function toStep(page: Page, step: FlowStep): Promise<void> {
  // Espera o fluxo montar (o contexto da agenda carrega antes) para saber se é o celular, com passos, ou o largo.
  await page.locator(".tn-sched-flow").first().waitFor();
  const steps = page.getByRole("list", { name: "Passos do agendamento" });
  if (!(await steps.isVisible())) return;
  await steps.getByRole("button", { name: new RegExp(step) }).click();
}
