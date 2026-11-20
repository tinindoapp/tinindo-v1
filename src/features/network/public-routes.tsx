// Rotas do perfil que o cliente final abre sem login. Sem a tela do dono, sem sessão e sem o cliente Supabase: este
// arquivo serve ao roteador completo (via module.tsx) e ao pacote das páginas do cliente, quando o integrador o ligar.
import type { RouteObject } from "react-router";
import { PublicProfilePage } from "./public/ProfilePage.tsx";

export const networkAnonRoutes: RouteObject[] = [{ path: "/p/:slug", element: <PublicProfilePage /> }];
