/**
 * `faceNumerals` — the **pure orientation/layout math** behind per-face numeral textures. Every
 * face of every {@link DieGeometry} gets a printed numeral matching {@link
 * DieGeometry.faceValues} (the same table {@link ./readFace}/{@link ./orientToValue} agree on —
 * this module reads that table, it never invents a second one), oriented so the numeral reads
 * **upright**.
 *
 * Split deliberately from the actual texture drawing ({@link ./numeralTexture}, which needs
 * `document`/`CanvasRenderingContext2D` and so only runs in a browser): everything here is
 * plain vector/quaternion math with no DOM/`three`/`cannon-es` import, so the geometry
 * contract — value-correspondence and upright orientation — is asserted headlessly in
 * `faceNumerals.test.ts`.
 *
 * **Two orientation conventions, chosen per face shape ({@link faceTangentAxes}).**
 *
 * A **square** face (d6/d3) uses a screen-frame mapping: `uAxis`/`vAxis` are the local
 * directions that map onto {@link ./DiceStage}'s screen-right/screen-up (world `+X`/`-Z`) once
 * the face's normal is carried onto world `+Y` by the minimal rotation ({@link rotationBetween},
 * mirrored here rather than imported — see the note on that function). That reads correctly
 * because a cube's face normal is itself world-axis-aligned, so the minimal rotation onto `+Y`
 * is an axis-permuting rotation and the mapped tangent frame lands edge-aligned.
 *
 * A **triangular** (d20/d8), **pentagonal** (d12), or **kite** (d10) face has a normal that is
 * *not* axis-aligned, so that same mapping would point at an arbitrary spot relative to the
 * face's own vertices — legible but visibly cocked, not the way a real die reads. Those faces
 * use the real-dice convention instead: upright **within their own face**, `vAxis` pointing from
 * the centroid toward a canonical apex vertex (in-plane, deterministic — see {@link faceApexUp}),
 * independent of screen/world orientation. Either branch keeps `(uAxis, vAxis)` unit, tangent to
 * the face, and right-handed (`uAxis × vAxis == normal`).
 *
 * **The d10's kite is also a 4-vertex ring, but it is NOT a square** — a cube face has equal
 * diagonals and an axis-aligned normal; a kite has unequal diagonals (it isn't even equilateral)
 * and a *tilted* normal, so routing it through the square branch prints a cocked numeral.
 * {@link faceTangentAxes} discriminates the two 4-gon shapes geometrically (equal vs. unequal
 * diagonals — see {@link isDiagonalSquare}), never by `geometry.sides`, and routes the kite
 * through the same apex-up branch as the triangular/pentagonal faces.
 *
 * This pins the *reference* orientation the numeral is authored against, **not** the die's final
 * on-screen twist: a rested die's in-plane twist is deliberately unpinned (the physics settle can
 * land at any twist around the shown face's normal, like a real die), so a landed numeral sits at
 * whatever angle that natural twist puts it.
 *
 * **A third scheme, beside one-glyph-per-face: the d4's corner-anchored layout.** The apex-up
 * caltrop is read off the up-pointing **vertex**, not a single "showing" face — so no face gets
 * one centered glyph; instead every face prints THREE small glyphs, one at each of its three
 * corners, and whichever vertex lands up, all three faces meeting it show the same value at that
 * shared apex corner (see the "Corner-anchored atlas" section below). It is its own
 * cell-assignment path (`buildCornerLayout`, one atlas cell per FACE) rather than
 * `buildNumeralLayout`'s one-cell-per-distinct-VALUE scheme, but reuses `vertexUV`/
 * `buildFlatUVs`/`faceTangentAxes` unmodified, since a tetrahedron's faces are pure triangles and
 * that projection math is already just "place this face's own vertex inside its assigned cell."
 * {@link isCornerAnchored} (`readSign === -1`) is the discriminator `numeralTexture.ts` branches
 * on to pick `buildCornerLayout` over `buildNumeralLayout`.
 */
