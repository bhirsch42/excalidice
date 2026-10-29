/** Dice notation and exploding rolls. Pure: no DOM, no network. */

export type Die = {
  sides: number;
  /** Every roll of this die in order; more than one means it exploded (each link but the last was a max). */
  chain: number[];
  total: number;
};

export type RollResult = { dice: Die[]; modifier: number; total: number };

export type Notation = { groups: { count: number; sides: number }[]; modifier: number };

export const MAX_DICE = 30;
export const MAX_SIDES = 1000;
/** A chain stops after this many explosions, so a d2 can't loop forever. */
export const MAX_EXPLOSIONS = 50;

/** Uniform integer in [1, sides]. */
export type Rng = (sides: number) => number;

export const cryptoRng: Rng = (sides) => (crypto.getRandomValues(new Uint32Array(1))[0]! % sides) + 1;

/** Parse "2d6+1", "d20", "d4 + d8 - 2". Whitespace and case are ignored. Returns null if unreadable. */
export function parse(expr: string): Notation | null {
  const s = expr.replace(/\s+/g, "").toLowerCase();
  if (!s || s.length > 60) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join("") !== s) return null;
  const groups: Notation["groups"] = [];
  let modifier = 0;
  let diceCount = 0;
  for (const t of terms) {
    const sign = t.startsWith("-") ? -1 : 1;
    const body = t.replace(/^[+-]/, "");
    const m = body.match(/^(\d*)d(\d+)$/);
    if (m) {
      if (sign < 0) return null;
      const count = m[1] ? Number(m[1]) : 1;
      const sides = Number(m[2]);
      if (count < 1 || sides < 2 || sides > MAX_SIDES) return null;
      diceCount += count;
      groups.push({ count, sides });
    } else if (/^\d+$/.test(body)) {
      modifier += sign * Number(body);
    } else return null;
  }
  if (!groups.length || diceCount > MAX_DICE) return null;
  return { groups, modifier };
}

/** Roll one die. Exploding (Kids on Bikes): each max rolls again and adds. */
export function rollDie(sides: number, explode: boolean, rng: Rng = cryptoRng): Die {
  const chain = [rng(sides)];
  while (explode && chain.at(-1) === sides && chain.length <= MAX_EXPLOSIONS) chain.push(rng(sides));
  return { sides, chain, total: chain.reduce((a, b) => a + b, 0) };
}

export function rollNotation(n: Notation, explode: boolean, rng: Rng = cryptoRng): RollResult {
  const dice = n.groups.flatMap((g) => Array.from({ length: g.count }, () => rollDie(g.sides, explode, rng)));
  return { dice, modifier: n.modifier, total: dice.reduce((a, d) => a + d.total, 0) + n.modifier };
}

/** Number of explosions across a roll's dice. */
export const explosions = (dice: Die[]) => dice.reduce((n, d) => n + d.chain.length - 1, 0);
