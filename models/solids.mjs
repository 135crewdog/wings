// A landmark's solid shapes, read from its model (docs/models.md,
// "Landmarks"): every part named solid... is a plain cube that the model
// chat moved, turned and stretched to wrap a pier, a tower or a wall.
//   node models/solids.mjs models/viaduct.glb
// prints them. Model axes: x east, y up, z south, in metres.

import { fileURLToPath } from 'node:url';
import { readGlb, readAccessor, worldMatrices } from './glb.mjs';

export const isSolid = (node) => (node.name ?? '').startsWith('solid');

/**
 * [{ name, centre: [x, y, z], half: [a, b, c], axes: [[x, y, z] x 3] }]: each box's middle, its
 * half-lengths along its own three axes, and those axes as unit vectors.
 */
export function solidsOf(glb) {
  const { json } = glb, world = worldMatrices(json);
  return json.nodes.flatMap((node, index) => {
    if (!isSolid(node)) return [];
    // The cube as it was made, before it was moved: its corners, to learn how big it is.
    const corners = readAccessor(glb, json.meshes[node.mesh].primitives[0].attributes.POSITION);
    const cube = [0, 1, 2].map((k) => Math.max(...corners.map((p) => Math.abs(p[k]))));
    const m = world[index];
    const columns = [0, 1, 2].map((k) => [m[4 * k], m[4 * k + 1], m[4 * k + 2]]);
    const lengths = columns.map((c) => Math.hypot(...c));
    return [{ name: node.name, centre: [m[12], m[13], m[14]], half: lengths.map((l, k) => l * cube[k]), axes: columns.map((c, k) => c.map((v) => v / lengths[k])) }];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const s of solidsOf(readGlb(process.argv[2]))) console.log(s.name.padEnd(22), 'centre', s.centre.map((v) => v.toFixed(1)).join(', '), ' half', s.half.map((v) => v.toFixed(1)).join(', '));
}
