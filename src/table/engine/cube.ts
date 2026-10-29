/**
 * Cube (hexahedron) geometry — the **single source of truth** for the d6 *and* the d3,
 * the mirror of {@link ./icosahedron} for the d20. Lancer rolls exactly three dice
 * shapes (d20, d6, d3), and the d6/d3 share one solid: a cube. The difference is only
 * the **numbering**:
 *
 *   - **d6** — the six faces print `1..6`, opposite faces summing to 7 (the western
 *     die convention).
 *   - **d3** — modeled honestly as a **d6 with doubled pips** (a real, common physical
 *     d3 design): the cube is numbered `1,2,3` *twice*, each value on a pair of
 *     **opposite** faces (`±X→1`, `±Y→2`, `±Z→3`). Every settle therefore shows a value
 *     in `1..3`, and — because the pair is antipodal — the bottom face shows the same
 *     number as the top, so the read is value-stable however it lands. A triangular prism
 *     is the other honest d3, but it rests on a rectangular side and reads its *up edge*
 *     rather than a face normal, which doesn't fit the "+Y face" read the whole pipeline
 *     is built on.
 *
 * Like {@link ./icosahedron} this is **pure data + math** — no `three`, no `cannon-es` —
 * so {@link ./dieGeometry} can wrap it into a `DieGeometry` consumed by *both* the render
 * mesh and the physics body, and the headless harness can step it.
 *
 * The 8 vertices are the cube corners `(±1, ±1, ±1)` normalised onto the unit sphere
 * (circumradius 1, matching the d20). The 6 faces are authored as proper vertex rings;
 * {@link ./dieGeometry makeGeometry} corrects each ring's winding to point its normal
 * outward (the winding cannon's `ConvexPolyhedron` needs and the read depends on).
 */

import type { Vec3 } from "./icosahedron";

/** The 8 cube vertices, normalised onto the unit sphere (circumradius 1). */
export const CUBE_VERTICES: Vec3[] = (() => {
  const inv = 1 / Math.sqrt(3);
  const raw: Vec3[] = [
    [-1, -1, -1], // 0
    [1, -1, -1], //  1
    [1, 1, -1], //   2
    [-1, 1, -1], //  3
    [-1, -1, 1], //  4
    [1, -1, 1], //   5
    [1, 1, 1], //    6
    [-1, 1, 1], //   7
  ];
  return raw.map((v) => [v[0] * inv, v[1] * inv, v[2] * inv]);
})();

/**
 * The 6 quad faces as vertex-index rings, in a fixed order so the value tables below can
 * be authored parallel to it. Each ring is a proper (non-self-intersecting) loop; winding
 * is normalised to outward in {@link ./dieGeometry makeGeometry}. Order: `+Z, -Z, +X, -X, +Y, -Y`.
 */
export const CUBE_FACES: ReadonlyArray<readonly number[]> = [
  [4, 5, 6, 7], // +Z (front)
  [0, 1, 2, 3], // -Z (back)
  [1, 2, 6, 5], // +X (right)
  [0, 4, 7, 3], // -X (left)
  [3, 7, 6, 2], // +Y (top)
  [0, 1, 5, 4], // -Y (bottom)
];

/** d6 numbering parallel to {@link CUBE_FACES} (`+Z, -Z, +X, -X, +Y, -Y`); opposite faces sum to 7. */
export const D6_VALUES: number[] = [3, 4, 1, 6, 2, 5];

/**
 * d3 numbering parallel to {@link CUBE_FACES} — `1,2,3` doubled, each value on a pair of
 * opposite faces (`±X→1`, `±Y→2`, `±Z→3`). Reads `1..3` whichever way the cube settles.
 */
export const D3_VALUES: number[] = [3, 3, 1, 1, 2, 2];
