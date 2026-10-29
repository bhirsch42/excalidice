import { expect, test } from "bun:test";
import { MAX_EXPLOSIONS, parse, rollDie, rollNotation } from "./rules";

const scripted = (values: number[]) => () => values.shift() ?? 1;

test("parse reads dice, modifiers and mixed pools", () => {
  expect(parse("2d6+1")).toEqual({ groups: [{ count: 2, sides: 6 }], modifier: 1 });
  expect(parse(" D20 - 2 ")).toEqual({ groups: [{ count: 1, sides: 20 }], modifier: -2 });
  expect(parse("d4+d8+3-1")).toEqual({ groups: [{ count: 1, sides: 4 }, { count: 1, sides: 8 }], modifier: 2 });
});

test("parse rejects nonsense, negative dice and oversize pools", () => {
  for (const bad of ["", "hello", "d", "2d", "d1", "-d6", "31d6", "d6+x", "2d6++1"]) expect(parse(bad)).toBeNull();
});

test("a max explodes and keeps going while it maxes", () => {
  expect(rollDie(6, true, scripted([6, 6, 2]))).toEqual({ sides: 6, chain: [6, 6, 2], total: 14 });
  expect(rollDie(6, true, scripted([5, 6]))).toEqual({ sides: 6, chain: [5], total: 5 });
});

test("explode off never chains", () => {
  expect(rollDie(4, false, scripted([4, 4]))).toEqual({ sides: 4, chain: [4], total: 4 });
});

test("a chain is capped", () => {
  expect(rollDie(2, true, () => 2).chain).toHaveLength(MAX_EXPLOSIONS + 1);
});

test("totals add every die and the modifier", () => {
  const r = rollNotation(parse("2d4+3")!, true, scripted([4, 1, 2]));
  expect(r.dice.map((d) => d.chain)).toEqual([[4, 1], [2]]);
  expect(r.total).toBe(10);
});
