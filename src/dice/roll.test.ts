import { expect, test } from "bun:test";
import { createRoll, sanitizeRoll } from "./roll";

const opts = { who: "Ben", color: "#e8590c", explode: true };

test("createRoll rolls notation for a person", () => {
  const r = createRoll("2d6+1", opts, () => 3)!;
  expect(r.who).toBe("Ben");
  expect(r.dice.map((d) => d.chain)).toEqual([[3], [3]]);
  expect(r.total).toBe(7);
  expect(createRoll("nonsense", opts)).toBeNull();
});

test("a well-formed peer roll survives sanitizing unchanged", () => {
  const r = createRoll("d4+d6", opts, () => 4)!;
  expect(sanitizeRoll(JSON.parse(JSON.stringify(r)))).toEqual(r);
});

test("sanitizing recomputes totals and drops extra fields", () => {
  const r = { ...createRoll("d6", opts, () => 2)!, total: 999, extra: "<script>" };
  const clean = sanitizeRoll(r)!;
  expect(clean.total).toBe(2);
  expect("extra" in clean).toBe(false);
});

test("sanitizing rejects bad shapes", () => {
  const good = createRoll("d6", opts, () => 2)!;
  const bad = [
    null,
    "roll",
    { ...good, color: "red;background:url(x)" },
    { ...good, dice: [{ sides: 6, chain: [7] }] },
    { ...good, dice: [{ sides: 6, chain: [3, 2] }] }, // a 3 can't explode
    { ...good, dice: [{ sides: 6, chain: ["<b>"] }] },
    { ...good, dice: [] },
    { ...good, modifier: "1" },
    { ...good, id: "<img>" },
  ];
  for (const b of bad) expect(sanitizeRoll(b)).toBeNull();
});
