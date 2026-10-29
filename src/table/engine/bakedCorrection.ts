/**
 * The baked-correction replay engine: a **record-then-play** pipeline that lands a die on a
 * chosen face with no visible snap.
 *
 * Pre-roll every die in a throw batch headlessly (the same cannon-es world/table
 * {@link ./DiceStage} runs live), recording each die's *entire* `(pos, quat)` trajectory to
 * rest; compute the one fixed world-space rotation `C` carrying that die's natural rest
 * orientation onto its target-showing orientation; then the visible pass plays the recorded
 * buffer back with `C` baked into every frame from frame zero (`q_shown(t) = C · q_sim(t)`).
 * **Because `C` is a constant, applying it to a continuous physical trajectory yields another
 * continuous trajectory** — there is no discrete post-settle snap; the correction is distributed
 * invisibly across the whole tumble. A genuine per-die physics solve is the alternative, and is
 * intractable for colliding multi-die pools.
 *
 * Pure math + a throwaway cannon-es world — no `three`/DOM — so tests drive this module directly
 * and headlessly, like they drive the physics primitives it's built from.
 */
import { createDiceWorld } from "./diceWorld";
import * as CANNON from "cannon-es";
import { createDieBody, spawnThrow, spawnFrom, bodyAtRest, type ThrowBounds } from "./diceBody";
import { isFlat, type Quat } from "./readFace";
import { readFace } from "./readFace";
import { orientToValue } from "./orientToValue";
import { geometryForSides, type DieGeometry } from "./dieGeometry";

const FIXED_DT = 1 / 60;
/** Consecutive at-rest+flat frames that count as physically settled. */
export const SETTLE_FRAMES = 18;
/** Ignore an early fluke-quiet. */
export const MIN_FRAMES = 30;

/**
 * Default sim-time budget (frames @60fps) a throw batch gets to settle before recording is
 * force-truncated. Overridable per call via `RecordOptions.budgetFrames`.
 *
 * Truncation is a **bounded-overtime escape hatch, not a defect**: the baked correction
 * `C = orientToValue(qRest, target)·qRest⁻¹` is computed from whatever pose the die is in *at
 * the truncation frame*, so the recorded tail's shown orientation reads `target` regardless of
 * whether the die physically settled, and the containment walls constrain *position*
 * independent of settle state, so a truncated die stays on-screen too.
 *
 * **200 is a measured number.** At the current gravity/damping (`./diceWorld`, `./diceBody`) a
 * throw settles at p50≈113 / p90≈149 / p99≈203 recorded frames, over 600 throws across six pool
 * shapes (1d20, 2d6, d20+2d6, 4d6, 2×d20, 8d6). So 200 clears ~99% of throws outright, and the
 * ~1% that truncate are dice micro-wobbling on an edge that stopped moving perceptibly ~40
 * frames earlier. Truncation stays safe by construction: `orientToValue` lands the shown face
 * exactly flat and target-up whatever pose the die was in, and the top-down orthographic camera
 * makes the leftover height invisible.
 *
 * Do not read this as "the tumble is 200/60 ≈ 3.3s" — {@link ./DiceStage} plays the buffer back
 * at `PLAYBACK_RATE` recorded frames per real frame, so the wall-clock ceiling is that over the
 * rate. Raise this only together with a re-measure; lowering it further starts truncating dice
 * that are still visibly moving.
 */