import type { DieGeometry, Vec3 } from "./dieGeometry";
import type { Quat } from "./readFace";

// --- Small pure quaternion/vector helpers -----------------------------------------------
// Deliberately self-contained (mirrors the equivalent private helpers in `orientToValue.ts` /
// `bakedCorrection.ts`) rather than importing from either: this module is pure geometry/layout
// math with no coupling to the physics-replay pipeline, and the dice module's convention is that
// each file keeps its own quaternion helpers local.

function rotate(q: Quat, v: Vec3): Vec3 {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeVec(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** The inverse of a unit quaternion is its conjugate — every quaternion this module handles is unit. */
function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/**
 * The minimal rotation taking unit vector `from` onto unit vector `to` — the exact same
 * construction `orientToValue.ts`'s private `rotationBetween` uses (including the antiparallel
 * fallback, e.g. the d6/d3 cube's `-Y` "bottom" face, whose normal is exactly `(0,-1,0)`: any
 * axis orthogonal to `from` is a valid 180° turn, so the choice here is deterministic — not
 * random — but not claimed to be *the* canonical one; the test asserts the round-trip contract
 * holds for it regardless).
 */
function rotationBetween(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d > 0.999999) return { x: 0, y: 0, z: 0, w: 1 };
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], from);
    if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-6) axis = cross([0, 1, 0], from);
    const [ax, ay, az] = normalizeVec(axis);
    return { x: ax, y: ay, z: az, w: 0 };
  }
  const c = cross(from, to);
  return normalizeQuat({ x: c[0], y: c[1], z: c[2], w: 1 + d });
}

// --- The upright-tangent-axes contract ---------------------------------------------------

const WORLD_UP: Vec3 = [0, 1, 0]; // a "showing" face's normal, once rotated to face the camera
/** Screen-right under {@link ./DiceStage}'s top-down camera (`camera.up = (0,0,-1)`). */
const SCREEN_RIGHT: Vec3 = [1, 0, 0];
/** Screen-up under {@link ./DiceStage}'s top-down camera — world `-Z`, not `+Z`. */
const SCREEN_UP: Vec3 = [0, 0, -1];

/**
 * The in-plane unit direction — within face `faceIndex`'s own plane — from its centroid toward
 * vertex `vertexIndex` (one of that face's own ring vertices), with any component along the face
 * normal projected out for numerical robustness (vertex/centroid are coplanar by construction,
 * so that's a no-op up to floating noise). This is the "point toward this corner" contract a
 * printed numeral's top must satisfy — {@link faceApexUp} is the single-glyph case, specialized
 * to `vertexIndex = ring[0]`; the d4's corner-anchored scheme calls this directly for all three
 * of a face's ring vertices, since it prints three glyphs per face instead of one.
 */
export function cornerOutwardDirection(geometry: DieGeometry, faceIndex: number, vertexIndex: number): Vec3 {
  const normal = geometry.faceNormals[faceIndex]!;
  const centroid = faceCentroid(geometry, faceIndex);
  const vertex = geometry.vertices[vertexIndex]!;
  const raw: Vec3 = [vertex[0] - centroid[0], vertex[1] - centroid[1], vertex[2] - centroid[2]];
  const off = dot(raw, normal);
  const inPlane: Vec3 = [raw[0] - off * normal[0], raw[1] - off * normal[1], raw[2] - off * normal[2]];
  return normalizeVec(inPlane);
}

/**
 * The face-intrinsic "up" direction for a non-square face: the in-plane direction from
 * the face's centroid toward its first winding vertex (`geometry.faces[faceIndex][0]`) — the
 * real-dice convention of a numeral's top pointing toward a triangle's apex (opposite its base
 * edge — exact for an equilateral triangle, whose centroid-to-vertex median is also the
 * altitude of the opposite edge) or toward a pentagon's chosen vertex. *Which* vertex is
 * deterministic (fixed by the geometry's own winding, never randomized) but otherwise
 * arbitrary — a face has no inherent up — so it's consistency across every face of a shape,
 * not a "correct" pick, that makes the printed numerals read as intentional rather than random.
 */
