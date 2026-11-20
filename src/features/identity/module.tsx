// Módulo Conta · dono: P01 (tasks/P01.md). Só esta pasta pertence ao módulo;
// src/app/modules.ts e o roteador são do integrador.
import { Outlet } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { AccountPage } from "./AccountPage.tsx";
import { NewPasswordPage } from "./AuthPages.tsx";
import { CreateBusinessPage } from "./CreateBusinessPage.tsx";
import { MoreFeaturesPage } from "./MoreFeaturesPage.tsx";
import { MyBookingsPage } from "./MyBookingsPage.tsx";
import { RedeemLinkPage } from "./RedeemLinkPage.tsx";
import { IdentityServicesProvider } from "./services.tsx";
import "./identity.css";

export { PublicRecoverPassword, PublicSignUp } from "./AuthPages.tsx";

function IdentityLayout() {
  return (
    <IdentityServicesProvider>
      <Outlet />
    </IdentityServicesProvider>
  );
}

export const identityModule: ModuleDefinition = {
  id: "identity",
  owner: "P01",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "conta",
  navLabel: "Conta",
  routes: [
    {
      element: <IdentityLayout />,
      children: [
        { index: true, element: <AccountPage /> },
        { path: "novo-negocio", element: <CreateBusinessPage /> },
        { path: "vincular", element: <RedeemLinkPage /> },
        { path: "reservas", element: <MyBookingsPage /> },
        { path: "nova-senha", element: <NewPasswordPage /> },
        // P51: os seis módulos "por ativação".
        { path: "recursos", element: <MoreFeaturesPage /> },
      ],
    },
  ],
};
