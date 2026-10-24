// Arquitetura de navegação do app (dono: integrador; ADR-0024). Segue o doc 12: abas principais Hoje, Agenda, Clientes,
// Dinheiro e Assistente; o resto (crescimento, negócio, conta) num menu secundário, agrupado. Ofertas, preços e lista de
// espera ficam no contexto da Agenda. Cada módulo registrado entra em exatamente um grupo (teste em AppShell.test).
import type { ModuleId } from "@contracts";
import type { IconName } from "../components/ui/icons.tsx";
import type { ModuleDefinition } from "./module-types.ts";

interface SectionSpec {
  id: string;
  label: string;
  icon: IconName;
  /** Aparece na barra de abas do celular. */
  tab: boolean;
  /** `sub`: tela interna do módulo promovida a item (ex.: Horários da Agenda). */
  items: { module: ModuleId; icon: IconName; label?: string; sub?: string }[];
}

export const SECTION_SPECS: readonly SectionSpec[] = [
  {
    id: "agenda", label: "Agenda", icon: "agenda", tab: true,
    items: [
      { module: "scheduling", icon: "agenda" },
      { module: "scheduling", sub: "horarios", label: "Horários", icon: "ajustes" },
      { module: "waitlist", icon: "espera" },
      { module: "pricing", icon: "preco" },
    ],
  },
  {
    id: "clientes", label: "Clientes", icon: "cliente", tab: true,
    items: [
      { module: "crm", icon: "cliente" },
      { module: "crm", sub: "servicos", label: "Serviços", icon: "lista" },
      { module: "messaging", icon: "mensagem" },
      { module: "sales", icon: "orcamento" },
      { module: "lifecycle", icon: "relacionamento" },
    ],
  },
  {
    id: "dinheiro", label: "Dinheiro", icon: "receber", tab: true,
    items: [{ module: "finance", icon: "receber" }, { module: "payments", icon: "pagamento" }, { module: "recurrence", icon: "assinatura" }, { module: "fiscal", icon: "nota" }],
  },
  { id: "assistente", label: "Assistente", icon: "assistente", tab: true, items: [{ module: "agent", icon: "assistente" }] },
  {
    id: "crescer", label: "Crescer", icon: "crescer", tab: false,
    items: [{ module: "growth-advice", icon: "metas" }, { module: "campaigns", icon: "campanha" }, { module: "referrals", icon: "indicacao" }, { module: "analytics", icon: "resultado" }],
  },
  {
    id: "negocio", label: "Negócio", icon: "negocio", tab: false,
    items: [{ module: "network", icon: "perfil" }, { module: "presence", icon: "site" }, { module: "service-ops", icon: "plano" }, { module: "identity", icon: "conta" }],
  },
];

export interface NavItem {
  module: ModuleId;
  /** Tela interna promovida (sem `sub`, é a tela principal do módulo). */
  sub: string | null;
  label: string;
  icon: IconName;
  to: string;
}
export interface NavSection {
  id: string;
  label: string;
  icon: IconName;
  tab: boolean;
  items: NavItem[];
  /** Destino ao tocar no grupo (primeiro item). */
  to: string;
}

export const HOME = { label: "Hoje", icon: "home" as IconName, to: "/app" };

/** Junta a especificação com os módulos registrados (rótulo e caminho vêm do módulo). Módulo sem grupo é erro. */
export function buildNavigation(modules: readonly ModuleDefinition[]): NavSection[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const sections = SECTION_SPECS.map((s) => {
    const items = s.items.flatMap((i) => {
      const m = byId.get(i.module);
      return m ? [{ module: m.id, sub: i.sub ?? null, label: i.label ?? m.navLabel, icon: i.icon, to: `/app/${m.path}${i.sub ? `/${i.sub}` : ""}` }] : [];
    });
    return { id: s.id, label: s.label, icon: s.icon, tab: s.tab, items, to: items[0]?.to ?? HOME.to };
  }).filter((s) => s.items.length > 0);
  return sections;
}

/** Módulos registrados que nenhum grupo cobre (deve ser vazio). */
export function ungrouped(modules: readonly ModuleDefinition[]): ModuleId[] {
  const covered = new Set(SECTION_SPECS.flatMap((s) => s.items.map((i) => i.module)));
  return modules.filter((m) => !covered.has(m.id)).map((m) => m.id);
}

const within = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/** Grupo da rota atual (null na Hoje e fora do app). */
export function sectionFor(sections: readonly NavSection[], pathname: string): NavSection | null {
  return sections.find((s) => s.items.some((i) => within(pathname, i.to))) ?? null;
}

export function isItemActive(item: NavItem, pathname: string): boolean {
  return within(pathname, item.to);
}

/** Destino do item mais específico que contém a rota (Horários vence Agenda em /app/agenda/horarios). */
export function activeTo(sections: readonly NavSection[], pathname: string): string | null {
  let best: string | null = null;
  for (const s of sections) for (const i of s.items) if (within(pathname, i.to) && (!best || i.to.length > best.length)) best = i.to;
  return best;
}
