// What is outside the airplane: the sky, the haze, the light, and the test
// field with its runway. The runway and the ground's squares are after
// 135crewdog/wings-v1, src/render/world.js; the sky and lights after
// 135crewdog/rage, src/render/world.js.

import * as THREE from 'three';
import { FT } from '../sim/card.js';

const HORIZON = 0xcfe6f7, ZENITH = 0x1f5fb8;   // the app's sky colours, as in style.css
const FAR = 30000;                              // m: the haze has hidden everything by here
const SQUARE = 1000 * FT;                       // the ground is marked in squares this size

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return [c, c.getContext('2d')];
}

// Grass in patches, with a faint line round each 1,000 ft square: something
// to judge speed and height by.
function groundTexture(renderer) {
  const N = 1024, [c, g] = canvas(N, N);
  g.fillStyle = '#6c8a4c';
  g.fillRect(0, 0, N, N);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [size, count, strength] of [[160, 60, 0.05], [48, 400, 0.05], [10, 5000, 0.06]]) {
    for (let i = 0; i < count; i++) {
      g.fillStyle = random() < 0.5 ? `rgba(40, 60, 20, ${strength})` : `rgba(190, 200, 120, ${strength})`;
      const x = random() * N, y = random() * N, w = size * (0.5 + random()), h = size * (0.5 + random());
      // Drawn again across each edge, so the squares join without a seam.
      for (const dx of [0, -N]) for (const dy of [0, -N]) g.fillRect(x + dx, y + dy, w, h);
    }
  }
  g.fillStyle = 'rgba(235, 240, 215, 0.5)';
  g.fillRect(0, 0, N, 4);
  g.fillRect(0, 0, 4, N);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

// The runway from above, its south end at the bottom: asphalt, edge lines,
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

/**
 * Builds the field into a scene. `field` is src/field.js's FIELD. Returns
 * { follow(camera) }: call it each frame so the sky stays around the camera.
 */
export function createWorld(scene, renderer, field) {
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 3000, FAR * 0.8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a70, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-3, 6, 4);
  scene.add(sun);

  // The sky: a dome that fades from the haze at the horizon to blue overhead.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(FAR * 0.95, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(ZENITH) } },
      vertexShader: 'varying vec3 dir; void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 horizon, zenith; varying vec3 dir;
        void main() {
          float up = max(normalize(dir).y, 0.0);
          gl_FragColor = vec4(mix(horizon, zenith, pow(up, 0.55)), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -4;
  scene.add(sky);

  // The ground and the runway lie in the same plane, so they are drawn in
  // order, ground first, instead of by depth: otherwise the two shimmer.
  const flat = (width, length, map, order) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshLambertMaterial({ map, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;   // the plane's "up" edge points north
    mesh.position.y = field.height;
    mesh.renderOrder = order;
    scene.add(mesh);
    return mesh;
  };
  const size = FAR * 2.2, grass = groundTexture(renderer);
  grass.repeat.set(size / SQUARE, size / SQUARE);
  const ground = flat(size, size, grass, -3);
  flat(field.runway.width, field.runway.length, runwayTexture(renderer, field.runway), -2);

  return {
    follow(camera) {
      sky.position.copy(camera.position);
      // The ground goes with the camera in whole squares, so it never runs out and never seems to move.
      ground.position.x = Math.round(camera.position.x / SQUARE) * SQUARE;
      ground.position.z = Math.round(camera.position.z / SQUARE) * SQUARE;
    },
  };
}
