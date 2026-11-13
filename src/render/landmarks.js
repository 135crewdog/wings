// The island's landmarks on screen: each a model built to docs/models.md
// ("Landmarks"), stood on its site from terrain/landmarks.json. The model's
// solid shapes are for the flight model (src/sim/solids.js), not the eye, so
// they are hidden here.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODELS = { viaduct: './models/viaduct.glb' };

/**
 * Adds every landmark to the scene as its model arrives. `landmarks` is
 * terrain/landmarks.json. Returns a promise that resolves when they are all in.
 */
export function createLandmarks(scene, landmarks) {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(landmarks).map(async ([name, at]) => {
    const { scene: model } = await loader.loadAsync(MODELS[name]);
    model.traverse((part) => { if (part.name.startsWith('solid')) part.visible = false; });
    // The picture's axes are the model's: x east, y up, z south.
    model.position.set(at.east, at.up, -at.north);
    model.rotation.y = (-at.turn * Math.PI) / 180;
    scene.add(model);
  }));
}
