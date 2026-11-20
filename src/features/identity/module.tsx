// Módulo Conta · dono: P01 (tasks/P01.md). Só esta pasta pertence ao módulo;
// src/app/modules.ts e o roteador são do integrador.
// Manifesto (P53): a moldura e cada tela são carregadas sob demanda.
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./identity.css";

const auth = () => import("./AuthPages.tsx");

/** Cadastro e recuperação de senha (P01), fora do shell, que manda quem não tem sessão para /entrar. */
export const identityPublicRoutes: RouteObject[] = [
  { path: "/criar-conta", lazy: screen(auth, (m) => m.PublicSignUp) },
  { path: "/recuperar-senha", lazy: screen(auth, (m) => m.PublicRecoverPassword) },
];

export const identityModule: ModuleDefinition = {
  id: "identity",
  owner: "P01",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "conta",
  navLabel: "Conta",
  routes: [
    {
      lazy: screen(() => import("./routes.tsx"), (m) => m.IdentityLayout),
      children: [
        { index: true, lazy: screen(() => import("./AccountPage.tsx"), (m) => m.AccountPage) },
        { path: "novo-negocio", lazy: screen(() => import("./CreateBusinessPage.tsx"), (m) => m.CreateBusinessPage) },
        { path: "vincular", lazy: screen(() => import("./RedeemLinkPage.tsx"), (m) => m.RedeemLinkPage) },
        { path: "reservas", lazy: screen(() => import("./MyBookingsPage.tsx"), (m) => m.MyBookingsPage) },
        { path: "nova-senha", lazy: screen(auth, (m) => m.NewPasswordPage) },
        // P51: os seis módulos "por ativação".
        { path: "recursos", lazy: screen(() => import("./MoreFeaturesPage.tsx"), (m) => m.MoreFeaturesPage) },
      ],
    },
  ],
};
