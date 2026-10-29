/**
 * The cannon-es "table" — a ground plane plus four containment walls so a tumbling die can
 * never escape. The world is framework-free (cannon-es only, no three, no DOM), so the headless
 * harness builds the exact same table the browser does and steps thousands of throws on it.
 *
 * World layout: the table is the `XZ` plane at `y = 0` with normal `+Y` (up). The top-down
 * camera looks straight down `-Y`, so world `X`→screen-x and world `Z`→screen-y. `bounds`
 * are the **visible** half-extents (the camera frustum, browser-derived from the aspect
 * ratio); the walls sit {@link WALL_INSET} *inside* the visible edge. That inset is
 * deliberate: a die's whole body (circumradius ≈ the inset) settles fully **on screen** —
 * the wall stops the die's surface at `visibleHalf - WALL_INSET`, so no die ever comes to
 * rest in an off-screen band. (Walls placed *outboard* of the visible edge leave a margin where
 * a decelerating die can settle invisibly.) The product path bakes a correction into every die's
 * shown orientation from frame zero ({@link ../bakedCorrection}), so a die resting tilted against
 * a wall still reads correctly — containment, not corner-avoidance, is what the walls buy.
 *
 * The walls track the live bounds: {@link positionWalls} repositions them on every resize so
 * they always hug the current frustum (the planes' orientations are fixed; only position
 * moves).
 */
import * as CANNON from "cannon-es";
import type { ThrowBounds } from "./diceBody";

/**
 * How far **inside** the visible edge the containment walls sit. Set to the die circumradius
 * so a die whose surface is stopped at the wall keeps its whole body within the frustum.
 */
export const WALL_INSET = 1.5;

export type DiceWorld = {
  world: CANNON.World;
  diceMaterial: CANNON.Material;
  /** The four containment walls in order: [right(+X), left(-X), near(+Z), far(-Z)]. */
  walls: CANNON.Body[];
  bounds: ThrowBounds;
};

/** Reposition the four containment walls to hug the (possibly resized) visible bounds. */
export function positionWalls(walls: CANNON.Body[], bounds: ThrowBounds): void {
  const hw = bounds.halfWidth - WALL_INSET;
  const hd = bounds.halfDepth - WALL_INSET;
  walls[0]!.position.set(hw, 0, 0); // right → normal -X
  walls[1]!.position.set(-hw, 0, 0); // left → normal +X
  walls[2]!.position.set(0, 0, hd); // near (+Z) → normal -Z
  walls[3]!.position.set(0, 0, -hd); // far (-Z) → normal +Z
}

/** Build the physics world (gravity, table, containment walls) for the given visible bounds. */
export function createDiceWorld(bounds: ThrowBounds): DiceWorld {
  // Gravity is a **tumble-length** dial as much as a physics one. At -64, paired with the body
  // damping in `createDieBody`, a throw's median settle is ~113 recorded frames; at -32 it is
  // ~180, and ~1-3% of colliding pools micro-wobble past the sim budget and get force-truncated.
  // Measured over 600 throws across six pool shapes. Pushing gravity further (96-128) shaves less
  // than it costs: the stragglers come back and cannon starts leaving dice leaning on each other.
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -42, 0) });
  // Cannon sleep stays OFF (see createDieBody): a die must be free to tip off an edge onto
  // a face rather than be frozen mid-tilt. Settle is decided by the at-rest+flat detector.
  world.allowSleep = false;

  const dice = new CANNON.Material("dice");
  const floor = new CANNON.Material("floor");
  const wall = new CANNON.Material("wall");
  // Floor: grippy + nearly inelastic so a die bleeds energy and settles FLAT onto a face.
  world.addContactMaterial(new CANNON.ContactMaterial(dice, floor, { friction: 0.45, restitution: 0.3 }));
  // Walls: low-friction so a die can't grip and climb/lean, light restitution so it deflects
  // back toward the centre — they catch a die at the visible edge and turn it inward.
  world.addContactMaterial(new CANNON.ContactMaterial(dice, wall, { friction: 0.1, restitution: 0.45 }));

  // Ground plane: cannon's Plane normal is +Z by default; rotate -90° about X so it faces +Y.
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: floor });
  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(ground);

  // Four containment walls, each an infinite plane whose normal points inward. A cannon
  // Plane's local normal is +Z; we rotate it about Y so each wall faces back into the arena.
  // Orientation is fixed at construction; position is set by positionWalls (per resize).
  const makeWall = (angle: number): CANNON.Body => {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: wall });
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
    world.addBody(body);
    return body;
  };
  const walls = [
    makeWall(-Math.PI / 2), // right → normal -X
    makeWall(Math.PI / 2), // left → normal +X
    makeWall(Math.PI), // near (+Z) → normal -Z
    makeWall(0), // far (-Z) → normal +Z
  ];
  positionWalls(walls, bounds);

  return { world, diceMaterial: dice, walls, bounds };
}
