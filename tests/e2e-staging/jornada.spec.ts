import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { noHorizontalScroll } from "../e2e/qa/helpers.ts";
import { env, groupNeeds, signIn } from "./ambiente.ts";

// Jornada que GRAVA na homologação, só no negócio da conta técnica sintética (nunca dado real), atrás de
// STAGING_WRITE=1. Cobre o roteiro do piloto (docs/qa/UAT-PILOTO.md):
//   1. Atendido (preparo): agendamento de hoje no primeiro horário livre, para um cliente fictício novo;
//   2. "Repetir toda semana": prévia das datas e confirmação (2 semanas, um dia da semana);
//   3. reserva pelo link público com o código que sai pelo canal SIMULADO e é lido em Mensagens › Simulador;
//   4. Atendido › "Recebi R$ X no Pix" no agendamento do passo 1 (espera o horário começar) e o valor em "Hoje" no Caixa.
// O passo 1 vem primeiro e o 4 por último para a espera do horário correr enquanto 2 e 3 rodam.
//
// Cada execução usa nomes e telefones novos (carimbo), claramente fictícios: "Cliente Teste UAT <carimbo>" e números
// +55 11 9000x-NNNN. Rodar de novo no mesmo ambiente não colide com o que ficou de antes.
//
// Fuso: o horário do negócio técnico é comparado com o relógio no fuso STAGING_TIMEZONE (padrão America/Sao_Paulo),
// o mesmo usado pelo navegador destes testes.
const TIMEZONE = process.env.STAGING_TIMEZONE || "America/Sao_Paulo";
/** Os horários da agenda andam de 15 em 15 minutos: o primeiro livre de hoje começa em até 15 minutos. */
const MAX_WAIT_MIN = 16;

const stamp = Date.now().toString(36);
const nnnn = String(Date.now() % 10_000).padStart(4, "0");
const people = {
  /** Cliente do agendamento de hoje (passos 1 e 4). */
  today: { name: `Cliente Teste UAT ${stamp}`, phone: `(11) 90000-${nnnn}` },
  /** Cliente da repetição semanal (passo 2), sem WhatsApp. */
  weekly: { name: `Cliente Teste UAT ${stamp} semanal` },
  /** Quem pede pelo link público (passo 3). */
  link: { name: `Cliente Teste UAT ${stamp} link`, phone: `(11) 90001-${nnnn}`, e164: `+551190001${nnnn}` },
  /** Número simulado do negócio, se a jornada precisar conectar o canal. */
  business: { e164: `+551190009${nnnn}` },
};

