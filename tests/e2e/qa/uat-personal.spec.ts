import { expect, test } from "@playwright/test";
import { noHorizontalScroll, openFromNav, PENDING } from "./helpers.ts";

// UAT · Personal (docs/10): vende pacote de 10 sessões, registra pagamento, agenda recorrência de oito
// semanas com conflito em uma data, resolve, conclui duas sessões, resta saldo 8, cancela a terceira
// conforme regra sem duplicar caixa. Sem dados de saúde.
// A demonstração offline só abre a Barbearia Exemplo A e o Caixa (P07) é placeholder: quase todo o
// roteiro fica em fixme. O que roda verifica o onboarding do personal e a ausência de dados de saúde.

const HEALTH = /sa[uú]de|les[aã]o|doen[cç]a|medica|patolog|alergia|peso|press[aã]o arterial/i;

test.describe("UAT personal", () => {
  test("0 · onboarding oferece Personal trainer e o termo exclui dados de saúde", async ({ page }) => {
    await page.goto("/app/conta/novo-negocio");
    await expect(page.getByRole("heading", { name: "Criar meu negócio" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Profissão" }).getByRole("radio", { name: "Personal trainer" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Não cadastro dados de saúde de ninguém/ })).toBeVisible();
    // Demonstração não cria negócio de verdade.
    await expect(page.getByRole("button", { name: "Criar negócio" })).toBeDisabled();
    await noHorizontalScroll(page);
  });

  test("0b · nenhuma tela de cadastro pede dado de saúde", async ({ page }) => {
    for (const path of ["/app/clientes", "/app/clientes/importar", "/app/agenda/novo", "/app/conta/novo-negocio", "/app/conta"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const labels = await page.locator("main label, main legend").allInnerTexts();
      expect(labels.filter((l) => HEALTH.test(l) && !/Não cadastro dados de saúde/.test(l)), path).toEqual([]);
    }
  });

  test("1a · Caixa vende pacote e explica que crédito não é caixa", async ({ page }) => {
    await page.goto("/app");
    await openFromNav(page, "Caixa");
    await expect(page.getByText("Recebíveis, recebimentos manuais e pacotes de sessões.")).toBeVisible();
    await expect(page.getByText("Usar uma sessão debita crédito, não gera caixa.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Vender pacote" })).toBeVisible();
  });

  test("1b · vende pacote de 10 sessões e registra o pagamento uma vez", async ({ page }) => {
    test.fixme(true, `${PENDING.finance} ${PENDING.personalTenant}`);
    await page.goto("/app/caixa");
    await page.getByRole("button", { name: "Vender pacote" }).click();
    await page.getByLabel("Sessões").fill("10");
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    await expect(page.getByText(/Saldo: 10 sessões/)).toBeVisible();
  });

  test("2 · agenda recorrência de oito semanas, mostra a data em conflito e permite resolver", async ({ page }) => {
    test.fixme(true, `${PENDING.recurrence} ${PENDING.personalTenant}`);
    await page.goto("/app/agenda/novo");
    await page.getByRole("checkbox", { name: /Repetir toda semana/ }).check();
    await page.getByLabel(/Semanas/).fill("8");
    await expect(page.getByText(/1 data com conflito/)).toBeVisible();
  });

  test("3 · conclui duas sessões e o saldo do pacote fica em 8", async ({ page }) => {
    test.fixme(true, `${PENDING.finance} O consumo de sessão do pacote não está ligado à conclusão na agenda.`);
    await page.goto("/app/caixa");
    await expect(page.getByText(/Saldo: 8 sessões/)).toBeVisible();
  });

  test("4 · cancela a terceira conforme a regra sem lançar o caixa de novo", async ({ page }) => {
    test.fixme(true, `${PENDING.finance} Precisa do ledger para provar ausência de dupla baixa (FIN-01/FIN-02).`);
    await page.goto("/app/caixa");
    await expect(page.getByText(/1 entrada/)).toBeVisible();
  });
});
