// Textos do módulo Domicílio. Horas no fuso do negócio; localização só como zona e CEP de 5 dígitos.
import { errorExplainer } from "../../lib/errors.ts";
import { formatTime } from "../../lib/time.ts";

export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(`${day}T12:00:00Z`));
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** "01310-100", "01310100" ou "01310" → "01310"; menos de 5 dígitos → null. */
export const cep5Of = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length >= 5 ? d.slice(0, 5) : null;
};
/** Lista de prefixos digitada ("01310, 01311 01312") → prefixos de 5 dígitos; null se algum não tiver 5 dígitos. */
export function parsePrefixes(v: string): string[] | null {
  const parts = v.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const d = p.replace(/\D/g, "");
    if (d.length !== 5 && d.length !== 8) return null;
    if (!out.includes(d.slice(0, 5))) out.push(d.slice(0, 5));
  }
  return out;
}
export const parseNumber = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));
export const minutes = (n: number) => (n === 1 ? "1 minuto" : `${n} minutos`);

/** Mensagem da janela de chegada para o cliente (texto pronto para WhatsApp ou copiar). */
export function arrivalMessage(s: { customer_name: string | null; service_name: string | null; arrival_from: string; arrival_to: string }, day: string, timeZone: string) {
  const who = s.customer_name ? `Olá, ${s.customer_name.split(" ")[0]}!` : "Olá!";
  const what = s.service_name ? ` para o ${s.service_name.toLowerCase()}` : "";
  return `${who} Chego entre ${formatTime(s.arrival_from, timeZone)} e ${formatTime(s.arrival_to, timeZone)}${what} de ${dayLabel(day)}. Se eu atrasar, aviso por aqui.`;
}

export const explain = errorExplainer({
  "POLICY_REJECTED.area": "Esta zona está fora da área de atendimento (inativa ou além da distância máxima). Nada foi marcado.",
  "POLICY_REJECTED.cep_prefixes": "Um desses CEPs já está em outra zona ativa. Cada CEP fica numa zona só.",
  "POLICY_REJECTED.name": "Já existe uma zona com esse nome.",
  "POLICY_REJECTED.status": "Só atendimentos marcados ou confirmados viram visita a domicílio.",
  "POLICY_REJECTED.disabled": "O atendimento a domicílio está desligado nas regras.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  SLOT_CONFLICT: "Não dá tempo de chegar: o deslocamento bate com outro horário da agenda. Nada foi marcado; mude o horário ou a zona.",
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  "VALIDATION_ERROR.cep": "O CEP não pertence a essa zona. Confira o CEP ou escolha a zona certa.",
  "VALIDATION_ERROR.zone": "Confira a zona: nome e CEPs com 5 dígitos.",
  VALIDATION_ERROR: "Confira os campos e tente de novo.",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio acessa o atendimento a domicílio.",
});
