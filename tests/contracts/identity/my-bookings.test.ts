// Minhas reservas: a função do banco e o contrato do frontend têm as mesmas colunas, só o cliente logado executa e a
// projeção não carrega campos do CRM.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BookingStatus, MyBooking } from "@contracts";

const sql = readFileSync(new URL("../../../supabase/migrations/20261025120000_my_bookings.sql", import.meta.url), "utf8");

describe("my_bookings", () => {
  it("colunas da função = campos do contrato", () => {
    const cols = /returns table \(([\s\S]*?)\)\s*language/.exec(sql)![1]!
      .split(",").map((c) => c.trim().split(/\s+/)[0]);
    expect(cols.sort()).toEqual(Object.keys(MyBooking.shape).sort());
  });

  it("só authenticated executa; SECURITY DEFINER com search_path vazio", () => {
    expect(sql).toMatch(/revoke all on function public\.my_bookings\(\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.my_bookings\(\) to authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\.my_bookings\(\)[^;]*anon/);
    expect(sql).toMatch(/security definer set search_path = ''/);
  });

  it("sem campos privados na projeção; reserva vencida fica de fora", () => {
    for (const f of ["status_reason", "source", "customer_id", "guest_ref", "created_by", "notes"]) expect(MyBooking.shape).not.toHaveProperty(f);
    expect(MyBooking.shape.status.options).toEqual(BookingStatus.options.filter((s) => s !== "expired"));
    expect(sql).toMatch(/b\.status <> 'expired'/);
  });
});
