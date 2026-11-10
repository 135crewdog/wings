// Where a model can touch the ground: its three wheels, gear down, and the
// corners of its airframe, gear up. In feet from the centre of gravity (the
// model's origin), in the simulation's body axes: [forward, right, down].
// The airplane's card carries these numbers; tests/model.test.js checks the
// card against the model, so the sim's wheels are where the model's are.

import { worldMatrices, verticesUnder, bounds, poseAt } from './glb.mjs';

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
  const root = json.scenes[json.scene ?? 0].nodes[0];
  const down = worldMatrices(json, poseAt(glb, 'gear', 1)), up = worldMatrices(json, poseAt(glb, 'gear', 0));
  // A wheel touches at the bottom of its tyre, under its middle.
  const wheel = (name) => {
    const box = bounds(verticesUnder(glb, named(name), down));
    return body([(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2]);
  };
  const skin = verticesUnder(glb, root, up);
  const pick = (points, better) => points.reduce((a, p) => (better(p, a) ? p : a));
  const z = bounds(skin), length = z.max[2] - z.min[2];
  const stretch = (from, to) => skin.filter((p) => p[2] >= z.min[2] + from * length && p[2] <= z.min[2] + to * length);
  const lowest = (points) => { const p = pick(points, (q, a) => q[1] < a[1]); return [0, p[1], p[2]]; };   // on the centreline
  return {
    wheels: { nose: wheel('wheel_nose'), left: wheel('wheel_left'), right: wheel('wheel_right') },
    airframe: {
      nose: body(pick(skin, (p, a) => p[2] < a[2])),          // the tip of the nose
      belly: body(lowest(stretch(0.3, 0.7))),                 // the lowest point of the middle
      tail: body(lowest(stretch(0.8, 1))),                    // the lowest point of the last fifth
      wingtip: body(pick(skin, (p, a) => p[0] > a[0])),       // the right one; the left is its mirror image
    },
  };
}
