/** Building rolls, and checking ones that arrive from peers. */
import { MAX_DICE, MAX_EXPLOSIONS, MAX_SIDES, parse, rollNotation, type Die, type Rng } from "./rules";

/** One person's roll, as it's shown and as it travels between peers. */
export type Roll = {
  id: string;
  who: string;
  color: string;
  at: number;
  explode: boolean;
  dice: Die[];
  modifier: number;
  total: number;
};

export const NAME_MAX = 24;

/** Dice colors to pick from. */
export const PLAYER_COLORS = ["#e8590c", "#2f9e44", "#1c7ed6", "#ae3ec9", "#f08c00", "#0ca678", "#e64980", "#5c7cfa", "#c9c2b5"];

/** Roll `expr` for `who`. Returns null if the notation can't be read. */
export function createRoll(
  expr: string,
  opts: { who: string; color: string; explode: boolean },
  rng?: Rng,
): Roll | null {
  const notation = parse(expr);
  if (!notation) return null;
  return {
    id: crypto.randomUUID(),
    who: opts.who.slice(0, NAME_MAX),
    color: opts.color,
    at: Date.now(),
    explode: opts.explode,
    ...rollNotation(notation, opts.explode, rng),
  };
}

const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

/**
 * A roll from a peer is untrusted input that ends up in the page, so accept only the exact
 * shape, re-derive the totals, and pass nothing else through. Returns null if anything is off.
 */
export function sanitizeRoll(raw: unknown): Roll | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[\w-]{1,64}$/.test(r.id)) return null;
  if (typeof r.who !== "string" || typeof r.color !== "string" || !/^#[0-9a-f]{6}$/i.test(r.color)) return null;
  if (!isInt(r.at, 0, Number.MAX_SAFE_INTEGER) || !isInt(r.modifier, -100000, 100000)) return null;
  if (!Array.isArray(r.dice) || r.dice.length < 1 || r.dice.length > MAX_DICE) return null;
  const dice = [];
  for (const d of r.dice as unknown[]) {
    if (!d || typeof d !== "object") return null;
    const { sides, chain } = d as Record<string, unknown>;
    if (!isInt(sides, 2, MAX_SIDES) || !Array.isArray(chain) || chain.length < 1 || chain.length > MAX_EXPLOSIONS + 1) return null;
    if (!chain.every((v) => isInt(v, 1, sides))) return null;
    // every link but the last must be a max, or it wouldn't have exploded
    if (chain.slice(0, -1).some((v) => v !== sides)) return null;
    dice.push({ sides, chain: chain as number[], total: (chain as number[]).reduce((a, b) => a + b, 0) });
  }
  return {
    id: r.id,
    who: r.who.slice(0, NAME_MAX) || "Someone",
    color: r.color,
    at: r.at,
    explode: r.explode === true,
    dice,
    modifier: r.modifier,
    total: dice.reduce((a, d) => a + d.total, 0) + r.modifier,
  };
}
