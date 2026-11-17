// The airplane on screen. Any model built to docs/models.md works: the app
// knows no airplane's hinges, only the five named motions every model
// carries, each one second long, where the time is the position. After
// Rage's src/render/aircraft.js, with the motions moved into the model.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlume } from './plume.js';

const MODEL = './models/f4c.glb';
const FT = 0.3048;
export const MOTIONS = ['gear', 'flaps', 'elevator', 'aileron', 'rudder'];

/**
 * Returns the airplane's group at once, empty until the model has loaded;
 * `ready` resolves with the group when it has. `set({ gear, flaps, elevator,
 * aileron, rudder })` puts each motion at a position from 0 to 1: gear and
 * flaps from up to down; the controls from full forward or left, through
 * neutral at 0.5, to full back or right; any other motion the model carries,
 * such as `speedbrake`, from 0 s (closed) to 1. Motions left out stay where they are.
 * `burner(fraction, dt)` lights a plume at each of the card's nozzles: 0 at
 * dry power, up to 1 at full afterburner.
 * `silhouette(renderer)`, once loaded, draws the airplane from straight above,
 * gear and flaps up, onto a canvas just its size, nose up: opaque where the
 * airplane is, clear elsewhere (the pause screen's map, src/map.js).
 */
export function createAircraft(pilot) {
  const airplane = new THREE.Group();
  // Feet in body axes (forward, right, down) to metres in the model's (right, up, aft).
  const model = ([x, y, z]) => [y * FT, -z * FT, -x * FT];
  const plumes = (pilot.nozzles_ft ?? []).map((at) => createPlume(model(at), pilot.nozzle_radius_ft * FT));
  for (const plume of plumes) airplane.add(plume.mesh);
  airplane.burner = (fraction, dt) => { for (const plume of plumes) plume.update(fraction, dt); };
  const actions = {};
  let mixer = null;
  airplane.ready = new GLTFLoader().loadAsync(MODEL).then((gltf) => {
    mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;   // the app sets the time; nothing plays by itself
      actions[clip.name] = action;
    }
    // Drawn after the runway and the road. Those lie in the land's own plane and are drawn nudged toward the eye,
    // and that nudge is deep enough to paint them over the bottoms of the tyres if they come last. The order is
    // set on every part: a model is groups within groups, and each group would start the order afresh.
    gltf.scene.traverse((part) => { part.renderOrder = 2; });
    airplane.add(gltf.scene);
    airplane.set({ gear: 1, flaps: 0, elevator: 0.5, aileron: 0.5, rudder: 0.5 });
    return airplane;
  });
  airplane.silhouette = (renderer, tall = 256) => {
    if (!mixer) return null;
    const parent = airplane.parent, position = airplane.position.clone(), quaternion = airplane.quaternion.clone();
    const looks = new THREE.Scene();
    looks.add(airplane);
    airplane.position.set(0, 0, 0);
    airplane.quaternion.identity();
    airplane.burner(0, 0);
    airplane.set({ gear: 0, flaps: 0, speedbrake: 0, elevator: 0.5, aileron: 0.5, rudder: 0.5 });
    airplane.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(airplane);
    // Looking straight down, the nose (-z) at the top of the picture and the right wing (+x) on the right.
    const camera = new THREE.OrthographicCamera(box.min.x, box.max.x, -box.min.z, -box.max.z, 0.1, 2 * (box.max.y - box.min.y) + 10);
    camera.position.set(0, box.max.y + 5, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, box.min.y, 0);
    const wide = Math.max(1, Math.round((tall * (box.max.x - box.min.x)) / (box.max.z - box.min.z)));
    const target = new THREE.WebGLRenderTarget(wide, tall);
    const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(looks, camera);
    const pixels = new Uint8Array(wide * tall * 4);
    renderer.readRenderTargetPixels(target, 0, 0, wide, tall, pixels);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
    target.dispose();
    parent?.add(airplane);
    airplane.position.copy(position);
    airplane.quaternion.copy(quaternion);
    // WebGL's rows run bottom up; a canvas's top down. Opaque where anything was drawn.
    const image = new ImageData(wide, tall);
    for (let y = 0; y < tall; y++) {
      for (let x = 0; x < wide; x++) {
        const from = ((tall - 1 - y) * wide + x) * 4, to = (y * wide + x) * 4;
        if (pixels[from + 3] > 32) image.data.set([255, 255, 255, 255], to);
      }
    }
    const canvas = new OffscreenCanvas(wide, tall);
    canvas.getContext('2d').putImageData(image, 0, 0);
    return canvas;
  };
  airplane.set = (positions) => {
    if (!mixer) return;
    for (const [name, position] of Object.entries(positions)) {
      const action = actions[name];
      // Just short of the end: at exactly its duration a clip wraps round to its start.
      if (action) action.time = Math.min(Math.max(position, 0), 1) * action.getClip().duration * 0.999999;
    }
    mixer.update(0);
  };
  return airplane;
}