export const SIM_BUDGET_FRAMES = 300;

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Hamilton product `a · b` (apply `b` first, then `a`, in the world frame). */
export function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** The inverse of a unit quaternion — its conjugate. Every orientation this module handles is a unit quat. */
export function invertQuat(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/**
 * `C = orientToValue(qRest, target) · qRest⁻¹` — the fixed world-space rotation carrying a die's
 * natural rest orientation onto the orientation that shows `target`. `orientToValue`'s own
 * return is already `correction · qRest`, so this algebraically recovers just the `correction`
 * term without reaching into that module's internals. Identity for a physics-decides die
 * (`target === null`) — nothing to correct, the natural rest IS the shown face.
 */
export function computeCorrection(qRest: Quat, target: number | null, geometry: DieGeometry): Quat {
  if (target === null) return IDENTITY;
  const targetOrientation = orientToValue(qRest, target, geometry);
  return multiplyQuat(targetOrientation, invertQuat(qRest));
}

/** One recorded simulation frame for a single die: its raw (uncorrected) physics pose. */
export type RecordedFrame = { pos: readonly [number, number, number]; quat: Quat };

export type RecordedDie = {
  geometry: DieGeometry;
  /** The face this die was choreographed to show, or null for a physics-decides throw. */
  target: number | null;
  /** The full recorded trajectory to rest, raw (uncorrected) physics poses, frame 0 = spawn. */
  buffer: RecordedFrame[];
  /** The fixed per-die correction baked into every playback frame (see {@link computeCorrection}). */
  correction: Quat;
  /** The value this die will show once played back — `target` if choreographed, else the natural read. */
  value: number;
};

/** One die to pre-roll: its shape and (if choreographed) the face it must land showing. */
// dice: `from` launches the die out of a point on the table (an explosion) instead of an edge.
export type ThrowSpec = { sides: number; target: number | null; from?: readonly [number, number] };

export type RecordOptions = {
  bounds: ThrowBounds;
  /** Die circumradius (world units) — must match the render mesh's radius. */
  radius: number;
  /** Defaults to `Math.random` for the live browser path; the proof harness injects a seeded PRNG. */
  rng?: () => number;
  /**
   * Sim-time budget (frames @60fps) — defaults to {@link SIM_BUDGET_FRAMES}. Exposed as a
   * per-call override so a caller (or a test) can tune it without touching the module default;
   * the truncate-and-snap contract (baked `C` + containment) holds at any value.
   */
  budgetFrames?: number;
  /** dice: already-settled dice that stay on the table as static obstacles. */
  obstacles?: readonly { sides: number; pos: readonly [number, number, number]; quat: Quat }[];
};

/**
 * Pre-roll a batch of dice **together**, in one shared headless world, recording each die's
 * full trajectory to rest — the same collision-inclusive tumble a live multi-die throw would
 * produce (dice spawned in the same batch really collide with each other; a settled die keeps
 * physically obstructing any still-tumbling sibling). Separate calls get separate worlds — an
 * accepted scope tradeoff: a single roll's pool is what needs to read as one physical throw,
 * not two arbitrary calls issued moments apart.
 *
 * Returns each die's recorded buffer plus its baked correction and final shown value, in the
 * same order as `specs`.
 */
export function recordThrowBatch(specs: readonly ThrowSpec[], options: RecordOptions): RecordedDie[] {
  if (specs.length === 0) return [];
  const { bounds, radius, rng = Math.random, budgetFrames = SIM_BUDGET_FRAMES, obstacles = [] } = options;
  const { world, diceMaterial } = createDiceWorld(bounds);
  for (const o of obstacles) {
    const body = createDieBody(geometryForSides(o.sides), radius, diceMaterial);
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.updateMassProperties();
    body.position.set(...o.pos);
    body.quaternion.set(o.quat.x, o.quat.y, o.quat.z, o.quat.w);
    world.addBody(body);
  }

  const active = specs.map((spec) => {
    const geometry = geometryForSides(spec.sides);
    const body = createDieBody(geometry, radius, diceMaterial);
    if (spec.from) spawnFrom(body, spec.from, rng);
    else spawnThrow(body, bounds, rng);
    world.addBody(body);
    return {
      spec,
      geometry,
      body,
      buffer: [] as RecordedFrame[],
      frames: 0,
      quiet: 0,
      settled: false,
      /** Index of the last recorded frame in which this die was still moving (see the trim below). */
      lastMotionIndex: 0,
    };
  });

  let stepCount = 0;
  while (stepCount < budgetFrames && active.some((d) => !d.settled)) {
    world.step(FIXED_DT);
    stepCount++;
    for (const d of active) {
      if (d.settled) continue; // still physically present (an obstacle for siblings) — just stop recording it
      d.frames++;
      const { position: p, quaternion: q } = d.body;
      d.buffer.push({ pos: [p.x, p.y, p.z], quat: { x: q.x, y: q.y, z: q.z, w: q.w } });
      const quietNow = bodyAtRest(d.body) && isFlat(d.body.quaternion, d.geometry);
      d.quiet = quietNow ? d.quiet + 1 : 0;
      if (!quietNow) d.lastMotionIndex = d.buffer.length - 1;
      // The budget-expiry branch is the truncate-and-snap escape hatch: force-settle once
      // `d.frames` reaches the budget even if the die never held `SETTLE_FRAMES` of stillness —
      // the baked correction still lands the shown orientation on `target`.
      if ((d.frames >= MIN_FRAMES && d.quiet >= SETTLE_FRAMES) || d.frames >= budgetFrames) {
        d.settled = true;
      }
    }
  }

  return active.map((d) => {
    // Trim the trailing motionless run. Settling requires `SETTLE_FRAMES` *consecutive* at-rest
    // frames, so every naturally-settled recording ends with ~18 frames (~0.3s of playback) of a
    // die that has already stopped — dead time indistinguishable from the linger that follows it.
    // Keep one frame past the last motion (the resting pose) and drop the rest: the correction is
    // recomputed from that frame, which is at-rest and flat by definition, so the landing contract
    // is untouched. A truncated recording has no trailing quiet run and is left whole.
    const buffer = d.buffer.slice(0, Math.min(d.lastMotionIndex + 2, d.buffer.length));
    const qRest = buffer[buffer.length - 1]!.quat;
    const correction = computeCorrection(qRest, d.spec.target, d.geometry);
    const value = d.spec.target ?? readFace(qRest, d.geometry).value;
    return { geometry: d.geometry, target: d.spec.target, buffer, correction, value };
  });
}

/** The shown (corrected) orientation for a recorded die at a given frame index (clamped to the buffer). */
export function shownQuatAt(die: RecordedDie, frameIndex: number): Quat {
  const clamped = Math.max(0, Math.min(frameIndex, die.buffer.length - 1));
  return multiplyQuat(die.correction, die.buffer[clamped]!.quat);
}
