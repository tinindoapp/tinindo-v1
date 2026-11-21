// Prévia do link nas páginas que o Worker não reescreve (/, /entrar…): o WhatsApp ignora og:image relativo.
// O build (vite.config.ts) passa VITE_PUBLIC_ORIGIN; com um https:// válido a imagem padrão do index.html sai
// absoluta, sem ele fica como está. Nas páginas do cliente final o Worker troca o bloco og inteiro (worker/og.ts).
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;

export function absolutizeOgImage(html: string, origin: string | undefined): string {
  const base = (origin ?? "").trim().replace(/\/+$/, "");
  if (!ORIGIN.test(base)) return html;
  return html.replace('<meta property="og:image" content="/', `<meta property="og:image" content="${base}/`);
}
