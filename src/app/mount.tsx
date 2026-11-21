// App completo (dono, cadastro, páginas com login): sessão, cliente Supabase e todas as rotas. main.tsx carrega este
// pedaço para tudo que não é página do cliente final (P55, recado #119).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { supabase } from "../lib/supabase.ts";
import { createAppRouter } from "./router.tsx";
import { SessionProvider } from "./session.tsx";
// Por último: o global.css vem depois do CSS dos módulos (mesma ordem de antes da divisão dos pacotes).
import "../styles/global.css";

export function mountApp(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <SessionProvider client={supabase}>
        <RouterProvider router={createAppRouter()} />
      </SessionProvider>
    </StrictMode>,
  );
}
