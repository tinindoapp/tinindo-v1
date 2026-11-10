// Telefone brasileiro: um analisador e um formatador para o app inteiro (Clientes, Agenda e link público de reserva).
// Antes cada módulo tinha a sua cópia e elas divergiam: "011 98765-4321" valia em Clientes e era recusado no link.
// Funções puras, testadas em phone.test.ts.

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normaliza telefone digitado no Brasil para E.164. Vazio → null.
 * "(11) 98765-4321" → "+5511987654321". Aceita o 0 de longa distância ("011 …") e o prefixo internacional "00".
 * Número estrangeiro precisa vir com "+" ou "00". Letras ou outros símbolos tornam o número inválido.
 */
export function normalizePhoneBR(raw: string | null | undefined): { value: string | null } | { error: "PHONE_INVALID" } {
  const text = (raw ?? "").trim();
  if (!text) return { value: null };
  if (/[^\d\s()+.-]/.test(text)) return { error: "PHONE_INVALID" };
  let digits = text.replace(/\D/g, "");
  let candidate: string;
  if (text.startsWith("+")) candidate = `+${digits}`;
  else if (digits.startsWith("00")) candidate = `+${digits.slice(2)}`;
  else {
    if (digits.length === 11 || digits.length === 12) digits = digits.replace(/^0/, ""); // prefixo de longa distância
    if (digits.length === 10 || digits.length === 11) candidate = `+55${digits}`;
    else if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) candidate = `+${digits}`;
    else return { error: "PHONE_INVALID" };
  }
  return E164.test(candidate) ? { value: candidate } : { error: "PHONE_INVALID" };
}

/** Atalho para formulários: E.164, null quando vazio e undefined quando inválido. */
export function phoneToE164(raw: string | null | undefined): string | null | undefined {
  const r = normalizePhoneBR(raw);
  return "error" in r ? undefined : r.value;
}

/** Mostra +55 no formato local ("(11) 98765-4321"); outros países ficam em E.164. */
export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Link para ligar (tel:) a partir do E.164 guardado. Sem telefone, null (a tela não mostra o botão). */
export function telHref(e164: string | null): string | null {
  return e164 && E164.test(e164) ? `tel:${e164}` : null;
}

/** Conversa no WhatsApp (wa.me só aceita os dígitos, com o código do país e sem "+"). Sem telefone, null. */
export function whatsappHref(e164: string | null): string | null {
  return e164 && E164.test(e164) ? `https://wa.me/${e164.slice(1)}` : null;
}