function faceApexUp(geometry: DieGeometry, faceIndex: number): Vec3 {
  const ring = geometry.faces[faceIndex]!;
  return cornerOutwardDirection(geometry, faceIndex, ring[0]!);
}

/**
 * Does this geometry use the d4's corner-anchored (one-glyph-per-vertex-corner) numeral scheme
 * rather than the one-glyph-per-face scheme? Discriminated by `readSign === -1`, **not**
 * `sides === 4`: it's the same structural fact — no antipodal up-face to center a single glyph
 * on — that forces the read-model's polarity flip, so any future non-centrally-symmetric shape
 * needs this same numeral scheme for the same reason, not a per-shape special case.
 */
export function isCornerAnchored(geometry: DieGeometry): boolean {
  return geometry.readSign === -1;
}

/**
 * Is this 4-vertex face a **square** (equal diagonals) rather than a **kite** (unequal
 * diagonals, e.g. the d10's trapezohedron faces)? A square's two diagonals are congruent; a
 * kite's short diagonal (across the pole-apex axis) is shorter than its long one. This is an
 * intrinsic geometric test — never `geometry.sides` (that would be brittle against any future
 * 4-gon-faced shape) — so a cube quad and a kite quad are told apart by their own shape, not by
 * which die they belong to.
 */
function isDiagonalSquare(geometry: DieGeometry, ring: readonly number[]): boolean {
  const p0 = geometry.vertices[ring[0]!]!;
  const p1 = geometry.vertices[ring[1]!]!;
  const p2 = geometry.vertices[ring[2]!]!;
  const p3 = geometry.vertices[ring[3]!]!;
  const diag02 = Math.hypot(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
  const diag13 = Math.hypot(p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]);
  return Math.abs(diag02 - diag13) < 1e-6 * Math.max(diag02, diag13, 1);
}

/**
 * The canonical local-space tangent axes for one face of a {@link DieGeometry}. **Square**
 * faces (d6/d3, 4-vertex rings with equal diagonals — see {@link isDiagonalSquare}) use the
 * screen-frame mapping: `uAxis`/`vAxis` are the local directions that map onto
 * screen-right/screen-up (world `+X`/`-Z`) once the face is rotated to show (its normal carried
 * onto `+Y` by the minimal rotation) — which lands edge-aligned for a cube.
 * **Triangular/pentagonal/kite** faces (d20/d8/d12/d10) use the in-face convention instead:
 * `vAxis` is {@link faceApexUp} (the face's own apex direction, independent of screen
 * orientation) and `uAxis` completes a right-handed orthonormal frame via
 * `vAxis × normal` (the standard identity for an orthonormal right-handed triple `(u, v, n)`
 * with `u × v = n`: also `v × n = u`). Either branch is the contract {@link ./numeralTexture}'s
 * UV mapping is built against: draw a numeral "upright" against `(uAxis, vAxis)` and it reads
 * upright in the chosen reference frame.
 */
export function faceTangentAxes(geometry: DieGeometry, faceIndex: number): { uAxis: Vec3; vAxis: Vec3 } {
  const normal = geometry.faceNormals[faceIndex]!;
  const ring = geometry.faces[faceIndex]!;
  if (ring.length === 4 && isDiagonalSquare(geometry, ring)) {
    const toUp = rotationBetween(normal, WORLD_UP);
    const fromUp = conjugate(toUp); // toUp is unit, so its inverse is its conjugate
    return { uAxis: rotate(fromUp, SCREEN_RIGHT), vAxis: rotate(fromUp, SCREEN_UP) };
  }
  const vAxis = faceApexUp(geometry, faceIndex);
  const uAxis = normalizeVec(cross(vAxis, normal));
  return { uAxis, vAxis };
}

// --- Atlas cell layout (which face gets which numeral cell) ------------------------------

