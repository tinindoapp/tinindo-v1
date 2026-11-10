// As funções puras de data e fuso moram em src/lib/time.ts: o link público de reserva (network) também precisa delas
// e um módulo não importa outro. Este arquivo só reexporta, para os imports da Agenda continuarem iguais.
export * from "../../lib/time.ts";
