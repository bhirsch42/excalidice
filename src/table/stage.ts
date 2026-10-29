import * as THREE from "three";
import { recordThrowBatch, shownQuatAt, type RecordedDie } from "./engine/bakedCorrection";
import { geometryForSides, type DieGeometry } from "./engine/dieGeometry";
import type { ThrowBounds } from "./engine/diceBody";
import { buildFlatUVs } from "./engine/faceNumerals";
import { SketchFx, type SketchPalette } from "./sketch";
import { numeralAtlasFor } from "./engine/numeralTexture";

/** Die circumradius in world units; must match what the physics pre-roll is given. */
const RADIUS = 1.5;
const RECORD_FPS = 60;
/** Recorded frames played per 1/60s of real time. */
const PLAYBACK_RATE = 1.5;
const CHARGE_MS = 650;

export type DieChain = { sides: number; chain: number[] };
export type StageRoll = { color: string; dice: DieChain[] };

/** Dice the table has a 3D model for. Others are left off the table (the log still shows them). */
export const TABLE_SIDES: ReadonlySet<number> = new Set([3, 4, 6, 8, 10, 12, 20]);

export type TableOptions = {
  /** Bigger = smaller dice. World half-extent mapped to half the container's shorter side. Default 11. */
  viewHalfMin?: number;
  /** How dark the dice shadows are, 0–1. Default 0.38. */
  shadowOpacity?: number;
  /** Colors for the explosions; read on every frame, so it can follow a theme switch. */
  palette?: () => SketchPalette;
  /** Called as each roll starts, once the previous roll's dice are off the table. */
  onThrow?: () => void;
};

type Live = {
  sides: number;
  rec: RecordedDie;
  mesh: THREE.Group;
  solid: THREE.MeshStandardMaterial;
  edges: THREE.LineBasicMaterial;
  frame: number;
  done: boolean;
  /** A clone leaping out of an exploded die: it starts inside that die and grows to full size. */
  emerge?: readonly [number, number, number];
};

