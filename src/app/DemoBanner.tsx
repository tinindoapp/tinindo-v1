// Banner permanente de demonstração (fora de produção). Arquivo próprio e sem dependência de
// módulos: páginas públicas usam o banner sem importar o shell (evita ciclo router ↔ módulos).
import { appEnv } from "./env.ts";
import "./shell.css";

const ENV_LABEL = { local: "ambiente local", staging: "homologação", production: "produção" } as const;

export function DemoBanner() {
  if (!appEnv.demo) return null;
  return (
    <div className="tn-demo-banner" role="note">
      <strong>Demonstração</strong> · {ENV_LABEL[appEnv.name]} · dados fictícios
    </div>
  );
}
