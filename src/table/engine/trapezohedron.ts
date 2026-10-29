/**
 * Trapezohedron geometry — the **single source of truth** for the d10's shape, the non-Platonic
 * sibling of {@link ./octahedron} (d8) and {@link ./dodecahedron} (d12). A regular pentagonal
 * trapezohedron (D5d symmetry, the classic RPG d10 shell) has 12 vertices and 10 congruent kite
 * (quadrilateral) faces — it is NOT one of the five Platonic solids, so unlike its siblings it
 * can't be derived from an existing shape; every vertex here is placed from a closed-form
 * constraint solved analytically below, not tuned by eye.
 *
 * Lancer's rules engine never rolls a d10 — this shape is wired only into the cosmetic ad-hoc
 * `/roll` feed projection, so a `/roll 1d10` gets a real mesh instead of `feedRollDice.ts`'s
 * d20-shell `displayableSides` fallback.
 *
 * ## The construction
 *
 * Two apex poles at `(0, ±h, 0)`, plus two rings of 5 equatorial vertices — an upper ring at
 * `y = +c` and a lower ring at `y = -c`, both radius `r`, the lower ring rotated 36° (half a
 * pentagon step) relative to the upper. Each of the 10 kite faces touches ONE apex plus 3
 * equatorial vertices: two from the near ring (adjacent, straddling the apex) and one from the
 * far ring (angularly centered between them, thanks to the 36° offset). Concretely, "top" kite
 * `i` (`i = 0..4`, touching apex `T`) is `[T, U_{i+1}, L_i, U_i]`; "bottom" kite `i` (touching
 * apex `B`) is `[B, L_i, U_{i+1}, L_{i+1}]`. **The top-kite ring is deliberately wound
 * `T → U_{i+1} → L_i → U_i`, not the more obvious `T → U_i → L_i → U_{i+1}`** ({@link
 * ./dieGeometry makeGeometry}'s outward-normal correction would silently reverse the latter for
 * every top kite but leave every bottom kite alone — same solid either way, but it would leave
 * `face[0]` as the true pole apex for bottom kites and an arbitrary equatorial side vertex for
 * top kites after correction, which matters downstream: {@link ./faceNumerals}'s `faceApexUp`
 * reads `face[0]` as the numeral's "point toward" vertex, so that asymmetry would print bottom
 * numerals pointing at the pole and top numerals pointing sideways. Winding it pre-reversed here
 * needs no correction, so `face[0]` stays the pole apex `T`/`B` for all 10 faces uniformly — a
 * pure relabeling of the same boundary trace; `dieGeometry.test.ts`'s planarity/congruence/
 * convexity proofs are order-invariant, so this changes only which vertex prints as index 0.
 *
 * **The crux (why this can't be eyeballed): a kite's 4 points are coplanar only for a specific
 * `h : c` ratio.** Solving the planarity condition for the top-kite quad `[T, U_0, L_0, U_1]`
 * — equate the scalar triple product of the edge vectors from `T` to zero, then collapse the
 * trig using the exact golden-ratio identity `cos 36° = φ/2` (φ = `(1+√5)/2`) and
 * `sin 72° = 2 sin 36° cos 36°` — yields:
 *
 * ```
 * h / c = (1 + cos 36°) / (1 - cos 36°)     [ = 5 + 2√5 ≈ 9.47214 ]
 * ```
 *
 * `H_OVER_C` below computes this directly from `cos 36°` rather than the hand-simplified closed
 * form, so the derivation is traceable in code, not just in the comment; it is numerically
 * identical to `5 + 2√5` (verified in `dieGeometry.test.ts`'s planarity proof, which is the real
 * check that this ratio — not "close enough" — is what makes every kite flat).
 *
 * Notably, **`r` cancels out of the planarity condition entirely.** Every term in the
 * determinant carries exactly one factor of `r` (from an `x`/`z` component) paired with one
 * `r`-free `y` component, so the whole expression scales as `r² · f(h, c)` and the zero of `f`
 * never depends on `r`. That makes `r` a genuine free *proportion* parameter (how wide the
 * equatorial bulge is relative to its height) — not a second load-bearing constant that needed
 * solving too.
 *
 * With one degree of freedom to spend on proportions, this module picks `r` so the apex distance
 * from the origin (`h`) exactly equals the ring-vertex distance (`√(r²+c²)`) — the roundest,
 * least needle-like member of the coplanar family, close to a real RPG d10's silhouette. That
 * forces `r = c·√((h/c)² − 1)`, which makes all 12 raw vertices already equidistant from the
 * origin *before* normalization — so normalizing to circumradius 1 (below) lands every vertex
 * exactly on the unit sphere, not just the farthest one.
 *
 * Face winding/outward-normal correction is delegated to the *existing*
 * {@link ./dieGeometry makeGeometry} — this module only emits raw vertices + face rings + a
 * parallel value table, the same shape as {@link ./octahedron}/{@link ./dodecahedron}. Pure data
 * + math: no `three`, no `cannon-es`.
 */
import type { Vec3 } from "./icosahedron";

