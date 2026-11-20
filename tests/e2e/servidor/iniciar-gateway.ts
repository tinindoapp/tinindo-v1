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
await startGateway({ port: gatewayPort, allowedOrigins: previewOrigins });
console.log(`[gateway] no ar em http://127.0.0.1:${gatewayPort} (banco ${process.env.PGDATABASE ?? "?"}), origens: ${previewOrigins.join(", ")}`);

const stop = () => void vite.close().finally(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
