/**
 * The plain, hand-drawn explosion style, for hosts like Excalidraw: ink lines with a pen's wobble
 * and one accent color. No glow, no flash. A scribbled circle rings the die that exploded (and
 * stays, like an annotation), cartoon action lines pop out of it, and a handful of little
 * outlined shapes go flying.
 */

export type SketchPalette = { ink: string; accent: string };

/** A hand-drawn circle around a die, in world (x, z) so it stays put on resize. */
type Scribble = { x: number; z: number; progress: number; alpha: number; wobble: number[]; start: number };
/** One "pow" action line, radiating from a burst. */
type Pow = { x: number; y: number; angle: number; r0: number; r1: number; t: number; max: number };
/** An outlined shape thrown out of a burst. */
type Shard = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; t: number; max: number; size: number; shape: 0 | 1 | 2; color: string };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const WOBBLE_POINTS = 14;

export class SketchFx {
  private scribbles: Scribble[] = [];
  private pows: Pow[] = [];
  private shards: Shard[] = [];

  get busy() {
    return this.pows.length > 0 || this.shards.length > 0;
  }

  get hasMarks() {
    return this.scribbles.length > 0;
  }

  /** Start a scribbled circle around (x, z); the caller animates its `progress` from 0 to 1. */
  circle(x: number, z: number): Scribble {
    const s: Scribble = {
      x,
      z,
      progress: 0,
      alpha: 1,
      wobble: Array.from({ length: WOBBLE_POINTS * 2 }, () => rand(-1, 1)),
      start: Math.random() * Math.PI * 2,
    };
    this.scribbles.push(s);
    return s;
  }

  /** Pop action lines and throw shapes out of screen point (sx, sy). `unit` is a die radius in px. */
  burst(sx: number, sy: number, unit: number, dpr: number, colors: string[]) {
    const lines = 9;
    const turn = Math.random() * Math.PI;
    for (let i = 0; i < lines; i++) {
      this.pows.push({
        x: sx,
        y: sy,
        angle: turn + (i / lines) * Math.PI * 2 + rand(-0.15, 0.15),
        r0: unit * rand(1.25, 1.45),
        r1: unit * rand(2.2, 2.9),
        t: 0,
        max: rand(280, 380),
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = unit * rand(0.08, 0.16);
      this.shards.push({
        x: sx + Math.cos(a) * unit,
        y: sy + Math.sin(a) * unit,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - unit * 0.06,
        rot: Math.random() * Math.PI,
        vr: rand(-0.2, 0.2),
        t: 0,
        max: rand(650, 950),
        size: rand(3, 6) * dpr,
        shape: Math.floor(Math.random() * 3) as 0 | 1 | 2,
        color: colors[Math.floor(Math.random() * colors.length)]!,
      });
    }
  }

  update(dt: number, dpr: number) {
    for (const p of this.pows) p.t += dt;
    this.pows = this.pows.filter((p) => p.t < p.max);
    for (const s of this.shards) {
      s.t += dt;
      const k = dt / 16;
      s.x += s.vx * k;
      s.y += s.vy * k;
      s.vy += 0.35 * dpr * k; // a little gravity, down the screen
      s.vx *= 0.97;
      s.rot += s.vr * k;
    }
    this.shards = this.shards.filter((s) => s.t < s.max);
  }

  /** Fade the scribbled circles (for clearing the table). */
  fade(alpha: number) {
    for (const s of this.scribbles) s.alpha = Math.min(s.alpha, alpha);
  }

  clearMarks() {
    this.scribbles = [];
  }

  draw(ctx: CanvasRenderingContext2D, toScreen: (x: number, z: number) => [number, number], unit: number, dpr: number, palette: SketchPalette) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const s of this.scribbles) {
      if (s.progress <= 0 || s.alpha <= 0) continue;
      const [x, y] = toScreen(s.x, s.z);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2 * dpr;
      // two passes, slightly different, the way a pen goes round twice
      for (const pass of [0, 1]) {
        ctx.globalAlpha = s.alpha * (pass ? 0.55 : 1);
        this.wobblyArc(ctx, x, y, unit * (1.55 + pass * 0.07), s, pass, s.progress * (pass ? 0.92 : 1.08));
      }
    }

    ctx.strokeStyle = palette.ink;
    for (const p of this.pows) {
      const t = p.t / p.max;
      const out = easeOut(t);
      // each line shoots outward and shrinks to nothing at its far end
      const a = p.r0 + (p.r1 - p.r0) * out * 0.6;
      const b = p.r0 + (p.r1 - p.r0) * Math.min(1, out * 1.3);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.4 * dpr * (1 - t * 0.7);
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(p.angle) * a, p.y + Math.sin(p.angle) * a);
      ctx.lineTo(p.x + Math.cos(p.angle) * b, p.y + Math.sin(p.angle) * b);
      ctx.stroke();
    }

    ctx.lineWidth = 1.6 * dpr;
    for (const s of this.shards) {
      ctx.globalAlpha = 1 - (s.t / s.max) ** 2;
      ctx.strokeStyle = s.color;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
      if (s.shape === 0) ctx.arc(0, 0, s.size, 0, Math.PI * 2);
      else if (s.shape === 1) ctx.rect(-s.size, -s.size, s.size * 2, s.size * 2);
      else {
        ctx.moveTo(0, -s.size * 1.2);
        ctx.lineTo(s.size * 1.1, s.size * 0.8);
        ctx.lineTo(-s.size * 1.1, s.size * 0.8);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** A pen-like circle: radius wobbles a little, and it overshoots its start when complete. */
  private wobblyArc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s: Scribble, pass: number, sweep: number) {
    const steps = 48;
    const end = Math.max(0, sweep) * Math.PI * 2;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * end;
      const f = (a / (Math.PI * 2)) * WOBBLE_POINTS;
      const k = Math.floor(f);
      const w0 = s.wobble[(k + pass * WOBBLE_POINTS) % s.wobble.length]!;
      const w1 = s.wobble[(k + 1 + pass * WOBBLE_POINTS) % s.wobble.length]!;
      const wob = w0 + (w1 - w0) * (f - k);
      // a slight spiral, so the overshoot lands just outside the start
      const rr = r * (1 + wob * 0.04 + (a / (Math.PI * 2)) * 0.05);
      const px = x + Math.cos(s.start + a) * rr;
      const py = y + Math.sin(s.start + a) * rr * 0.92;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
}
