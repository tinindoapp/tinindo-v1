import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { noHorizontalScroll, openCaixaHistory, openFromNav } from "../qa/helpers.ts";
import { moveBookingToPast, sql } from "./banco.ts";
import { gatewayUrl } from "./portas.ts";

// Primeiro acesso com gravação real: um negócio que nasce do zero (0 de 7 na configuração guiada), na tela, contra o
// Postgres local, pelo gateway desta pasta (handlers de produção, RLS do usuário que entrou). Sem demonstração.
//   criar conta (/criar-conta) → criar o negócio → configurar pela Home e por /app/configurar (horários, serviço,
//   antecedência, perfil) → Mensagens ligado pelo operador e número simulado conectado pela tela → reserva pelo link
//   numa aba anônima com o código do canal simulado → Atendido › Recebi no Pix → Caixa e Retorno → conferir no banco.
// Desktop = cabeleireira; mobile (375 px) = personal trainer. Cada execução cria contas e números novos (carimbo).
//
// Preparos por SQL, os mesmos que a homologação usa e nada além:
// - Mensagens é guardado no piloto (P51): quem opera liga para o negócio com app.module_admin_set, como
//   release/preparar-uat.sh e docs/qa/UAT-PILOTO.md fazem;
// - o tempo passar: a reserva feita pelo link para amanhã vai para ontem ao meio-dia (moveBookingToPast), porque o
//   banco só deixa concluir depois do início.
// O canal simulado sai pelo despacho do gateway (E2E_GATEWAY_DESPACHO_MS, o "cron" local; ver playwright.config.ts).

const CENARIOS = {
  desktop: {
    pessoa: "cabeleireira", negocio: "Salão Teste Primeiro Acesso", profissao: "Cabeleireiro(a)",
    servico: "Corte feminino", duracao: "45", intervalo: "10", preco: "80,00", centavos: 8000, antecedencia: "Até 4 h antes",
  },
  mobile: {
    pessoa: "personal", negocio: "Personal Teste Primeiro Acesso", profissao: "Personal trainer",
    servico: "Sessão individual", duracao: "60", intervalo: "0", preco: "120,00", centavos: 12000, antecedencia: "Até 12 h antes",
  },
} as const;
type Cenario = (typeof CENARIOS)[keyof typeof CENARIOS];
/** Senha fictícia: só existe no banco descartável da execução. */
const SENHA = "senhaTeste123";
const TIMEZONE = "America/Sao_Paulo";

const toast = (page: Page) => page.locator(".tn-toast");
const money = (v: string) => new RegExp(`R\\$\\s?${v.replace(",", "\\,")}`);
const setupCard = (page: Page) => page.getByRole("region", { name: /^Deixe seu negócio pronto/ });

test.use({ timezoneId: TIMEZONE });

/** Falha alta: resposta de erro do gateway (inclusive o 501 do que ele não cobre) e erro de página reprovam no fim. */
function watch(page: Page, out: string[]) {
  page.on("response", (r) => {
    if (r.url().startsWith(gatewayUrl) && r.status() >= 400) out.push(`${r.status()} ${r.request().method()} ${r.url().slice(gatewayUrl.length)}`);
  });
  page.on("pageerror", (e) => out.push(`erro na página: ${e.message}`));
}

async function confirmacaoDeEmail(request: APIRequestContext, ligada: boolean) {
  const r = await request.post(`${gatewayUrl}/__teste/confirmacao`, { data: { ligada } });
  expect(r.ok(), "o gateway de teste troca o modo do cadastro").toBe(true);
}

