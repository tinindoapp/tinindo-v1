// Bloco do dono acima das conversas, fornecido pelo app (módulo não importa módulo). P45: o resumo semanal da Tinindo
// por modelo fixo chega aqui, na caixa de Mensagens do dono. Fica fora de routes.tsx porque a casca o fornece.
import { createContext, type ReactNode } from "react";

export const InboxExtraContext = createContext<ReactNode>(null);
export const InboxExtraProvider = InboxExtraContext.Provider;
