// P19 pelos handlers com o banco real: prévia do público (só consentimento de marketing) → aprovação citando o hash,
// controle sorteado e tetos no servidor → passos pela régua do P13 (sem canal: para compartilhar) → conversão medida
// por um agendamento real do P03 → resultado por braço com intervalo → cancelar para o pendente → fechamento pelo
// worker congela. SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { BookingOutput, CampaignGetOutput, CampaignListOutput, CampaignOutput, CampaignPreviewOutput } from "@contracts";
import { fails, FX, nextWeek, ok, plusMin, pool, runJobs, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
type Jobs = { campaigns?: { closed: number }; lifecycle?: { manual: number } };
afterAll(() => pool.end());
/** Clientes só deste roteiro (o banco é compartilhado): 12 com consentimento de marketing, sem atendimento futuro. */
const IDS = Array.from({ length: 12 }, (_, i) => `60000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`);
const preview = (segment: unknown) => ok(CampaignPreviewOutput, "campaigns", "campaign.preview", { ...owner, body: { segment } });

describe("P19 · campanhas pelos handlers", () => {
  let campaignId = "";
  let version = 1;

  it("1 · público autorizado: só quem consentiu marketing; segmento inválido cai antes do banco", async () => {
    await runJobs();
    await sql("insert into public.customers (id, tenant_id, name) select x.id::uuid, $1, 'Campanha ' || x.ord from unnest($2::text[]) with ordinality as x(id, ord) on conflict do nothing", [T.A, IDS]);
    await sql("insert into public.lifecycle_consents (tenant_id, customer_id, purpose) select $1, x::uuid, 'marketing' from unnest($2::text[]) x where not exists (select 1 from public.lifecycle_consents c where c.customer_id = x::uuid and c.purpose = 'marketing' and c.revoked_at is null)", [T.A, IDS.slice(0, 10)]);
    const p = await preview({ kind: "inactive_days", days: 30 });
    const mine = p.customers.filter((c) => IDS.includes(c.customer_id)).map((c) => c.customer_id).sort();
    expect(mine).toEqual(IDS.slice(0, 10).sort());
    expect(p.audience_count).toBe(p.customers.length);
    await fails("campaigns", "campaign.preview", { ...owner, body: { segment: { kind: "inactive_days", days: 2 } } }, "VALIDATION_ERROR");
    expect((await preview({ kind: "credit_remaining" })).customers.some((c) => IDS.includes(c.customer_id))).toBe(false);
  });

  it("2 · aprovar cita o público visto; o servidor sorteia o controle e aplica os tetos; hash velho é recusado", async () => {
    const p = await preview({ kind: "inactive_days", days: 30 });
    await fails("campaigns", "campaign.approve", { ...owner, key: true, body: { name: "Velha", segment: { kind: "inactive_days", days: 30 }, audience_hash: "0".repeat(64), control_pct: 50, max_sends: 100 } }, "STALE_VERSION", "audience_hash");
    const c = await ok(CampaignOutput, "campaigns", "campaign.approve", { ...owner, key: true, body: {
      name: "Volta pro corte", segment: { kind: "inactive_days", days: 30 }, audience_hash: p.audience_hash, control_pct: 50, max_sends: 100, window_days: 14,
      offer: { kind: "discount_pct", pct: 10, service_id: FX.services.corteA } } });
    campaignId = c.campaign.id;
    version = c.campaign.version;
    expect(c.campaign).toMatchObject({ status: "running", audience_count: p.audience_count, offer_text: "10% de desconto em Corte", result: { design: "randomized_control", final: false } });
    expect(c.campaign.control_count).toBe(Math.ceil(p.audience_count / 2));
    expect(c.campaign.control_count + c.campaign.treatment_count).toBe(p.audience_count);
    expect(c.campaign.estimated_cost_cents).toBe(600 * c.campaign.treatment_count);
    // Quem entrou está fora do público seguinte (hash muda) e o público vazio não aprova.
    const p2 = await preview({ kind: "inactive_days", days: 30 });
    expect(p2.audience_hash).not.toBe(p.audience_hash);
    expect(p2.customers.some((x) => IDS.includes(x.customer_id))).toBe(false);
    // Sem canal conectado neste roteiro para essas clientes: passos viram "para compartilhar", nada sai sozinho.
    const jobs = (await runJobs()) as Jobs;
    expect(jobs.lifecycle?.manual).toBeGreaterThanOrEqual(1);
    const g = await ok(CampaignGetOutput, "campaigns", "campaign.get", { ...owner, body: { campaign_id: campaignId } });
    expect(g.members.filter((m) => m.arm === "treatment").every((m) => ["manual", "sent", "deferred", "skipped"].includes(m.step_status ?? ""))).toBe(true);
    expect(g.members.filter((m) => m.arm === "control").every((m) => m.step_status === null)).toBe(true);
    const names = JSON.stringify(g.campaign);
    expect(names).not.toContain("Campanha 1");
  });

  it("3 · conversão é medida por agendamento real; resultado por braço com intervalo; veredito só pelo desenho", async () => {
    const g = await ok(CampaignGetOutput, "campaigns", "campaign.get", { ...owner, body: { campaign_id: campaignId } });
    const treated = g.members.find((m) => m.arm === "treatment" && IDS.includes(m.customer_id))!;
    const t = await nextWeek(2, "08:15");
    await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: treated.customer_id, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A, slot: { starts_at: t, ends_at: plusMin(t, 30) }, quote_id: null, mode: "confirm" } });
    const g2 = await ok(CampaignGetOutput, "campaigns", "campaign.get", { ...owner, body: { campaign_id: campaignId } });
    expect(g2.members.find((m) => m.customer_id === treated.customer_id)?.converted).toBe(true);
    const r = g2.campaign.result;
    expect(r.arms.treatment.converted).toBeGreaterThanOrEqual(1);
    expect(r.arms.treatment.ci[0]).toBeLessThanOrEqual(r.arms.treatment.rate!);
    expect(r.arms.treatment.ci[1]).toBeGreaterThanOrEqual(r.arms.treatment.rate!);
    expect(["no_difference_detected", "difference_detected", "inconclusive"]).toContain(r.verdict);
    expect(r.difference === null || r.difference.ci[0] <= r.difference.value).toBe(true);
    const list = await ok(CampaignListOutput, "campaigns", "campaign.list", { ...owner, body: {} });
    expect(list.campaigns.some((c) => c.id === campaignId)).toBe(true);
  });

  it("4 · cancelar para o pendente e congela como observação parcial; fechamento pelo worker congela de verdade", async () => {
    await fails("campaigns", "campaign.cancel", { ...owner, key: true, body: { campaign_id: campaignId, expected_version: 99 } }, "STALE_VERSION");
    const c = await ok(CampaignOutput, "campaigns", "campaign.cancel", { ...owner, key: true, body: { campaign_id: campaignId, expected_version: version } });
    expect(c.campaign).toMatchObject({ status: "cancelled", result: { final: true } });
    await fails("campaigns", "campaign.cancel", { ...owner, key: true, body: { campaign_id: campaignId, expected_version: c.campaign.version } }, "POLICY_REJECTED", "status");
    // As clientes voltam ao público e uma campanha observacional (sem controle) fecha pelo worker ao vencer.
    const p = await preview({ kind: "marketing_all" });
    expect(p.customers.some((x) => IDS.includes(x.customer_id))).toBe(true);
    const obs = await ok(CampaignOutput, "campaigns", "campaign.approve", { ...owner, key: true, body: {
      name: "Só observação", segment: { kind: "marketing_all" }, audience_hash: p.audience_hash, control_pct: 0, max_sends: 3, window_days: 7 } });
    expect(obs.campaign).toMatchObject({ treatment_count: 3, control_count: 0, result: { design: "observational", verdict: "observation_only" } });
    await sql("update public.campaigns set ends_at = clock_timestamp() - interval '1 minute' where id = $1", [obs.campaign.id]);
    expect(((await runJobs()) as Jobs).campaigns?.closed).toBe(1);
    expect(((await runJobs()) as Jobs).campaigns?.closed).toBe(0);
    const g = await ok(CampaignGetOutput, "campaigns", "campaign.get", { ...owner, body: { campaign_id: obs.campaign.id } });
    expect(g.campaign).toMatchObject({ status: "closed", result: { final: true, verdict: "observation_only" } });
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'campaign.closed.v1' and aggregate_id = $1", [obs.campaign.id]);
    expect(ev[0]!.n).toBe(1);
  });

  it("SEC · outro dono não vê nem aprova", async () => {
    await fails("campaigns", "campaign.list", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("campaigns", "campaign.get", { as: U.ownerB, tenant: T.A, body: { campaign_id: campaignId } }, "FORBIDDEN");
    await fails("campaigns", "campaign.approve", { as: U.outsider, tenant: T.A, key: true, body: { name: "X", segment: { kind: "marketing_all" }, audience_hash: "0".repeat(64), max_sends: 1 } }, "FORBIDDEN");
  });
});