async function preencherCadastro(page: Page, email: string) {
  await page.goto("/criar-conta");
  await expect(page.getByRole("heading", { name: "Criar conta", level: 1 })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(SENHA);
  await page.getByLabel("Repita a senha").fill(SENHA);
  await page.getByRole("button", { name: "Criar conta" }).click();
}

async function criarNegocio(page: Page, nome: string, profissao: string) {
  await expect(page.getByRole("heading", { name: "Criar meu negócio", level: 1 })).toBeVisible();
  await page.getByLabel("Nome do negócio").fill(nome);
  await page.getByRole("radio", { name: profissao, exact: true }).check();
  // O fuso vem do aparelho (aqui, o do navegador do teste).
  await expect(page.getByText(/Fuso horário: Brasília/)).toBeVisible();
  await page.getByRole("checkbox", { name: /Li e aceito os termos de uso e a política de privacidade/ }).check();
  await page.getByRole("button", { name: "Criar negócio" }).click();
  await expect(toast(page)).toContainText(`Negócio criado. Você é dono(a) de ${nome}.`);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText(nome);
}

/** Volta à Home pelo menu e confere a contagem do cartão e o próximo passo. */
async function homeCard(page: Page, feitos: number, total: number, proximo: RegExp | null) {
  await openFromNav(page, "Hoje");
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  const card = setupCard(page);
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(`Deixe seu negócio pronto · ${feitos} de ${total}`);
  if (proximo) await expect(card).toContainText(proximo);
  return card;
}

test.describe("primeiro acesso com gravação real", () => {
  test.describe.configure({ timeout: 240_000 });

  for (const [projeto, cenario] of Object.entries(CENARIOS) as [keyof typeof CENARIOS, Cenario][]) {
    test.describe(`${cenario.pessoa} (${projeto})`, () => {
      // O mobile do config é um Pixel 7 (412 px); a meta do piloto é o celular de 375 px.
      if (projeto === "mobile") test.use({ viewport: { width: 375, height: 812 } });

      test(`${cenario.pessoa}: conta nova, negócio do zero, configuração, reserva pelo link, Atendido e Recebi no Pix`, async ({ page, browser, request }, testInfo) => {
        test.skip(testInfo.project.name !== projeto, `o cenário da ${cenario.pessoa} roda no projeto ${projeto}`);
        await jornada(page, browser, request, cenario);
      });
    });
  }

  test("cadastro com a confirmação de e-mail LIGADA: não entra até confirmar; o link do e-mail abre o Criar negócio", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "teste curto do cadastro: uma vez, no desktop");
    const falhas: string[] = [];
    watch(page, falhas);
    const email = `confirmar.${Date.now().toString(36)}@exemplo.test`;
    await confirmacaoDeEmail(request, true);
    try {
      await test.step("cadastrar: a tela pede para abrir o link e não abre sessão", async () => {
        await preencherCadastro(page, email);
        await expect(page.getByRole("status").filter({ hasText: "enviamos um link de confirmação" }))
          .toContainText("Se o e-mail puder ser usado, enviamos um link de confirmação. Abra o link para continuar.");
        await expect(page.getByRole("link", { name: "Criar meu negócio" })).toHaveCount(0);
        await page.goto("/app");
        await expect(page).toHaveURL(/\/entrar$/);
      });
      await test.step("entrar antes de confirmar não passa", async () => {
        await page.getByLabel("E-mail").fill(email);
        await page.getByLabel("Senha", { exact: true }).fill(SENHA);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("Falta confirmar o e-mail. Abra o link que enviamos ou peça outro abaixo.");
        await expect(page).toHaveURL(/\/entrar$/);
      });
      await test.step("abrir o link do e-mail (caixa simulada do gateway) entra e cai no Criar meu negócio", async () => {
        const { links } = await (await request.get(`${gatewayUrl}/__teste/correio?para=${encodeURIComponent(email)}`)).json() as { links: string[] };
        expect(links, "um e-mail de confirmação").toHaveLength(1);
        await page.goto(links[0]!);
        await expect(page).toHaveURL(/\/app\/conta\/novo-negocio/);
        await expect(page.getByRole("heading", { name: "Criar meu negócio", level: 1 })).toBeVisible();
        await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
      });
      const [user] = await sql<{ confirmado: boolean; negocios: number }>(
        `select u.email_confirmed_at is not null as confirmado,
                (select count(*)::int from public.tenant_memberships m where m.user_id = u.id) as negocios
         from auth.users u where u.email = $1`, [email]);
      expect(user).toEqual({ confirmado: true, negocios: 0 });
    } finally {
      await confirmacaoDeEmail(request, false);
    }
    // Entrar sem confirmar responde 400 do Auth: é o esperado e fica fora da lista de falhas.
    expect(falhas.filter((f) => !f.startsWith("400 POST /auth/v1/token?grant_type=password")), "respostas de erro do gateway ou erros de página").toEqual([]);
  });
});

