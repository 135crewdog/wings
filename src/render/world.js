// What is outside the airplane: the sky, the haze, the light, the island and
// the air base's runway. The runway's paint is after 135crewdog/wings-v1,
// src/render/world.js; the sky and lights after 135crewdog/rage,
// src/render/world.js: a sun, and fair-weather clouds painted on the sky, far
// away and still, so nothing is ever flown through. Rage's clouds are soft;
// these have clean edges and two flat tones, to match the painted airplane.

import * as THREE from 'three';
import { createTerrain } from './terrain.js';
import { createTrees } from './trees.js';
import { createLandmarks } from './landmarks.js';
import { createStrip } from './strip.js';

const HORIZON = 0xcfe6f7, ZENITH = 0x1f5fb8;   // the app's sky colours, as in style.css
const SUN = new THREE.Vector3(-3, 6, 4).normalize();   // the way to the sun: high in the south-west (x east, y up, z south)
const FAR = 30000;                              // m: the haze has hidden everything by here

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return [c, c.getContext('2d')];
}

// The runway from above, the end a takeoff starts from at the bottom:
// asphalt, edge lines, threshold bars, numbers and a dashed centreline.
function runwayTexture(renderer, runway) {
  const across = 256, along = 4096, [c, g] = canvas(across, along);
  const px = across / runway.width, py = along / runway.length;   // pixels per metre each way
  g.fillStyle = '#4a4d51';
  g.fillRect(0, 0, across, along);
  g.fillStyle = '#e8e8e2';
  const edge = 1 * px;
  g.fillRect(2 * px, 0, edge, along);
  g.fillRect(across - 2 * px - edge, 0, edge, along);
  const end = (flip, number) => {
    g.save();
    if (flip) { g.translate(across, along); g.rotate(Math.PI); }
    // Seen from the approach: bars at the threshold, then the number.
    const bars = 8, gap = across / (bars * 2 + 3);
    for (let i = 0; i < bars; i++) {
      const x = gap * (1.5 + i * 2 + (i >= bars / 2 ? 1 : 0)) - gap / 2;
      g.fillRect(x, along - 50 * py, gap, 40 * py);
    }
    g.translate(across / 2, along - 75 * py);
    g.scale(1, (py / px) * 2.2);   // tall, the way runway numbers are painted
    g.font = `bold ${14 * px}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(number, 0, 0);
    g.restore();
  };
  end(false, runway.numbers[0]);
  end(true, runway.numbers[1]);
  for (let m = 130; m < runway.length - 130; m += 60) g.fillRect(across / 2 - 0.5 * px, m * py, 1 * px, 36 * py);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

/**
 * Builds the world into a scene. `field` is the air base (src/field.js's
 * baseField), `land` the island's files ({ region, image } from src/land.js)
 * and `island` its land (src/sim/island.js).
 * Returns { ready, follow(camera) }: call it each frame, so the sky and the land
 * stay round the camera.
 */
export function createWorld(scene, renderer, field, land, island) {
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 3000, FAR * 0.8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a70, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.copy(SUN);
  scene.add(sun);

  // The sky: a dome that fades from the haze at the horizon to blue overhead.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(FAR * 0.95, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(ZENITH) }, sun: { value: SUN } },
      vertexShader: 'varying vec3 dir; void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 horizon, zenith, sun; varying vec3 dir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float field(vec2 p) { return 0.5 * noise(p) + 0.25 * noise(p * 2.03 + 7.1) + 0.125 * noise(p * 4.11 + 3.7) + 0.0625 * noise(p * 8.07 + 1.3); }
        void main() {
          vec3 d = normalize(dir);
          float up = max(d.y, 0.0);
          vec3 sky = mix(horizon, zenith, pow(up, 0.55));
          // The sun: a glow that brightens the sky round it, and a disc.
          float s = max(dot(d, sun), 0.0);
          sky += vec3(1.0, 0.95, 0.85) * 0.3 * pow(s, 24.0);
          sky = mix(sky, vec3(1.0, 0.98, 0.9), smoothstep(0.9990, 0.9993, s));
          // Clouds: the direction laid onto a flat deck overhead, so they crowd toward the horizon as a real
          // deck does. A clean edge, a white top and a flat grey base.
          if (d.y > 0.0) {
            float n = field(d.xz / (d.y + 0.06) * 1.7);
            vec3 cloud = mix(vec3(1.0, 0.99, 0.97), vec3(0.80, 0.84, 0.90), step(0.68, n));
            sky = mix(sky, cloud, smoothstep(0.585, 0.595, n) * smoothstep(0.015, 0.10, d.y));
          }
          gl_FragColor = vec4(sky, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -4;
  scene.add(sky);

  const terrain = createTerrain(scene, land, SUN, scene.fog);
  const trees = createTrees(scene, island, land.region);
  const ready = createLandmarks(scene, land.landmarks);
  createStrip(scene, renderer, land.region.sites.strip);

  // The runway lies in the land's own plane, so it is drawn nudged toward
  // the eye: otherwise the two shimmer.
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(field.runway.width, field.runway.length),
    new THREE.MeshLambertMaterial({ map: runwayTexture(renderer, field.runway), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  runway.rotation.set(-Math.PI / 2, (-field.heading * Math.PI) / 180, 0, 'YXZ');   // flat, then turned so its "up" edge lies along the takeoff heading
  runway.position.set(field.east, field.height, -field.north);
  runway.renderOrder = 1;   // after the land
  scene.add(runway);

  return {
    ready,   // resolves when the landmarks' models are in the picture
    follow(camera) {
      sky.position.copy(camera.position);
      terrain.follow(camera);
      trees.follow(camera);
    },
  };
}
