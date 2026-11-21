// Módulo Agenda · dono: P04 (tasks/P04.md). Só esta pasta pertence ao módulo;
// src/app/modules.ts é do integrador.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";

const routes = () => import("./routes.tsx");

export const schedulingModule: ModuleDefinition = {
  id: "scheduling",
  owner: "P04",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "agenda",
  navLabel: "Agenda",
  routes: [
    {
      lazy: screen(routes, (m) => m.SchedulingLayout),
      children: [
        { index: true, lazy: screen(routes, (m) => m.AgendaPage) },
        { path: "novo", lazy: screen(routes, (m) => m.NewBookingPage) },
        { path: "horarios", lazy: screen(routes, (m) => m.HoursPage) },
        { path: "atendimento/:bookingId", lazy: screen(routes, (m) => m.BookingDetailPage) },
        { path: "atendimento/:bookingId/reagendar", lazy: screen(routes, (m) => m.ReschedulePage) },
      ],
    },
  ],
};
