/**
 * Tetrahedron geometry — the **single source of truth** for the d4's shape, the mirror of
 * {@link ./octahedron} (d8) and {@link ./dodecahedron} (d12): a regular tetrahedron is the
 * simplest Platonic solid, 4 vertices and 4 equilateral-triangle faces. Unlike every other die
 * in this directory, the tetrahedron is **not centrally symmetric** — it has no antipodal
 * vertex/face pairs, so it necessarily rests **face-down with a single vertex pointing up**.
 * That's the whole reason `readSign` exists: this is the one shape in the registry built with
 * `readSign: -1` ({@link ./dieGeometry}), reading the down-resting face rather than an up-face.
 *
 * **The face↔value assignment here is deliberately arbitrary** — each face just gets a distinct
 * value 1..4, in face order. The real apex-up caltrop labelling (each face prints all three
 * *other* faces' values at its corners, so whichever vertex ends up on top reads correctly
 * regardless of twist) lives in `faceNumerals.ts`'s corner-anchored layout, not here.
 *
 * The 4 vertices are the canonical alternate corners of a cube — `(1,1,1)`, `(1,-1,-1)`,
 * `(-1,1,-1)`, `(-1,-1,1)` (the four with an even count of negative signs) — normalized onto the
 * unit sphere (circumradius 1, matching every other die shape here; all four are already
 * equidistant from the origin before normalizing, so this is a uniform rescale, not a
 * per-vertex fit). The 4 faces are each vertex's opposite triangle (the other three vertices);
 * {@link ./dieGeometry makeGeometry} corrects each ring's winding to point its normal outward,
 * same as every sibling module.
 *
 * Pure data + math — no `three`, no `cannon-es` — so {@link ./dieGeometry} can wrap it into a
 * `DieGeometry` consumed by both the render mesh and the physics body, and the headless harness
 * can step it.
 */
import type { Vec3 } from "./icosahedron";

const INV_SQRT3 = 1 / Math.sqrt(3);

/**
 * The 4 tetrahedron vertices — the alternate (even-negative-count) corners of a cube, already
 * unit length (circumradius 1) since every permutation of `(±1,±1,±1)` has the same magnitude
 * `√3` before this uniform rescale.
 */
export const TETRA_VERTICES: Vec3[] = (
  [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ] as const
).map(([x, y, z]) => [x * INV_SQRT3, y * INV_SQRT3, z * INV_SQRT3] as Vec3);

/**
 * The 4 triangular faces as vertex-index triples — face `i` is the triangle **opposite** vertex
 * `i` (the other three vertices), the standard tetrahedron face/vertex duality. Winding is
 * normalized to outward in {@link ./dieGeometry makeGeometry}, so the order within each triple
 * doesn't need to be pre-wound correctly here.
 *
 * **This "face `i` opposite vertex `i`" ordering is load-bearing, not incidental** — it's what
 * lets `faceNumerals.ts`'s corner-anchored numeral scheme compute `cornerValue(geometry,
 * vertexIndex)` as the direct one-liner `faceValues[vertexIndex]`, with no runtime search for
 * the face excluding this vertex. If this array is ever reordered so face `i` is no longer
 * opposite vertex `i`, `cornerValue` silently prints the wrong number at the apex —
 * `faceNumerals.test.ts` independently re-derives the opposite face by searching the geometry
 * specifically so a reorder here fails there rather than passing by tautology.
 */
export const TETRA_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 2, 3], // opposite vertex 0
  [0, 2, 3], // opposite vertex 1
  [0, 1, 3], // opposite vertex 2
  [0, 1, 2], // opposite vertex 3
];

/**
 * d4 numbering parallel to {@link TETRA_FACES}: each face is given a distinct value `1..4` in
 * face order. `faceValues[i]` is the value read when face `i` is the down-resting face
 * (`readSign: -1`, see {@link ./dieGeometry}), i.e. when the vertex opposite face `i` points up.
 * The corner-anchored numeral scheme (`faceNumerals.ts`'s `cornerValue`) prints `faceValues[v]`
 * at every corner touching vertex `v` — see {@link TETRA_FACES}'s note on why that depends on
 * this array's face/vertex ordering.
 */
export const D4_VALUES: number[] = [1, 2, 3, 4];
