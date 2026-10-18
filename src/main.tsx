import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createAppRouter } from "./app/router.tsx";
import { SessionProvider } from "./app/session.tsx";
import { supabase } from "./lib/supabase.ts";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root ausente");

createRoot(root).render(
  <StrictMode>
    <SessionProvider client={supabase}>
      <RouterProvider router={createAppRouter()} />
    </SessionProvider>
  </StrictMode>,
);
