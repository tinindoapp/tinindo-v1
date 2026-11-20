// Cabeçalhos de segurança do frontend (P57, borda pública). Uma fonte só para:
// - as respostas que o Worker produz (rotas de `run_worker_first`: /p/*, /s/*), aplicadas em worker/index.ts;
// - o arquivo `_headers` dos arquivos estáticos (`headersFile()`): o integrador gera `public/_headers` a partir daqui
//   (recado no handoff do P57), porque os estáticos não passam pelo código do Worker.
//
// CSP: só o próprio domínio para script, estilo, fonte e manifesto; conexões e imagens também para o Supabase (API,
// Edge Functions e fotos públicas do perfil); nada de ser emoldurado por outro site (frame-ancestors 'none').
// `style-src 'unsafe-inline'`: o React escreve `style=` em alguns componentes (barra de progresso, por exemplo).
// Sem `unsafe-inline` em script: o HTML do build só tem <script type="module" src>, e o JSON-LD do perfil é bloco de
// dados (não executa, não depende de CSP).

export interface CspConfig {
  /** URL do Supabase do ambiente (og-config.json). Sem ela, vale o domínio padrão do Supabase. */
  supabase_url: string | null;
}

const SUPABASE_DEFAULT = "https://*.supabase.co";

/** Origem https do Supabase configurado, ou null se a URL não for https (local) ou for inválida. */
function supabaseOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(cfg: CspConfig = { supabase_url: null }): string {
  const sb = [SUPABASE_DEFAULT, supabaseOrigin(cfg.supabase_url)].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
  const wss = sb.map((o) => o.replace(/^https:/, "wss:"));
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${sb.join(" ")}`,
    "font-src 'self' data:",
    `connect-src 'self' ${[...sb, ...wss].join(" ")}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(cfg?: CspConfig): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(cfg),
    "X-Content-Type-Options": "nosniff",
    // O token do link da reserva fica no fragmento (#t=…), que o navegador nunca manda; mesmo assim, para outro site
    // só vai a origem.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Navegadores antigos que não leem frame-ancestors.
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Strict-Transport-Security": "max-age=31536000",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** Mesma resposta com os cabeçalhos de segurança (substitui os que vierem). Redirecionamento incluído. */
export function withSecurityHeaders(res: Response, cfg?: CspConfig): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(securityHeaders(cfg))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Conteúdo de `_headers` (Cloudflare) para os arquivos estáticos: os mesmos cabeçalhos em todas as rotas. */
export function headersFile(cfg?: CspConfig): string {
  const lines = Object.entries(securityHeaders(cfg)).map(([k, v]) => `  ${k}: ${v}`);
  return ["# Gerado de worker/security-headers.ts (P57). Não edite à mão.", "/*", ...lines, ""].join("\n");
}
