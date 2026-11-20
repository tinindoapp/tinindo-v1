// Rotas do perfil que o cliente final abre sem login. Sem a tela do dono, sem sessão e sem o cliente Supabase: este
// arquivo serve ao roteador completo (via module.tsx) e ao pacote das páginas do cliente, quando o integrador o ligar.
import type { RouteObject } from "react-router";
import { PublicProfilePage } from "./public/ProfilePage.tsx";
import { ReservationPage } from "./public/ReservationPage.tsx";

export const networkAnonRoutes: RouteObject[] = [
  { path: "/p/:slug", element: <PublicProfilePage /> },
  // D20: ver a reserva e avaliar pelo link com token (o endereço do negócio no caminho é opcional).
  { path: "/reserva", element: <ReservationPage /> },
  { path: "/reserva/:slug", element: <ReservationPage /> },
];
