// Plural em português sem "(s)" (auditoria de UX, item 58). O número vai junto, no formato pt-BR ("1.234 clientes").
const NUMBER = new Intl.NumberFormat("pt-BR");

/** Só a palavra: "cliente" com 1 (ou −1), "clientes" com qualquer outro número, inclusive 0. */
export function pluralWord(n: number, one: string, many = `${one}s`): string {
  return Math.abs(n) === 1 ? one : many;
}

/** Número e palavra: plural(1, "cliente") = "1 cliente"; plural(2, "nota válida", "notas válidas") = "2 notas válidas". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${NUMBER.format(n)} ${pluralWord(n, one, many)}`;
}
