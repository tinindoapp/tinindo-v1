// Módulo Agenda · dono: P04 (tasks/P04.md). Só esta pasta pertence ao módulo;
// src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { AgendaPage } from "./AgendaPage.tsx";
import { BookingDetailPage } from "./BookingDetailPage.tsx";
import { NewBookingPage, ReschedulePage } from "./BookingFlowPage.tsx";
import { HoursPage } from "./HoursPage.tsx";
import { SchedulingLayout } from "./SchedulingLayout.tsx";

export const schedulingModule: ModuleDefinition = {
  id: "scheduling",
  owner: "P04",
  path: "agenda",
  navLabel: "Agenda",
  routes: [
    {
      element: <SchedulingLayout />,
      children: [
        { index: true, element: <AgendaPage /> },
        { path: "novo", element: <NewBookingPage /> },
        { path: "horarios", element: <HoursPage /> },
        { path: "atendimento/:bookingId", element: <BookingDetailPage /> },
        { path: "atendimento/:bookingId/reagendar", element: <ReschedulePage /> },
      ],
    },
  ],
};
