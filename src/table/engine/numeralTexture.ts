/**
 * `numeralTexture` — the **browser-only** half of the face numerals: draws a canvas atlas and
 * hands back a `THREE.CanvasTexture` for {@link ./DiceStage} to apply as a mesh `map`. Two
 * schemes ({@link numeralAtlasFor}, discriminated by {@link ./faceNumerals}'s
 * `isCornerAnchored`): every shape but the d4 draws one glyph per distinct printed value (see
 * {@link ./faceNumerals}'s {@link NumeralLayout}); the d4 draws three small corner glyphs per
 * face cell instead ({@link drawCornerAtlas}, {@link ./faceNumerals}'s `CornerLayout`).
 *
 * Needs `document`/`CanvasRenderingContext2D`, so — unlike every other file in this module — it
 * cannot run in the headless `bun:test` harness. The geometry contract it depends on (value→cell
 * assignment, per-face UV mapping, corner-value/orientation correspondence) is proven separately
 * and headlessly in `faceNumerals.test.ts`; "does it read cleanly" needs a human visual pass.
 *
 * **Why a white-background/dark-ink atlas, not a transparent one:** the atlas RGB is
 * multiplied by the mesh material's `color` (three.js `map` semantics), so a white cell
 * background (`texture_rgb = 1`) reproduces the material's existing tint exactly — kept
 * (bright) and dropped (dimmed, `transparent`/`opacity`) dice both render correctly through
 * the *same* atlas with no per-tint texture variant needed. Ink pixels darken the tint,
 * reading as a debossed numeral (visually consistent with the die's existing dark edge lines).
 */
import * as THREE from "three";
import type { DieGeometry, Vec3 } from "./dieGeometry";
import {
  buildNumeralLayout,
  buildCornerLayout,
  cornerValue,
  cornerOutwardDirection,
  faceTangentAxes,
  isCornerAnchored,
  type NumeralLayout,
  type CornerLayout,
  type CellLayout,
} from "./faceNumerals";

const CELL_PX = 128;
const ATLAS_BG = "#ffffff";
const ATLAS_INK = "#0a2a3a"; // matches the "kept" die's edge-line color (DiceStage.buildMesh)

/**
 * Glyph font size as a fraction of `CELL_PX`, **per die shape** (keyed by `DieGeometry.sides`).
 * The atlas cell is a square, but a face's actual printed area isn't — so each shape gets a scale
 * derived from how much of its square cell the face actually fills. Every value below is a
 * reasoned starting point, not a closed-form fit; final legibility is a human eyeball call.
 *
 * - **Square faces (d6/d3)** fill the cell, so a cell-sized glyph fits: `DEFAULT_FONT_SCALE` 0.62.
 * - **Equilateral-triangle faces (d20, d8)** are inscribed in that same square cell (see
 *   {@link ./faceNumerals}'s `buildFlatUVs`), and the triangle's incircle is roughly half the
 *   square's area — a glyph sized for the square overflows the face and reads too big. Both
 *   shapes share 0.36, since both inscribe the same triangle in the same cell.
 * - **Regular-pentagon faces (d12)** are roomier than a triangle but not as filling as a square,
 *   so 0.48 sits between the two entries.
 * - **Kite faces (d10)** are 4-vertex like a square but not equilateral (their diagonals differ,
 *   see {@link ./faceNumerals}'s `isDiagonalSquare`), so their usable interior falls short of a
 *   full square much as a pentagon's does — reuse `D12_FONT_SCALE`.
 * - **The d4's triangle faces** are the same shape as the d20/d8, but the d4 prints THREE small
 *   glyphs, one per corner, rather than one centered glyph ({@link drawCornerAtlas}). Each corner
 *   region is roughly a third of the face, so 0.22 sits well under the single-glyph 0.36.
 */
const DEFAULT_FONT_SCALE = 0.62;
const D20_FONT_SCALE = 0.36;
const D8_FONT_SCALE = D20_FONT_SCALE; // same equilateral-triangle-in-square-cell geometry as the d20
const D12_FONT_SCALE = 0.48;
// dice: lancer-vtt reused D12_FONT_SCALE here, which read too big on a kite face
const D10_FONT_SCALE = 0.3;
const D4_FONT_SCALE = 0.22; // three corner glyphs share one triangular cell — well under the single-glyph triangle scale
const FONT_SCALE_BY_SIDES: Readonly<Record<number, number>> = { 20: D20_FONT_SCALE, 8: D8_FONT_SCALE, 12: D12_FONT_SCALE, 10: D10_FONT_SCALE, 4: D4_FONT_SCALE };

/** Exported only for {@link ./numeralFontScale.test} — the rest of this module needs
 * `document`/canvas and so cannot run in the headless `bun:test` harness (see file header),
 * but this lookup is plain arithmetic and is worth proving headlessly on its own. */
export function fontScaleFor(sides: number): number {
  return FONT_SCALE_BY_SIDES[sides] ?? DEFAULT_FONT_SCALE;
}

