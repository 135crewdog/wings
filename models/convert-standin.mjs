// Converts the stand-in F-4 to the rules of docs/models.md. A one-off
// developer tool: it goes when the owner's own F-4C replaces the stand-in.
//
//   node models/convert-standin.mjs <the Sketchfab download>.glb
//
// The source is "FREE F-4 Phantom low poly" by Artbor, CC BY 4.0 (see
// models/CREDITS.md). It is already nose along -Z, right wing +X, up +Y, with
// its moving parts separate. This script:
//   - scales it to the real F-4C's length and span, and moves the origin to
//     an estimated centre of gravity;
//   - replaces the author's twelve animations with the five one-second
//     motions the app drives: gear, flaps, elevator, aileron, rudder (the
//     rudder's is new: his has none);
//   - names the tyres wheel_nose, wheel_left and wheel_right.
// It writes models/f4c.glb and prints the contact points for the card.

import { fileURLToPath } from 'node:url';
import { readGlb, writeGlb, readAccessor, worldMatrices, verticesUnder, bounds, poseAt, normalize, slerp, transform } from './glb.mjs';
import { contactPoints } from './measure.mjs';

const LENGTH = 58.2 * 0.3048, SPAN = 38.4 * 0.3048;   // the card's, in metres
const CG_AHEAD_OF_MAINS = 0.6;   // m: the real jet balances a little ahead of its main wheels
const CG_ABOVE_GROUND = 2.0;     // m, on its wheels

const source = process.argv[2];
if (!source) throw new Error('usage: node models/convert-standin.mjs <source.glb>');
const glb = readGlb(source);
const { json } = glb;
// A part by its name without the number the author's tool appended: "left_elevator" finds "left_elevator_5".
const node = (name) => {
  const index = json.nodes.findIndex((n) => new RegExp(`^${name}_\\d+$`).test(n.name ?? ''));
  if (index < 0) throw new Error(`no part named ${name}`);
  return index;
};

// ---- the five motions, from the author's clips ----
// Each of his clips runs a part from one position to another; all that is
// used here is the position each ends (or starts) in.
const rest = (index) => json.nodes[index].rotation ?? [0, 0, 0, 1];
const endOf = (clip, index, t) => poseAt(glb, clip, t)[index].rotation;
const world0 = worldMatrices(json);

// Whether a pose raises a part's trailing edge (its rearmost point) above where it rests.
function raisesTrailingEdge(index, rotation) {
  const rearmost = (world) => verticesUnder(glb, index, world).reduce((a, p) => (p[2] > a[2] ? p : a));
  return rearmost(worldMatrices(json, { [index]: { rotation } }))[1] > rearmost(world0)[1];
}
// The two positions a part is given, sorted into { up, down } by what they do to its trailing edge.
function upAndDown(index, a, b) {
  const aUp = raisesTrailingEdge(index, a);
  if (aUp === raisesTrailingEdge(index, b)) throw new Error(`${json.nodes[index].name}: both positions move the same way`);
  return aUp ? { up: a, down: b } : { up: b, down: a };
}

// How far the real F-4C's surfaces travel, in degrees (docs/models.md). His
// poses go other distances (stabilator 22.5 each way, flaps 45, ailerons
// 22.5, spoilers 67.5), so each is taken for its hinge and direction only.
const TRAVEL = { stabilatorUp: 21, stabilatorDown: 9, flaps: 60, aileronDown: 30, spoilerUp: 45, rudder: 30 };

// From where a part rests toward one of his poses, but only `degrees` of the way round.
function swing(from, toward, degrees) {
  const dot = Math.abs(from.reduce((sum, x, k) => sum + x * toward[k], 0));
  return slerp(from, toward, (degrees * Math.PI) / 180 / (2 * Math.acos(Math.min(1, dot))));
}

const tracks = { gear: [], flaps: [], elevator: [], aileron: [], rudder: [] };
const rotate = (motion, index, keys) => tracks[motion].push({ node: index, path: 'rotation', keys });

