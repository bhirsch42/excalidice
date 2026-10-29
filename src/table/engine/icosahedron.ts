/**
 * Icosahedron geometry — the **single source of truth** for the d20's shape, shared by
 * both the three.js render mesh ({@link ./DiceStage}) and the cannon-es physics body
 * ({@link ./diceBody}). Building both from one vertex/face list is what keeps the thing
 * you *see* tumbling and the thing the *physics* simulates identical — a mismatch there
 * would make `readFace` (which reads the physics body's orientation) disagree with the
 * rendered die.
 *
 * Everything here is **pure data + pure math** — no `three`, no `cannon-es`. That keeps
 * the dice numbering / face-reading logic unit-testable headlessly: the harness steps a
 * cannon body and calls {@link ./readFace}, never a browser.
 *
 * A d20 is a regular icosahedron: 12 vertices, 20 equilateral-triangle faces. The
 * vertices are the cyclic permutations of `(0, ±1, ±φ)` (φ = golden ratio), normalised
 * onto the unit sphere so a die's `radius` is its literal circumradius. Faces are derived
 * (not hand-typed) by finding every triple of mutually min-edge-adjacent vertices, then
 * wound counter-clockwise as seen from outside so the face normals point outward — the
 * winding cannon's `ConvexPolyhedron` needs and the orientation `readFace` reads.
 */

export type Vec3 = readonly [number, number, number];

const PHI = (1 + Math.sqrt(5)) / 2;

/** The 12 icosahedron vertices, normalised onto the unit sphere (circumradius 1). */
export const ICOSA_VERTICES: Vec3[] = (() => {
  const raw: Vec3[] = [
    [0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI],
    [1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0],
    [PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, 1], [-PHI, 0, -1],
  ];
  return raw.map((v) => normalize(v));
})();

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Derive the 20 triangular faces as `[i, j, k]` vertex-index triples, each wound so its
 * normal points **outward** (away from the centre). A face is any triple of vertices all
 * pairwise separated by the minimum edge length.
 */
export const ICOSA_FACES: ReadonlyArray<readonly [number, number, number]> = (() => {
  const V = ICOSA_VERTICES;
  // Minimum pairwise distance = the edge length.
  let minEdge = Infinity;
  for (let i = 0; i < V.length; i++) {
    for (let j = i + 1; j < V.length; j++) {
      minEdge = Math.min(minEdge, dist(V[i]!, V[j]!));
    }
  }
  const eps = minEdge * 1e-3;
  const faces: Array<[number, number, number]> = [];
  for (let i = 0; i < V.length; i++) {
    for (let j = i + 1; j < V.length; j++) {
      if (Math.abs(dist(V[i]!, V[j]!) - minEdge) > eps) continue;
      for (let k = j + 1; k < V.length; k++) {
        if (Math.abs(dist(V[i]!, V[k]!) - minEdge) > eps) continue;
        if (Math.abs(dist(V[j]!, V[k]!) - minEdge) > eps) continue;
        // A valid face: orient it outward.
        const a = V[i]!, b = V[j]!, c = V[k]!;
        const normal = cross(sub(b, a), sub(c, a));
        // Centroid points outward from origin; flip winding if the normal opposes it.
        const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        faces.push(dot(normal, centroid) >= 0 ? [i, j, k] : [i, k, j]);
      }
    }
  }
  return faces;
})();

/** Unit outward normal of each face, parallel to {@link ICOSA_FACES}. */
export const FACE_NORMALS: Vec3[] = ICOSA_FACES.map(([i, j, k]) => {
  const a = ICOSA_VERTICES[i]!, b = ICOSA_VERTICES[j]!, c = ICOSA_VERTICES[k]!;
  return normalize(cross(sub(b, a), sub(c, a)));
});

/**
 * The printed number on each face, parallel to {@link ICOSA_FACES}. Opposite faces sum to
 * 21 (the d20 convention). The exact rotational layout is not canonical — only the
 * antipodal-pairing + 1..20 coverage matter, and that's all `readFace` depends on.
 */
export const FACE_VALUES: number[] = (() => {
  const values = new Array<number>(FACE_NORMALS.length).fill(0);
  let next = 1;
  for (let i = 0; i < FACE_NORMALS.length; i++) {
    if (values[i] !== 0) continue;
    // Find the antipodal face (normal ≈ -normal[i]).
    let anti = -1;
    for (let j = 0; j < FACE_NORMALS.length; j++) {
      if (j === i) continue;
      if (dot(FACE_NORMALS[i]!, FACE_NORMALS[j]!) < -0.999) {
        anti = j;
        break;
      }
    }
    values[i] = next;
    if (anti >= 0) values[anti] = 21 - next;
    next++;
  }
  return values;
})();
