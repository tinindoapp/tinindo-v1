import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { addDays, zonedInstant } from "../../lib/time.ts";
import { ForecastPage, riskiestSlots } from "./ForecastPage.tsx";
import { computeForecast, createDemoForecastPort, type ForecastPort, type ForecastVisit } from "./forecastPort.ts";

const TZ = "America/Sao_Paulo";
const v = (date: string, hhmm: string, status: string): ForecastVisit => {
  const s = zonedInstant(date, hhmm, TZ).getTime();
  return { starts_at: new Date(s).toISOString(), ends_at: new Date(s + 3_600_000).toISOString(), status };
};
function synthetic(): ForecastPort {
  const visits: ForecastVisit[] = [];
  for (let j = 1; j <= 12; j++) {
    const m = addDays("2026-11-09", -7 * j);
    visits.push(v(m, "09:00", "completed"), v(m, "10:00", "completed"), v(addDays(m, 1), "09:00", "completed"));
    if (j % 2 === 0) visits.push(v(addDays(m, 1), "10:00", "completed"), v(addDays(m, 1), "11:00", "completed"));
    visits.push(v(addDays(m, 3), "11:00", j <= 4 ? "no_show" : "completed"));
  }
  const hours = Object.fromEntries([1, 2, 3, 4, 5].map((wd) => [wd, { open: [["09:00", "12:00"]] as [string, string][] }]));
  const now = new Date("2026-11-12T15:00:00Z");
  return { kind: "server", now: () => now, forecast: async (ref) => computeForecast({ timezone: TZ, visits, hours }, ref, now) };
}

describe("previsão da próxima semana", () => {
  it("na demonstração (menos de 8 semanas) diz dados insuficientes e quanto falta", async () => {
    render(<ForecastPage port={createDemoForecastPort()} />);
    expect(await screen.findByRole("heading", { name: "dados insuficientes" })).toBeInTheDocument();
    expect(screen.getByText(/precisa de pelo menos 8 semanas fechadas/)).toBeInTheDocument();
  });

  it("com histórico: ocupação por dia, risco por horário com base e acerto contra a referência", async () => {
    render(<ForecastPage port={synthetic()} />);
    expect(await screen.findByRole("heading", { name: /Ocupação esperada · 16\/11\/2026 a 22\/11\/2026/ })).toBeInTheDocument();
    expect(screen.getAllByText("67%").length).toBeGreaterThan(0);
    expect(screen.getByText(/quinta, 11h/)).toBeInTheDocument();
    expect(screen.getByText("4 de 8")).toBeInTheDocument();
    expect(screen.getByText(/acerto de/)).toHaveTextContent("acerto de 80%");
    expect(screen.getByText(/Repetir a semana anterior acertaria 60%/)).toBeInTheDocument();
    expect(screen.getByText("A média das 8 semanas errou menos que repetir a semana anterior.")).toBeInTheDocument();
    expect(screen.getByText(/nada muda sozinho na agenda/)).toBeInTheDocument();
  });

  it("só lista como arriscado o horário com base própria", async () => {
    const f = await synthetic().forecast("2026-11-12");
    expect(riskiestSlots(f).map((s) => [s.weekday, s.hour])).toEqual([[4, 11]]);
  });

  it("erro do servidor vira aviso", async () => {
    render(<ForecastPage port={{ ...synthetic(), forecast: vi.fn().mockRejectedValue(new Error("x")) }} />);
    expect(await screen.findByText(/Não foi possível montar a previsão agora/)).toBeInTheDocument();
  });
});
