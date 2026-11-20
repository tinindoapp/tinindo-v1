// Portas e pasta do build da jornada com servidor, configuráveis por variável de ambiente (outras cópias do
// repositório usam 4173 e 4273). Sem imports: o mesmo arquivo é lido pelo Node (iniciar-gateway.ts) e pelo
// Playwright (playwright.config.ts).
export const previewPort = Number(process.env.E2E_SERVIDOR_PORT ?? 4373);
export const gatewayPort = Number(process.env.E2E_GATEWAY_PORT ?? 54390);
export const previewUrl = `http://127.0.0.1:${previewPort}`;
export const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
export const previewOrigins = [previewUrl, `http://localhost:${previewPort}`];
/** Pasta do build com servidor: temporária e fora do repositório, criada por run.sh (não pisa no `dist` da demonstração). */
export const distDir = process.env.E2E_SERVIDOR_DIST ?? "";
