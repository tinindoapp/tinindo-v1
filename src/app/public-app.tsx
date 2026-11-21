// Pacote das páginas do cliente final (P55, item 5; recado #119): perfil, reserva e avaliação por link, pagamento,
// orçamento e avaliações públicas. Sem sessão, sem o cliente Supabase e sem as telas do dono. Os arquivos
// public-routes.tsx de cada módulo são os mesmos que o roteador completo usa.
// Qualquer caminho fora daqui (ex.: "Entrar", "/app") recarrega a página: main.tsx então carrega o app completo.
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, type RouteObject, RouterProvider } from "react-router";
import { networkAnonRoutes } from "../features/network/public-routes.tsx";
import { paymentsPublicRoutes } from "../features/payments/public-routes.tsx";
import { presencePublicRoutes } from "../features/presence/public-routes.tsx";
import { reputationAnonRoutes } from "../features/reputation/public-routes.tsx";
import { salesPublicRoutes } from "../features/sales/public-routes.tsx";
import { RouteError } from "./pages/Fallbacks.tsx";
import { RouteFrame } from "./RouteFocus.tsx";
import "./pages/pages.css";
// Por último, como no app completo: o global.css vem depois do CSS dos módulos.
import "../styles/global.css";

/** Fora das páginas do cliente: recarrega o mesmo endereço, e o main.tsx escolhe o app completo. */
function LeavePublicApp() {
  useEffect(() => {
    window.location.replace(window.location.href);
  }, []);
  return null;
}

export const publicRoutes: RouteObject[] = [
  {
    element: <RouteFrame />,
    errorElement: <RouteError />,
    children: [
      ...networkAnonRoutes,
      ...presencePublicRoutes,
      ...paymentsPublicRoutes,
      ...salesPublicRoutes,
      ...reputationAnonRoutes,
      { path: "*", element: <LeavePublicApp /> },
    ],
  },
];

export function mountPublicApp(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={createBrowserRouter(publicRoutes)} />
    </StrictMode>,
  );
}
