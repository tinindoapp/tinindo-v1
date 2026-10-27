// Banner permanente de demonstração (fora de produção). Arquivo próprio e sem dependência de
// módulos: o RouteFrame o mostra uma vez para todas as rotas (app e públicas), sem ciclo router ↔ módulos.
import { appEnv } from "./env.ts";
import "./shell.css";

const BUILD = __TININDO_BUILD__;
/** Versão curta do build: identifica qual commit o endereço está servindo (detalhe completo em /version.json). */
export const BUILD_LABEL = `versão ${BUILD.commit.slice(0, 7)} · ${BUILD.branch}`;

const ENV_LABEL = { local: "ambiente local", staging: "homologação", production: "produção" } as const;

/** Uma linha só (altura fixa `--tn-demo-h`). No celular a versão encurta para o commit; o essencial nunca some. */
export function DemoBanner() {
  if (!appEnv.demo) return null;
  return (
    <div className="tn-demo-banner" role="note">
      <span className="tn-demo-banner__main">
        <strong>Demonstração</strong> · {ENV_LABEL[appEnv.name]} · dados fictícios
      </span>
      <span className="tn-demo-banner__build" title={BUILD_LABEL}>
        {" · "}
        <span className="tn-demo-banner__long">versão </span>
        {BUILD.commit.slice(0, 7)}
        <span className="tn-demo-banner__long"> · {BUILD.branch}</span>
      </span>
    </div>
  );
}