/**
 * The fields every atlas layout needs for per-vertex UV projection ({@link vertexUV}/{@link
 * cellRect}) — shared by {@link NumeralLayout} (one cell per distinct value) and the d4's
 * {@link CornerLayout} (one cell per face). The projection math (`vertexUV`/`buildFlatUVs`)
 * never reads `NumeralLayout.values` — only cell geometry — so it's naturally polymorphic over
 * which cell-assignment scheme produced the layout; only the assignment itself
 * (`buildNumeralLayout` vs. `buildCornerLayout`) differs.
 */
export type CellLayout = {
  /** Atlas grid width in cells. */
  cols: number;
  /** Atlas grid height in cells. */
  rows: number;
  /** Cell index for each face, parallel to `geometry.faces`/`faceValues`. */
  cellForFace: number[];
};

export type NumeralLayout = CellLayout & {
  /** Distinct printed values, ascending — cell `i` (row-major: `row = i / cols`, `col = i % cols`) shows `values[i]`. Faces sharing a value (the d3's doubled pips) share a cell, via {@link CellLayout.cellForFace}. */
  values: number[];
};

/** One atlas cell per **distinct** printed value (a d3's two same-valued faces share a cell — same numeral, different per-face UV orientation). */
export function buildNumeralLayout(geometry: DieGeometry): NumeralLayout {
  const values = [...new Set(geometry.faceValues)].sort((a, b) => a - b);
  const cols = Math.max(1, Math.ceil(Math.sqrt(values.length)));
  const rows = Math.max(1, Math.ceil(values.length / cols));
  const indexOfValue = new Map(values.map((v, i) => [v, i] as const));
  const cellForFace = geometry.faceValues.map((v) => indexOfValue.get(v)!);
  return { cols, rows, values, cellForFace };
}

type UVRect = { u0: number; v0: number; u1: number; v1: number };

function cellRect(layout: CellLayout, faceIndex: number): UVRect {
  const cell = layout.cellForFace[faceIndex]!;
  const col = cell % layout.cols;
  const row = Math.floor(cell / layout.cols);
  return { u0: col / layout.cols, u1: (col + 1) / layout.cols, v0: row / layout.rows, v1: (row + 1) / layout.rows };
}

function faceCentroid(geometry: DieGeometry, faceIndex: number): Vec3 {
  const ring = geometry.faces[faceIndex]!;
  let x = 0, y = 0, z = 0;
  for (const idx of ring) {
    const v = geometry.vertices[idx]!;
    x += v[0]; y += v[1]; z += v[2];
  }
  return [x / ring.length, y / ring.length, z / ring.length];
}

/** Bundles a die's geometry with its atlas layout — the fixed pair every `vertexUV` call needs (kept as one param to stay under `CODE_STYLE.md`'s max-params-3). */
export type NumeralContext = { geometry: DieGeometry; layout: CellLayout };

/**
 * The UV coordinate for one vertex of one face, mapping the face's own `(uAxis, vAxis)`-relative
 * position onto its assigned atlas cell. `v` is inverted relative to `tv` (`+vAxis` → lower `v`)
 * to match {@link ./numeralTexture}'s canvas convention (`flipY = false`: `v=0` is the *top* row
 * of the drawn atlas, matching a glyph's own top-down drawing order), so `+vAxis` — screen-up
 * once showing for a square face, the face's own apex direction for a triangular/pentagonal one
 * ({@link faceTangentAxes}) — samples toward the top of the drawn digit, not its baseline.
 */
