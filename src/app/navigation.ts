// Arquitetura de navegação do app (dono: integrador; ADR-0024). Abas principais Hoje, Agenda, Clientes, Retorno e
// Dinheiro; o resto (mensagens, crescimento, negócio, conta) num menu secundário, agrupado. Ofertas, preços e lista de
// espera ficam no contexto da Agenda. Cada módulo registrado entra em exatamente um grupo (teste em AppShell.test).
// Auditoria de UX, item 39: "Mensagens" juntou-se ao "Assistente", que atende as mesmas conversas ("Assistente atende" /
// "Você está atendendo"), com selo de não lidas no menu.
// Decisão D2 (b), 10/11 (P49): a quinta aba passa a ser "Retorno" (lembretes a mandar, quem não volta, lista de espera),
// tela do Relacionamento. Mensagens sai da barra e fica no menu: no piloto só funciona com provedor simulado.
// A barra segue com 5 abas, que é o que cabe em 360 px com rótulo legível.
import type { ModuleId } from "@contracts";
import type { IconName } from "../components/ui/icons.tsx";
import type { ModuleDefinition } from "./module-types.ts";

interface SectionSpec {
  id: string;
  label: string;
  icon: IconName;
  /** Aparece na barra de abas do celular. */
  tab: boolean;
  /** Selo na aba e no menu: "unread" = mensagens não lidas (o número escrito, nunca só um ponto). */
  badge?: "unread";
  /** `sub`: tela interna do módulo promovida a item (ex.: Horários da Agenda). `short`: rótulo da sub-aba do celular,
   *  para caber mais telas na faixa (o menu e o h1 da tela continuam com o nome inteiro). */
  items: { module: ModuleId; icon: IconName; label?: string; short?: string; sub?: string }[];
}

export const SECTION_SPECS: readonly SectionSpec[] = [
  {
    id: "agenda", label: "Agenda", icon: "agenda", tab: true,
    items: [
      { module: "scheduling", icon: "agenda" },
      { module: "scheduling", sub: "horarios", label: "Horários", icon: "ajustes" },
      { module: "waitlist", icon: "espera", short: "Espera" },
      { module: "pricing", icon: "preco" },
      { module: "field-service", icon: "local" },
    ],
  },
  {
    id: "clientes", label: "Clientes", icon: "cliente", tab: true,
    items: [
      { module: "crm", icon: "cliente" },
      { module: "crm", sub: "servicos", label: "Serviços", icon: "lista" },
      { module: "sales", icon: "orcamento" },
      { module: "lifecycle", icon: "relacionamento", short: "Lembretes" },
      { module: "reputation", icon: "avaliacao" },
    ],
  },
  {
    id: "retorno", label: "Retorno", icon: "relacionamento", tab: true,
    items: [{ module: "lifecycle", sub: "retorno", label: "Retorno", icon: "relacionamento" }],
  },
  {
    id: "dinheiro", label: "Dinheiro", icon: "receber", tab: true,
    items: [{ module: "finance", icon: "receber" }, { module: "finance-advanced", icon: "nota", label: "Contas", short: "Contas" }, { module: "payments", icon: "pagamento" }, { module: "recurrence", icon: "assinatura" }, { module: "fiscal", icon: "nota" }],
  },
  {
    id: "mensagens", label: "Mensagens", icon: "mensagem", tab: false, badge: "unread",
    items: [{ module: "messaging", icon: "mensagem" }, { module: "agent", icon: "assistente" }],
  },
  {
    id: "crescer", label: "Crescer", icon: "crescer", tab: false,
    items: [{ module: "growth-advice", icon: "metas" }, { module: "campaigns", icon: "campanha" }, { module: "referrals", icon: "indicacao" }, { module: "analytics", icon: "resultado" }],
  },
  {
    id: "negocio", label: "Negócio", icon: "negocio", tab: false,
    items: [{ module: "setup", icon: "ajustes" }, { module: "network", icon: "perfil" }, { module: "presence", icon: "site" }, { module: "discovery", icon: "local" }, { module: "service-ops", icon: "plano" }, { module: "resources", icon: "equipe" }, { module: "materials", icon: "material" }, { module: "identity", icon: "conta" }],
  },
];

export interface NavItem {
  module: ModuleId;
  /** Tela interna promovida (sem `sub`, é a tela principal do módulo). */
  sub: string | null;
  label: string;
  /** Rótulo curto da sub-aba (igual a `label` quando não há um próprio). */
  short: string;
  icon: IconName;
  to: string;
}
export interface NavSection {
  id: string;
  label: string;
  icon: IconName;
  tab: boolean;
  badge: "unread" | null;
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
      if (!m) return [];
      const label = i.label ?? m.navLabel;
      return [{ module: m.id, sub: i.sub ?? null, label, short: i.short ?? label, icon: i.icon, to: `/app/${m.path}${i.sub ? `/${i.sub}` : ""}` }];
    });
    return { id: s.id, label: s.label, icon: s.icon, tab: s.tab, badge: s.badge ?? null, items, to: items[0]?.to ?? HOME.to };
  }).filter((s) => s.items.length > 0);
  return sections;
}

/** Módulos registrados que nenhum grupo cobre (deve ser vazio). */
export function ungrouped(modules: readonly ModuleDefinition[]): ModuleId[] {
  const covered = new Set(SECTION_SPECS.flatMap((s) => s.items.map((i) => i.module)));
  return modules.filter((m) => !covered.has(m.id)).map((m) => m.id);
}

const within = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/** Grupo da rota atual (null na Hoje e fora do app): o do item mais específico, porque uma tela interna pode estar
 *  noutro grupo que a principal do módulo (/app/relacionamento/retorno é Retorno; /app/relacionamento, Clientes). */
export function sectionFor(sections: readonly NavSection[], pathname: string): NavSection | null {
  const to = activeTo(sections, pathname);
  return to ? (sections.find((s) => s.items.some((i) => i.to === to)) ?? null) : null;
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