test.describe("homologação · jornada que grava no negócio técnico", () => {
  // Grava: uma vez só, no desktop. Uma nova tentativa gravaria tudo de novo; falha é para ler, não para repetir.
  test.skip(({ isMobile }) => isMobile, "A jornada que grava roda uma vez, no desktop.");
  test.describe.configure({ retries: 0, timeout: (MAX_WAIT_MIN + 6) * 60_000 });
  test.use({ timezoneId: TIMEZONE });
  groupNeeds(
    ["STAGING_WRITE", "STAGING_TECH_EMAIL", "STAGING_TECH_PASSWORD", "STAGING_PUBLIC_SLUG"],
    "gravar a jornada (Atendido e Caixa, repetição semanal e reserva pelo link) no negócio da conta técnica",
  );

  test("1 · Atendido (preparo): agendamento de hoje no primeiro horário livre", async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto("/app/agenda/novo");
    await expect(page.getByRole("heading", { name: "Novo agendamento", level: 1 })).toBeVisible();
    await newCustomer(page, people.today.name, people.today.phone);

    const slots = page.getByRole("group", { name: "Horários livres" });
    await expect(slots.or(page.getByText("Nenhum horário livre neste dia. Tente outro dia."))).toBeVisible();
    if (!(await slots.isVisible())) {
      // Sem horário livre hoje: o passo 4 procura um atendimento de hoje que já começou ("ou usar um que já começou").
      saveState(testInfo, null);
      testInfo.annotations.push({ type: "Atendido", description: "sem horário livre hoje; o passo 4 usa um atendimento de hoje que já começou" });
      return;
    }
    const first = slots.getByRole("button").first();
    const time = (await first.textContent())!.trim();
    const wait = minutesUntil(time);
    expect(wait, `o primeiro horário livre de hoje é ${time} (${wait} min daqui, fuso ${TIMEZONE}): rode a jornada dentro do expediente do negócio técnico`)
      .toBeLessThanOrEqual(MAX_WAIT_MIN);
    await first.click();
    await expect(page.getByRole("region", { name: "Revise e confirme" })).toContainText(/R\$\s?\d/);
    await page.getByRole("button", { name: "Confirmar agendamento" }).click();

    await expect(page.getByRole("heading", { name: "Atendimento", level: 1 })).toBeVisible();
    await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
    await expect(page.getByRole("main")).toContainText(people.today.name);
    const id = /\/atendimento\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
    expect(id, "o endereço do atendimento traz o id gravado").toBeTruthy();
    saveState(testInfo, { bookingId: id!, time });
    testInfo.annotations.push({ type: "Atendido", description: `agendado hoje às ${time} para ${people.today.name}` });
    expect(errors, "erros do servidor ou da página").toEqual([]);
  });

  test("2 · Repetir toda semana: prévia das datas e confirmação", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto("/app/agenda/novo");
    await newCustomer(page, people.weekly.name);
    // Daqui a dois dias, para não disputar com o agendamento de hoje; o último horário livre do dia.
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Próximo dia" }).click();
    const date = await page.getByLabel("Dia", { exact: true }).inputValue();
    const slots = page.getByRole("group", { name: "Horários livres" });
    await expect(slots, `nenhum horário livre em ${date}: o negócio técnico precisa de expediente nesse dia`).toBeVisible();
    const last = slots.getByRole("button").last();
    const time = (await last.textContent())!.trim();
    await last.click();
    await page.getByRole("checkbox", { name: /Repetir toda semana/ }).check();

    const form = page.getByRole("form", { name: "Repetir toda semana" });
    await expect(form.getByLabel("Horário")).toHaveValue(time);
    await form.getByLabel("Quantas semanas").fill("2");
    const review = page.getByRole("region", { name: "Revise as datas" });
    const dates = review.getByRole("list", { name: "Datas da repetição" }).getByRole("listitem");
    await expect(dates).toHaveCount(2);
    // A primeira data é o horário escolhido na lista de livres; a segunda pode ter ficado ocupada por outra execução.
    await expect(dates.first()).toContainText("Livre");
    const count = review.getByRole("status").filter({ hasText: /^2 datas:/ });
    await expect(count).toBeVisible();
    const free = Number(/: (\d) livres?/.exec((await count.textContent()) ?? "")?.[1]);
    expect(free).toBeGreaterThanOrEqual(1);
    await noHorizontalScroll(page);

    await page.getByRole("button", { name: "Confirmar repetição" }).click();
    const done = page.getByRole("heading", { name: free === 1 ? "1 agendamento criado" : `${free} agendamentos criados`, level: 2 });
    await expect(done).toBeVisible();
    await expect(page.getByRole("main")).toContainText(people.weekly.name);

    await page.getByRole("link", { name: "Ver na agenda" }).click();
    await expect(page).toHaveURL(new RegExp(`data=${date}`));
    const item = page.getByRole("list", { name: /^Linha do tempo de / }).getByRole("listitem").filter({ hasText: people.weekly.name });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(time);
    expect(errors, "erros do servidor ou da página").toEqual([]);
  });

  test("3 · Reserva pelo link público com o código do canal simulado", async ({ page, browser }) => {
    const errors = watchErrors(page);
    await signIn(page);

    await test.step("pré-condição: Mensagens ligado e o número simulado conectado", async () => {
      await page.goto("/app/mensagens");
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: /^Carregando/ })).toHaveCount(0);
      const heading = (await title.textContent())?.trim();
      if (heading !== "Mensagens") {
        throw new Error(
          `Mensagens não está ligado no negócio técnico (a tela diz "${heading}"). Quem opera a homologação liga, com a chave de serviço, no SQL do Supabase: ` +
            "select app.module_admin_set('<id do negócio técnico>', 'messaging', true); (e desliga depois com false). Ver tests/e2e-staging/README.md.",
        );
      }
      await connectSimulatedNumber(page);
    });

    const visitor = await browser.newContext({ timezoneId: TIMEZONE });
    const pub = await visitor.newPage();
    const pubErrors = watchErrors(pub);
    let day = "";
    let time = "";
    await test.step("cliente fictício pede um horário pelo link (aba anônima)", async () => {
      await pub.goto(`/p/${env.slug}`);
      await expect(pub.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(pub.getByRole("heading", { name: "Escolha o serviço", level: 2 })).toBeVisible();
      await pub.getByRole("button", { name: "Escolher dia e hora" }).click();
      const days = pub.locator('input[name="dia-link"]');
      const slots = pub.getByRole("list", { name: "Horários livres" });
      const none = pub.getByText("Nenhum horário livre neste dia. Tente outro dia.");
      // Amanhã em diante (hoje fica para o agendamento do passo 1).
      for (let i = 1; i < (await days.count()); i++) {
        await days.nth(i).check();
        await expect(slots.or(none)).toBeVisible();
        if (await slots.isVisible()) {
          day = await days.nth(i).inputValue();
          break;
        }
      }
      expect(day, "nenhum horário livre no link público nos próximos dias: o negócio técnico precisa de expediente").not.toBe("");
      const last = slots.getByRole("button").last();
      time = (await last.textContent())!.trim();
      await last.click();
      const form = pub.getByRole("form", { name: "Pedir horário" });
      await form.getByLabel("Seu nome").fill(people.link.name);
      await form.getByLabel("WhatsApp com DDD").fill(people.link.phone);
      await form.getByRole("button", { name: "Pedir este horário" }).click();
      await expect(pub.getByRole("heading", { name: "Confirme o horário", level: 2 })).toBeVisible();
      await expect(pub.getByLabel("Código recebido")).toBeVisible();
    });

    let code = "";
    await test.step("o código sai pelo canal simulado e é lido em Mensagens › Simulador", async () => {
      code = await codeOnSimulator(page, people.link.e164, /\d{6}/);
    });

    await test.step("volta à aba pública e confirma com o código", async () => {
      await pub.bringToFront();
      await pub.getByLabel("Código recebido").fill(code);
      await pub.getByRole("button", { name: "Confirmar horário" }).click();
      await expect(pub.getByRole("heading", { name: "Horário confirmado", level: 2 })).toBeVisible();
      await expect(pub.getByRole("main")).toContainText(time);
      await noHorizontalScroll(pub);
    });

    await test.step("o pedido aparece na Agenda do negócio", async () => {
      await page.bringToFront();
      await page.goto(`/app/agenda?data=${day}`);
      // Na Agenda o pedido pelo link fica sem cliente cadastrado; o nome e o WhatsApp de quem pediu estão no atendimento.
      const item = page.getByRole("list", { name: /^Linha do tempo de / }).locator('li[data-kind="booking"][data-status="confirmed"]')
        .filter({ hasText: new RegExp(`^${time}–`) });
      await expect(item).toHaveCount(1);
      await item.getByRole("link").click();
      await expect(page.getByRole("heading", { name: "Atendimento", level: 1 })).toBeVisible();
      await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
      await expect(page.getByRole("main")).toContainText("Link de agendamento");
      await expect(page.getByRole("main")).toContainText(people.link.name);
      await expect(page.getByRole("main")).toContainText(people.link.e164);
    });
    await visitor.close();
    expect([...errors, ...pubErrors], "erros do servidor ou da página").toEqual([]);
  });

  test("4 · Atendido › Recebi no Pix: o valor entra em Hoje no Caixa", async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await signIn(page);
    const state = loadState(testInfo);

    let target = "";
    if (state) {
      target = `/app/agenda/atendimento/${state.bookingId}`;
      await test.step(`espera o atendimento das ${state.time} começar`, async () => {
        const wait = minutesUntil(state.time);
        test.info().annotations.push({ type: "espera", description: `${Math.max(wait, 0)} min até ${state.time}` });
        await page.goto(target);
        await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
        const button = page.getByRole("button", { name: "Atendido", exact: true });
        await expect(async () => {
          await page.reload();
          await expect(button).toBeVisible({ timeout: 5_000 });
        }, `o atendimento das ${state.time} não começou a tempo`).toPass({ intervals: [15_000], timeout: (Math.max(wait, 0) + 2) * 60_000 });
      });
    } else {
      await test.step("sem agendamento novo: usa um atendimento de hoje que já começou", async () => {
        await page.goto("/app/agenda");
        const started = page.getByRole("list", { name: /^Linha do tempo de / }).getByRole("listitem")
          .filter({ has: page.getByRole("button", { name: /^Atendido/ }) }).first();
        await expect(started, "nenhum horário livre hoje e nenhum atendimento de hoje já começado: rode dentro do expediente").toBeVisible();
        target = (await started.getByRole("link").first().getAttribute("href"))!;
        await page.goto(target.startsWith("/") ? target : `/app/agenda/${target}`);
      });
    }

    const before = await receivedToday(page);
    await page.goto(target.startsWith("/") ? target : `/app/agenda/${target}`);
    let cents = 0;
    await test.step("Atendido › Recebi R$ X no Pix", async () => {
      await page.getByRole("button", { name: "Atendido", exact: true }).click();
      const exits = page.getByRole("group", { name: "Atendido. Como fica o pagamento?" });
      const receive = exits.getByRole("button", { name: /^Recebi R\$\s?[\d.,]+ no Pix$/ });
      const label = (await receive.textContent()) ?? "";
      cents = toCents(/R\$\s?([\d.,]+)/.exec(label)?.[1] ?? "");
      expect(cents, `valor do botão "${label}"`).toBeGreaterThan(0);
      await receive.click();
      await expect(page.locator(".tn-toast")).toContainText("recebido no Pix");
      await expect(page.locator(".tn-sched-badge")).toHaveText("Concluído");
      await expect(page.getByRole("button", { name: "Atendido", exact: true })).toHaveCount(0);
      testInfo.annotations.push({ type: "Recebi no Pix", description: `R$ ${(cents / 100).toFixed(2).replace(".", ",")}` });
    });

    await test.step("Caixa: o valor entra em Hoje", async () => {
      expect(await receivedToday(page)).toBe(before + cents);
      await noHorizontalScroll(page);
    });
    expect(errors, "erros do servidor ou da página").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

/** Respostas 5xx do Supabase (função caída, segredo faltando, 501 do gateway local) e erros de página. */
function watchErrors(page: Page): string[] {
  const out: string[] = [];
  const base = env.supabaseUrl;
  page.on("response", (r) => {
    if (base && r.url().startsWith(base) && r.status() >= 500) out.push(`${r.status()} ${r.request().method()} ${r.url().slice(base.length)}`);
  });
  page.on("pageerror", (e) => out.push(`erro na página: ${e.message}`));
  return out;
}

/** "+ Novo cliente" no Novo agendamento: cadastra e já escolhe. */
async function newCustomer(page: Page, name: string, phone?: string) {
  await page.getByRole("button", { name: "+ Novo cliente" }).click();
  const form = page.getByRole("form", { name: "Novo cliente" });
  await form.getByLabel("Nome").fill(name);
  if (phone) await form.getByLabel("WhatsApp").fill(phone);
  await form.getByRole("button", { name: "Cadastrar e escolher" }).click();
  await expect(page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: new RegExp(escape(name)) })).toBeChecked();
}