function drawAtlas(layout: NumeralLayout, sides: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = layout.cols * CELL_PX;
  canvas.height = layout.rows * CELL_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("numeralTexture: 2D canvas context unavailable");
  ctx.fillStyle = ATLAS_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = ATLAS_INK;
  ctx.font = `bold ${Math.round(CELL_PX * fontScaleFor(sides))}px ui-monospace, "JetBrains Mono", SFMono-Regular, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < layout.values.length; i++) {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    ctx.fillText(String(layout.values[i]), col * CELL_PX + CELL_PX / 2, row * CELL_PX + CELL_PX / 2 + 1);
  }
  return canvas;
}

type AtlasEntry = { texture: THREE.CanvasTexture; layout: CellLayout };

/** One atlas per die shape — shapes are closed/static, so a single shared texture serves every throw and every `DiceStage` instance; never disposed by `DiceStage.dispose()` (material disposal doesn't cascade to `map` textures — deliberate, so the cache survives a stage teardown). */
const atlasCache = new Map<number, AtlasEntry>();

/** The (cached) numeral atlas texture + layout for a die shape. Branches on {@link
 * isCornerAnchored} (the d4 today) to pick the corner-anchored cell assignment + drawer over the
 * one-glyph-per-face scheme — `DiceStage.buildMesh` stays unaware of the distinction, it just
 * consumes whichever `layout` comes back via `buildFlatUVs` (polymorphic over `CellLayout`,
 * see `faceNumerals.ts`). */
export function numeralAtlasFor(geometry: DieGeometry): AtlasEntry {
  const cached = atlasCache.get(geometry.sides);
  if (cached) return cached;
  const layout: CellLayout = isCornerAnchored(geometry) ? buildCornerLayout(geometry) : buildNumeralLayout(geometry);
  const canvas = isCornerAnchored(geometry)
    ? drawCornerAtlas(geometry, layout as CornerLayout)
    : drawAtlas(layout as NumeralLayout, geometry.sides);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; // faceNumerals.vertexUV's v-mapping assumes canvas-row-0 = v=0 (no flip)
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; // crisp glyphs, no mipmap bleed across atlas cells
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const entry: AtlasEntry = { texture, layout };
  atlasCache.set(geometry.sides, entry);
  return entry;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The d4's corner-anchored atlas: one cell per FACE ({@link ./faceNumerals}'s `CornerLayout`),
 * each cell printing THREE small corner glyphs — one at each of the face's three vertices —
 * instead of one centered glyph. This is the caltrop's "read at the apex" convention: whichever
 * vertex lands up, all three faces meeting it show the same value at their shared corner, so each
 * glyph sits near its own vertex, oriented with its top pointing outward toward it —
 * {@link cornerOutwardDirection}, the exact same pure function `faceNumerals.test.ts` proves
 * headlessly. This is the one place that orientation contract has to hold up *visually*, since
 * the canvas draw itself can't run under `bun:test` (see this file's header).
 *
 * Kept as its own function rather than a branch inside {@link drawAtlas}: the per-value atlas
 * loop draws one centered glyph per cell from `layout.values`, which a `CornerLayout` doesn't
 * have (values here are per-vertex, not per-cell) — forking the draw loop is cleaner than
 * threading an extra optional-values case through the existing one.
 */
function drawCornerAtlas(geometry: DieGeometry, layout: CornerLayout): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = layout.cols * CELL_PX;
  canvas.height = layout.rows * CELL_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("numeralTexture: 2D canvas context unavailable");
  ctx.fillStyle = ATLAS_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = ATLAS_INK;
  ctx.font = `bold ${Math.round(CELL_PX * fontScaleFor(geometry.sides))}px ui-monospace, "JetBrains Mono", SFMono-Regular, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // How far from the cell center toward each vertex's projected corner to place its glyph —
  // pulled in from the true corner (1.0) so the glyph doesn't clip the cell edge or crowd its
  // two siblings. Not headlessly provable (no canvas) — a human eyeball call, like the font
  // scales above.
  const PLACEMENT = 0.55;
  for (let f = 0; f < geometry.faces.length; f++) {
    const cell = layout.cellForFace[f]!;
    const col = cell % layout.cols;
    const row = Math.floor(cell / layout.cols);
    const cx = col * CELL_PX + CELL_PX / 2;
    const cy = row * CELL_PX + CELL_PX / 2;
    const { uAxis, vAxis } = faceTangentAxes(geometry, f);
    for (const vertexIdx of geometry.faces[f]!) {
      const outward = cornerOutwardDirection(geometry, f, vertexIdx);
      const du = dot(outward, uAxis);
      const dv = dot(outward, vAxis);
      // Canvas rotate(θ) is clockwise in a y-down space: a glyph's default "up" (local (0,-1))
      // lands at screen (sinθ, -cosθ) after rotating by θ. We want that direction to be (du, -dv)
      // — the vAxis→canvas-y mapping is inverted the same way vertexUV's `v` is (see its doc
      // comment: "+vAxis samples toward the top") — so sinθ = du, cosθ = dv ⇒ θ = atan2(du, dv).
      const angle = Math.atan2(du, dv);
      const px = cx + du * (CELL_PX / 2) * PLACEMENT;
      const py = cy - dv * (CELL_PX / 2) * PLACEMENT;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillText(String(cornerValue(geometry, vertexIdx)), 0, 1);
      ctx.restore();
    }
  }
  return canvas;
}
