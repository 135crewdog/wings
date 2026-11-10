// A small reader and writer for .glb files (binary glTF 2.0), with the few
// sums the model tools and tests need. No dependencies, no three.js.

import { readFileSync, writeFileSync } from 'node:fs';

/** Reads a .glb: returns { json, bin } - the glTF document and its binary buffer. */
export function readGlb(path) {
  const data = readFileSync(path);
  if (data.toString('latin1', 0, 4) !== 'glTF') throw new Error(`${path} is not a .glb`);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  const bin = binStart < data.length ? data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart)) : Buffer.alloc(0);
  return { json, bin };
}

/** Writes { json, bin } as a .glb. */
export function writeGlb(path, { json, bin }) {
  const pad = (buffer, fill) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), binChunk = pad(bin, 0);
  const header = Buffer.alloc(12), jsonHead = Buffer.alloc(8), binHead = Buffer.alloc(8);
  header.write('glTF', 0, 'latin1'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0); jsonHead.write('JSON', 4, 'latin1');
  binHead.writeUInt32LE(binChunk.length, 0); binHead.write('BIN\0', 4, 'latin1');
  writeFileSync(path, Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk]));
}

const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** The values of a float accessor, as an array of arrays. */
export function readAccessor({ json, bin }, index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView];
  if (a.componentType !== 5126) throw new Error('only float accessors are read');
  const width = WIDTH[a.type], stride = view.byteStride || 4 * width;
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, k) => bin.readFloatLE(start + i * stride + 4 * k)));
}

// ---- 4x4 matrices, column-major as glTF stores them ----
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
export const transform = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
export function compose(t = [0, 0, 0], [x, y, z, w] = [0, 0, 0, 1], s = [1, 1, 1]) {
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
/** A node's own matrix, with `pose` ({ rotation, translation, scale }) overriding its rest values. */
export function localMatrix(node, pose) {
  if (node.matrix && !pose) return node.matrix;
  return compose(pose?.translation ?? node.translation, pose?.rotation ?? node.rotation, pose?.scale ?? node.scale);
}

/**
 * Every node's world matrix, by node index. `pose` maps a node index to
 * { rotation, translation } to move parts away from their rest position.
 */
export function worldMatrices(json, pose = {}) {
  const world = [];
  const walk = (index, parent) => {
    world[index] = multiply(parent, localMatrix(json.nodes[index], pose[index]));
    for (const child of json.nodes[index].children ?? []) walk(child, world[index]);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, IDENTITY);
  return world;
}

/** Every vertex under a node (itself and its children), in world axes. */
export function verticesUnder(glb, index, world) {
  const out = [];
  const walk = (i) => {
    const node = glb.json.nodes[i];
    if (node.mesh !== undefined) {
      for (const primitive of glb.json.meshes[node.mesh].primitives) {
        for (const v of readAccessor(glb, primitive.attributes.POSITION)) out.push(transform(world[i], v));
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(index);
  return out;
}

/** The smallest box around some points: { min, max }. */
export function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return { min, max };
}

/** The pose a named animation gives at time t (seconds): { nodeIndex: { rotation, translation } }, linear between keys. */
export function poseAt(glb, name, t) {
  const animation = glb.json.animations.find((a) => a.name === name);
  if (!animation) throw new Error(`no animation named ${name}`);
  const pose = {};
  for (const channel of animation.channels) {
    const sampler = animation.samplers[channel.sampler];
    const times = readAccessor(glb, sampler.input).map((v) => v[0]), values = readAccessor(glb, sampler.output);
    let i = 0;
    while (i < times.length - 2 && t > times[i + 1]) i++;
    const span = times[i + 1] - times[i], f = times.length < 2 || span <= 0 ? 0 : Math.min(1, Math.max(0, (t - times[i]) / span));
    const a = values[i], b = values[Math.min(i + 1, values.length - 1)];
    const value = channel.target.path === 'rotation' ? slerp(a, b, f) : a.map((x, k) => x + (b[k] - x) * f);
    (pose[channel.target.node] ??= {})[channel.target.path] = value;
  }
  return pose;
}

export function slerp(a, b, f) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const to = dot < 0 ? b.map((x) => -x) : b;
  dot = Math.abs(dot);
  if (dot > 0.9995) return normalize(a.map((x, k) => x + (to[k] - x) * f));
  const angle = Math.acos(dot), s = Math.sin(angle);
  return a.map((x, k) => (x * Math.sin((1 - f) * angle) + to[k] * Math.sin(f * angle)) / s);
}
export const normalize = (q) => { const n = Math.hypot(...q); return q.map((x) => x / n); };
