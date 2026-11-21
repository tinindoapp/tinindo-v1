// Entrada: escolhe o pacote pelo caminho (P55, recado #119). As páginas do cliente final carregam só o pacote público
// (sem sessão, sem cliente Supabase, sem telas do dono); o resto carrega o app completo. Manter o padrão em sincronia
// com src/app/public-app.tsx (teste em src/app/public-app.test.ts). O global.css entra no fim de cada pacote, depois do CSS
// dos módulos, como antes da divisão: a ordem da cascata não muda.
import { isPublicPath } from "./app/public-paths.ts";

const root = document.getElementById("root");
if (!root) throw new Error("#root ausente");

// await no topo: o carregamento da página (evento load) espera o pacote escolhido montar, como quando era um pacote só.
if (isPublicPath(location.pathname)) (await import("./app/public-app.tsx")).mountPublicApp(root);
else (await import("./app/mount.tsx")).mountApp(root);
