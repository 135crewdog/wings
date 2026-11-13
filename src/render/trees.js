// Trees for scenery: single trees standing along the tracks between the
// fields, drawn round the camera and nowhere else. They are not solid; the
// woods are (they are part of the ground, src/render/terrain.js). Where a
// tree stands is worked out from the place itself, so the same trees are
// there every time you come back. Metres; x east, y up, z south.

import * as THREE from 'three';
import { TREE_GRID as GRID, rand, treeIn } from '../fields.js';

const REACH = 1400;     // m: trees are drawn this far from the camera
const REDO = 250;       // m: the camera moves this far before the trees are worked out afresh
const MOST = 2500;      // trees drawn at once, at most

// One tree: a trunk and a crown of two cones, about 1 m tall before it is scaled.
function treeGeometry() {
  const parts = [[new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5), 0.15, 0x5a4630], [new THREE.ConeGeometry(0.27, 0.55, 6), 0.5, 0x2f6a34], [new THREE.ConeGeometry(0.19, 0.42, 6), 0.79, 0x3a7a3c]];
  const position = [], normal = [], color = [], index = [];
  for (const [part, up, tint] of parts) {
    const flat = part.toNonIndexed();   // flat-shaded, like everything else
    flat.computeVertexNormals();
    const at = position.length / 3, c = new THREE.Color(tint);
    for (let i = 0; i < flat.attributes.position.count; i++) {
      position.push(flat.attributes.position.getX(i), flat.attributes.position.getY(i) + up, flat.attributes.position.getZ(i));
      normal.push(flat.attributes.normal.getX(i), flat.attributes.normal.getY(i), flat.attributes.normal.getZ(i));
      color.push(c.r, c.g, c.b);
      index.push(at + i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Puts the trees into a scene. `island` is the land (src/sim/island.js) and
 * `region` terrain/island.json. Returns { follow(camera) }: call it each frame.
 */
export function createTrees(scene, island, region) {
  const mesh = new THREE.InstancedMesh(treeGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), MOST);
  mesh.count = 0;
  mesh.frustumCulled = false;   // they are always round the camera
  scene.add(mesh);
  const at = new THREE.Matrix4(), turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), where = new THREE.Vector3(), size = new THREE.Vector3();
  let done = null;
  return {
    follow(camera) {
      const n = -camera.position.z, e = camera.position.x;
      if (done && Math.hypot(n - done.n, e - done.e) < REDO) return;
      done = { n, e };
      let count = 0;
      const span = Math.ceil(REACH / GRID), ci = Math.round(n / GRID), cj = Math.round(e / GRID);
      for (let i = ci - span; i <= ci + span && count < MOST; i++) {
        for (let j = cj - span; j <= cj + span && count < MOST; j++) {
          if ((i - ci) ** 2 + (j - cj) ** 2 > span * span) continue;
          const tree = treeIn(i, j, island, region);
          if (!tree) continue;
          where.set(tree.east, island.heightAt(tree.north, tree.east), -tree.north);
          turn.setFromAxisAngle(up, rand(i, j, 24) * Math.PI * 2);
          mesh.setMatrixAt(count++, at.compose(where, turn, size.set(tree.height * (0.8 + 0.5 * rand(i, j, 25)), tree.height, tree.height * (0.8 + 0.5 * rand(i, j, 25)))));
        }
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
