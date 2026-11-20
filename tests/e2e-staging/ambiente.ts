import { expect, type Page, test } from "@playwright/test";

// Variáveis da homologação e a regra comum do smoke (smoke.spec.ts) e da jornada que grava (jornada.spec.ts).
// Variável ausente: sem STAGING_REQUIRED, o passo que depende dela pula e diz o motivo (uso do dia a dia, ambiente
// pela metade). Com STAGING_REQUIRED=1 (antes de liberar para o piloto), o passo FALHA dizendo qual variável falta:
// o smoke não pode ficar verde sem ter conferido nada (revisão de 10/11, testes-09).
export const REQUIRED = process.env.STAGING_REQUIRED === "1";
export const env = {
  sha: process.env.STAGING_EXPECTED_SHA,
  supabaseUrl: process.env.STAGING_SUPABASE_URL,
  publishableKey: process.env.STAGING_SUPABASE_PUBLISHABLE_KEY,
  email: process.env.STAGING_TECH_EMAIL,
  password: process.env.STAGING_TECH_PASSWORD,
  slug: process.env.STAGING_PUBLIC_SLUG,
};

export const ALL_VARS = [
  "STAGING_EXPECTED_SHA",
  "STAGING_SUPABASE_URL",
  "STAGING_SUPABASE_PUBLISHABLE_KEY",
  "STAGING_TECH_EMAIL",
  "STAGING_TECH_PASSWORD",
  "STAGING_PUBLIC_SLUG",
  // Liga a jornada que grava no negócio da conta técnica (jornada.spec.ts). Só vale com o valor 1.
  "STAGING_WRITE",
] as const;
export type Var = (typeof ALL_VARS)[number];
const isSet = (n: Var) => (n === "STAGING_WRITE" ? process.env[n] === "1" : !!process.env[n]);
export const missing = (names: readonly Var[]) => names.filter((n) => !isSet(n));
const failure = (absent: readonly Var[], what: string) =>
  `STAGING_REQUIRED=1 e falta ${absent.map((n) => (n === "STAGING_WRITE" ? "STAGING_WRITE=1" : n)).join(", ")}: ${what}. Defina a variável ou rode sem STAGING_REQUIRED.`;

/** No corpo do `describe`: sem as variáveis, o grupo inteiro pula com o motivo; com STAGING_REQUIRED=1, cada teste falha. */
export function groupNeeds(names: readonly Var[], what: string) {
  const absent = missing(names);
  if (absent.length === 0) return;
  if (!REQUIRED) {
    test.skip(true, `Defina ${absent.map((n) => (n === "STAGING_WRITE" ? "STAGING_WRITE=1" : n)).join(" e ")}: ${what}.`);
    return;
  }
  test.beforeEach(() => {
    throw new Error(failure(absent, what));
  });
}

/** Dentro de um teste: diz se o passo pode rodar. Sem a variável, anota o passo pulado; com STAGING_REQUIRED=1, falha. */
export function stepNeeds(names: readonly Var[], what: string): boolean {
  const absent = missing(names);
  if (absent.length === 0) return true;
  if (REQUIRED) throw new Error(failure(absent, what));
  test.info().annotations.push({ type: "passo pulado", description: `Defina ${absent.join(" e ")}: ${what}.` });
  return false;
}

/** Entra com a conta técnica sintética e espera a Hoje. */
export async function signIn(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(env.email!);
  await page.getByLabel("Senha", { exact: true }).fill(env.password!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
}
