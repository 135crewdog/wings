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
import { calibratedAirspeed, instruments } from './sim/airdata.js';
import { PARKED, runwayField, startState } from './field.js';
import { toWorld, HNL_VORTAC } from './sim/hawaii.js';
import { createAircraft } from './render/aircraft.js';
import { createChaseCamera } from './render/camera.js';
import { attachLook, createLook } from './input/look.js';
import { createWorld } from './render/world.js';
import { attitudeToThree, toThree } from './render/frames.js';

/**
 * Puts the flight on a canvas, parked on the runway and holding still.
 * `hawaii` is the islands (src/hawaii.js), with every flight starting on
 * their `start` runway.
 * `controls()` returns the pilot's controls each step; `onCrash()` is called
 * when a flight ends in a crash; `onReadout(reading, project, looking)` is
 * called every frame it draws with what the instruments read: { knots, feet,
 * aboveGround } (feet at the wheels) and the HUD's numbers (see
 * instruments() in src/sim/airdata.js, and `power`, the engine's); `project`
 * turns a north, east, down direction into where it falls on the screen. Returns { ready, fly(), hold(), restart(), redraw(), setCrashes(on) }:
 * fly() lets time run, hold() stops it (the picture stays), restart() puts
 * the airplane back on the runway.
 */
export function startFlight(canvas, hawaii, { controls, onCrash, onReadout }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const { index, ground } = hawaii;
  const field = runwayField(index.runways.find((w) => w.airport === index.start.airport && w.ends[0].ident === index.start.runway));
  const world = createWorld(scene, renderer, hawaii);
  const card = deriveCard(F4C);
  const airplane = createAircraft(F4C);
  scene.add(airplane);
  const chase = createChaseCamera();
  const look = createLook();   // a finger dragged across the view looks around; let go and the view comes back

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

  // The HUD's steerpoint, the HNL VORTAC: the way to it from the airplane,
  // its true bearing, and its range in nautical miles (slant, as DME reads).
  const vortac = [...toWorld(index, HNL_VORTAC.group, HNL_VORTAC.lat, HNL_VORTAC.lon), -HNL_VORTAC.feet * FT];
  const NM = 1852;
  const steerpoint = () => {
    const d = vortac.map((v, k) => v - sim.state.x[k]), range = Math.hypot(...d) || 1;
    return { dir: d.map((v) => v / range), bearing: ((Math.atan2(d[1], d[0]) * 180) / Math.PI + 360) % 360, range: range / NM, name: HNL_VORTAC.name };
  };

  // Where a north, east, down direction falls on the screen, as the camera
  // sees it: for the HUD's conformal symbols.
  const projected = new THREE.Vector3();
  const project = (ned) => {
    const [x, y, z] = toThree(ned), at = chase.camera.position;
    projected.set(at.x + x * 10000, at.y + y * 10000, at.z + z * 10000).project(chase.camera);
    return { x: ((projected.x + 1) / 2) * canvas.clientWidth, y: ((1 - projected.y) / 2) * canvas.clientHeight, visible: projected.z < 1 };
  };

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
  let frames = 0, fpsAt = performance.now(), fps = 0;   // frames a second, for the developer overlay
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
    // The model's parts: gear, flaps and speedbrakes where the simulation has them, the
    // stabilator where the stick puts it at this speed (it moves less the
    // faster the airplane goes), the ailerons with the stick, and the rudder
    // where the automatic feet have it.
    const stick = normalizeControls(flown), seen = sim.observe(flown), air = seen.air;
    airplane.set({
      gear: sim.gear, flaps: sim.flaps, speedbrake: sim.speedbrake,
      elevator: 0.5 + 0.5 * elevatorTravel(card, air, stick.elevator), aileron: 0.5 + 0.5 * stick.aileron,
      rudder: 0.5 + 0.5 * coordinate(card, stick, air),
    });
    airplane.burner(Math.min(1, Math.max(0, sim.power - 1)), flying ? elapsed : 0);   // the plumes show the engine, not the throttle
    fit();   // every frame: iOS can report the new size late after a rotation
    hawaii.near(sim.state.x[0], sim.state.x[1]);   // the ground round the airplane, decoded ahead of it
    const height = -sim.state.x[2] - wheels;
    const buffet = (seen.coef?.buffet ?? 0) * Math.min(1, air.qbar / BUFFET_FULL);
    look.update(elapsed);
    // The camera stays above the ground where it is; where it was a frame ago is near enough.
    const under = Math.max(ground.heightAt(sim.state.x[0], sim.state.x[1]), ground.heightAt(-chase.camera.position.z, chase.camera.position.x));
    chase.update(shown.position, shown.quaternion, elapsed, under, flying ? buffet : 0, look);
    world.follow(chase.camera);
    renderer.render(scene, chase.camera);
    frames++;
    if (time - fpsAt > 500) { fps = (frames * 1000) / (time - fpsAt); frames = 0; fpsAt = time; }
    onReadout({
      knots: calibratedAirspeed(air.V, atmosphere(-sim.state.x[2])) / KT,
      feet: height / FT,
      aboveGround: (height - ground.heightAt(sim.state.x[0], sim.state.x[1])) / FT,
      power: sim.power,
      ...instruments(sim, seen),
      steer: steerpoint(),
    }, project, look.active);
    settle = flying || !world.settled ? SETTLE : settle - 1;   // at rest, draw on until all the ground round the camera is in
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
  run();
  return {
    ready: airplane.ready,
    fly() { flying = true; carry = 0; look.reset(); wake(); },
    hold() { flying = false; look.release(); wake(); },
    restart() { restart(); wake(); },
    /** Draw again, though nothing in the flight changed: the HUD was switched. */
    redraw() { wake(); },
    /** Whether a hard arrival ends the flight. False is the crash override. Takes effect at once. */
    setCrashes(on) { crashes = on; sim.crashes = on; },
    get sim() { return sim; },
    /** For the developer overlay: frame rate, draw calls, where the airplane is, and the ground's state round it. */
    status() {
      const [north, east] = sim.state.x;
      return { fps, draws: renderer.info.render.calls, north, east, levels: world.terrain.levelsAt(north, east), queued: world.terrain.queued };
    },
  };
}
