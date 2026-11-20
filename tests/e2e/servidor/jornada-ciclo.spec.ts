import { expect, type Page, test } from "@playwright/test";
import { noHorizontalScroll, openFromNav } from "../qa/helpers.ts";
import { moveBookingToPast, sql } from "./banco.ts";
import { gatewayUrl } from "./portas.ts";

// Jornada do ciclo com gravação real (P59; lacuna 4 de docs/qa/revisao-2026-11-10/25-testes.md):
// expediente → agendar → atender → receber → retorno, na tela, contra o Postgres local; depois recarrega e confere.
// Cada clique passa pela porta de servidor do frontend (src/features/*/serverPort.ts), pelo handler de produção
// (montado em tests/integration/harness.ts) e pelas RPCs do banco, com o papel e a RLS do usuário que entrou.
//
// Cada projeto usa um negócio do seed, para um não mexer nos totais do outro: desktop = Barbearia Exemplo A,
// mobile = Personal Exemplo B (a RLS separa os dois de verdade).
//
// Relógio: o banco usa o relógio real. O teste não depende do dia nem da hora em que roda:
// - o expediente é salvo pela tela para os sete dias (não há fim de semana fechado);
// - o agendamento é sempre para amanhã ao meio-dia (nunca "hoje mais tarde", que some no fim do dia);
// - o que a tela não faz (o tempo passar) é o único preparo por SQL: moveBookingToPast (ver banco.ts);
// - os totais conferidos são os do mês; a janela de falha é virar o mês entre o toque em "Recebi" e a leitura do
//   Caixa (segundos, uma vez por mês).
const CENARIOS = {
  desktop: { email: "dono.a@exemplo.test", negocio: "Barbearia Exemplo A", servico: "Corte", preco: "60,00", centavos: 6000 },
  mobile: { email: "dono.b@exemplo.test", negocio: "Personal Exemplo B", servico: "Sessão de treino", preco: "120,00", centavos: 12000 },
} as const;
/** Senha local do seed (supabase/seed.sql): só existe no banco descartável. */
const SENHA = "tinindo-local-123";
/** Há quantos dias foi a visita depois que "o tempo passa": 30 ou mais é "não volta" (src/lib/visits.ts). */
const DIAS = 35;

const toast = (page: Page) => page.locator(".tn-toast");
const money = (v: string) => new RegExp(`R\\$\\s?${v.replace(",", "\\,")}`);

