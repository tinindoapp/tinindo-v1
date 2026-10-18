import { expect, test } from "@playwright/test";
import { PENDING } from "./helpers.ts";

// UAT · Cliente de dois profissionais (docs/10): a mesma conta acessa suas reservas de ambos; não vê notas
// privadas, lista de clientes nem custos; um profissional não descobre o histórico do outro.
// Fixtures: "Cliente AB" é cliente da Barbearia Exemplo A e do Personal Exemplo B. A demonstração entra
// como dono(a) de A; o que roda prova que nada de B aparece em A e que o perfil público não vaza CRM.

const TENANT_B_MARKERS = ["Personal Exemplo B", "Sessão de treino", "10000000-0000-4000-8000-00000000000b"];

test.describe("UAT cliente de dois profissionais", () => {
  test("1a · conta explica vínculos por profissional sem juntar cadastros pelo telefone", async ({ page }) => {
    await page.goto("/app/conta");
    const region = page.getByRole("region", { name: "Onde sou cliente" });
    await expect(region).toContainText("Cada um vê só o que é dele.");
    await region.getByRole("link", { name: "Tenho um código de vínculo" }).click();
    await expect(page.getByRole("heading", { name: "Vincular ao seu profissional" })).toBeVisible();
    await expect(page.getByText("A Tinindo não junta cadastros só porque o telefone é igual.", { exact: false })).toBeVisible();
  });

  test("1b · a mesma conta vê as próprias reservas nos dois profissionais", async ({ page }) => {
    test.fixme(true, PENDING.multiTenant);
    await page.goto("/app/conta");
    const region = page.getByRole("region", { name: "Onde sou cliente" });
    await expect(region).toContainText("Barbearia Exemplo A");
    await expect(region).toContainText("Personal Exemplo B");
  });

  test("2a · telas do profissional A não mostram nada do negócio B", async ({ page }) => {
    for (const path of ["/app", "/app/agenda", "/app/clientes", "/app/clientes/servicos", "/app/perfil", "/app/conta"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const text = await page.locator("body").innerText();
      for (const marker of TENANT_B_MARKERS) expect(text, `${path} contém ${marker}`).not.toContain(marker);
    }
    // Seletor de negócio só aparece com mais de um vínculo; aqui há um só.
    await expect(page.getByRole("banner").getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("banner")).toContainText("Barbearia Exemplo A");
  });

  test("2b · perfil público não expõe clientes, contatos, valores combinados nem custos", async ({ page }) => {
    await page.goto("/app/perfil");
    await page.getByLabel("Endereço do perfil").fill("perfil-cliente-ab");
    await page.getByLabel("Bairro ou região").fill("Centro");
    await page.getByRole("button", { name: "Publicar perfil" }).click();
    await page.getByRole("link", { name: "Abrir perfil público" }).click();
    await expect(page).toHaveURL(/\/p\/perfil-cliente-ab$/);
    const body = page.locator("body");
    for (const secret of ["Cliente AB", "Cliente Exemplo", "Visitante sem login", "cliente.ab@exemplo.test", "piso", "custo", "R$"]) {
      await expect(body, secret).not.toContainText(secret);
    }
    await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
  });

  test("3 · cliente não vê notas privadas, lista de clientes nem custos do profissional", async ({ page }) => {
    test.fixme(true, `${PENDING.multiTenant} Exige sessão de cliente (não dono) e a área de reservas da cliente.`);
    await page.goto("/app/clientes");
    await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toHaveCount(0);
  });

  test("4 · profissional A não descobre o histórico da cliente com B", async ({ page }) => {
    test.fixme(true, `${PENDING.multiTenant} SEC-01/SEC-02 precisam de RLS real; a demonstração não prova fronteira.`);
    await page.goto("/app/clientes");
    await page.getByRole("button", { name: /Editar Cliente AB/ }).click();
    await expect(page.locator("body")).not.toContainText("Sessão de treino");
  });
});
