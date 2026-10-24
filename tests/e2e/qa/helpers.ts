import { expect, type Page } from "@playwright/test";

// Utilitários dos roteiros UAT (docs/10_TESTES_E_ACEITE.md) sobre a demonstração offline.
// Sem Supabase o app usa fixtures do contrato v1: tenant "Barbearia Exemplo A", hoje = terça 20/10/2026
// 09:00 no fuso do negócio. O estado vive na aba: os fluxos navegam pelo próprio app, sem recarregar.

/** Motivos padronizados de test.fixme: o que falta para o passo do roteiro rodar de verdade. */
export const PENDING = {
  crmWrite: "A demonstração offline não grava (ADR-0006). A mesma regra roda com banco real em tests/integration (UAT barbeiro/cabeleireira pelos handlers); a tela com servidor só roda no staging hospedado (gate ADR-0006).",
  publicBooking: "Reservar pelo link público não existe ainda: o link só mostra horários (P09/P03). Pendência de produto registrada no handoff do P10.",
  pricing: "A regra publicada vale no servidor: provada em tests/integration/10_uat_barbeiro (cotação de terça com piso). A agenda da demonstração usa a regra de exemplo própria.",
  waitlist: "Candidatos por cancelamento dependem do worker: provado em tests/integration/10_uat_barbeiro (jobs → candidato → oferta → aceite pelo link).",
  finance: "Caixa com banco real provado em tests/integration/12_uat_personal (pacote, pagamento único, consumo por evento, cancelamento sem dupla baixa). A demonstração só tem o negócio A.",
  recurrence: "Recorrência com conflito provada em tests/integration/12_uat_personal (7 criadas, 1 conflito, resolução). A demonstração não tem o fluxo.",
  multiTenant: "Vínculo da mesma conta a dois negócios e RLS provados em tests/integration/13_uat_cliente_dois. A área da cliente com as próprias reservas não existe ainda (pendência de produto).",
  personalTenant: "A demonstração offline abre apenas a Barbearia Exemplo A; o negócio de personal roda em tests/integration/12_uat_personal.",
} as const;

export async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

/** Abre uma tela pelo menu principal: barra lateral no desktop; no celular, o botão Menu abre a folha antes. */
export async function openFromNav(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Principal" });
  if (!(await nav.isVisible())) {
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(nav).toBeVisible();
  }
  await nav.getByRole("link", { name, exact: true }).click();
}

/** Toda tela operável precisa se identificar como demonstração (AGENTS.md, BRAND.md). */
export async function expectDemoLabel(page: Page) {
  await expect(page.getByRole("note")).toContainText("Demonstração");
}

/** Navegação do app sem recarregar, para manter o estado da demonstração na aba. */
export async function softNavigate(page: Page, href: string) {
  await page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);
}

/** Cria um agendamento pela tela "Novo agendamento" a partir da agenda do dia já aberta. */
export async function bookFromAgenda(
  page: Page,
  opts: { service: RegExp; slot: string; customer: string; nextDays?: number },
) {
  await page.getByRole("link", { name: "Novo agendamento" }).click();
  await page.getByRole("radio", { name: opts.service }).check();
  for (let i = 0; i < (opts.nextDays ?? 0); i++) await page.getByRole("button", { name: "Próximo dia" }).click();
  await page.getByRole("button", { name: opts.slot, exact: true }).click();
  await page.getByLabel("Cliente").selectOption({ label: opts.customer });
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByText("Agendamento confirmado.")).toBeVisible();
}