type Tween = { start: number; ms: number; fn: (t: number) => void; resolve: () => void };
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Recorded frames a clone takes to grow out of its parent die. */
const EMERGE_FRAMES = 14;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TableStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly light: THREE.DirectionalLight;
  private readonly shadows: THREE.ShadowMaterial;
  private readonly fx: CanvasRenderingContext2D;
  private bounds: ThrowBounds = { halfWidth: 11, halfDepth: 11 };
  private w = 1;
  private h = 1;
  private dpr = 1;

  private dice: Live[] = [];
  private tweens: Tween[] = [];
  private waveDone: (() => void) | null = null;

  private raf = 0;
  private last = 0;
  private frameAccum = 0;
  private queue: { roll: StageRoll; resolve: () => void }[] = [];
  private playing = false;
  private readonly viewHalfMin: number;
  private readonly palette: () => SketchPalette;
  private readonly onThrow?: () => void;
  private readonly sketch = new SketchFx();
  private readonly observer: ResizeObserver;
  private readonly canvases: HTMLCanvasElement[];

  /**
   * Fill `container` (which must be positioned) with the table's two canvases: WebGL dice
   * underneath, 2D hand-drawn effects on top. Both are transparent and ignore the pointer.
   */
  constructor(
    private readonly container: HTMLElement,
    options: TableOptions = {},
  ) {
    this.viewHalfMin = options.viewHalfMin ?? 11;
    this.palette = options.palette ?? (() => ({ ink: "#1e1e1e", accent: "#6965db" }));
    this.onThrow = options.onThrow;
    const [canvas3d, canvasFx] = (this.canvases = [0, 1].map(() => {
      const c = document.createElement("canvas");
      Object.assign(c.style, { position: "absolute", inset: "0", pointerEvents: "none" });
      container.append(c);
      return c;
    })) as [HTMLCanvasElement, HTMLCanvasElement];
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas3d, alpha: true, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.fx = canvasFx.getContext("2d")!;

    this.scene.add(new THREE.AmbientLight(0xfff3e0, 0.55));
    this.scene.add(new THREE.HemisphereLight(0xbfa8ff, 0x2a1a10, 0.35));
    this.light = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.light.position.set(-8, 30, -10);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.radius = 6;
    this.scene.add(this.light);

    this.shadows = new THREE.ShadowMaterial({ opacity: options.shadowOpacity ?? 0.38 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.shadows);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.camera.position.set(0, 40, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  /** Remove the canvases and free the GPU. */
  destroy() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    for (const d of this.dice) this.release(d);
    this.renderer.dispose();
    for (const c of this.canvases) c.remove();
  }

  /**
   * Animate a roll; resolves when its dice have landed and every explosion has played. Rolls
   * play one at a time; if they pile up, the oldest waiting ones are skipped (resolved at once),
   * and nothing animates while the page is hidden.
   */
  show(roll: StageRoll): Promise<void> {
    // a hidden page gets no animation frames, so its rolls would pile up unseen
    if (document.visibilityState === "hidden") return Promise.resolve();
    return new Promise((resolve) => {
      this.queue.push({ roll, resolve });
      for (const skipped of this.queue.splice(0, Math.max(0, this.queue.length - 2))) skipped.resolve();
      if (!this.playing) void this.drain();
    });
  }

  /** Fade the dice and scribbled circles off the table (waits for any roll in progress first). */
  async clear() {
    while (this.playing) await sleep(100);
    await this.clearTable();
  }

  private async drain() {
    this.playing = true;
    while (this.queue.length) {
      const { roll, resolve } = this.queue.shift()!;
      try {
        await this.play({ ...roll, dice: roll.dice.filter((d) => TABLE_SIDES.has(d.sides)) });
      } finally {
        resolve();
      }
    }
    this.playing = false;
  }

  private async play(roll: StageRoll) {
    await this.clearTable();
    this.onThrow?.();
    const color = new THREE.Color(roll.color);
    // wave k throws the k-th link of every chain that reached it; links after the first are
    // clones leaping out of the die that exploded
    let wave: { i: number; parent?: Live }[] = roll.dice.map((_, i) => ({ i }));
    for (let k = 0; wave.length; k++) {
      const obstacles = this.dice.map((d) => ({ sides: d.sides, pos: d.rec.buffer.at(-1)!.pos, quat: shownQuatAt(d.rec, d.rec.buffer.length - 1) }));
      const thrown = await this.throwWave(
        wave.map((w) => {
          const p = w.parent?.rec.buffer.at(-1)!.pos;
          return { sides: roll.dice[w.i]!.sides, target: roll.dice[w.i]!.chain[k]!, from: p && ([p[0], p[2]] as [number, number]), emerge: p };
        }),
        obstacles,
        color,
      );
      const exploding = wave.map((w, j) => ({ i: w.i, die: thrown[j]! })).filter((w) => roll.dice[w.i]!.chain.length > k + 1);
      if (!exploding.length) break;
      await sleep(200);
      await Promise.all(exploding.map((e, n) => sleep(n * 90).then(() => this.explode(e.die))));
      wave = exploding.map((e) => ({ i: e.i, parent: e.die }));
    }
  }

  private async clearTable() {
    if (!this.dice.length && !this.sketch.hasMarks) return;
    const dice = this.dice;
    // Shadows ignore a die's opacity, so fade the shadow-catching floor alongside the dice.
    const shadowOpacity = this.shadows.opacity;
    await this.tween(250, (t) => {
      for (const d of dice) this.setOpacity(d, 1 - t);
      this.shadows.opacity = shadowOpacity * (1 - t);
      this.sketch.fade(1 - t);
    });
    this.sketch.clearMarks();
    for (const d of dice) this.release(d);
    this.dice = this.dice.filter((d) => !dice.includes(d));
    this.shadows.opacity = shadowOpacity;
    // redraw the now-empty table; otherwise the last faded frame, shadows and all, stays up
    this.kick();
  }

  private throwWave(
    specs: { sides: number; target: number; from?: [number, number]; emerge?: readonly [number, number, number] }[],
    obstacles: Parameters<typeof recordThrowBatch>[1]["obstacles"],
    color: THREE.Color,
  ): Promise<Live[]> {
    const recorded = recordThrowBatch(specs, { bounds: this.bounds, radius: RADIUS, obstacles });
    const live = recorded.map((rec, i) => {
      const d = this.buildDie(rec.geometry, color);
      const die: Live = { sides: specs[i]!.sides, rec, ...d, frame: 0, done: false, emerge: specs[i]!.emerge };
      this.scene.add(die.mesh);
      this.syncMesh(die);
      this.dice.push(die);
      return die;
    });
    return new Promise((resolve) => {
      this.waveDone = () => resolve(live);
      this.kick();
    });
  }

  /**
   * Explode a die, in Excalidraw's plain style: it jitters while a circle is scribbled round it,
   * then action lines pop and little outlined shapes fly. The die stays where it is, and the
   * circle stays round it, marking it as exploded; the caller throws its clone out of it.
   */
  private async explode(die: Live) {
    const [x, y, z] = die.rec.buffer.at(-1)!.pos;
    const ring = this.sketch.circle(x, z);
    await this.tween(CHARGE_MS * 0.75, (t) => {
      ring.progress = easeOut(t);
      const shake = 0.12 * t;
      die.mesh.position.set(x + Math.sin(t * 70) * shake, y, z + Math.cos(t * 55) * shake);
    });
    die.mesh.position.set(x, y, z);
    const [sx, sy] = this.toScreen(x, z);
    const { ink, accent } = this.palette();
    this.sketch.burst(sx, sy, this.unitPx(), this.dpr, [ink, accent, `#${die.solid.color.getHexString()}`]);
    void this.tween(420, (t) => die.mesh.scale.setScalar(1 + 0.22 * Math.sin(Math.min(t * 2.2, 1) * Math.PI) * (1 - t)));
  }

  private buildDie(die: DieGeometry, color: THREE.Color) {
    const positions: number[] = [];
    for (const face of die.faces) {
      for (let k = 1; k < face.length - 1; k++) {
        for (const idx of [face[0]!, face[k]!, face[k + 1]!]) {
          const v = die.vertices[idx]!;
          positions.push(v[0] * RADIUS, v[1] * RADIUS, v[2] * RADIUS);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const { texture, layout } = numeralAtlasFor(die);
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buildFlatUVs(die, layout), 2));
    geometry.computeVertexNormals();

    const mesh = new THREE.Group();
    const solid = new THREE.MeshStandardMaterial({
      color,
      map: texture,
      metalness: 0.15,
      roughness: 0.35,
      flatShading: true,
      transparent: true,
    });
    const body = new THREE.Mesh(geometry, solid);
    body.castShadow = true;
    mesh.add(body);
    const edges = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.35), transparent: true });
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edges));
    return { mesh, solid, edges };
  }

  private setOpacity(d: Live, o: number) {
    d.solid.opacity = o;
    d.edges.opacity = o;
  }

  private syncMesh(d: Live) {
    const f = d.rec.buffer[d.frame]!;
    const q = shownQuatAt(d.rec, d.frame);
    d.mesh.position.set(f.pos[0], f.pos[1], f.pos[2]);
    d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    if (d.emerge && d.frame < EMERGE_FRAMES) {
      const t = easeOut(d.frame / EMERGE_FRAMES);
      const [ex, ey, ez] = d.emerge;
      d.mesh.position.set(ex + (f.pos[0] - ex) * t, ey + (f.pos[1] - ey) * t, ez + (f.pos[2] - ez) * t);
      d.mesh.scale.setScalar(0.35 + 0.65 * t);
    } else if (d.emerge) d.mesh.scale.setScalar(1);
  }

  private release(d: Live) {
    this.scene.remove(d.mesh);
    d.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  private tween(ms: number, fn: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), ms, fn, resolve });
      this.kick();
    });
  }

  private kick() {
    if (this.raf) return;
    this.last = performance.now();
    this.frameAccum = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    // rAF's timestamp can predate the performance.now() that kick() stored
    const dt = Math.max(0, Math.min(now - this.last, 1000 / 30));
    this.last = now;

    this.frameAccum += (dt / 1000) * RECORD_FPS * PLAYBACK_RATE;
    const steps = Math.floor(this.frameAccum);
    this.frameAccum -= steps;
    const moving = this.dice.filter((d) => !d.done);
    for (const d of moving) {
      d.frame = Math.min(d.frame + steps, d.rec.buffer.length - 1);
      d.done = d.frame === d.rec.buffer.length - 1;
      this.syncMesh(d);
    }
    if (moving.length && this.dice.every((d) => d.done) && this.waveDone) {
      const done = this.waveDone;
      this.waveDone = null;
      done();
    }

    for (const tw of [...this.tweens]) {
      const t = Math.min((now - tw.start) / tw.ms, 1);
      tw.fn(t);
      if (t >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.resolve();
      }
    }

    this.sketch.update(dt, this.dpr);

    this.renderer.render(this.scene, this.camera);
    this.drawFx();

    const busy = moving.length || this.tweens.length || this.sketch.busy;
    this.raf = busy ? requestAnimationFrame(this.tick) : 0;
  };

  private drawFx() {
    const ctx = this.fx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.sketch.draw(ctx, (x, z) => this.toScreen(x, z), this.unitPx(), this.dpr, this.palette());
  }

  /** World (x, z) on the table → fx-canvas pixels. The camera looks down -Y with screen-up = -Z. */
  private toScreen(x: number, z: number): [number, number] {
    const { halfWidth, halfDepth } = this.bounds;
    return [((x + halfWidth) / (2 * halfWidth)) * this.w * this.dpr, ((z + halfDepth) / (2 * halfDepth)) * this.h * this.dpr];
  }

  /** One die radius in fx-canvas pixels. */
  private unitPx() {
    return (RADIUS / (2 * this.bounds.halfWidth)) * this.w * this.dpr;
  }

  private resize() {
    this.w = Math.max(1, this.container.clientWidth);
    this.h = Math.max(1, this.container.clientHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aspect = this.w / this.h;
    this.bounds =
      aspect >= 1
        ? { halfDepth: this.viewHalfMin, halfWidth: this.viewHalfMin * aspect }
        : { halfWidth: this.viewHalfMin, halfDepth: this.viewHalfMin / aspect };
    const { halfWidth, halfDepth } = this.bounds;
    Object.assign(this.camera, { left: -halfWidth, right: halfWidth, top: halfDepth, bottom: -halfDepth });
    this.camera.updateProjectionMatrix();
    const sc = this.light.shadow.camera;
    Object.assign(sc, { left: -halfWidth - 5, right: halfWidth + 5, top: halfDepth + 5, bottom: -halfDepth - 5, near: 1, far: 80 });
    sc.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, true);
    this.fx.canvas.width = this.w * this.dpr;
    this.fx.canvas.height = this.h * this.dpr;
    this.fx.canvas.style.width = `${this.w}px`;
    this.fx.canvas.style.height = `${this.h}px`;
    this.renderer.render(this.scene, this.camera);
    this.drawFx();
  }

  /** Compile shaders before the first roll so it doesn't stutter. */
  warmup() {
    const d = this.buildDie(geometryForSides(20), new THREE.Color("#888"));
    this.scene.add(d.mesh);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(d.mesh);
  }
}