async function jornada(page: Page, browser: Browser, request: APIRequestContext, cenario: Cenario) {
  const carimbo = Date.now().toString(36);
  const email = `${cenario.pessoa}.${carimbo}@exemplo.test`;
  const negocio = `${cenario.negocio} ${carimbo}`;
  // Números fictícios, diferentes a cada execução: +55 11 9000x-NNNN.
  const nnnn = String(Date.now() % 10_000).padStart(4, "0");
  const numeroNegocio = `+551190009${nnnn}`;
  const visitante = { nome: `Cliente Teste ${carimbo}`, telefone: `(11) 90001-${nnnn}`, e164: `+551190001${nnnn}` };

  const og = await (await request.get("/og-config.json")).json() as { supabase_url: string | null };
  expect(og.supabase_url, "o preview não é o build com servidor: rode `bash tests/e2e/servidor/run.sh`").toBe(gatewayUrl);

  const [{ inicio }] = await sql<{ inicio: Date }>("select now() as inicio");
  const falhas: string[] = [];
  watch(page, falhas);

  await test.step("criar conta com a confirmação de e-mail desligada (o caso da homologação)", async () => {
    await confirmacaoDeEmail(request, false);
    await preencherCadastro(page, email);
    await expect(page.getByRole("status").filter({ hasText: "Conta criada." })).toBeVisible();
    await page.getByRole("link", { name: "Criar meu negócio" }).click();
  });

  await test.step("criar o negócio: nome, profissão e termos; abre na Home com 0 de 7", async () => {
    await criarNegocio(page, negocio, cenario.profissao);
    const card = setupCard(page);
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("Deixe seu negócio pronto · 0 de 7");
    await expect(card).toContainText("Próximo: Definir seus horários de atendimento");
    await noHorizontalScroll(page);
  });

  await test.step("horários, a partir do cartão da Home: os sete dias, 08:00–20:00", async () => {
    await setupCard(page).getByRole("link", { name: "Definir horários" }).click();
    const form = page.getByRole("form", { name: "Expediente semanal" });
    await expect(form.getByRole("group", { name: "Segunda" })).toContainText("Fechado");
    for (const day of ["Segunda", "Sábado", "Domingo"]) {
      await form.getByRole("button", { name: `Editar ${day}` }).click();
      await form.getByRole("button", { name: `Adicionar faixa em ${day}` }).click();
      const group = form.getByRole("group", { name: day });
      await group.getByLabel("Início").fill("08:00");
      await group.getByLabel("Fim").fill("20:00");
      if (day === "Segunda") await form.getByRole("button", { name: "Usar o horário de segunda nos dias úteis" }).click();
    }
    await page.getByRole("button", { name: "Salvar expediente" }).click();
    await expect(page.getByRole("button", { name: "Salvar expediente" })).toHaveCount(0);
    for (const day of ["Segunda", "Quarta", "Sábado", "Domingo"]) await expect(form.getByRole("group", { name: day })).toContainText("08:00–20:00");
    await noHorizontalScroll(page);
  });

  await test.step("serviço com duração e preço, a partir do cartão da Home", async () => {
    const card = await homeCard(page, 1, 7, /Próximo: Cadastrar um serviço com duração e preço/);
    await card.getByRole("link", { name: "Cadastrar serviço" }).click();
    await expect(page.getByRole("heading", { name: "Serviços", level: 1 })).toBeVisible();
    await page.getByRole("region", { name: "Lista de serviços" }).getByRole("button", { name: "Cadastrar serviço" }).click();
    await page.getByLabel("Nome", { exact: true }).fill(cenario.servico);
    await page.getByLabel("Duração (min)").fill(cenario.duracao);
    await page.getByLabel("Preço à vista (R$)").fill(cenario.preco);
    // P54 parte 2: intervalos, piso, custo e taxa ficam em "Mais opções"; piso em branco vale o preço.
    await page.getByText("Mais opções", { exact: true }).click();
    await page.getByLabel("Intervalo depois (min)").fill(cenario.intervalo);
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    const lista = page.getByRole("region", { name: "Lista de serviços" });
    await expect(lista.getByRole("listitem").filter({ hasText: cenario.servico })).toContainText(money(cenario.preco));
    await noHorizontalScroll(page);
  });

  await test.step("antecedência para cancelar, pela lista de /app/configurar", async () => {
    const card = await homeCard(page, 2, 7, /Próximo: Definir a antecedência para cancelar/);
    await card.getByRole("link", { name: "Ver os 7 passos" }).click();
    await expect(page.getByRole("heading", { name: "Deixe seu negócio pronto", level: 1 })).toBeVisible();
    const passos = page.getByRole("list", { name: "Passos da configuração" });
    await passos.getByRole("listitem").filter({ hasText: "Definir a antecedência para cancelar" }).getByRole("link", { name: "Definir antecedência" }).click();
    const form = page.getByRole("form", { name: "Objetivo e política de cancelamento" });
    await expect(form).toBeVisible();
    await form.getByRole("radio", { name: "Saber quem pagou e quem falta pagar" }).check();
    // "cliente" na beleza, "aluno(a)" no personal.
    const prazo = form.getByLabel(/^Até quando (cliente|aluno\(a\)) pode cancelar sem multa\?$/);
    // O rótulo da opção pode trazer "(comum para …)" conforme a profissão: escolhe pelo começo do texto.
    const opcao = prazo.locator("option").filter({ hasText: new RegExp(`^${cenario.antecedencia}`) });
    await prazo.selectOption((await opcao.getAttribute("value"))!);
    await form.getByRole("button", { name: "Concluir" }).click();
    await expect(toast(page)).toContainText("Salvo.");
    await noHorizontalScroll(page);
  });

  let slug = "";
  await test.step("publicar o perfil, pela lista de /app/configurar", async () => {
    await openFromNav(page, "Configuração");
    await expect(page.getByRole("region", { name: /^Passos · 3 de 7 feitos/ })).toBeVisible();
    const passos = page.getByRole("list", { name: "Passos da configuração" });
    await passos.getByRole("listitem").filter({ hasText: "Publicar seu perfil e mandar o link" }).getByRole("link", { name: "Publicar perfil" }).click();
    await expect(page.getByRole("heading", { name: "Seu perfil público", level: 1 })).toBeVisible();
    const montar = page.getByRole("region", { name: "Montar perfil" });
    slug = await montar.getByLabel("Endereço do perfil").inputValue();
    expect(slug, "o endereço sugerido sai do nome do negócio").toMatch(/^[a-z0-9-]+$/);
    await expect(montar).toContainText(cenario.profissao);
    await montar.getByLabel("Bairro ou região").fill("Bairro Exemplo");
    await montar.getByRole("button", { name: "Publicar perfil" }).click();
    await expect(page.getByText("Seu perfil está no ar!")).toBeVisible();
    await noHorizontalScroll(page);
    const card = await homeCard(page, 4, 7, /Seu link público já recebe reservas\. O que falta é opcional\./);
    await expect(card).toContainText("Próximo (opcional):");
  });

  const [{ tenant }] = await sql<{ tenant: string }>(
    `select t.id::text as tenant from public.tenants t join public.tenant_memberships m on m.tenant_id = t.id
     join auth.users u on u.id = m.user_id where u.email = $1 and t.name = $2`, [email, negocio]);

  await test.step("Mensagens ligado pelo operador e número simulado conectado pela tela", async () => {
    // Preparo de quem opera a homologação (P51: Mensagens fica guardado no piloto).
    await sql("select app.module_admin_set($1, 'messaging', true)", [tenant]);
    await page.goto("/app/mensagens");
    await expect(page.getByRole("heading", { name: "Mensagens", level: 1 })).toBeVisible();
    await conectarNumeroSimulado(page, numeroNegocio);
  });

  const visitor = await browser.newContext({ timezoneId: TIMEZONE, viewport: page.viewportSize() ?? undefined, isMobile: cenario.pessoa === "personal", hasTouch: cenario.pessoa === "personal" });
  const pub = await visitor.newPage();
  const falhasPub: string[] = [];
  watch(pub, falhasPub);
  let dia = "";
  await test.step("aba anônima: pedir um horário de amanhã ao meio-dia pelo link", async () => {
    await pub.goto(`/p/${slug}`);
    await expect(pub.getByRole("heading", { name: negocio, level: 1 })).toBeVisible();
    await expect(pub.getByRole("heading", { name: "Escolha o serviço", level: 2 })).toBeVisible();
    await expect(pub.getByRole("main")).toContainText(cenario.servico);
    await pub.getByRole("button", { name: "Escolher dia e hora" }).click();
    const dias = pub.locator('input[name="dia-link"]');
    await dias.nth(1).check();
    dia = await dias.nth(1).inputValue();
    await pub.getByRole("list", { name: "Horários livres" }).getByRole("button", { name: "12:00", exact: true }).click();
    const form = pub.getByRole("form", { name: "Pedir horário" });
    await form.getByLabel("Seu nome").fill(visitante.nome);
    await form.getByLabel("WhatsApp com DDD").fill(visitante.telefone);
    await form.getByRole("button", { name: "Pedir este horário" }).click();
    await expect(pub.getByRole("heading", { name: "Confirme o horário", level: 2 })).toBeVisible();
    await noHorizontalScroll(pub);
  });

  await test.step("o código sai pelo canal simulado e é lido em Mensagens › Simulador; a cliente confirma", async () => {
    const codigo = await codigoNoSimulador(page, visitante.e164);
    await pub.bringToFront();
    await pub.getByLabel("Código recebido").fill(codigo);
    await pub.getByRole("button", { name: "Confirmar horário" }).click();
    await expect(pub.getByRole("heading", { name: "Horário confirmado", level: 2 })).toBeVisible();
    await expect(pub.getByRole("main")).toContainText("12:00");
    await noHorizontalScroll(pub);
  });
  await visitor.close();

  let bookingId = "";
  await test.step("o pedido aparece na Agenda do negócio, confirmado e com quem pediu", async () => {
    await page.bringToFront();
    await page.goto(`/app/agenda?data=${dia}`);
    const item = page.getByRole("list", { name: /^Linha do tempo de / }).locator('li[data-kind="booking"][data-status="confirmed"]').filter({ hasText: /^12:00–/ });
    await expect(item).toHaveCount(1);
    await item.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Atendimento", level: 1 })).toBeVisible();
    await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
    await expect(page.getByRole("main")).toContainText("Link de agendamento");
    await expect(page.getByRole("main")).toContainText(visitante.nome);
    await expect(page.getByRole("main")).toContainText(money(cenario.preco));
    bookingId = /\/atendimento\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? "";
    expect(bookingId, "o endereço do atendimento traz o id gravado").not.toBe("");
  });

  await test.step("preparo: o tempo passa (o atendimento vai para ontem ao meio-dia)", async () => {
    await moveBookingToPast(bookingId, 1);
    await page.reload();
    await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
  });

  await test.step("Atendido › Recebi no Pix", async () => {
    await page.getByRole("button", { name: "Atendido", exact: true }).click();
    const exits = page.getByRole("group", { name: "Atendido. Como fica o pagamento?" });
    await exits.getByRole("button", { name: new RegExp(`^Recebi R\\$\\s?${cenario.preco.replace(",", "\\,")} no Pix$`) }).click();
    await expect(toast(page)).toContainText("recebido no Pix");
    await expect(page.locator(".tn-sched-badge")).toHaveText("Concluído");
    await expect(page.getByRole("button", { name: "Atendido", exact: true })).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  await test.step("Caixa: o recebimento entrou", async () => {
    await openFromNav(page, "Caixa");
    await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
    await openCaixaHistory(page);
    const recebimentos = page.getByRole("region", { name: "Recebimentos no mês" });
    await expect(recebimentos.getByRole("listitem")).toHaveCount(1);
    await expect(recebimentos.getByRole("listitem")).toContainText(money(cenario.preco));
    await expect(recebimentos.getByRole("listitem")).toContainText("Pix");
    await noHorizontalScroll(page);
  });

  await test.step("Retorno abre sem erro", async () => {
    if (cenario.pessoa === "personal") await page.getByRole("navigation", { name: "Abas" }).getByRole("link", { name: "Retorno" }).click();
    else await openFromNav(page, "Retorno");
    await expect(page.getByRole("heading", { name: "Retorno", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Quem não volta" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    // Quem reservou pelo link não vira cliente (a reserva fica "Sem cliente cadastrado"): Retorno não tem a quem
    // chamar. Defeito anotado no relatório da jornada (achado A11 da revisão de 04/11, ainda aberto).
    await expect(page.getByRole("region", { name: "Quem não volta" })).toContainText("Ninguém sumido");
    await noHorizontalScroll(page);
  });

  await test.step("Home: o que ficou feito conta no cartão (Mensagens ligado acrescenta o passo do número)", async () => {
    // 4 obrigatórios + número verificado + primeiro recebimento = 6; com Mensagens ligado são 8 passos.
    const card = await homeCard(page, 6, 8, /Próximo \(opcional\): Cadastrar seu primeiro cliente/);
    await expect(card).toContainText("Seu link público já recebe reservas.");
  });

  await test.step("no banco: negócio, serviço, atendimento e recebimento, todos do negócio novo e de mais nenhum", async () => {
    const [n] = await sql<{ nome: string; profissao: string; dono: string; servicos: number; regras: number; publicado: boolean; antecedencia: number | null }>(
      `select t.name as nome, t.profession as profissao, u.email as dono,
              (select count(*)::int from public.provider_services s where s.tenant_id = t.id and s.active) as servicos,
              (select count(*)::int from public.availability_rules r where r.tenant_id = t.id) as regras,
              (select p.published_at is not null from public.public_profiles p where p.tenant_id = t.id) as publicado,
              (select o.cancellation_notice_hours from public.tenant_onboarding o where o.tenant_id = t.id) as antecedencia
       from public.tenants t join public.tenant_memberships m on m.tenant_id = t.id and m.role = 'owner'
       join auth.users u on u.id = m.user_id where t.id = $1`, [tenant]);
    expect(n).toMatchObject({ nome: negocio, dono: email, servicos: 1, regras: 7, publicado: true });
    expect(n!.antecedencia).toBeGreaterThan(0);

    const rows = await sql<{ status: string; tenant: string; servico: string; preco: number; origem: string; recebivel: string; pago: number; recebimentos: number; metodo: string }>(
      `select b.status, b.tenant_id::text as tenant, s.name as servico, b.agreed_price_cents::int as preco, b.source as origem,
              r.status as recebivel, r.paid_cents::int as pago,
              (select count(*)::int from public.payment_entries e where e.receivable_id = r.id) as recebimentos,
              (select min(e.method) from public.payment_entries e where e.receivable_id = r.id) as metodo
       from public.bookings b
       join public.provider_services s on s.tenant_id = b.tenant_id and s.id = b.service_id
       left join public.receivables r on r.tenant_id = b.tenant_id and r.booking_id = b.id
       where b.id = $1`, [bookingId]);
    expect(rows).toEqual([{ status: "completed", tenant, servico: cenario.servico, preco: cenario.centavos, origem: "public_link", recebivel: "paid", pago: cenario.centavos, recebimentos: 1, metodo: "pix" }]);

    // Nada do que esta jornada gravou foi para outro negócio: desde o começo dela (os testes rodam em série, um
    // worker), nenhum serviço, expediente, reserva, recebível ou recebimento nasceu em outro negócio.
    const [vazou] = await sql<{ servicos: number; regras: number; reservas: number; recebiveis: number; recebimentos: number }>(
      `select (select count(*)::int from public.provider_services where tenant_id <> $1 and created_at >= $2) as servicos,
              (select count(*)::int from public.availability_rules where tenant_id <> $1 and created_at >= $2) as regras,
              (select count(*)::int from public.bookings where tenant_id <> $1 and created_at >= $2) as reservas,
              (select count(*)::int from public.receivables where tenant_id <> $1 and created_at >= $2) as recebiveis,
              (select count(*)::int from public.payment_entries where tenant_id <> $1 and created_at >= $2) as recebimentos`,
      [tenant, inicio]);
    expect(vazou).toEqual({ servicos: 0, regras: 0, reservas: 0, recebiveis: 0, recebimentos: 0 });
  });

  expect(inesperadas([...falhas, ...falhasPub]), "respostas de erro do gateway ou erros de página durante a jornada").toEqual([]);
}

/**
 * Respostas de erro conhecidas, que não travam a jornada: cada uma fica anotada no relatório (com o motivo) em vez de
 * reprovar. Qualquer outra resposta de erro reprova. Tirar daqui quando a causa for corrigida.
 */
// Vazia desde o recado #161: a página pública só pede o Site do P17 quando o perfil diz que há um (has_site).
const CONHECIDAS: { padrao: RegExp; motivo: string }[] = [];
function inesperadas(falhas: string[]): string[] {
  const resto: string[] = [];
  for (const f of falhas) {
    const conhecida = CONHECIDAS.find((c) => c.padrao.test(f));
    if (!conhecida) resto.push(f);
    else if (!test.info().annotations.some((a) => a.description?.startsWith(f))) test.info().annotations.push({ type: "resposta de erro conhecida", description: `${f}: ${conhecida.motivo}` });
  }
  return resto;
}

/** Lê em Mensagens › Simulador o último código entregue ao número (o despacho do gateway roda a cada poucos segundos). */
async function codigoNoSimulador(page: Page, e164: string): Promise<string> {
  await page.goto("/app/mensagens/simulador");
  await expect(page.getByRole("heading", { name: "Simulador do telefone", level: 1 })).toBeVisible();
  const field = page.getByLabel("Número da cliente (ou o do negócio, para ver o código)");
  const newest = page.getByRole("list", { name: "Mensagens entregues" }).getByRole("listitem").first();
  let code = "";
  await expect(async () => {
    await page.reload();
    await field.fill(e164);
    await expect(newest).toContainText(/\d{6}/, { timeout: 3_000 });
    code = /\d{6}/.exec((await newest.textContent()) ?? "")?.[0] ?? "";
    expect(code).not.toBe("");
  }, `nenhum código chegou ao telefone simulado ${e164}: o despacho do gateway (E2E_GATEWAY_DESPACHO_MS) está ligado?`)
    .toPass({ intervals: [2_000], timeout: 60_000 });
  return code;
}

/** Mensagens › Conectar número com o provedor simulado; o código de verificação é lido no simulador. */
async function conectarNumeroSimulado(page: Page, e164: string) {
  await expect(page.getByRole("heading", { name: "Conecte o número do seu negócio" })).toBeVisible();
  const form = page.getByRole("form", { name: "Conectar número" });
  await form.getByLabel("Provedor").selectOption("simulated");
  await form.getByLabel("Número do negócio (formato internacional)").fill(e164);
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByRole("heading", { name: "Falta verificar o número" })).toBeVisible();
  const code = await codigoNoSimulador(page, e164);
  await page.goto("/app/mensagens");
  const verify = page.getByRole("form", { name: "Verificar número" });
  await verify.getByLabel("Código recebido no número").fill(code);
  await verify.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByText(/^Número simulado conectado$/)).toBeVisible();
}
