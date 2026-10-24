// Roteador central (dono: integrador). Módulos entram via src/app/modules.ts.
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { PublicRecoverPassword, PublicSignUp } from "../features/identity/module.tsx";
import { networkPublicRoutes } from "../features/network/module.tsx";
import { waitlistPublicRoutes } from "../features/waitlist/module.tsx";
import { salesPublicRoutes } from "../features/sales/module.tsx";
import { paymentsPublicRoutes } from "../features/payments/module.tsx";
import { presencePublicRoutes } from "../features/presence/module.tsx";
import { discoveryPublicRoutes } from "../features/discovery/module.tsx";
import { reputationPublicRoutes } from "../features/reputation/module.tsx";
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
      // Link de pagamento (P14): anônimo, token no fragmento; pagar de verdade é no provedor, aqui só o simulado.
      ...paymentsPublicRoutes,
      // Site do negócio (P17): só a versão publicada; a página indexável é servida pela função `presence`.
      ...presencePublicRoutes,
      // Diretório local (P23): busca e páginas por cidade; a versão indexável é servida pela função `discovery`.
      ...discoveryPublicRoutes,
      // Avaliações (P24): o cliente avalia com login (sem negócio) e a lista pública do perfil.
      ...reputationPublicRoutes,
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
