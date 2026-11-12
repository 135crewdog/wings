// Where a model can touch the ground: its three wheels, the points of its
// airframe that reach the ground first with the gear up, and whatever else
// hangs lowest with the gear down, at any attitude it might arrive in. In feet from the centre of gravity (the
// model's origin), in the simulation's body axes: [forward, right, down].
// The airplane's card carries these numbers; tests/model.test.js checks the
// card against the model, so the sim's wheels are where the model's are.

import { readGlb, worldMatrices, verticesUnder, bounds, poseOf } from './glb.mjs';

const FT = 0.3048;
// Model axes are nose -Z, right +X, up +Y; body axes are x forward, y right, z down.
const body = ([x, y, z]) => [-z, x, -y].map((v) => Math.round((v / FT) * 100) / 100);

export function contactPoints(glb) {
  const { json } = glb;
  const named = (name) => {
    const index = json.nodes.findIndex((n) => n.name === name);
    if (index < 0) throw new Error(`the model has no part named ${name}`);
    return index;
  };
  const roots = json.scenes[json.scene ?? 0].nodes;
  const all = (world) => roots.flatMap((root) => verticesUnder(glb, root, world));
  // Controls centred and flaps up, with the gear down and then up.
  const down = worldMatrices(json, poseOf(glb, { gear: 1 })), up = worldMatrices(json, poseOf(glb, { gear: 0 }));
  // A wheel touches along the bottom of its tyre: under its middle, and as
  // wide as the tyre (or the pair of tyres) is.
  const wheel = (name) => {
    const box = bounds(verticesUnder(glb, named(name), down));
    return { at: [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2], width: box.max[0] - box.min[0] };
  };
  const measured = { nose: wheel('wheel_nose'), left: wheel('wheel_left'), right: wheel('wheel_right') };
  const wheels = {}, tyres = {}, corners = [];
  for (const [name, w] of Object.entries(measured)) {
    wheels[name] = body(w.at);
    tyres[name] = Math.round((w.width / FT) * 100) / 100;
    for (const side of [-1, 1]) corners.push([-w.at[2], w.at[0] + (side * w.width) / 2, -w.at[1]]);
  }
  const airframe = firstToTouch(all(up));
  // With the gear down, legs and doors hang below the airframe too: whatever
  // touches first then, that the tyres and the airframe points don't already cover.
  const known = [...airframe, ...corners];
  const gear = firstToTouch(all(down), known).filter((p) => !known.includes(p));
  return { wheels, tyres, airframe: airframe.map(feet), gear: gear.map(feet) };
}

const feet = (p) => p.map((v) => Math.round((v / FT) * 100) / 100);
const DEG = Math.PI / 180;

/** How far below the centre of gravity a body-axes point hangs with the airplane pitched and rolled (radians). */
export const depth = ([x, y, z], pitch, roll) => -Math.sin(pitch) * x + Math.cos(pitch) * (Math.sin(roll) * y + Math.cos(roll) * z);

// The attitudes an airplane might meet the ground in: nose 10 degrees down to
// 20 up, 30 degrees of bank either way.
export const ARRIVALS = [];
for (let pitch = -10; pitch <= 20; pitch += 2.5) for (let roll = -30; roll <= 30; roll += 5) ARRIVALS.push([pitch * DEG, roll * DEG]);

/**
 * The airframe's contact points, in metres in body axes: for each arrival
 * attitude, the point of the skin that hangs lowest. Points within 30 cm
 * of one already chosen (or already `known`) are the same corner; the set is
 * the same both sides.
 */
const RADIUS = 0.3;   // m: points closer together than this are the same corner

export function firstToTouch(skin, known = []) {
  const points = skin.map(([x, y, z]) => [-z, x, -y]);   // model axes to body axes
  const chosen = [...known];
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < RADIUS;
  for (const [pitch, roll] of ARRIVALS) {
    const low = points.reduce((a, p) => (depth(p, pitch, roll) > depth(a, pitch, roll) ? p : a));
    const p = Math.abs(low[1]) < 0.05 ? [low[0], 0, low[2]] : low;
    if (chosen.some((q) => near(p, q))) continue;
    // A point off the centreline always brings its mirror image, even when
    // the two are close together: the airplane banks both ways.
    chosen.push(p);
    if (p[1] !== 0) chosen.push([p[0], -p[1], p[2]]);
  }
  return chosen.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
}

// Run as a tool, it prints a model's contact points, to copy into its card:
//   node models/measure.mjs models/f4c.glb
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log('contact points, feet from the centre of gravity [forward, right, down]:');
  console.log(JSON.stringify(contactPoints(readGlb(process.argv[2])), null, 2));
}
