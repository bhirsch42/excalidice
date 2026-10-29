/**
 * The cannon-es physics body for a die — a `ConvexPolyhedron` built from the **same**
 * vertices/faces as the render mesh, so the simulated solid and the drawn solid are one shape.
 * The body's orientation after it settles is what {@link ./readFace} reads.
 *
 * Spawning ({@link spawnThrow}) seeds a die just *inside* a randomly-chosen visible edge
 * (inboard of the containment wall, see {@link ./diceWorld}) and launches it inward toward
 * the centre, so it tumbles across the frustum and settles fully on screen. Because the
 * walls hug the visible edge, every resting die is guaranteed on-screen; the launch speed
 * scales with the spawn→target distance so the throw reads the same at any arena size.
 * Randomness comes through an injected `rng` so the headless harness can drive thousands of
 * reproducible throws.
 */
import * as CANNON from "cannon-es";
import type { DieGeometry } from "./dieGeometry";
import { WALL_INSET } from "./diceWorld";

/**
 * Build the convex cannon shape for any {@link DieGeometry} at the given circumradius, from
 * the **same** vertices/faces the render mesh uses. The geometry's faces are already wound
 * outward (see `makeGeometry`), which is the winding cannon's `ConvexPolyhedron` expects;
 * quad faces (the d6/d3 cube) are passed whole — cannon handles convex polygon faces, not
 * just triangles.
 */
