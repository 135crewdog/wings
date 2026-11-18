// What is outside the airplane: the sky, the haze, the light, Hawaii and its
// runways. The sky is 135crewdog/rage's (src/render/world.js): a dome fading
// from a pale horizon to blue overhead, a mid-afternoon sun, and soft
// fair-weather cumulus painted on the dome, infinitely far, so nothing is
// ever flown through. The runways' paint is after 135crewdog/wings-v1.

import * as THREE from 'three';
import { createTerrain, NOISE_GLSL } from './terrain.js';

const HORIZON = 0xb9c7d6, ZENITH = 0x3f78c8;          // Rage's
const SUN = new THREE.Vector3(-3, 6, 4).normalize();  // the way to the sun: high in the south-west (x east, y up, z south)
const HAZE = 80000;                                    // m (43 nm): the haze has hidden everything by here; it starts a fifth of the way out

const skyFragment = `
  uniform vec3 horizon, zenith, sun;
  varying vec3 dir;
  ${NOISE_GLSL}
  // four octaves of noise: the cloud field
  float fbm(vec2 p) { return 0.5 * noise(p) + 0.25 * noise(p * 2.03 + 7.1) + 0.125 * noise(p * 4.11 + 3.7) + 0.0625 * noise(p * 8.07 + 1.3); }
  void main() {
    vec3 d = normalize(dir);
    float t = clamp(d.y * 2.2, 0.0, 1.0); t = t * t * (3.0 - 2.0 * t);
    vec3 sky = mix(horizon, zenith, t);
    // the sun: a disc, and a glow that also brightens the sky round it
    float s = max(dot(d, sun), 0.0);
    sky += vec3(1.0, 0.95, 0.85) * (0.35 * pow(s, 24.0) + 0.25 * pow(s, 200.0));
    sky = mix(sky, vec3(1.0, 0.98, 0.92), smoothstep(0.9993, 0.9997, s));
    // cumulus: the dome's direction laid onto a flat deck above, so the field
    // crowds toward the horizon the way a real deck does
    if (d.y > 0.0) {
      float n = fbm(d.xz / (d.y + 0.06) * 2.4);
      float cover = smoothstep(0.52, 0.68, n);                      // broken, mostly clear overhead
      float body = smoothstep(0.52, 0.85, n);                       // thicker where the cloud is deeper
      vec3 colour = mix(vec3(1.0, 0.99, 0.97), vec3(0.78, 0.80, 0.84), body);   // bright edges, shaded cores
      colour += vec3(0.08, 0.06, 0.03) * s * s;                     // warmer toward the sun
      sky = mix(sky, colour, cover * smoothstep(0.015, 0.10, d.y)); // fading into the haze at the horizon
    }
    gl_FragColor = vec4(sky, 1.0);
  }`;

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return [c, c.getContext('2d')];
}

// A runway from above, its first end at the bottom: asphalt, edge lines,
// threshold bars, numbers and a dashed centreline.
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

// A runway lying on the ground from one end to the other. Drawn nudged toward
// the eye, so the paint and the ground under it don't shimmer.
function runwayMesh(renderer, way) {
  const [a, b] = way.ends;
  const length = Math.hypot(b.north - a.north, b.east - a.east);
  const along = [(b.east - a.east) / length, -(b.north - a.north) / length];   // three.js x, z
  const right = [-along[1], along[0]];
  const half = way.width / 2;
  // On the airfield's surface (height = a + b·north + c·east; every runway is level, so b and c are 0),
  // which is exactly the ground under it: the tiles hold the runway's height with no rounding.
  const [a0, bn, ce] = way.surface;
  const corner = (end, side) => {
    const east = end.east + right[0] * half * side, north = end.north - right[1] * half * side;
    return [east, a0 + bn * north + ce * east, -north];
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...corner(a, -1), ...corner(a, 1), ...corner(b, -1), ...corner(b, 1)], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const texture = runwayTexture(renderer, { width: way.width, length, numbers: way.ends.map((e) => e.ident) });
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }));
  mesh.renderOrder = 1;   // after the land
  return mesh;
}

/**
 * Builds the world into a scene: the sky, Hawaii (src/hawaii.js's) and every
 * runway in it. Returns { follow(camera), settled, far }: call follow each frame,
 * so the sky and the land stay round the camera; settled is true once all
 * the ground round the camera is in the picture.
 */
export function createWorld(scene, renderer, hawaii) {
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, HAZE / 5, HAZE);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a70, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.copy(SUN);
  scene.add(sun);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(HAZE * 0.95, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      // The horizon in screen colours, as the haze on the ground is (src/render/terrain.js), so the
      // two meet with no line: the sky low down and the farthest ground are one colour.
      uniforms: { horizon: { value: new THREE.Color(HORIZON).convertLinearToSRGB() }, zenith: { value: new THREE.Color(ZENITH) }, sun: { value: SUN } },
      vertexShader: 'varying vec3 dir; void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: skyFragment,
    }),
  );
  sky.renderOrder = -4;
  scene.add(sky);

  const terrain = createTerrain(scene, renderer, hawaii, SUN, scene.fog);
  for (const way of hawaii.index.runways) scene.add(runwayMesh(renderer, way));

  return {
    follow(camera) {
      sky.position.copy(camera.position);
      terrain.follow(camera);
    },
    get settled() { return terrain.settled; },
    far: HAZE,   // the camera need see no farther
    terrain,
  };
}