// Gear: his "landing_out" is already up to down over one second, doors and all.
{
  const clip = json.animations.find((a) => a.name === 'landing_out');
  for (const channel of clip.channels) {
    const sampler = clip.samplers[channel.sampler];
    const times = readAccessor(glb, sampler.input).map((v) => v[0]), values = readAccessor(glb, sampler.output);
    const keys = times.map((t, i) => [t, values[i]]);
    if (keys[0][0] > 0) keys.unshift([0, keys[0][1]]);
    if (keys.at(-1)[0] < 1) keys.push([1, keys.at(-1)[1]]);
    rotate('gear', channel.target.node, keys);
  }
}
// His wing is thinner than his wheels, so retracted gear shows through its
// upper surface. Shrink each leg to nothing over the last tenth of the way up.
for (const leg of ['front_wheel_suspension', 'back_left_wheel_assembly', 'back_right_wheel_assembly']) {
  tracks.gear.push({ node: node(leg), path: 'scale', keys: [[0, [0.001, 0.001, 0.001]], [0.1, [1, 1, 1]], [1, [1, 1, 1]]] });
}
// Flaps: up is how they rest, down is where "flaps_out" ends.
for (const side of ['left', 'right']) {
  const flap = node(`${side}_2nd_flap`);
  rotate('flaps', flap, [[0, rest(flap)], [1, swing(rest(flap), endOf('flaps_out', flap, 0.5), TRAVEL.flaps)]]);
}
// Elevator: both halves together. 0 s is full forward stick (trailing edge down).
for (const side of ['left', 'right']) {
  const half = node(`${side}_elevator`);
  const { up, down } = upAndDown(half, endOf('elecators_out', half, 0.5), endOf('elecators_in', half, 0.5));
  rotate('elevator', half, [[0, swing(rest(half), down, TRAVEL.stabilatorDown)], [0.5, rest(half)], [1, swing(rest(half), up, TRAVEL.stabilatorUp)]]);
}
// Aileron: 0 s is full left stick. The F-4 rolls the way few fighters do: its
// ailerons only go down, and a spoiler on top of the other wing comes up. So
// for a left roll the right aileron goes down and the left spoiler rises,
// while the left aileron stays where it is. His clips move both ailerons the
// same way, up and down, and the right one's keys run backward; all that is
// taken from them is each aileron's down position.
{
  const left = node('left_1st_flap'), right = node('right_1st_flap');
  const l = upAndDown(left, endOf('ailerons_out', left, 0.5), endOf('ailerons_in', left, 0.5));
  const r = upAndDown(right, endOf('ailerons_out', right, 0), endOf('ailerons_in', right, 0));
  rotate('aileron', left, [[0, rest(left)], [0.5, rest(left)], [1, swing(rest(left), l.down, TRAVEL.aileronDown)]]);
  rotate('aileron', right, [[0, swing(rest(right), r.down, TRAVEL.aileronDown)], [0.5, rest(right)], [1, rest(right)]]);
  const leftSpoiler = node('left_3rd_spoiler'), rightSpoiler = node('right_3rd_spoiler');
  rotate('aileron', leftSpoiler, [[0, swing(rest(leftSpoiler), endOf('spoilers_out', leftSpoiler, 0.5), TRAVEL.spoilerUp)], [0.5, rest(leftSpoiler)], [1, rest(leftSpoiler)]]);
  rotate('aileron', rightSpoiler, [[0, rest(rightSpoiler)], [0.5, rest(rightSpoiler)], [1, swing(rest(rightSpoiler), endOf('spoilers_out', rightSpoiler, 0.5), TRAVEL.spoilerUp)]]);
}
// Rudder: he made the part but gave it no motion. Its hinge is its leading
// edge, found from the part's own shape; swing it about that line.
{
  const rudder = node('stabilizer_wing');
  // The part sits square to the airplane (no rotation of its own or above it),
  // so its own axes are the airplane's, shifted to its origin.
  const m = world0[rudder];
  const square = [m[0], m[5], m[10]].every((x) => Math.abs(x - 1) < 1e-6) && [m[1], m[2], m[4], m[6], m[8], m[9]].every((x) => Math.abs(x) < 1e-6);
  if (!square || json.nodes[rudder].rotation) throw new Error('the rudder is expected to sit square to the airplane');
  const local = verticesUnder(glb, rudder, world0).map((p) => [p[0] - m[12], p[1] - m[13], p[2] - m[14]]);
  const box = bounds(local);
  // The leading edge: the forward-most point near the bottom and near the top.
  const frontAt = (y) => local.filter((p) => Math.abs(p[1] - y) < 0.02 * (box.max[1] - box.min[1]) + 1e-6).reduce((a, p) => (p[2] < a[2] ? p : a));
  const foot = frontAt(box.min[1]), head = frontAt(box.max[1]);
  const axis = normalize([0, head[1] - foot[1], head[2] - foot[2]]);
  const about = (degrees) => {
    const half = (degrees * Math.PI) / 360, s = Math.sin(half);
    const q = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
    // Turning about a line through `foot` instead of the part's origin: also move it by foot - R foot.
    const turned = transform(composeRotation(q), [0, foot[1], foot[2]]);
    return { rotation: q, translation: [0 - turned[0], foot[1] - turned[1], foot[2] - turned[2]] };
  };
  const base = json.nodes[rudder].translation ?? [0, 0, 0];
  // Trailing edge left (toward -X) for full left: a positive turn about an upward axis swings the rear toward +X, so left is negative... checked below.
  const poses = [-TRAVEL.rudder, 0, TRAVEL.rudder].map(about);
  const swingsLeft = transform(composeRotation(poses[0].rotation), [0, 0, 1])[0] < 0;
  const ordered = swingsLeft ? poses : poses.slice().reverse();
  tracks.rudder.push({ node: rudder, path: 'rotation', keys: ordered.map((p, i) => [i / 2, p.rotation]) });
  tracks.rudder.push({ node: rudder, path: 'translation', keys: ordered.map((p, i) => [i / 2, p.translation.map((x, k) => x + base[k])]) });
}
function composeRotation([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
}

// A part may belong to one motion only (docs/models.md).
const owners = new Map();
for (const [motion, list] of Object.entries(tracks)) for (const t of list) {
  if (owners.has(t.node) && owners.get(t.node) !== motion) throw new Error(`${json.nodes[t.node].name} is in ${owners.get(t.node)} and ${motion}`);
  owners.set(t.node, motion);
}

// Write the five motions into the file's buffer, replacing the author's.
const chunks = [glb.bin];
let offset = glb.bin.length;
const pad = () => { const extra = (4 - (offset % 4)) % 4; if (extra) { chunks.push(Buffer.alloc(extra)); offset += extra; } };
function addAccessor(rows, type) {
  pad();
  const width = rows[0].length, data = Buffer.alloc(4 * width * rows.length);
  rows.forEach((row, i) => row.forEach((x, k) => data.writeFloatLE(x, 4 * (i * width + k))));
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
  chunks.push(data); offset += data.length;
  const accessor = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: rows.length, type };
  if (type === 'SCALAR') { accessor.min = [Math.min(...rows.map((r) => r[0]))]; accessor.max = [Math.max(...rows.map((r) => r[0]))]; }
  json.accessors.push(accessor);
  return json.accessors.length - 1;
}
json.animations = Object.entries(tracks).map(([name, list]) => ({
  name,
  samplers: list.map((t) => ({ input: addAccessor(t.keys.map((k) => [k[0]]), 'SCALAR'), output: addAccessor(t.keys.map((k) => k[1]), t.path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' })),
  channels: list.map((t, i) => ({ sampler: i, target: { node: t.node, path: t.path } })),
}));
// Parts are driven by their motions from now on, so every moving part needs a
// rotation of its own rather than a matrix.
for (const index of owners.keys()) if (json.nodes[index].matrix) throw new Error(`${json.nodes[index].name} carries a matrix; it cannot be animated`);

// ---- the wheels ----
const tyres = { wheel_nose: node('front_tires'), wheel_left: node('back_left_tire'), wheel_right: node('back_right_tire') };
for (const [name, index] of Object.entries(tyres)) json.nodes[index].name = name;

// ---- real size, and the origin at the centre of gravity ----
const everything = bounds(verticesUnder(glb, json.scenes[0].nodes[0], world0));
const sx = SPAN / (everything.max[0] - everything.min[0]), s = LENGTH / (everything.max[2] - everything.min[2]);
const mains = bounds(verticesUnder(glb, tyres.wheel_left, world0));
const cg = [0, everything.min[1] + CG_ABOVE_GROUND / s, (mains.min[2] + mains.max[2]) / 2 - CG_AHEAD_OF_MAINS / s];
const root = { name: 'f4c', children: json.scenes[0].nodes, matrix: [sx, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cg[0] * sx, -cg[1] * s, -cg[2] * s, 1] };
json.nodes.push(root);
json.scenes[0].nodes = [json.nodes.length - 1];

json.buffers[0].byteLength = offset;
json.asset.extras = { ...json.asset.extras, modified: 'Converted for Wings by models/convert-standin.mjs: scaled to the real F-4C, origin moved to an estimated centre of gravity, animations replaced by gear, flaps, elevator, aileron and rudder, tyres renamed.' };
const out = fileURLToPath(new URL('./f4c.glb', import.meta.url));
writeGlb(out, { json, bin: Buffer.concat(chunks) });

// ---- report: the contact points for the card ----
const made = readGlb(out);
const box = bounds(verticesUnder(made, made.json.scenes[0].nodes[0], worldMatrices(made.json, poseAt(made, 'gear', 0))));
console.log(`wrote ${out}`);
console.log(`scale ${s.toFixed(3)} (${sx.toFixed(3)} across the span); length ${(box.max[2] - box.min[2]).toFixed(2)} m, span ${(box.max[0] - box.min[0]).toFixed(2)} m`);
console.log('contact points for the card, feet from the centre of gravity [forward, right, down]:');
console.log(JSON.stringify(contactPoints(made), null, 2));