const PHI = (1 + Math.sqrt(5)) / 2; // golden ratio
/** `cos 36° = φ/2` — the exact golden-ratio identity the planarity derivation collapses onto. */
const COS_36 = PHI / 2;

/**
 * The load-bearing constant: the apex-height-to-ring-height ratio that makes a kite face's 4
 * points coplanar (see the module header for the derivation). Equals the closed form `5 + 2√5`
 * (≈ 9.47214); `r` does not appear in it at all.
 */
const H_OVER_C = (1 + COS_36) / (1 - COS_36);

const STEP = (2 * Math.PI) / 5; // 72°, the pentagon step between adjacent same-ring vertices
const RING_OFFSET = Math.PI / 5; // 36°, the angular offset between the two rings

// Free proportion parameters (see header): fix the ring height at 1 unit (the overall scale is
// irrelevant — normalization below rescales everything) and choose the ring radius so the apex
// distance from the origin equals the ring-vertex distance, the roundest coplanar shape.
const RING_Y = 1;
const APEX_Y = RING_Y * H_OVER_C;
const RING_RADIUS = RING_Y * Math.sqrt(H_OVER_C * H_OVER_C - 1);

/** One ring of 5 equatorial vertices at height `y`, starting at angular `offset`. */
function ring(y: number, offset: number): Vec3[] {
  return Array.from({ length: 5 }, (_, i) => {
    const theta = i * STEP + offset;
    return [RING_RADIUS * Math.cos(theta), y, RING_RADIUS * Math.sin(theta)] as Vec3;
  });
}

/** Rescale every vertex by the SAME factor (the shape's circumradius) so proportions are preserved. */
function normalizeToCircumradius1(vertices: Vec3[]): Vec3[] {
  const circumradius = Math.max(...vertices.map(([x, y, z]) => Math.hypot(x, y, z)));
  return vertices.map(([x, y, z]) => [x / circumradius, y / circumradius, z / circumradius] as Vec3);
}

const rawVertices: Vec3[] = [
  [0, APEX_Y, 0], // 0: T, top apex
  [0, -APEX_Y, 0], // 1: B, bottom apex
  ...ring(RING_Y, 0), // 2..6: U_0..U_4, upper ring
  ...ring(-RING_Y, RING_OFFSET), // 7..11: L_0..L_4, lower ring (offset 36° from the upper)
];

/**
 * The 12 trapezohedron vertices — 2 apexes + 2 rings of 5, normalized to circumradius 1 (matching
 * every other die shape here). By construction (see header) every one of the 12 was already
 * equidistant from the origin before this rescale.
 */
export const TRAPEZO_VERTICES: Vec3[] = normalizeToCircumradius1(rawVertices);

const T = 0;
const B = 1;
/** Index of upper-ring vertex `i` (mod 5, wraps). */
function U(i: number): number {
  return 2 + (((i % 5) + 5) % 5);
}
/** Index of lower-ring vertex `i` (mod 5, wraps). */
function L(i: number): number {
  return 7 + (((i % 5) + 5) % 5);
}

/**
 * The 10 kite faces as vertex-index quads: 5 "top" kites touching the top apex `T`, then 5
 * "bottom" kites touching the bottom apex `B` — ordered `[top0..top4, bottom0..bottom4]` so
 * {@link D10_VALUES} can be authored against a documented antipodal pairing (see there). Winding
 * is normalized to outward in {@link ./dieGeometry makeGeometry}; the top-kite ring is authored
 * `[T, U_{i+1}, L_i, U_i]` (not `[T, U_i, L_i, U_{i+1}]`) so that correction is a no-op for every
 * face — see the module header for why `face[0]` staying the pole apex uniformly matters.
 */
export const TRAPEZO_FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  ...Array.from({ length: 5 }, (_, i) => [T, U(i + 1), L(i), U(i)] as readonly [number, number, number, number]),
  ...Array.from({ length: 5 }, (_, i) => [B, L(i), U(i + 1), L(i + 1)] as readonly [number, number, number, number]),
];

/**
 * d10 numbering parallel to {@link TRAPEZO_FACES}: prints **1..10 literally** — a deliberate
 * divergence from a physical d10's 0-9-with-0-meaning-10 convention, because a VTT glyph on the
 * up-face must equal the literal rolled result. Opposite kite faces sum to 11 (the standard d10
 * antipodal convention).
 *
 * The antipodal map is combinatorial: negating a ring vertex at angle `θ` and height `±c` lands
 * it at angle `θ + 180°` and height `∓c` — i.e. on the OTHER ring. Working through the index
 * algebra for this exact construction (upper ring at offset 0°, lower at offset 36°) shows
 * **top kite `i` is antipodal to bottom kite `(i + 2) mod 5`** (verified directly by face-normal
 * dot product in this module's tests, not just asserted). Top kites are numbered `1..5` in face
 * order; each antipodal bottom kite `(i + 2) mod 5` is then `11 - top[i]`, giving bottom kites
 * `[7, 6, 10, 9, 8]` for face-order index `j = 0..4`.
 */
export const D10_VALUES: number[] = [1, 2, 3, 4, 5, 7, 6, 10, 9, 8];
