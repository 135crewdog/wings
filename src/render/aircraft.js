// The airplane on screen. Any model built to docs/models.md works: the app
// knows no airplane's hinges, only the five named motions every model
// carries, each one second long, where the time is the position. After
// Rage's src/render/aircraft.js, with the motions moved into the model.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL = './models/f4c.glb';
export const MOTIONS = ['gear', 'flaps', 'elevator', 'aileron', 'rudder'];

/**
 * Returns the airplane's group at once, empty until the model has loaded;
 * `ready` resolves with the group when it has. `set({ gear, flaps, elevator,
 * aileron, rudder })` puts each motion at a position from 0 to 1: gear and
 * flaps from up to down; the controls from full forward or left, through
 * neutral at 0.5, to full back or right. Motions left out stay where they are.
 */
export function createAircraft() {
  const airplane = new THREE.Group();
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
    airplane.add(gltf.scene);
    airplane.set({ gear: 1, flaps: 0, elevator: 0.5, aileron: 0.5, rudder: 0.5 });
    return airplane;
  });
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
