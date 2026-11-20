// Moldura das telas da Conta, carregada sob demanda pelo manifesto (module.tsx).
import { Outlet } from "react-router";
import { IdentityServicesProvider } from "./services.tsx";

export function IdentityLayout() {
  return (
    <IdentityServicesProvider>
      <Outlet />
    </IdentityServicesProvider>
  );
}
