// Modelos de serviço por profissão (P44). Cópia de leitura dos mesmos valores da migration
// (public.setup_service_templates, 20261103134122_p44_setup.sql): os modelos só mudam por migration, e esta lista
// acompanha. Usada pelo analisador da frase (duração e faixa de preço do rascunho) e pela demonstração sem servidor.
// A faixa é ponto de partida que o dono revisa; nunca vira preço sozinha.
import type { Profession, SetupServiceTemplate } from "../../contracts/index.ts";

export type ServiceTemplateSeed = Omit<SetupServiceTemplate, "exists"> & { profession: Profession };

export const SERVICE_TEMPLATES: readonly ServiceTemplateSeed[] = [
  { code: "barber_corte", profession: "barber", kind: "service", name: "Corte", duration_min: 30, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 3500, price_to_cents: 7000 },
  { code: "barber_barba", profession: "barber", kind: "service", name: "Barba", duration_min: 20, buffer_before_min: 0, buffer_after_min: 5, price_from_cents: 2500, price_to_cents: 5000 },
  { code: "barber_corte_barba", profession: "barber", kind: "service", name: "Corte e barba", duration_min: 50, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 5500, price_to_cents: 11000 },
  { code: "hair_corte", profession: "hairdresser", kind: "service", name: "Corte", duration_min: 45, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 5000, price_to_cents: 15000 },
  { code: "hair_escova", profession: "hairdresser", kind: "service", name: "Escova", duration_min: 40, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 4000, price_to_cents: 10000 },
  { code: "hair_coloracao", profession: "hairdresser", kind: "service", name: "Coloração", duration_min: 120, buffer_before_min: 0, buffer_after_min: 15, price_from_cents: 12000, price_to_cents: 35000 },
  { code: "hair_hidratacao", profession: "hairdresser", kind: "service", name: "Hidratação", duration_min: 45, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 5000, price_to_cents: 15000 },
  { code: "pt_avaliacao", profession: "personal_trainer", kind: "service", name: "Avaliação física", duration_min: 45, buffer_before_min: 15, buffer_after_min: 15, price_from_cents: 8000, price_to_cents: 20000 },
  { code: "pt_sessao", profession: "personal_trainer", kind: "service", name: "Sessão individual", duration_min: 60, buffer_before_min: 15, buffer_after_min: 15, price_from_cents: 8000, price_to_cents: 20000 },
  { code: "pt_pacote_10", profession: "personal_trainer", kind: "package", name: "Pacote de 10 sessões", duration_min: 60, buffer_before_min: 15, buffer_after_min: 15, price_from_cents: 70000, price_to_cents: 180000 },
  { code: "other_atendimento", profession: "other", kind: "service", name: "Atendimento", duration_min: 60, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: null, price_to_cents: null },
];

/** Nome comparável: sem acento, sem caixa, sem espaço sobrando (mesma regra do catálogo). */
export const templateKey = (name: string): string => name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Modelos de serviço (não pacote) da profissão. */
export function serviceTemplatesOf(profession: Profession | null): ServiceTemplateSeed[] {
  return profession ? SERVICE_TEMPLATES.filter((t) => t.profession === profession && t.kind === "service") : [];
}
