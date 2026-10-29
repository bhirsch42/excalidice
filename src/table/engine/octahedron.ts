/**
 * Octahedron geometry — the **single source of truth** for the d8's shape, the mirror of
 * {@link ./icosahedron} (d20) and {@link ./cube} (d6/d3). A regular octahedron is the dual of
 * the cube: 6 vertices, 8 equilateral-triangle faces.
 *
 * Lancer's rules engine never rolls a d8 — this shape is wired only into the cosmetic ad-hoc
 * `/roll` feed projection, so a `/roll 1d8` gets a real mesh instead of {@link ./feedRollDice}'s
 * d20-shell `displayableSides` fallback.
 *
 * Like its siblings this is **pure data + math** — no `three`, no `cannon-es` — so
 * {@link ./dieGeometry} can wrap it into a `DieGeometry` consumed by both the render mesh and
 * the physics body, and the headless harness can step it.
 *
 * The 6 vertices are the axis poles `(±1,0,0), (0,±1,0), (0,0,±1)` — already unit length
 * (circumradius 1, matching every other die shape here). The 8 faces are authored as proper
 * vertex rings, one per octant; {@link ./dieGeometry makeGeometry} corrects each ring's winding
 * to point its normal outward.
 */
import type { Vec3 } from "./icosahedron";

/** The 6 octahedron vertices — already unit length (circumradius 1). */
export const OCTA_VERTICES: Vec3[] = [
  [1, 0, 0], //  0: +X
  [-1, 0, 0], // 1: -X
  [0, 1, 0], //  2: +Y
  [0, -1, 0], // 3: -Y
  [0, 0, 1], //  4: +Z
  [0, 0, -1], // 5: -Z
];

/**
 * The 8 triangular faces as vertex-index triples, one per octant, **ordered so face `i` and
 * face `i + 4` are antipodal** (each of the first four faces touches `+X`; each of the last
 * four touches `-X`, mirrored on `Y`/`Z` to land opposite its `+X` counterpart) — this is what
 * lets {@link D8_VALUES} below be authored as a simple parallel `i ↔ i+4` pairing, the same
 * discipline {@link ./cube}'s `CUBE_FACES`/`D6_VALUES` follow. Winding is normalised to
 * outward in {@link ./dieGeometry makeGeometry}, so the order within each triple doesn't need
 * to be pre-wound correctly here.
 */
export const OCTA_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 4], // +X +Y +Z
  [0, 4, 3], // +X -Y +Z
  [0, 3, 5], // +X -Y -Z
  [0, 5, 2], // +X +Y -Z
  [1, 3, 5], // -X -Y -Z (antipodal to index 0)
  [1, 2, 5], // -X +Y -Z (antipodal to index 1)
  [1, 2, 4], // -X +Y +Z (antipodal to index 2)
  [1, 3, 4], // -X -Y +Z (antipodal to index 3)
];

/**
 * d8 numbering parallel to {@link OCTA_FACES}: `1..8`, opposite faces summing to 9 (the
 * standard d8 convention). Because {@link OCTA_FACES} is ordered `i ↔ i+4` antipodal, the
 * pairing is just `values[i] + values[i+4] === 9`.
 */
export const D8_VALUES: number[] = [1, 2, 3, 4, 8, 7, 6, 5];
