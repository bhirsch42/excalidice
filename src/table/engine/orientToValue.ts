/**
 * `orientToValue` — the "land on a predetermined face" primitive. The *authority*
 * (`@lancer-vtt/rules`'s `dice.ts`) already decided the value; the 3D layer must show it. So the
 * die tumbles **naturally** (collisions and all — robust to any number of co-thrown dice), and
 * the instant it settles flat a single rigid re-orientation swaps the shown face to the target
 * while keeping the die flat on the table.
 *
 * **The math is exact, not a search.** A settled die lies flat (some face's normal ≈ `+Y`). Take
 * the *target* face's body-local normal, find where it currently points in world space, and
 * rotate the whole body by the minimal rotation that carries that direction onto `+Y`. After
 * the rotation the target face's normal points **exactly** `+Y`, so it's the top face and the
 * die is still flat (its antipodal face rests on the floor). Preferred over rejection-resampling
 * a deterministic replay because it's collision-proof (multiple dice can knock into each other
 * while tumbling) and zero-miss by construction (no attempt budget to exhaust).
 *
 * Pure math: plain `{x,y,z,w}` quaternions and the geometry's face tables, no
 * `three`/`cannon-es` — so the harness drives it headlessly over hundreds of real settled
 * orientations. Because the camera is top-down orthographic, the re-orientation is a pure spin
 * of the visible top face about a fixed body centre; any vertical floor-clip during a brief
 * correction animation is along the view axis and so invisible (see {@link ./DiceStage}).
 *
 * **Polarity rides on `geometry.readSign`.** Both the candidate-selection dot and the target pole
 * below are signed by it, so `readSign = -1` (the tetrahedron/d4) lands the target value's face
 * on the **floor** (its normal → `(0,-1,0)`, the opposite vertex pointing up) instead of on top —
 * the die is flat either way, only which pole "shows" the value flips. `readSign = +1` is the
 * plain up-face behaviour.
 */
import type { Quat } from "./readFace";
import type { DieGeometry, Vec3 } from "./dieGeometry";

/** Index of a face printed with `value` (the first such face — for a d3, two faces share a value). */
export function faceIndexForValue(value: number, geometry: DieGeometry): number {
  const idx = geometry.faceValues.indexOf(value);
  if (idx < 0) throw new Error(`orientToValue: no d${geometry.sides} face printed ${value}`);
  return idx;
}

/** Rotate a vector by a quaternion (`q * v * q⁻¹`). */
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

/** Hamilton product `a · b` (apply `b` first, then `a`, in the world frame). */
function multiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalizeVec(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** The canonical up pole. The actual target pole a re-orientation aims for is `readSign · UP` — see {@link orientToValue}. */
const UP: Vec3 = [0, 1, 0];

/** The minimal rotation taking unit vector `from` onto unit vector `to`. */
function rotationBetween(from: Vec3, to: Vec3): Quat {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  // Already aligned → identity.
  if (d > 0.999999) return { x: 0, y: 0, z: 0, w: 1 };
  // Antiparallel → a 180° turn about any axis orthogonal to `from`.
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], from);
    if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-6) axis = cross([0, 1, 0], from);
    const [ax, ay, az] = normalizeVec(axis);
    return { x: ax, y: ay, z: az, w: 0 };
  }
  const c = cross(from, to);
  return normalizeQuat({ x: c[0], y: c[1], z: c[2], w: 1 + d });
}

/**
 * Given a die's current orientation `q` (typically a freshly-settled, flat quaternion), a
 * `targetValue`, and the die's {@link DieGeometry}, return the orientation that shows
 * `targetValue` on top while remaining flat.
 *
 * Exact: the chosen target face's normal ends up pointing precisely `+Y`, so {@link readFace}
 * on the result reads `targetValue` with `bestDot === 1`. If the die already shows the target
 * the returned orientation equals `q` (identity correction — no visible snap).
 *
 * When more than one face prints the value (a **d3** prints `1..3` twice), the face whose
 * normal *currently* points most nearly up is chosen — the **minimal** re-orientation, so the
 * correction snap stays as small as possible. For a d20/d6 (unique values) there is exactly
 * one candidate.
 *
 * When **no** face prints the value, the orientation is returned **unchanged** (a no-op): the
 * die stays as it physically settled. The combat path never hits this — its values are always
 * printable on the chosen shape — but the ad-hoc `/roll` feed maps an un-modelled die (a `d100`)
 * onto the d20 mesh, where a recorded `73` has no face. A no-op keeps that best-effort (the true
 * total lives on the readout panel) rather than throwing and crashing the overlay's RAF loop.
 */
export function orientToValue(q: Quat, targetValue: number, geometry: DieGeometry): Quat {
  const { faceNormals, faceValues, readSign } = geometry;
  let chosen = -1;
  let chosenUp = -Infinity;
  for (let i = 0; i < faceValues.length; i++) {
    if (faceValues[i] !== targetValue) continue;
    // Signed by readSign: for a d4 (readSign=-1) this picks the candidate face whose normal
    // already points most nearly DOWN, minimizing the correction snap, same as the +1 case
    // minimizes against UP.
    const up = readSign * rotate(q, faceNormals[i]!)[1];
    if (up > chosenUp) {
      chosenUp = up;
      chosen = i;
    }
  }
  if (chosen < 0) return q; // unprintable target (e.g. a d100 face on the d20 mesh) → leave as-settled
  const worldDir = normalizeVec(rotate(q, faceNormals[chosen]!));
  // The target pole is readSign·UP: +Y for every centrally-symmetric shape (the face lands on
  // top), -Y for the d4 (the face lands on the floor, its opposite vertex pointing up).
  const target: Vec3 = [UP[0] * readSign, UP[1] * readSign, UP[2] * readSign];
  const correction = rotationBetween(worldDir, target);
  return normalizeQuat(multiply(correction, q));
}
