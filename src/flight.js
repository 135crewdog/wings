// The flight: the simulation flying the airplane, and the picture of it.
// The loop is after 135crewdog/rage, src/main.js: the simulation always
// steps 1/120 s at a time, however fast the screen draws, and the picture
// shows the airplane between its last two steps.

import * as THREE from 'three';
import { deriveCard } from './sim/card.js';
import { F4C } from './sim/cards/f4c.js';
import { Sim, stepsFor } from './sim/sim.js';
import { FIELD, fieldGround, startState } from './field.js';
import { createAircraft } from './render/aircraft.js';
import { createChaseCamera } from './render/camera.js';
import { createWorld } from './render/world.js';
import { attitudeToThree, toThree } from './render/frames.js';

/** Starts the flight on a canvas: for now, the airplane parked on the runway. */
export function startFlight(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const world = createWorld(scene, renderer, FIELD);
  const airplane = createAircraft();
  scene.add(airplane);
  const chase = createChaseCamera();

  const card = deriveCard(F4C);
  const ground = fieldGround();
  // Parked: gear and flaps down, brakes on, engine at idle.
  const controls = { elevator: 0, aileron: 0, throttle: 0, gear: true, flaps: true, brake: true };
  const sim = new Sim(card, startState(card), { ground, gear: true, flaps: true });

  // Where the airplane is, in the picture's axes, at the last two steps.
  const pose = () => ({ position: new THREE.Vector3(...toThree(sim.state.x)), quaternion: new THREE.Quaternion(...attitudeToThree(sim.state.q)) });
  let now = pose(), before = now, carry = 0;
  const shown = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  const fit = () => {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(height * ratio)) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    chase.camera.aspect = width / height;
    chase.camera.updateProjectionMatrix();
  };

  // Draw only while the app is on screen. One loop at most: a frame still
  // waiting when the app is hidden is cancelled, so coming back never starts
  // a second loop beside it.
  let last = null, waiting = null;
  const draw = (time) => {
    const elapsed = last === null ? 0 : Math.min((time - last) / 1000, 0.25);
    last = time;
    const { steps, carry: left, fraction } = stepsFor(carry, elapsed);
    carry = left;
    for (let i = 0; i < steps; i++) {
      sim.step(controls);
      before = now;
      now = pose();
    }
    shown.position.lerpVectors(before.position, now.position, fraction);
    shown.quaternion.slerpQuaternions(before.quaternion, now.quaternion, fraction);
    airplane.position.copy(shown.position);
    airplane.quaternion.copy(shown.quaternion);
    airplane.set({ gear: sim.gear, flaps: sim.flaps });
    fit();   // every frame: iOS can report the new size late after a rotation
    chase.update(shown.position, shown.quaternion, elapsed, FIELD.height);
    world.follow(chase.camera);
    renderer.render(scene, chase.camera);
    waiting = requestAnimationFrame(draw);
  };
  const run = () => {
    if (waiting !== null) cancelAnimationFrame(waiting);
    waiting = null;
    last = null;
    if (!document.hidden) waiting = requestAnimationFrame(draw);
  };
  document.addEventListener('visibilitychange', run);
  run();
  return { sim, airplane, ready: airplane.ready };
}
