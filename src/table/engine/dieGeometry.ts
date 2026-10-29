/**
 * `DieGeometry` — the per-shape geometry record the whole dice pipeline is parameterised over.
 * Each die carries its own record (vertices, faces, per-face outward normals, per-face printed
 * values), and `readFace`/`orientToValue`/the physics body/the render mesh all take it as a
 * parameter. **One geometry per shape, consumed by *both* the three mesh and the cannon body** —
 * so the drawn solid and the simulated one can never drift apart.
 *
 * Pure data + math (no `three`/`cannon-es`): the headless harness builds a body from a
 * geometry and round-trips every face.
 *
 * The registry covers the shapes the rules engine rolls (d20/d6/d3) plus the **cosmetic**
 * d8/d12/d10/d4 — ad-hoc `/roll` visualization only, the rules engine never rolls them, but all
 * are reachable via `feedRollDice.ts`'s `SUPPORTED_SIDES`. d100 is deliberately out of scope and
 * keeps hitting the `displayableSides` d20-shell fallback in `feedRollDice.ts`.
 * `geometryForSides` throws on any other unknown shape rather than silently substituting.
 */
import { ICOSA_VERTICES, ICOSA_FACES, FACE_NORMALS, FACE_VALUES, type Vec3 } from "./icosahedron";
import { CUBE_VERTICES, CUBE_FACES, D6_VALUES, D3_VALUES } from "./cube";
import { OCTA_VERTICES, OCTA_FACES, D8_VALUES } from "./octahedron";
import { DODECA_VERTICES, DODECA_FACES, D12_VALUES } from "./dodecahedron";
import { TRAPEZO_VERTICES, TRAPEZO_FACES, D10_VALUES } from "./trapezohedron";
import { TETRA_VERTICES, TETRA_FACES, D4_VALUES } from "./tetrahedron";

export type { Vec3 };

/** One die shape: vertices (circumradius 1), outward-wound faces, per-face normals + printed values. */
export type DieGeometry = {
  /** Faces on the die (20/6/3 in Lancer) — the key `DiceSpec.sides` selects on. */
  sides: number;
  /** Vertices normalised onto the unit sphere (circumradius 1); the body scales by its radius. */
  vertices: Vec3[];
  /** Face vertex-index rings, wound counter-clockwise as seen from outside (normals point out). */
  faces: ReadonlyArray<readonly number[]>;
  /** Unit outward normal per face, parallel to {@link faces}. */
  faceNormals: Vec3[];
  /** Printed value per face, parallel to {@link faces}; duplicates allowed (a d3 prints 1..3 twice). */
  faceValues: number[];
  /**
   * Which pole the read-model compares a rotated face normal against: `+1` (the default, every
   * centrally-symmetric die — d20/d6/d3/d8/d12/d10) reads the **up**-face, comparing against
   * world `+Y`. `-1` reads the **down**-resting face — equivalently the up-pointing vertex —
   * comparing against world `-Y`; this is the tetrahedron/d4 case, the one shape here with no
   * antipodal face to rest the "up-face" read on. {@link ./readFace} and {@link ./orientToValue}
   * both multiply their up-dot comparisons by this sign, so it's the single seam a
   * non-centrally-symmetric shape's polarity flips through.
   */
  readSign: 1 | -1;
};

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Raw inputs for {@link makeGeometry} — a shape's sides, vertices, face rings, and parallel
 * value table. `readSign` defaults to `+1` (the up-face read every centrally-symmetric shape
 * uses); only the tetrahedron/d4 passes `-1`.
 */
type GeometrySpec = {
  sides: number;
  vertices: Vec3[];
  faceRings: ReadonlyArray<readonly number[]>;
  faceValues: number[];
  readSign?: 1 | -1;
};

/**
 * Assemble a {@link DieGeometry} from raw vertices, face rings, and a parallel value table,
 * normalising each ring's winding so its normal points **outward** (the centroid of a
 * face on an origin-centred convex solid points outward, so a normal that opposes it is
 * inward-wound — reverse the ring). Returns the corrected faces + their unit outward normals.
 */
