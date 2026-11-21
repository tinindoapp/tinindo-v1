import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { noHorizontalScroll, openFromNav } from "../e2e/qa/helpers.ts";
import { ALL_VARS, env, groupNeeds, missing, REQUIRED, signIn, stepNeeds } from "./ambiente.ts";

// P42 · smoke da homologação hospedada (release/CHECKLIST.md, seção 2). Só lê e entra com a conta técnica sintética:
// não grava nada além do login. O que grava fica em jornada.spec.ts, atrás de STAGING_WRITE=1.
// Regra das variáveis (pula com motivo; com STAGING_REQUIRED=1, falha dizendo qual falta): ver ambiente.ts.

test("STAGING_REQUIRED=1 · todas as variáveis da homologação estão definidas", () => {
  test.skip(!REQUIRED, "Só com STAGING_REQUIRED=1. Sem ela, os passos que dependem de variável ausente pulam com o motivo.");
  // Uma falha só com a lista inteira do que falta, além da falha de cada passo.
  expect(missing(ALL_VARS), "variáveis ausentes (tests/e2e-staging/README.md)").toEqual([]);
});

// Funções chamadas pelo navegador. `jobs` é só servidor a servidor (cron com segredo) e fica de fora do CORS.
const FUNCTIONS_DIR = fileURLToPath(new URL("../../supabase/functions/", import.meta.url));
const BROWSER_FUNCTIONS = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "jobs")
  .map((d) => d.name);

