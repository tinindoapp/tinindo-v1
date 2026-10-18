// Roteador central (dono: integrador). Módulos entram via src/app/modules.ts.
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { PublicRecoverPassword, PublicSignUp } from "../features/identity/module.tsx";
import { networkPublicRoutes } from "../features/network/module.tsx";
import { waitlistPublicRoutes } from "../features/waitlist/module.tsx";
import { salesPublicRoutes } from "../features/sales/module.tsx";
import { AppShell } from "./AppShell.tsx";
import { MODULES } from "./modules.ts";
import { Home } from "./pages/Home.tsx";
import { NotFound, RouteError } from "./pages/Fallbacks.tsx";
import { RouteFrame } from "./RouteFocus.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import "./pages/pages.css";

export const routes: RouteObject[] = [
  {
    // RouteFrame: título e foco por rota em todas as páginas (shell e públicas).
    element: <RouteFrame />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Navigate to="/app" replace /> },
      { path: "/entrar", element: <SignIn /> },
      // Cadastro e recuperação de senha (P01) ficam fora do shell, que manda quem não tem sessão para /entrar.
      { path: "/criar-conta", element: <PublicSignUp /> },
      { path: "/recuperar-senha", element: <PublicRecoverPassword /> },
      // Páginas públicas fora do shell autenticado: perfil por slug, convite e indicação (P09).
      ...networkPublicRoutes,
      // Link da oferta de vaga (P06): anônimo, token no fragmento, aceite só por ação explícita.
      ...waitlistPublicRoutes,
      // Link do orçamento (P11): anônimo, token no fragmento, aceite só por ação explícita da versão vista.
      ...salesPublicRoutes,
      {
        path: "/app",
        element: <AppShell />,
        children: [
          { index: true, element: <Home /> },
          ...MODULES.map((m) => ({ path: m.path, children: m.routes })),
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