/** Minutos de agora até HH:MM de hoje, no fuso do negócio técnico. */
function minutesUntil(hhmm: string): number {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const get = (t: string) => Number(now.find((p) => p.type === t)?.value ?? 0);
  const [h, m] = hhmm.split(":").map(Number);
  return Math.ceil(h! * 60 + m! - (get("hour") * 60 + get("minute") + get("second") / 60));
}

/** "Hoje" do Caixa (recebido no dia), em centavos. */
async function receivedToday(page: Page): Promise<number> {
  await page.goto("/app/caixa");
  await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
  // P54: o resumo do mês virou a lista "Números de <mês>", com "Recebido hoje dd/mm" e o valor no mesmo item.
  const today = page.getByRole("list", { name: /^Números de / }).getByRole("listitem").filter({ hasText: /^Recebido hoje/ });
  await expect(today).toContainText(/R\$\s?[\d.,]+/);
  return toCents(/R\$\s?[\d.,]+/.exec((await today.textContent()) ?? "")?.[0] ?? "");
}

const toCents = (brl: string) => Number(brl.replace(/\D/g, "") || "NaN");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Lê em Mensagens › Simulador o último código entregue ao número. O despacho do canal roda pelo cron (1 min na
 * homologação): a tela é relida até o código chegar.
 */
