// Moldura das páginas públicas (perfil, convite, indicação e diretório): a marca no topo e o conteúdo numa coluna.
// Fica no app porque mais de um módulo usa (auditoria de UX, E11). As classes mantêm o nome antigo (tn-net-public),
// que o ui.css já usa para o tamanho de fonte dos campos no iPhone.
import type { ReactNode } from "react";
import { Wordmark } from "../components/ui/index.tsx";
import "./public-layout.css";

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="tn-net-public">
      <header className="tn-net-public__header">
        <Wordmark width={120} />
      </header>
      <main className="tn-net-public__main" id="conteudo">
        {children}
      </main>
    </div>
  );
}
