/**
 * Dodecahedron geometry — the **single source of truth** for the d12's shape, the mirror of
 * {@link ./icosahedron} (d20), {@link ./cube} (d6/d3), and {@link ./octahedron} (d8). A regular
 * dodecahedron has 20 vertices and 12 pentagonal faces.
 *
 * Lancer's rules engine never rolls a d12 — this shape is wired only into the cosmetic ad-hoc
 * `/roll` feed projection, so a `/roll 1d12` gets a real mesh instead of {@link ./feedRollDice}'s
 * d20-shell `displayableSides` fallback.
 *
 * **Derived as the dual of the icosahedron, not hand-typed.** A dodecahedron vertex is the
 * (normalized) centroid of one icosahedron *face*; a dodecahedron *face* is the pentagon formed
 * by the 5 face-centroids meeting at one icosahedron *vertex* (every vertex of a regular
 * icosahedron has degree 5). For a regular icosahedron this is a well-known exact
 * construction — the 5-fold rotational symmetry around each vertex keeps its 5 adjacent face
 * centroids coplanar and equidistant, i.e. a proper regular pentagon — so building it off
 * {@link ICOSA_VERTICES}/{@link ICOSA_FACES} (themselves covered by `dieGeometry.test.ts`'s d20
 * coverage) sidesteps hand-authoring 20 vertices + 12 pentagon vertex-rings against a reference
 * table, which is bug-prone data entry. `dieGeometry.test.ts`'s planarity/convexity/antipodal
 * proofs are what catch a construction bug if this reasoning is ever wrong.
 *
 * Pure data + math — no `three`, no `cannon-es`.
 */
import { ICOSA_VERTICES, ICOSA_FACES, type Vec3 } from "./icosahedron";

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * The 20 dodecahedron vertices — one per icosahedron face, the normalized centroid of that
 * face (circumradius 1, matching every other die shape here). Index-aligned with
 * {@link ICOSA_FACES}.
 */
export const DODECA_VERTICES: Vec3[] = ICOSA_FACES.map(([i, j, k]) => {
  const a = ICOSA_VERTICES[i]!;
  const b = ICOSA_VERTICES[j]!;
  const c = ICOSA_VERTICES[k]!;
  const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  return normalize(centroid);
});

/** Two unit vectors spanning the plane perpendicular to `n`, for angular-sorting a face's ring. */
function localBasis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(helper, n));
  const v = normalize(cross(n, u));
  return [u, v];
}

/**
 * The 12 pentagonal faces, one per icosahedron vertex (index-aligned with
 * {@link ICOSA_VERTICES}) — its ring is the 5 {@link DODECA_VERTICES} (icosahedron-face
 * centroids) of the icosahedron faces meeting at that vertex, sorted by angle around it so the
 * ring is a proper (non-self-intersecting) pentagon. {@link ./dieGeometry makeGeometry} corrects
 * each face's winding to outward independently, so the angular sort direction (CW/CCW as seen
 * from outside) doesn't matter here — only that consecutive ring entries are genuinely adjacent
 * around the vertex, which the angle sort guarantees.
 */
export const DODECA_FACES: ReadonlyArray<readonly number[]> = ICOSA_VERTICES.map((v, vIdx) => {
  const adjacentFaceIndices = ICOSA_FACES.map((f, fi) => (f.includes(vIdx) ? fi : -1)).filter((fi) => fi >= 0);
  const [u, w] = localBasis(v);
  return adjacentFaceIndices
    .map((fi) => {
      const p = DODECA_VERTICES[fi]!;
      return { fi, angle: Math.atan2(dot(p, w), dot(p, u)) };
    })
    .sort((a, b) => a.angle - b.angle)
    .map((e) => e.fi);
});

/**
 * d12 numbering parallel to {@link DODECA_FACES}: `1..12`, opposite faces summing to 13 (the
 * standard d12 convention). Because {@link DODECA_FACES} is index-aligned with
 * {@link ICOSA_VERTICES} (face `i` = the pentagon around icosahedron vertex `i`), and the
 * icosahedron's vertex set is closed under negation (each `(0,±1,±φ)`-family vertex has an
 * exact antipode also in the list), the dodecahedron face antipodal to face `i` is simply the
 * face at icosahedron vertex `-V[i]` — found directly here without needing face normals.
 */
export const D12_VALUES: number[] = (() => {
  const values = new Array<number>(DODECA_FACES.length).fill(0);
  let next = 1;
  for (let i = 0; i < ICOSA_VERTICES.length; i++) {
    if (values[i] !== 0) continue;
    const anti = ICOSA_VERTICES.findIndex((w, j) => j !== i && dot(ICOSA_VERTICES[i]!, w) < -0.999);
    if (anti < 0) throw new Error(`dodecahedron: icosahedron vertex ${i} has no antipodal partner`);
    values[i] = next;
    values[anti] = 13 - next;
    next++;
  }
  return values;
})();
