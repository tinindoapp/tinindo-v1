// Sobe o gateway de teste. O repositório não tem tsx nem vite-node: o módulo é carregado pelo próprio Vite (SSR),
// que resolve o alias @contracts do vite.config.ts de que o harness de integração depende.
// Uso (playwright.config.ts desta pasta): node --experimental-strip-types tests/e2e/servidor/iniciar-gateway.ts
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { gatewayPort, previewOrigins } from "./portas.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const vite = await createServer({
  root,
  appType: "custom",
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { startGateway } = (await vite.ssrLoadModule("/tests/e2e/servidor/gateway.ts")) as typeof import("./gateway.ts");
// E2E_GATEWAY_DESPACHO_MS (opcional): de quanto em quanto tempo o despacho do canal roda, imitando o cron. A jornada
// do P59 não usa; a jornada da homologação rodada localmente (tests/e2e-staging/local.sh) usa para o código chegar.
const dispatchEveryMs = Number(process.env.E2E_GATEWAY_DESPACHO_MS ?? 0);
await startGateway({ port: gatewayPort, allowedOrigins: previewOrigins, dispatchEveryMs });
console.log(`[gateway] no ar em http://127.0.0.1:${gatewayPort} (banco ${process.env.PGDATABASE ?? "?"}), origens: ${previewOrigins.join(", ")}${dispatchEveryMs > 0 ? `, despacho do canal a cada ${dispatchEveryMs} ms` : ""}`);

const stop = () => void vite.close().finally(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