test.describe("homologação · build publicado", () => {
  test("serve o build de homologação, não a demonstração local", async ({ page, request }) => {
    const scripts: string[] = [];
    page.on("response", (r) => { if (r.url().endsWith(".js")) scripts.push(r.url()); });
    await page.goto("/entrar");
    // A faixa "Demonstração · homologação" fica dentro do app (AppShell), não na tela de entrada; a prova de que é a
    // homologação e não a demo sem servidor é o bundle apontar para o Supabase de homologação.
    if (stepNeeds(["STAGING_SUPABASE_URL"], "conferir que o bundle aponta para o Supabase de homologação")) {
      // Desde o P53 as telas e o cliente do Supabase vêm sob demanda: além do que /entrar carregou, segue os
      // pedaços citados nesses arquivos (um nível, como o mapa de pré-carga do Vite) antes de procurar o endereço.
      const seen = new Set(scripts);
      const bodies = await Promise.all(scripts.map(async (u) => (await request.get(u)).text()));
      const chunks = new Set(bodies.flatMap((b) => [...b.matchAll(/assets\/[\w.-]+\.js/g)].map((m) => new URL(`/${m[0]}`, page.url()).href)));
      for (const u of chunks) if (!seen.has(u)) { seen.add(u); bodies.push(await (await request.get(u)).text()); }
      expect(bodies.some((b) => b.includes(new URL(env.supabaseUrl!).host)), "bundle aponta para o Supabase de homologação").toBe(true);
    }
    await expect(page.getByRole("heading", { name: "Entrar", level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("version.json aponta para o SHA aprovado", async ({ request }) => {
    const res = await request.get("/version.json");
    expect(res.ok()).toBe(true);
    const build = (await res.json()) as { commit: string; branch: string };
    test.info().annotations.push({ type: "build", description: `${build.commit} · ${build.branch}` });
    if (stepNeeds(["STAGING_EXPECTED_SHA"], "conferir o SHA aprovado em /version.json")) {
      expect(build.commit.startsWith(env.sha!), `build ${build.commit}, aprovado ${env.sha}`).toBe(true);
    }
  });

  test("nenhuma chave secreta no bundle", async ({ page, request }) => {
    const scripts: string[] = [];
    page.on("response", (r) => { if (r.url().endsWith(".js")) scripts.push(r.url()); });
    await page.goto("/entrar");
    await page.waitForLoadState("networkidle");
    expect(scripts.length).toBeGreaterThan(0);
    for (const url of scripts) {
      const body = await (await request.get(url)).text();
      // O app traz os prefixos como texto na própria trava (env.ts e supabase-js); o que não pode haver é chave inteira:
      // sb_secret_ seguido do valor, ou um JWT legado cujo payload diz service_role.
      expect(body, url).not.toMatch(/sb_secret_[A-Za-z0-9_-]{16,}/);
      for (const jwt of body.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) ?? []) {
        // Montado em partes: a regra de lint barra o literal inteiro em qualquer arquivo.
        expect(Buffer.from(jwt.split(".")[1], "base64url").toString(), url).not.toContain(["service", "role"].join("_"));
      }
    }
  });

  test("rota interna recarregada abre o app (SPA no Worker), não 404", async ({ page }) => {
    const res = await page.goto("/app/agenda");
    expect(res?.status()).toBe(200);
  });
});

test.describe("homologação · funções", () => {
  // Sem tela envolvida: uma vez só, no projeto desktop.
  test.skip(({ isMobile }) => isMobile, "Funções conferidas uma vez, no desktop.");
  groupNeeds(["STAGING_SUPABASE_URL"], "conferir as funções");
  // A chave pública só é exigida no modo obrigatório: sem ela o pedido vai sem `apikey`, como antes.
  if (REQUIRED) groupNeeds(["STAGING_SUPABASE_PUBLISHABLE_KEY"], "chamar as funções com a chave pública do projeto");

  for (const fn of BROWSER_FUNCTIONS) {
    test(`${fn} sobe e aceita a origem do app (CORS)`, async ({ request, baseURL }) => {
      const origin = new URL(baseURL!).origin;
      const res = await request.fetch(`${env.supabaseUrl}/functions/v1/${fn}/health`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          ...(env.publishableKey ? { apikey: env.publishableKey } : {}),
        },
      });
      // 5xx aqui quase sempre é segredo faltando na função (o index.ts recusa subir) ou deploy que não aconteceu.
      expect(res.status(), `${fn}: ${res.status()}`).toBeLessThan(300);
      expect(res.headers()["access-control-allow-origin"], `${fn}: ALLOWED_ORIGINS sem ${origin}`).toBe(origin);
    });
  }
});

test.describe("homologação · conta técnica", () => {
  groupNeeds(["STAGING_TECH_EMAIL", "STAGING_TECH_PASSWORD"], "entrar com a conta técnica sintética");

  test("entra e abre Agenda e Clientes sem rolagem lateral", async ({ page }) => {
    await signIn(page);
    for (const name of ["Agenda", "Clientes"]) {
      await openFromNav(page, name);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Erro honesto aparece como alerta; aqui não pode haver nenhum (função caída, RLS, CORS).
      await expect(page.getByRole("alert")).toHaveCount(0);
      await noHorizontalScroll(page);
    }
  });

  // Só leitura: não dispensa passo nenhum. Com tudo feito ou dispensado, a linha some da Hoje e isso também vale.
  test("configuração guiada: a linha da Hoje e /app/configurar abrem sem erro", async ({ page }) => {
    await signIn(page);
    const line = page.getByRole("heading", { name: /^Deixe seu negócio pronto · \d+ de \d+$/, level: 2 });
    // A linha (ou o cartão, com o dia vazio) entra depois que o progresso chega do servidor.
    await expect(line.or(page.getByRole("heading", { name: "Atendimentos de hoje" })).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const onHome = await line.isVisible();
    if (onHome) {
      const [, done, total] = /(\d+) de (\d+)/.exec((await line.textContent()) ?? "") ?? [];
      expect(Number(done), "passos feitos não passam do total").toBeLessThanOrEqual(Number(total));
      test.info().annotations.push({ type: "configuração", description: `Hoje mostra ${done} de ${total}` });
      // P54: o título virou cartão com o próximo passo; a lista inteira abre em "Ver os N passos".
      await page.getByRole("region", { name: /^Deixe seu negócio pronto · / }).getByRole("link", { name: /^Ver os \d+ passos$/ }).click();
    } else {
      test.info().annotations.push({ type: "configuração", description: "linha fora da Hoje: todos os passos feitos ou dispensados" });
      await page.goto("/app/configurar");
    }
    await expect(page).toHaveURL(/\/app\/configurar/);
    await expect(page.getByRole("heading", { name: "Deixe seu negócio pronto", level: 1 })).toBeVisible();
    // O subtítulo traz a conta do servidor ("<negócio>: N de M passos feitos."), a mesma da Hoje.
    await expect(page.getByText(/: \d+ de \d+ passos feitos\.$/)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test("aba Retorno abre com lembretes, quem não volta e lista de espera", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/relacionamento/retorno");
    await expect(page.getByRole("heading", { name: "Retorno", level: 1 })).toBeVisible();
    for (const name of ["Lembretes a mandar", "Quem não volta", "Lista de espera"]) {
      await expect(page.getByRole("heading", { name, exact: true, level: 2 })).toBeVisible();
    }
    // Cada bloco termina de carregar (lista, vazio ou erro honesto); erro aqui reprova.
    await expect(page.getByRole("status").filter({ hasText: /^Carregando/ })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await noHorizontalScroll(page);
  });
});

test.describe("homologação · link público", () => {
  groupNeeds(["STAGING_PUBLIC_SLUG"], "abrir o perfil publicado da conta técnica");

  test("perfil público mostra os serviços para reservar", async ({ page }) => {
    await page.goto(`/p/${env.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await noHorizontalScroll(page);
  });
});
