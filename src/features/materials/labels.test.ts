import { describe, expect, it } from "vitest";
import { parseNumber } from "./labels.ts";

describe("Materiais: quantidade digitada", () => {
  it.each([
    ["2", 2],
    ["0,5", 0.5],
    ["10,50", 10.5],
    ["10.50", 10.5],
    ["1.250,5", 1250.5],
    ["0.125", 0.125],
    [" 3 ", 3],
  ])("%s vale %s", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });

  it.each(["", "abc", "-1", "1,2,3", "1.2.3"])("%j é inválido", (input) => {
    expect(parseNumber(input)).toBeNaN();
  });
});
