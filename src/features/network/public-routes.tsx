// Rotas do perfil que o cliente final abre sem login. Sem a tela do dono, sem sessão e sem o cliente Supabase: este
// arquivo serve ao roteador completo (via module.tsx) e ao pacote das páginas do cliente, quando o integrador o ligar.
// Revisão de qualidade (bloco 2, desempenho): as telas carregam sob demanda. Antes vinham inteiras no carregamento do
// app (perfil público, kit público e o CSS deles), também para quem só abria a Hoje.
import type { RouteObject } from "react-router";

const profile = () => import("./public/ProfilePage.tsx");
const reservation = () => import("./public/ReservationPage.tsx");

export const networkAnonRoutes: RouteObject[] = [
  { path: "/p/:slug", lazy: async () => ({ Component: (await profile()).PublicProfilePage }) },
  // D20: ver a reserva e avaliar pelo link com token (o endereço do negócio no caminho é opcional).
  { path: "/reserva", lazy: async () => ({ Component: (await reservation()).ReservationPage }) },
  { path: "/reserva/:slug", lazy: async () => ({ Component: (await reservation()).ReservationPage }) },
];
