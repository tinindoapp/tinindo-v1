// Roteador central (dono: integrador). Módulos entram via src/app/modules.ts.
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { AppShell } from "./AppShell.tsx";
import { MODULES } from "./modules.ts";
import { Home } from "./pages/Home.tsx";
import { NotFound, RouteError } from "./pages/Fallbacks.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import "./pages/pages.css";

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Navigate to="/app" replace /> },
      { path: "/entrar", element: <SignIn /> },
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
