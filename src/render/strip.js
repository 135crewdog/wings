// The Strip, as far as the app draws it: the road, and the plain slab hotels
// along it. Where they stand is in terrain/island.json (sites.strip), worked
// out by terrain/make-island.mjs. The recognizable places are models, like
// every other landmark (src/render/landmarks.js); until one arrives its lot
// is bare ground. Metres; x east, y up, z south.

import * as THREE from 'three';

// The hotels' colours: sand, white, pale blue glass, rose, gold.
const TINTS = [0xd9c7a3, 0xe8e4da, 0x9fc0d6, 0xd8a89a, 0xd6b25e];

// The road: dark asphalt, a kerb line each side, lanes, and a median of palms' green down the middle.
function roadTexture(renderer, width, length) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 2048;
  const g = canvas.getContext('2d'), px = canvas.width / width, py = canvas.height / length;
  g.fillStyle = '#3d3f43';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#5f8a4a';
  g.fillRect(canvas.width / 2 - 2 * px, 0, 4 * px, canvas.height);
  g.fillStyle = '#e8e8e2';
  for (const x of [1, width - 1.6]) g.fillRect(x * px, 0, 0.6 * px, canvas.height);
  for (const x of [6, 10, width - 10.5, width - 6.5]) for (let y = 0; y < length; y += 24) g.fillRect(x * px, y * py, 0.5 * px, 9 * py);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

/** Adds the Strip's road and hotels to a scene. `strip` is sites.strip of terrain/island.json. */
export function createStrip(scene, renderer, strip) {
  // The road lies in the land's own plane, like the runway: drawn nudged toward the eye, after the land.
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(strip.road, strip.length),
    new THREE.MeshLambertMaterial({ map: roadTexture(renderer, strip.road, strip.length), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(strip.east, strip.height, -strip.north);
  road.renderOrder = 1;
  scene.add(road);

  // The hotels: one box each, its walls banded with rows of windows by rule.
  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 wall; varying vec3 facing;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nwall = (instanceMatrix * vec4(position, 1.0)).xyz; facing = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 wall; varying vec3 facing;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Windows: dark glass in rows a storey apart, on the walls only, with a plain base and a plain top.
        float along = abs(facing.x) > 0.5 ? wall.z : wall.x;
        if (abs(facing.y) < 0.5 && wall.y > ${(strip.height + 8).toFixed(1)} && fract(wall.y / 4.0) > 0.42 && fract(along / 5.0) > 0.25) diffuseColor.rgb *= vec3(0.34, 0.42, 0.52);`);
  };
  const hotels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, strip.hotels.length);
  const at = new THREE.Matrix4(), tint = new THREE.Color();
  strip.hotels.forEach((h, i) => {
    // Each carries on 5 m into the ground, as every landmark does.
    at.makeScale(h.across, h.height + 5, h.along).setPosition(h.east, strip.height + (h.height - 5) / 2, -h.north);
    hotels.setMatrixAt(i, at);
    hotels.setColorAt(i, tint.setHex(TINTS[h.tint]));
  });
  scene.add(hotels);
}
