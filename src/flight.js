// The flight: the simulation flying the airplane, and the picture of it.
// The loop is after 135crewdog/rage, src/main.js: the simulation always
// steps 1/120 s at a time, however fast the screen draws, and the picture
// shows the airplane between its last two steps.

import * as THREE from 'three';
import { deriveCard } from './sim/card.js';
import { F4C } from './sim/cards/f4c.js';
import { Sim, DT, coordinate, normalizeControls, stepsFor } from './sim/sim.js';
import { FT, KT } from './sim/card.js';
import { atmosphere } from './sim/atmosphere.js';
import { elevatorTravel } from './sim/aero.js';
import { calibratedAirspeed } from './sim/airdata.js';
import { PARKED, baseField, startState } from './field.js';
import { createIsland, islandGround } from './sim/island.js';
import { createSolids, hotelSolids } from './sim/solids.js';
import { createAircraft } from './render/aircraft.js';
import { createChaseCamera } from './render/camera.js';
import { attachLook, createLook } from './input/look.js';
import { createWorld } from './render/world.js';
import { attitudeToThree, toThree } from './render/frames.js';

/**
 * Puts the flight on a canvas, parked on the runway and holding still.
 * `land` is the island ({ region, heights, canopy, image } from src/land.js).
 * `controls()` returns the pilot's controls each step; `onCrash()` is called
 * when a flight ends in a crash; `onReadout(knots, feet, feetAboveGround)` is
 * called every frame with what the instruments read. Returns { ready, fly(), hold(), restart(), setCrashes(on) }:
 * fly() lets time run, hold() stops it (the picture stays), restart() puts
 * the airplane back on the runway.
 */
export function startFlight(canvas, land, { controls, onCrash, onReadout }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const island = createIsland(land.region, land.heights, land.canopy, land.country), field = baseField(land.region, island);
  const world = createWorld(scene, renderer, field, land, island);
  const airplane = createAircraft();
  scene.add(airplane);
  const chase = createChaseCamera();
  const look = createLook();   // a finger dragged across the view looks around; let go and the view comes back

  const card = deriveCard(F4C);
  const ground = islandGround(island, createSolids([...Object.values(land.landmarks).flatMap((l) => l.solids), ...hotelSolids(land.region.sites.strip)]));
  // Heights are read at the wheels, so the jet standing on the runway reads the runway's height.
  const wheels = Math.max(...card.contacts.filter((p) => p.wheel).map((p) => p.r[2] - p.sag));   // where the wheels rest, not where the struts hang to
  const BUFFET_FULL = 2000;   // Pa of dynamic pressure: below this (about 110 knots) the buffet shake is weaker
  let sim, now, before, carry = 0, flying = false, crashes = true;

  // Where the airplane is, in the picture's axes.
  const pose = () => ({ position: new THREE.Vector3(...toThree(sim.state.x)), quaternion: new THREE.Quaternion(...attitudeToThree(sim.state.q)) });
  const shown = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  const restart = () => {
    sim = new Sim(card, startState(card, field), { ground, gear: true, flaps: true, crashes });
    for (let t = 0; t < 3; t += DT) sim.step(PARKED);   // let it settle onto its wheels
    now = before = pose();
    carry = 0;
    chase.reset();
    look.reset();
  };
  restart();
  attachLook(canvas, look, () => flying);

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

  // Draw only while the app is on screen, and only while something is
  // moving: in flight, every frame; otherwise a few frames after anything
  // changes, then rest, so a paused game costs the battery nothing. One loop
  // at most: a frame still waiting when the app is hidden is cancelled, so
  // coming back never starts a second loop beside it.
  const SETTLE = 30;   // frames drawn after a change: the camera eases in, and iOS can report a new size late
  let last = null, waiting = null, settle = SETTLE;
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
    // stabilator where the stick puts it at this speed (it moves less the
    // faster the airplane goes), the ailerons with the stick, and the rudder
    // where the automatic feet have it.
    const stick = normalizeControls(flown), seen = sim.observe(flown), air = seen.air;
    airplane.set({
      gear: sim.gear, flaps: sim.flaps,
      elevator: 0.5 + 0.5 * elevatorTravel(card, air, stick.elevator), aileron: 0.5 + 0.5 * stick.aileron,
      rudder: 0.5 + 0.5 * coordinate(card, stick, air),
    });
    fit();   // every frame: iOS can report the new size late after a rotation
    const height = -sim.state.x[2] - wheels;
    onReadout(calibratedAirspeed(air.V, atmosphere(-sim.state.x[2])) / KT, height / FT, (height - ground.heightAt(sim.state.x[0], sim.state.x[1])) / FT);
    const buffet = (seen.coef?.buffet ?? 0) * Math.min(1, air.qbar / BUFFET_FULL);
    look.update(elapsed);
    // The camera stays above the ground where it is; where it was a frame ago is near enough.
    const under = Math.max(ground.heightAt(sim.state.x[0], sim.state.x[1]), ground.heightAt(-chase.camera.position.z, chase.camera.position.x));
    chase.update(shown.position, shown.quaternion, elapsed, under, flying ? buffet : 0, look);
    world.follow(chase.camera);
    renderer.render(scene, chase.camera);
    settle = flying ? SETTLE : settle - 1;
    waiting = settle > 0 ? requestAnimationFrame(draw) : null;
    if (waiting === null) last = null;   // resting: the next frame starts the clock afresh
  };
  // Something changed: draw again for a moment, even at rest.
  const wake = () => {
    settle = SETTLE;
    if (waiting === null && !document.hidden) waiting = requestAnimationFrame(draw);
  };
  const run = () => {
    if (waiting !== null) cancelAnimationFrame(waiting);
    waiting = null;
    last = null;
    wake();
  };
  document.addEventListener('visibilitychange', run);
  // A new size, a turned phone, or the model arriving all change the picture.
  new ResizeObserver(wake).observe(canvas);
  for (const type of ['resize', 'orientationchange']) window.addEventListener(type, wake);
  airplane.ready.then(wake);
  world.ready.then(wake);
  run();
  return {
    ready: airplane.ready,
    fly() { flying = true; carry = 0; look.reset(); wake(); },
    hold() { flying = false; look.release(); wake(); },
    restart() { restart(); wake(); },
    /** Whether a hard arrival ends the flight. False is the crash override. Takes effect at once. */
    setCrashes(on) { crashes = on; sim.crashes = on; },
    get sim() { return sim; },
  };
}