export function dieShape(geometry: DieGeometry, radius: number): CANNON.ConvexPolyhedron {
  const vertices = geometry.vertices.map((v) => new CANNON.Vec3(v[0] * radius, v[1] * radius, v[2] * radius));
  const faces = geometry.faces.map((f) => [...f]);
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

/**
 * Create a rigid die body for any shape (d20/d6/d3). **Cannon's own sleep is left OFF on
 * purpose.** A sleeping body has its velocity forced to zero — and cannon's sleep timer can
 * trip at the apex of a tip-over (where angular velocity momentarily dips near zero while the
 * die is balanced on an edge), freezing the die *tilted* forever so it never falls onto a
 * face. With sleep off, a metastable edge-balanced die always tips off and lands flat; the
 * caller decides "settled" via {@link bodyAtRest} + `isFlat` (at rest AND lying flat).
 * Damping bleeds energy so the die comes fully to rest quickly.
 *
 * **Damping is the tumble-length dial**: cannon applies it as `v *= (1 - damping)^dt`, so these
 * are per-second retention factors, not forces. `0.7` angular / `0.4` linear bleed the tail
 * wobble that otherwise dominates settle time. Two hard limits found by measurement, worth
 * knowing before touching these: a damping value of **exactly 1.0 zeroes the velocity outright**
 * (the die stops rotating and can then never satisfy `isFlat`, so it never settles), and anything
 * **above 1.0 makes `(1 - damping)^dt` NaN** and the die's position corrupts silently. Stay below 1.
 */
export function createDieBody(geometry: DieGeometry, radius: number, material: CANNON.Material): CANNON.Body {
  const body = new CANNON.Body({
    mass: 1,
    shape: dieShape(geometry, radius),
    material,
    allowSleep: false,
    angularDamping: 0.4,
    linearDamping: 0.2,
  });
  return body;
}

export type ThrowBounds = {
  halfWidth: number; // world half-extent along X (maps to screen width)
  halfDepth: number; // world half-extent along Z (maps to screen height)
};

/**
 * Whether a body is effectively at rest. The settle trigger (with {@link isFlat}) is "at
 * rest AND flat for N consecutive steps" — cannon's own `sleepState` is unused here (sleep
 * stays off; see {@link createDieBody}). The thresholds sit above the residual contact creep
 * yet far below a moving die.
 */
export function bodyAtRest(body: CANNON.Body, linEps = 0.12, angEps = 0.12): boolean {
  return body.velocity.length() < linEps && body.angularVelocity.length() < angEps;
}

/**
 * How far inboard of the wall a die's *centre* spawns, so its whole body (circumradius ≈
 * {@link WALL_INSET}) starts fully inside the wall rather than penetrating it. Combined with
 * {@link WALL_INSET}, a die spawns {@link WALL_INSET}+{@link SPAWN_CLEARANCE} in from the
 * visible edge — at the frustum's edge, on screen, never behind a wall.
 */
const SPAWN_CLEARANCE = 1.6;
/**
 * Inward launch speed *per world-unit* of spawn→target distance; jittered ±15%. Scaling the
 * speed with the distance (rather than a fixed magnitude) keeps the throw scale-invariant —
 * a die crosses the same fraction of the arena whether the frustum is small or large.
 */
const THROW_SPEED_PER_UNIT = 0.8;

/**
 * Position + launch a die from just *inside* a random *visible* edge (inboard of the
 * containment wall), aimed at a point in the central viewport so it tumbles across the
 * frustum and settles on screen. `bounds` are the **visible** half-extents (the camera
 * frustum); the walls sit {@link WALL_INSET} inside them. `rng` defaults to `Math.random`.
 */
export function spawnThrow(body: CANNON.Body, bounds: ThrowBounds, rng: () => number = Math.random): void {
  const { halfWidth, halfDepth } = bounds;
  // Spawn inboard of the wall (which is at halfExtent - WALL_INSET) by the body clearance.
  const innerW = halfWidth - WALL_INSET - SPAWN_CLEARANCE;
  const innerD = halfDepth - WALL_INSET - SPAWN_CLEARANCE;
  const edge = Math.floor(rng() * 4); // 0:left 1:right 2:near(+Z) 3:far(-Z)
  let x: number, z: number;
  if (edge === 0) {
    x = -innerW;
    z = (rng() * 2 - 1) * halfDepth * 0.5;
  } else if (edge === 1) {
    x = innerW;
    z = (rng() * 2 - 1) * halfDepth * 0.5;
  } else if (edge === 2) {
    z = innerD;
    x = (rng() * 2 - 1) * halfWidth * 0.5;
  } else {
    z = -innerD;
    x = (rng() * 2 - 1) * halfWidth * 0.5;
  }

  // Aim at a random point in the central third of the viewport so the die ends up on open
  // floor away from any wall.
  const targetX = (rng() * 2 - 1) * halfWidth * 0.3;
  const targetZ = (rng() * 2 - 1) * halfDepth * 0.3;
  let dx = targetX - x;
  let dz = targetZ - z;
  const len = Math.hypot(dx, dz);
  dx /= len;
  dz /= len;
  const speed = THROW_SPEED_PER_UNIT * len * (0.85 + rng() * 0.3);
  const y = 5 + rng() * 3; // tossed above the table

  body.wakeUp();
  body.position.set(x, y, z);
  body.velocity.set(dx * speed, -2 - rng() * 2, dz * speed);
  body.angularVelocity.set((rng() * 2 - 1) * 22, (rng() * 2 - 1) * 22, (rng() * 2 - 1) * 22);
  // A random starting orientation so no throw is biased toward a face.
  body.quaternion.setFromEuler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
}

/**
 * dice: launch a die up out of a point on the table (an exploding die's burst), tossed outward
 * in a random direction. The containment walls keep it on the table.
 */
export function spawnFrom(body: CANNON.Body, from: readonly [number, number], rng: () => number = Math.random): void {
  const angle = rng() * Math.PI * 2;
  const speed = 6 + rng() * 6;
  body.wakeUp();
  body.position.set(from[0], 4 + rng() * 2, from[1]);
  body.velocity.set(Math.cos(angle) * speed, 10 + rng() * 6, Math.sin(angle) * speed);
  body.angularVelocity.set((rng() * 2 - 1) * 18, (rng() * 2 - 1) * 18, (rng() * 2 - 1) * 18);
  body.quaternion.setFromEuler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
}