async function codeOnSimulator(page: Page, e164: string, pattern: RegExp, minutes = 3): Promise<string> {
  await page.goto("/app/mensagens/simulador");
  await expect(page.getByRole("heading", { name: "Simulador do telefone", level: 1 })).toBeVisible();
  const field = page.getByLabel("Número da cliente (ou o do negócio, para ver o código)");
  const newest = page.getByRole("list", { name: "Mensagens entregues" }).getByRole("listitem").first();
  let code = "";
  await expect(async () => {
    await page.reload();
    await field.fill(e164);
    await expect(newest).toContainText(pattern, { timeout: 5_000 });
    code = pattern.exec((await newest.textContent()) ?? "")?.[0] ?? "";
    expect(code).not.toBe("");
  }, `nenhum código chegou ao telefone simulado ${e164} em ${minutes} min: o cron do messaging/channel.dispatch está ativo?`)
    .toPass({ intervals: [10_000], timeout: minutes * 60_000 });
  return code;
}

/**
 * Deixa o número simulado do negócio conectado. Já conectado: nada a fazer. Esperando código de uma execução
 * anterior: desconecta e conecta de novo. Sem número: Conectar com o provedor simulado e o código lido no simulador.
 */
async function connectSimulatedNumber(page: Page) {
  const connected = page.getByRole("group", { name: "Número conectado" });
  const setup = page.getByRole("heading", { name: "Conecte o número do seu negócio" });
  await expect(connected.or(setup).first()).toBeVisible();
  if (await page.getByRole("heading", { name: "Falta verificar o número" }).isVisible()) {
    await page.getByRole("button", { name: "Desconectar" }).click();
    await page.getByRole("button", { name: "Sim, desconectar" }).click();
    await expect(setup).toBeVisible();
  }
  if (await setup.isVisible()) {
    const form = page.getByRole("form", { name: "Conectar número" });
    await form.getByLabel("Provedor").selectOption("simulated");
    await form.getByLabel("Número do negócio (formato internacional)").fill(people.business.e164);
    await form.getByRole("button", { name: "Conectar" }).click();
    await expect(page.getByRole("heading", { name: "Falta verificar o número" })).toBeVisible();
    const code = await codeOnSimulator(page, people.business.e164, /\d{6}/);
    await page.goto("/app/mensagens");
    const verify = page.getByRole("form", { name: "Verificar número" });
    await verify.getByLabel("Código recebido no número").fill(code);
    await verify.getByRole("button", { name: "Verificar" }).click();
  }
  await expect(page.getByText(/^(Número simulado|WhatsApp) conectado$/)).toBeVisible();
  test.info().annotations.push({ type: "canal", description: (await connected.textContent())?.trim() ?? "" });
}

// Estado entre o passo 1 e o 4: o Playwright recomeça o processo depois de uma falha, então fica num arquivo da
// execução (o processo pai, o executor do Playwright, é o mesmo em toda a execução).
type State = { bookingId: string; time: string } | null;
const stateFile = (testInfo: { project: { outputDir: string } }) => join(testInfo.project.outputDir, `jornada-staging-${process.ppid}.json`);
function saveState(testInfo: { project: { outputDir: string } }, state: State) {
  const file = stateFile(testInfo);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}
function loadState(testInfo: { project: { outputDir: string } }): State {
  try {
    return JSON.parse(readFileSync(stateFile(testInfo), "utf8")) as State;
  } catch {
    return null;
  }
}
