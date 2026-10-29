/**
 * `readFace` — read the shown face of a settled die from its orientation quaternion. Once a die
 * lies flat on the table, the face whose outward normal points most nearly straight **up** (world
 * `+Y`) is the one the top-down camera sees, and that's the result. The same primitive serves
 * both the physics-decides read and the choreographed "land on a predetermined value" path.
 *
 * Pure math: it takes a plain quaternion `{x,y,z,w}` (the cannon body's `quaternion` works
 * directly) and any {@link DieGeometry}'s `faceNormals`/`faceValues`, with no `three`/`cannon-es`
 * import — so the harness can read faces headlessly.
 *
 * The returned `bestDot`/`secondDot` are the diagnostic the harness asserts on: a die at rest on
 * a face has its top normal essentially colinear with `+Y` (`bestDot ≈ 1`) and the next face well
 * below it, so a clean read is unambiguous. A low or close-call `bestDot` means the die settled
 * on an edge/vertex — a misread risk.
 *
 * **Polarity rides on {@link DieGeometry.readSign}**: the comparison below is
 * `readSign * (rotated normal)[1]`, so `readSign = +1` (every centrally-symmetric shape) is the
 * up-face read above, while `readSign = -1` (the tetrahedron/d4) picks the face whose normal
 * points most nearly **down** — the floor-resting face of a die that rests vertex-up. `isFlat`
 * needs no special case: a flat d4's resting face normal ≈ `(0,-1,0)`, so
 * `readSign · (-1) = +1 ≥ threshold`, the same check as every other die.
 */
import type { DieGeometry } from "./dieGeometry";

export type Quat = { x: number; y: number; z: number; w: number };

export type FaceReading = {
  /** The number printed on the shown face. */
  value: number;
  /** Index into the geometry's `faceNormals`/`faceValues` of the shown face. */
  faceIndex: number;
  /** Dot of the top face's world normal with `+Y` (≈ 1 when settled flat). */
  bestDot: number;
  /** Dot of the runner-up face — the read is unambiguous when `bestDot - secondDot` is large. */
  secondDot: number;
};

/** Rotate a vector by a quaternion (`q * v * q⁻¹`), no external dependency. */
function rotate(q: Quat, v: readonly [number, number, number]): [number, number, number] {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // v + w*t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Whether the die is lying flat on a face (as opposed to balanced on an edge/vertex). A
 * flat die has its shown normal essentially colinear with its read pole, so `bestDot` is near 1. The
 * settle logic requires this *in addition to* "at rest" — an edge-balanced die at the apex
 * of a tip-over is momentarily slow but not actually settled, and reading it there is the
 * ambiguous-read trap. Requiring flatness keeps the sim stepping until the die falls onto a
 * face.
 */
export function isFlat(q: Quat, geometry: DieGeometry, threshold = 0.97): boolean {
  return readFace(q, geometry).bestDot >= threshold;
}

/**
 * Read the top-read face for the given shape: the largest `geometry.readSign`-signed world `Y`
 * component of a rotated face normal — `+Y` (up-face) for `readSign = +1`, `-Y` (down-face) for
 * `readSign = -1` (the d4).
 */
export function readFace(q: Quat, geometry: DieGeometry): FaceReading {
  const { faceNormals, faceValues, readSign } = geometry;
  let bestDot = -Infinity;
  let secondDot = -Infinity;
  let faceIndex = 0;
  for (let i = 0; i < faceNormals.length; i++) {
    const upDot = readSign * rotate(q, faceNormals[i]!)[1]; // signed y-component = readSign · dot with +Y
    if (upDot > bestDot) {
      secondDot = bestDot;
      bestDot = upDot;
      faceIndex = i;
    } else if (upDot > secondDot) {
      secondDot = upDot;
    }
  }
  return { value: faceValues[faceIndex]!, faceIndex, bestDot, secondDot };
}
