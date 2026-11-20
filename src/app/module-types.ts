import type { ModuleId, ModuleLevel } from "@contracts";
import type { RouteObject } from "react-router";

export interface ModuleDefinition {
  id: ModuleId;
  /** Pacote responsável (tasks/Pxx.md). */
  owner: `P${number}`;
  /**
   * Visibilidade no piloto (P51, decisão D1 a): `pilot` aparece para todo negócio; `activation` aparece quando o dono
   * liga em Conta › Mais recursos; `stored` fica guardado (rota registrada, nenhum link) até o backend ligar para o negócio.
   */
  level: ModuleLevel;
  /** Segmento sob /app. Único por módulo. */
  path: string;
  navLabel: string;
  /** Rotas filhas relativas a /app/<path>. A rota índice é a tela principal do módulo. */
  routes: RouteObject[];
}
