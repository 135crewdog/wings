// The flight: the simulation flying the airplane, and the picture of it.
// The loop is after 135crewdog/rage, src/main.js: the simulation always
// steps 1/120 s at a time, however fast the screen draws, and the picture
// shows the airplane between its last two steps.

import * as THREE from 'three';
import { deriveCard } from './sim/card.js';
import { F4C } from './sim/cards/f4c.js';
import { Sim, DT, coordinate, normalizeControls, stepsFor } from './sim/sim.js';
import { FIELD, PARKED, fieldGround, startState } from './field.js';
import { createAircraft } from './render/aircraft.js';
import { createChaseCamera } from './render/camera.js';
import { createWorld } from './render/world.js';
import { attitudeToThree, toThree } from './render/frames.js';

/**
 * Puts the flight on a canvas, parked on the runway and holding still.
 * `controls()` returns the pilot's controls each step; `onCrash()` is called
 * when a flight ends in a crash. Returns { ready, fly(), hold(), restart() }:
 * fly() lets time run, hold() stops it (the picture stays), restart() puts
 * the airplane back on the runway.
 */
export function startFlight(canvas, { controls, onCrash }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const world = createWorld(scene, renderer, FIELD);
  const airplane = createAircraft();
  scene.add(airplane);
  const chase = createChaseCamera();

  const card = deriveCard(F4C);
  const ground = fieldGround();
  let sim, now, before, carry = 0, flying = false;

  // Where the airplane is, in the picture's axes.
  const pose = () => ({ position: new THREE.Vector3(...toThree(sim.state.x)), quaternion: new THREE.Quaternion(...attitudeToThree(sim.state.q)) });
  const shown = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  const restart = () => {
    sim = new Sim(card, startState(card), { ground, gear: true, flaps: true });
    for (let t = 0; t < 3; t += DT) sim.step(PARKED);   // let it settle onto its wheels
    now = before = pose();
    carry = 0;
    chase.reset();
  };
  restart();

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
    let flown = PARKED;
    if (flying) {
      const { steps, carry: left } = stepsFor(carry, elapsed);
      carry = left;
      flown = controls();
      for (let i = 0; i < steps && !sim.crashed; i++) {
        sim.step(flown);
        before = now;
        now = pose();
      }
      if (sim.crashed) { flying = false; carry = 0; onCrash(sim.crashed); }
    }
    const fraction = carry / DT;
    shown.position.lerpVectors(before.position, now.position, fraction);
    shown.quaternion.slerpQuaternions(before.quaternion, now.quaternion, fraction);
    airplane.position.copy(shown.position);
    airplane.quaternion.copy(shown.quaternion);
    // The model's parts: gear and flaps where the simulation has them, the
    // controls where the pilot's stick and the automatic rudder are.
    const stick = normalizeControls(flown), air = sim.observe(flown).air;
    airplane.set({
      gear: sim.gear, flaps: sim.flaps,
      elevator: 0.5 + 0.5 * stick.elevator, aileron: 0.5 + 0.5 * stick.aileron,
      rudder: 0.5 + 0.5 * coordinate(card, stick, air.beta, air.qbar),
    });
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
  return {
    ready: airplane.ready,
    fly() { flying = true; carry = 0; },
    hold() { flying = false; },
    restart,
    get sim() { return sim; },
  };
}
