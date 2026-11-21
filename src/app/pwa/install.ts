// "Adicionar à tela de início" (P34). No Android (Chrome, Edge, Samsung Internet) o navegador oferece a instalação pelo
// evento `beforeinstallprompt`; no iPhone não há evento e o caminho é o botão Compartilhar do Safari. Em qualquer outro
// caso, as instruções do menu do navegador.

export type Platform = "ios" | "ios-other-browser" | "android" | "desktop";

export interface InstallEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** display-mode: standalone, ou navigator.standalone no iPhone. */
  standalone: boolean;
}

export function platformOf(env: InstallEnv): Platform {
  const ua = env.userAgent;
  // iPad com iPadOS se apresenta como Mac; o toque denuncia.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other-browser" : "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export interface InstallSteps {
  title: string;
  steps: string[];
}

/** Passos em palavras, do jeito que cada celular mostra. Sem prometer nada que o navegador não faz. */
export function installSteps(p: Platform): InstallSteps {
  switch (p) {
    case "ios":
      return {
        title: "No iPhone (Safari)",
        steps: [
          "Toque em Compartilhar, o quadrado com a seta para cima, na barra de baixo.",
          "Role a lista e toque em \"Adicionar à Tela de Início\".",
          "Confirme em \"Adicionar\". O ícone da Tinindo aparece junto dos outros apps.",
        ],
      };
    case "ios-other-browser":
      return {
        title: "No iPhone",
        steps: [
          "Abra este endereço no Safari: só ele adiciona à tela de início no iPhone.",
          "No Safari, toque em Compartilhar e depois em \"Adicionar à Tela de Início\".",
        ],
      };
    case "android":
      return {
        title: "No Android (Chrome)",
        steps: [
          "Toque no menu do navegador, os três pontos no canto de cima.",
          "Toque em \"Instalar app\" ou \"Adicionar à tela inicial\".",
          "Confirme. O ícone da Tinindo aparece na tela inicial.",
        ],
      };
    default:
      return {
        title: "No computador",
        steps: ["No Chrome ou no Edge, use o ícone de instalar na barra de endereço, ou o menu do navegador e \"Instalar Tinindo\"."],
      };
  }
}

/** O evento `beforeinstallprompt` (Chromium). Guardado para o botão "Instalar" chamar quando o dono tocar. */
export interface DeferredPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "tinindo.pwa.instalar.dispensado";
const FIRST_SEEN_KEY = "tinindo.pwa.primeiro-uso";
/** O convite só aparece depois de um dia de uso neste aparelho: no primeiro acesso, o dono está conhecendo o app. */
const INVITE_AFTER_MS = 86_400_000;

/** Marca o primeiro uso (se ainda não houver) e diz se já passou o tempo para convidar. */
export function inviteDue(now: number, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  try {
    const seen = Number(storage?.getItem(FIRST_SEEN_KEY) ?? "");
    if (!Number.isFinite(seen) || seen <= 0) {
      storage?.setItem(FIRST_SEEN_KEY, String(now));
      return false;
    }
    return now - seen >= INVITE_AFTER_MS;
  } catch {
    return false;
  }
}
const DISMISS_DAYS = 30;

/** "Agora não" vale por 30 dias neste aparelho. */
export function installDismissed(now: number, storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    const at = Number(storage?.getItem(DISMISS_KEY) ?? "");
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function dismissInstall(now: number, storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(DISMISS_KEY, String(now));
  } catch {
    /* modo privado: some só nesta visita */
  }
}
