// Rótulos da tela Site e Google (P17).
import type { PresenceDelivery, SiteSection } from "./port.ts";

export const SECTION_LABEL: Record<SiteSection, string> = {
  services: "Serviços",
  prices: "Preços dos serviços",
  hours: "Horários de atendimento",
  booking: "Botão para agendar",
};
export const DELIVERY_LABEL: Record<PresenceDelivery["kind"], string> = {
  site_published: "Site publicado",
  site_unpublished: "Site fora do ar",
  site_restored: "Versão anterior de volta",
  domain_verified: "Domínio verificado",
  domain_removed: "Domínio desligado",
  google_access_granted: "Acesso ao Google concedido",
  google_access_revoked: "Acesso ao Google revogado",
  google_profile_update: "Perfil no Google atualizado",
  google_post: "Publicação no Google",
  google_review_reply: "Resposta a avaliação no Google",
};
export const ACTOR_LABEL: Record<PresenceDelivery["actor"], string> = { owner: "você", operator: "equipe Tinindo", system: "verificação automática" };
export const CATEGORY_LABEL = { barber: "Barbearia", hairdresser: "Cabeleireira", personal_trainer: "Personal trainer", other: "Serviços" } as const;
export const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const CHECK_LABEL = {
  found: "Registro encontrado: domínio verificado.",
  not_found: "O registro ainda não apareceu no DNS. Pode levar alguns minutos depois de criado.",
  taken: "Este domínio já está verificado por outro negócio na Tinindo.",
  lookup_failed: "Não foi possível consultar o DNS agora. Tente de novo em instantes.",
} as const;
export const formatCents = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100);
export const formatDateTime = (iso: string, tz = "America/Sao_Paulo") =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(iso));

/** Erro do catálogo em português simples, com o próximo passo. */
export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "STALE_VERSION":
      return e.field === "preview" ? "O conteúdo mudou desde a prévia (por exemplo, um preço). Atualizamos: confira a prévia e publique de novo." : "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "POLICY_REJECTED":
      if (e.field === "profile") return "Publique seu perfil público primeiro: o site usa só o que o perfil mostra.";
      if (e.field === "domain") return "Já há um domínio ligado. Desligue o atual para ligar outro.";
      if (e.field === "hostname") return "Use um domínio seu (não da Tinindo nem de teste).";
      if (e.field === "hostname_taken") return "Este domínio já está verificado por outro negócio na Tinindo.";
      if (e.field === "service_ids") return "Algum serviço escolhido não está mais ativo. Atualize a lista.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      if (e.field === "hostname") return "Domínio inválido. Exemplo: minhabarbearia.com.br";
      if (e.field === "profile_url") return "O link precisa ser do Google Maps (google.com/maps, maps.app.goo.gl ou g.page).";
      return "Confira os campos e tente de novo.";
    case "QUOTA_EXCEEDED":
      return "Acabamos de consultar o DNS. Espere alguns segundos e verifique de novo.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio cuida do site e do Google.";
    default:
      return "Não deu certo agora. Nada foi alterado; tente de novo.";
  }
}