export function makeGeometry({ sides, vertices, faceRings, faceValues, readSign = 1 }: GeometrySpec): DieGeometry {
  const faces: number[][] = [];
  const faceNormals: Vec3[] = [];
  for (const ring of faceRings) {
    const a = vertices[ring[0]!]!;
    const b = vertices[ring[1]!]!;
    const c = vertices[ring[2]!]!;
    let normal = normalize(cross(sub(b, a), sub(c, a)));
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const idx of ring) {
      cx += vertices[idx]![0];
      cy += vertices[idx]![1];
      cz += vertices[idx]![2];
    }
    const centroid: Vec3 = [cx / ring.length, cy / ring.length, cz / ring.length];
    if (dot(normal, centroid) >= 0) {
      faces.push([...ring]);
    } else {
      faces.push([...ring].reverse());
      normal = [-normal[0], -normal[1], -normal[2]];
    }
    faceNormals.push(normal);
  }
  return { sides, vertices, faces, faceNormals, faceValues, readSign };
}

/** The d20 — built directly from the {@link ./icosahedron} exports. */
export const D20_GEOMETRY: DieGeometry = {
  sides: 20,
  vertices: ICOSA_VERTICES,
  faces: ICOSA_FACES,
  faceNormals: FACE_NORMALS,
  faceValues: FACE_VALUES,
  readSign: 1,
};

/** The d6 — a cube numbered 1..6 (opposite faces sum to 7). */
export const D6_GEOMETRY: DieGeometry = makeGeometry({ sides: 6, vertices: CUBE_VERTICES, faceRings: CUBE_FACES, faceValues: D6_VALUES });

/** The d3 — the same cube, numbered 1..3 doubled on opposite faces (see {@link ./cube}). */
export const D3_GEOMETRY: DieGeometry = makeGeometry({ sides: 3, vertices: CUBE_VERTICES, faceRings: CUBE_FACES, faceValues: D3_VALUES });

/** The d8 — a regular octahedron numbered 1..8 (opposite faces sum to 9, see {@link ./octahedron}). Cosmetic only — the rules engine never rolls a d8. */
export const D8_GEOMETRY: DieGeometry = makeGeometry({ sides: 8, vertices: OCTA_VERTICES, faceRings: OCTA_FACES, faceValues: D8_VALUES });

/** The d12 — a regular dodecahedron numbered 1..12 (opposite faces sum to 13, see {@link ./dodecahedron}). Cosmetic only — the rules engine never rolls a d12. */
export const D12_GEOMETRY: DieGeometry = makeGeometry({ sides: 12, vertices: DODECA_VERTICES, faceRings: DODECA_FACES, faceValues: D12_VALUES });

/**
 * The d10 — a pentagonal trapezohedron numbered 1..10 (opposite faces sum to 11, see
 * {@link ./trapezohedron}). Cosmetic only — the rules engine never rolls a d10. Its kite faces
 * print numerals via {@link ./faceNumerals}'s apex-up branch.
 */
export const D10_GEOMETRY: DieGeometry = makeGeometry({ sides: 10, vertices: TRAPEZO_VERTICES, faceRings: TRAPEZO_FACES, faceValues: D10_VALUES });

/**
 * The d4 — a regular tetrahedron numbered 1..4 (see {@link ./tetrahedron}), `readSign: -1`. The
 * one shape here with no antipodal face: it rests face-down with a vertex up, so it's read off
 * the **down**-resting face, not the up-face every other shape uses. Its numerals are
 * corner-anchored — three glyphs per face, one per corner (see `faceNumerals.ts`'s `CornerLayout`).
 */
export const D4_GEOMETRY: DieGeometry = makeGeometry({ sides: 4, vertices: TETRA_VERTICES, faceRings: TETRA_FACES, faceValues: D4_VALUES, readSign: -1 });

/**
 * The geometry for a die by face count. The rules engine only ever asks for 20/6/3; the cosmetic
 * 8/12/10/4 serve the ad-hoc `/roll` feed path only, reachable via `feedRollDice.ts`'s
 * `SUPPORTED_SIDES`. An unknown shape throws — d100 stays deliberately unsupported (see this
 * file's header) rather than silently rendering the wrong solid.
 */
export function geometryForSides(sides: number): DieGeometry {
  switch (sides) {
    case 20:
      return D20_GEOMETRY;
    case 6:
      return D6_GEOMETRY;
    case 3:
      return D3_GEOMETRY;
    case 8:
      return D8_GEOMETRY;
    case 12:
      return D12_GEOMETRY;
    case 10:
      return D10_GEOMETRY;
    case 4:
      return D4_GEOMETRY;
    default:
      throw new Error(`geometryForSides: unsupported die d${sides} (Lancer rolls d20/d6/d3; cosmetic d8/d12/d10/d4 also supported)`);
  }
}
