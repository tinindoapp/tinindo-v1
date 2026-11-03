// Textos do módulo Domicílio. Horas no fuso do negócio; localização só como zona e CEP de 5 dígitos.
export const hhmm = (v: string, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(v));
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
  return `${who} Chego entre ${hhmm(s.arrival_from, timeZone)} e ${hhmm(s.arrival_to, timeZone)}${what} de ${dayLabel(day)}. Se eu atrasar, aviso por aqui.`;
}

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "area") return "Esta zona está fora da área de atendimento (inativa ou além da distância máxima). Nada foi marcado.";
      if (e.field === "cep_prefixes") return "Um desses CEPs já está em outra zona ativa. Cada CEP fica numa zona só.";
      if (e.field === "name") return "Já existe uma zona com esse nome.";
      if (e.field === "status") return "Só atendimentos marcados ou confirmados viram visita a domicílio.";
      if (e.field === "disabled") return "O atendimento a domicílio está desligado nas regras.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "SLOT_CONFLICT":
      return "Não dá tempo de chegar: o deslocamento bate com outro horário da agenda. Nada foi marcado; mude o horário ou a zona.";
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "VALIDATION_ERROR":
      if (e.field === "cep") return "O CEP não pertence a essa zona. Confira o CEP ou escolha a zona certa.";
      if (e.field === "zone") return "Confira a zona: nome e CEPs com 5 dígitos.";
      return "Confira os campos e tente de novo.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa o atendimento a domicílio.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
