import { expect, type Page } from "@playwright/test";

// Utilitários dos roteiros UAT (docs/10_TESTES_E_ACEITE.md) sobre a demonstração offline.
// Sem Supabase o app usa fixtures do contrato v1: tenant "Barbearia Exemplo A", hoje = terça 20/10/2026
// 09:00 no fuso do negócio. O estado vive na aba: os fluxos navegam pelo próprio app, sem recarregar.

/** Motivos padronizados de test.fixme: o que falta para o passo do roteiro rodar de verdade. */
export const PENDING = {
  crmWrite: "P02 sem servidor: na demonstração os formulários de clientes/serviços ficam bloqueados (readOnly).",
  publicBooking: "P03/P09: o link público só mostra horários; reservar pelo link exige o motor de agenda no servidor.",
  pricing: "P05 (Preços): a regra publicada vale no servidor; a agenda da demonstração usa a regra de exemplo própria.",
  waitlist: "P06 (Lista de espera): candidatos por cancelamento dependem do worker no servidor; a demonstração traz uma vaga de exemplo.",
  finance: "P07 (Caixa): o ledger existe no servidor, mas a demonstração só tem o negócio A; pacote de personal e conclusão pela agenda pedem banco real.",
  recurrence: "P03: recorrência com detecção de conflito por data não existe no fluxo da demonstração.",
  multiTenant: "P01/P09: a demonstração tem só um vínculo (tenant A); conta com reservas em dois negócios exige servidor e RLS.",
  personalTenant: "A demonstração offline abre apenas a Barbearia Exemplo A; não há negócio de personal para operar.",
} as const;

export async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

export async function openFromNav(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name, exact: true }).click();
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
