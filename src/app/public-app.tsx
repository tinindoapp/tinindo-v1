// Pacote das páginas do cliente final (P55, item 5; recado #119): perfil, reserva e avaliação por link, pagamento,
// orçamento e avaliações públicas. Sem sessão, sem o cliente Supabase e sem as telas do dono. Os arquivos
// public-routes.tsx de cada módulo são os mesmos que o roteador completo usa.
// Qualquer caminho fora daqui (ex.: "Entrar", "/app") recarrega a página: main.tsx então carrega o app completo.
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, type RouteObject, RouterProvider } from "react-router";
import { networkAnonRoutes } from "../features/network/public-routes.tsx";
import { setReviewsReader } from "../features/network/public/ReviewHighlights.tsx";
import { paymentsPublicRoutes } from "../features/payments/public-routes.tsx";
import { presencePublicRoutes } from "../features/presence/public-routes.tsx";
import { readPublicReviews, reputationAnonRoutes } from "../features/reputation/public-routes.tsx";
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
  // Avaliações em destaque no perfil: o perfil (Rede) lê a lista pública do módulo Avaliações por esta ligação, sem
  // importar o módulo. Com servidor dá no mesmo que a leitura própria do perfil; na demonstração traz as de exemplo.
  setReviewsReader(readPublicReviews);
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={createBrowserRouter(publicRoutes)} />
    </StrictMode>,
  );
}