export function vertexUV(ctx: NumeralContext, faceIndex: number, vertexIdx: number): [number, number] {
  const { geometry, layout } = ctx;
  const { uAxis, vAxis } = faceTangentAxes(geometry, faceIndex);
  const centroid = faceCentroid(geometry, faceIndex);
  const ring = geometry.faces[faceIndex]!;
  let maxExtent = 0;
  for (const idx of ring) {
    const rv = geometry.vertices[idx]!;
    const rd: Vec3 = [rv[0] - centroid[0], rv[1] - centroid[1], rv[2] - centroid[2]];
    maxExtent = Math.max(maxExtent, Math.abs(dot(rd, uAxis)), Math.abs(dot(rd, vAxis)));
  }
  const p = geometry.vertices[vertexIdx]!;
  const d: Vec3 = [p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]];
  const tuN = maxExtent > 0 ? dot(d, uAxis) / maxExtent : 0;
  const tvN = maxExtent > 0 ? dot(d, vAxis) / maxExtent : 0;
  const rect = cellRect(layout, faceIndex);
  const uCenter = (rect.u0 + rect.u1) / 2;
  const vCenter = (rect.v0 + rect.v1) / 2;
  const halfW = (rect.u1 - rect.u0) / 2;
  const halfH = (rect.v1 - rect.v0) / 2;
  return [uCenter + tuN * halfW, vCenter - tvN * halfH];
}

/**
 * The flat, per-triangle-vertex UV array for a die's render mesh — mirrors {@link
 * ./DiceStage}'s `buildMesh` position-triangulation loop **exactly** (same fan order, same
 * `[face[0], face[k], face[k+1]]` indexing) so this array lines up 1:1 with the `position`
 * attribute it sets `uv` alongside.
 */
export function buildFlatUVs(geometry: DieGeometry, layout: CellLayout): Float32Array {
  const ctx: NumeralContext = { geometry, layout };
  const out: number[] = [];
  for (let f = 0; f < geometry.faces.length; f++) {
    const face = geometry.faces[f]!;
    for (let k = 1; k < face.length - 1; k++) {
      for (const idx of [face[0]!, face[k]!, face[k + 1]!]) {
        const [u, v] = vertexUV(ctx, f, idx);
        out.push(u, v);
      }
    }
  }
  return new Float32Array(out);
}

// --- Corner-anchored atlas: the d4's own path -------------------------------------------
//
// The apex-up caltrop has no single "showing" face — reading the die means finding whichever
// VERTEX is up, and all three faces meeting it must show the same value at that shared corner.
// So the d4 doesn't fit the "one glyph, centered, per face" scheme: each face instead prints
// THREE small corner glyphs, one at each of its three vertices. That is its OWN cell-assignment
// path (`buildCornerLayout`, one cell per FACE) rather than `buildNumeralLayout`'s
// one-cell-per-distinct-VALUE scheme — but it reuses the per-vertex projection math
// (`vertexUV`/`buildFlatUVs`/`faceTangentAxes`) unmodified, since that math is expressed purely
// as "project this face's own vertex into its assigned cell", with no dependency on how cells
// got assigned. Only the assignment (below) and the drawing (`numeralTexture.ts`'s
// `drawCornerAtlas`) are specific to it.

export type CornerLayout = CellLayout;

/**
 * One atlas cell per FACE (not per distinct value, unlike {@link buildNumeralLayout}): a face
 * can't share a cell with any other face here, because each face prints all three of ITS OWN
 * corner vertices' values, not one glyph shared with a same-valued sibling face — so
 * `cellForFace` is the identity map.
 */
export function buildCornerLayout(geometry: DieGeometry): CornerLayout {
  const n = geometry.faces.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellForFace = geometry.faces.map((_, i) => i);
  return { cols, rows, cellForFace };
}

/**
 * The value printed at the corner where vertex `vertexIndex` touches any face's cell — the value
 * OF that vertex (what {@link ./readFace} reads when it's the up-apex). By the tetrahedron's
 * face/vertex duality (face `i` is the triangle opposite vertex `i`, see `tetrahedron.ts`), that
 * value is simply `faceValues[vertexIndex]` — independent of which face is asking, which IS the
 * apex invariant this module's test proves: every face meeting a given vertex shows the same
 * value at their shared corner.
 */
export function cornerValue(geometry: DieGeometry, vertexIndex: number): number {
  return geometry.faceValues[vertexIndex]!;
}
