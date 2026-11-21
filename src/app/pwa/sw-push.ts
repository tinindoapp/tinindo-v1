// Aviso no celular (P34, item 3), do lado do service worker: o que vira a notificação e para onde o toque leva.

export interface ShownNotification {
  title: string;
  options: { body: string; icon: string; badge: string; tag: string; data: { url: string }; lang: string };
}

/** Só caminhos do próprio app (/app…): um conteúdo estranho nunca leva para fora. */
export function safeAppUrl(url: unknown): string {
  return typeof url === "string" && /^\/app(\/[A-Za-z0-9/_?=&.-]*)?$/.test(url) && !url.includes("..") ? url : "/app";
}

/** Monta a notificação a partir do conteúdo decifrado. Conteúdo inválido vira um aviso neutro (o navegador exige um). */
export function notificationFrom(raw: unknown): ShownNotification {
  const m = (raw ?? {}) as { title?: unknown; body?: unknown; url?: unknown; kind?: unknown };
  const title = typeof m.title === "string" && m.title.trim() ? m.title.slice(0, 60) : "Tinindo";
  const body = typeof m.body === "string" && m.body.trim() ? m.body.slice(0, 160) : "Você tem uma novidade na agenda.";
  const kind = typeof m.kind === "string" && /^[a-z_0-9]{1,30}$/.test(m.kind) ? m.kind : "aviso";
  return {
    title,
    options: {
      body,
      icon: "/icons/app-icon-192.png",
      badge: "/icons/app-icon-192.png",
      // Mesma etiqueta por tipo e conteúdo: o mesmo aviso repetido substitui o anterior em vez de empilhar.
      tag: `${kind}:${body}`.slice(0, 120),
      data: { url: safeAppUrl(m.url) },
      lang: "pt-BR",
    },
  };
}
