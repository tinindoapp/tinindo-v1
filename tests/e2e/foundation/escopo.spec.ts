import { expect, type Page, test } from "@playwright/test";
import { noHorizontalScroll, openFromNav } from "../qa/helpers.ts";

// P51 · escopo visível do piloto (D1 a): o participante vê 10 módulos; 6 entram por Conta › Mais recursos; 11 ficam
// guardados (nenhum link; a rota direta explica e oferece saída). Roda na demonstração, como o participante do piloto
// vê (sem a chave "todos" dos e2e dos outros módulos), no celular de 375 px e no desktop.

const PILOT_MENU = ["Hoje", "Agenda", "Horários", "Lista de espera", "Preços", "Clientes", "Serviços", "Relacionamento", "Retorno", "Caixa", "Assistente", "Configuração", "Perfil", "Conta", "Seus dados"];
const STORED = ["mensagens", "pagamentos", "notas", "site", "campanhas", "avaliacoes", "domicilio", "diretorio", "equipe", "materiais", "contas"];

test.beforeEach(async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 800 });
});

async function menuLabels(page: Page): Promise<string[]> {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav).toBeVisible();
  return (await nav.getByRole("link").allTextContents()).map((t) => t.trim());
}

test("primeiro dia: o menu tem só os 10 módulos do piloto e nenhum link leva a módulo guardado", async ({ page, isMobile }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  expect(await menuLabels(page)).toEqual(PILOT_MENU);
  // Nenhum link da tela aponta para um módulo guardado (menu, abas, Hoje, configuração).
  for (const path of STORED) await expect(page.locator(`a[href^="/app/${path}"]`)).toHaveCount(0);
  // A barra de abas só existe no celular.
  if (isMobile) await expect(page.getByRole("navigation", { name: "Abas" }).getByRole("link")).toHaveText(["Hoje", "Agenda", "Clientes", "Retorno", "Dinheiro"]);
  await noHorizontalScroll(page);
});

test("rota direta de módulo guardado diz que não está disponível no piloto e volta para Hoje", async ({ page }) => {
  await page.goto("/app/mensagens");
  await expect(page.getByRole("heading", { name: "Não disponível no piloto", level: 1 })).toBeVisible();
  await expect(page.getByText(/Mensagens não faz parte do piloto/)).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole("link", { name: "Voltar para Hoje" }).click();
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
});

test("Mais recursos: ligar Assinaturas põe no menu e abre a tela; desligar tira de novo", async ({ page }) => {
  await page.goto("/app");
  await openFromNav(page, "Conta");
  await page.getByRole("link", { name: "Ver mais recursos" }).click();
  await expect(page.getByRole("heading", { name: "Mais recursos", level: 1 })).toBeVisible();
  const list = page.getByRole("list", { name: "Recursos opcionais" });
  await expect(list.getByRole("listitem")).toHaveCount(6);
  await noHorizontalScroll(page);
  // Botões de 44 px no celular.
  for (const b of await list.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await list.getByRole("button", { name: "Ligar Assinaturas" }).click();
  await expect(list.getByRole("button", { name: "Desligar Assinaturas" })).toBeVisible();
  await list.getByRole("link", { name: "Abrir Assinaturas" }).click();
  await expect(page.getByRole("heading", { name: "Assinaturas", level: 1 })).toBeVisible();
  expect(await menuLabels(page)).toContain("Assinaturas");

  // Recarregar mantém a escolha na aba.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Assinaturas", level: 1 })).toBeVisible();

  await page.goto("/app/conta/recursos");
  await page.getByRole("list", { name: "Recursos opcionais" }).getByRole("button", { name: "Desligar Assinaturas" }).click();
  await expect(page.getByRole("list", { name: "Recursos opcionais" }).getByRole("button", { name: "Ligar Assinaturas" })).toBeVisible();
  await page.goto("/app/assinaturas");
  await expect(page.getByRole("heading", { name: "Assinaturas está desligado", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir Mais recursos" })).toHaveAttribute("href", "/app/conta/recursos");
});

// Planos e cobrança (D3 a, substitui a D3 b): o Completo diz o que libera a mais; nenhum plano promete o que o
// piloto já dá a todos (ofertas de vaga e recuperação de agenda).
test("plano: o texto diz o que o Completo libera a mais que o Grátis (D3 a)", async ({ page }) => {
  await page.goto("/app/conta/recursos");
  await page.getByRole("list", { name: "Recursos opcionais" }).getByRole("button", { name: "Ligar Plano e serviços" }).click();
  await page.goto("/app/servicos-tinindo");
  await expect(page.getByText("Todos os recursos opcionais de Conta › Mais recursos").first()).toBeVisible();
  await expect(page.getByText("As mesmas funções do Grátis durante o piloto")).toHaveCount(0);
  await expect(page.getByText("Ofertas de vaga e recuperação de agenda")).toHaveCount(0);
});