test("ciclo com gravação real: expediente, agendar, atender, receber e retorno; recarregar mostra o que ficou", async ({ page, request, isMobile }, testInfo) => {
  const cenario = CENARIOS[testInfo.project.name as keyof typeof CENARIOS];
  expect(cenario, `projeto ${testInfo.project.name} sem cenário`).toBeTruthy();
  const sufixo = Date.now().toString(36);
  const cliente = `Cliente da Jornada ${sufixo}`;
  // DDD 11 + 9 dígitos, diferente a cada execução (o cadastro avisa de duplicado pelo telefone).
  const digitos = String(Date.now() % 100_000_000).padStart(8, "0");
  const whatsapp = `(11) 9${digitos.slice(0, 4)}-${digitos.slice(4)}`;

  // O build servido tem de apontar para o gateway (og-config.json sai do mesmo VITE_SUPABASE_URL do bundle).
  const og = await (await request.get("/og-config.json")).json() as { supabase_url: string | null };
  expect(og.supabase_url, "o preview não é o build com servidor: rode `bash tests/e2e/servidor/run.sh`").toBe(gatewayUrl);

  // Falha alta: resposta de erro do gateway (inclusive o 501 do que ele não cobre) reprova a jornada no fim.
  const falhas: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith(gatewayUrl) && r.status() >= 400) falhas.push(`${r.status()} ${r.request().method()} ${r.url().slice(gatewayUrl.length)}`);
  });
  page.on("pageerror", (e) => falhas.push(`erro na página: ${e.message}`));

  await test.step("entrar com o usuário do seed", async () => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/entrar$/);
    await page.getByLabel("E-mail").fill(cenario.email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    // O negócio vem dos vínculos lidos com a RLS do usuário (tenant_memberships), não das fixtures da demonstração.
    await expect(page.getByRole("banner")).toContainText(cenario.negocio);
  });

  await test.step("definir o expediente dos sete dias (o seed não traz horários)", async () => {
    await openFromNav(page, "Horários");
    const form = page.getByRole("form", { name: "Expediente semanal" });
    await expect(form.getByRole("group", { name: "Domingo" })).toContainText("Fechado");
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
    await page.reload();
    const saved = page.getByRole("form", { name: "Expediente semanal" });
    for (const day of ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]) {
      await expect(saved.getByRole("group", { name: day })).toContainText("08:00–20:00");
    }
  });

  let bookingId = "";
  await test.step("agendar para amanhã ao meio-dia, cadastrando o cliente na hora", async () => {
    await openFromNav(page, "Agenda");
    await page.getByRole("link", { name: "Novo agendamento" }).click();
    await page.getByRole("button", { name: "+ Novo cliente" }).click();
    const novo = page.getByRole("form", { name: "Novo cliente" });
    await novo.getByLabel("Nome").fill(cliente);
    await novo.getByLabel("WhatsApp").fill(whatsapp);
    await novo.getByRole("button", { name: "Cadastrar e escolher" }).click();
    await expect(page.getByRole("group", { name: "Cliente" }).getByRole("radio", { name: new RegExp(cliente) })).toBeChecked();

    await page.getByRole("radio", { name: new RegExp(`^${cenario.servico}`) }).check();
    await page.getByRole("button", { name: "Próximo dia" }).click();
    await page.getByRole("group", { name: "Horários livres" }).getByRole("button", { name: "12:00", exact: true }).click();
    // O valor vem da cotação do servidor (pricing.quote), que a reserva consome.
    await expect(page.getByRole("region", { name: "Revise e confirme" })).toContainText(money(cenario.preco));
    await page.getByRole("button", { name: "Confirmar agendamento" }).click();

    await expect(page.getByRole("heading", { name: "Atendimento", level: 1 })).toBeVisible();
    await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
    await expect(page.getByText(/, 12:00–1[23]:[03]0$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Avisar no WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/55119\d{8}\?text=/);
    // Antes do início o banco não deixa concluir, e a tela não oferece.
    await expect(page.getByRole("button", { name: "Atendido", exact: true })).toHaveCount(0);
    bookingId = /\/atendimento\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? "";
    expect(bookingId, "o endereço do atendimento traz o id gravado").not.toBe("");
    await noHorizontalScroll(page);
  });

  await test.step(`preparo: o tempo passa (o atendimento vai para ${DIAS} dias atrás)`, async () => {
    await moveBookingToPast(bookingId, DIAS);
    await page.reload();
    await expect(page.locator(".tn-sched-badge")).toHaveText("Confirmado");
    await expect(page.getByText(/, 12:00–1[23]:[03]0$/)).toBeVisible();
  });

  await test.step("atender e receber num toque: Atendido → Recebi no Pix", async () => {
    await page.getByRole("button", { name: "Atendido", exact: true }).click();
    const exits = page.getByRole("group", { name: "Atendido. Como fica o pagamento?" });
    await exits.getByRole("button", { name: new RegExp(`^Recebi R\\$\\s?${cenario.preco} no Pix$`) }).click();
    await expect(toast(page)).toContainText("Atendimento concluído e R$");
    await expect(toast(page)).toContainText("recebido no Pix. Registro manual no Caixa.");
    await expect(page.locator(".tn-sched-badge")).toHaveText("Concluído");
    await expect(page.getByRole("button", { name: "Atendido", exact: true })).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  const conferirCaixa = async () => {
    await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
    const recebimentos = page.getByRole("region", { name: "Recebimentos no mês" });
    await expect(recebimentos.getByRole("listitem")).toHaveCount(1);
    await expect(recebimentos.getByRole("listitem")).toContainText(money(cenario.preco));
    await expect(recebimentos.getByRole("listitem")).toContainText("Pix");
    await expect(recebimentos.getByRole("listitem")).toContainText(cliente);
    const mes = page.getByRole("region", { name: /^Caixa registrado em / });
    await expect(mes).toContainText(new RegExp(`Sobrou no mês\\s*R\\$\\s?${cenario.preco}`));
    await expect(page.getByRole("region", { name: "A receber", exact: true })).toContainText("Nada em aberto.");
    await expect(page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" })).toContainText("Nenhum atendimento concluído esperando cobrança.");
  };
  await test.step("Caixa: o recebimento entrou, nada ficou em aberto", async () => {
    await openFromNav(page, "Caixa");
    await conferirCaixa();
    await noHorizontalScroll(page);
  });

  const conferirRetorno = async () => {
    await expect(page.getByRole("heading", { name: "Retorno", level: 1 })).toBeVisible();
    const lapsed = page.getByRole("region", { name: "Quem não volta" });
    await expect(lapsed.getByRole("listitem")).toHaveCount(1);
    await expect(lapsed.getByRole("link", { name: cliente, exact: true })).toBeVisible();
    await expect(lapsed).toContainText(`Última visita há ${DIAS} dias`);
    await expect(lapsed.getByRole("link", { name: `Chamar ${cliente} no WhatsApp` })).toHaveAttribute("href", /^https:\/\/wa\.me\/55119\d{8}$/);
  };
  await test.step("Retorno: quem veio há mais de 30 dias e não tem horário marcado aparece para chamar de volta", async () => {
    if (isMobile) await page.getByRole("navigation", { name: "Abas" }).getByRole("link", { name: "Retorno" }).click();
    else await openFromNav(page, "Retorno");
    await conferirRetorno();
    await noHorizontalScroll(page);
  });

  await test.step("recarregar: agendamento concluído, recebimento no Caixa e cliente no Retorno continuam lá", async () => {
    await page.reload();
    await conferirRetorno();

    await page.goto("/app/caixa");
    await conferirCaixa();

    await page.goto(`/app/agenda/atendimento/${bookingId}`);
    await expect(page.locator(".tn-sched-badge")).toHaveText("Concluído");
    await expect(page.getByRole("main")).toContainText(cliente);
    await expect(page.getByRole("button", { name: "Atendido", exact: true })).toHaveCount(0);

    await page.goto("/app/clientes?filtro=sem-voltar");
    const lista = page.getByRole("region", { name: /^Lista de (clientes|alunos)$/ });
    await expect(lista.getByRole("link", { name: cliente, exact: true })).toBeVisible();
    await expect(lista.getByRole("listitem").filter({ hasText: cliente })).toContainText(`Última visita há ${DIAS} dias`);
  });

  await test.step("no banco: uma reserva concluída, um recebível quitado e um recebimento, do negócio certo", async () => {
    const rows = await sql<{ status: string; negocio: string; cliente: string; recebivel: string; valor: number; pago: number; recebimentos: number; metodo: string }>(
      `select b.status, t.name as negocio, c.name as cliente, r.status as recebivel, r.amount_cents::int as valor, r.paid_cents::int as pago,
              (select count(*)::int from public.payment_entries e where e.receivable_id = r.id) as recebimentos,
              (select min(e.method) from public.payment_entries e where e.receivable_id = r.id) as metodo
       from public.bookings b
       join public.tenants t on t.id = b.tenant_id
       join public.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id
       left join public.receivables r on r.tenant_id = b.tenant_id and r.booking_id = b.id
       where b.id = $1`, [bookingId]);
    expect(rows).toEqual([{ status: "completed", negocio: cenario.negocio, cliente, recebivel: "paid", valor: cenario.centavos, pago: cenario.centavos, recebimentos: 1, metodo: "pix" }]);
  });

  expect(falhas, "respostas de erro do gateway ou erros de página durante a jornada").toEqual([]);
});
