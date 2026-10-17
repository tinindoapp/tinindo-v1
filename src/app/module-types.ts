import type { ModuleId } from "@contracts";
import type { RouteObject } from "react-router";

export interface ModuleDefinition {
  id: ModuleId;
  /** Pacote responsável (tasks/Pxx.md). */
  owner: `P${number}`;
  /** Segmento sob /app. Único por módulo. */
  path: string;
  navLabel: string;
  /** Rotas filhas relativas a /app/<path>. A rota índice é a tela principal do módulo. */
  routes: RouteObject[];
}
