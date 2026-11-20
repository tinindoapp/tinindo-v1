import type { Page } from "@playwright/test";

// P51 · Liga módulos "por ativação" na demonstração antes de a página abrir, como o dono faria em Conta › Mais recursos
// (src/app/scope-demo.ts guarda a escolha na aba). Para os e2e do núcleo que passam por uma tela opcional.
export async function ligarRecursos(page: Page, modules: string[]) {
  await page.addInitScript((list) => {
    try {
      const key = "tinindo.demo.modulos";
      const current: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      const merged = new Set([...(Array.isArray(current) ? current : []), ...list]);
      sessionStorage.setItem(key, JSON.stringify([...merged]));
    } catch {
      /* sem armazenamento: o teste vai falhar mostrando a tela desligada */
    }
  }, modules);
}
