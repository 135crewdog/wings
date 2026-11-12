// The simulation: one airplane, a state, and step(controls) at a fixed 1/120 s.
// From 135crewdog/wings-v1, src/sim/sim.js, with the safety net of
// docs/sim-core-review.md finding 2 added and the wind removed (the air is
// always still). Forces: aerodynamics, thrust, gravity, and ground contact
// when a ground is given.

import { atmosphere, G0 } from './atmosphere.js';
import { aeroForces, aileronPower, airData, groundEffect, separationStep } from './aero.js';
import { rk4Step } from './body.js';
import { contactForces, crashCheck, onGear, touching } from './contact.js';
import { powerStep, powerWanted, thrust } from './engine.js';
import { qrotate, qrotateInv } from './vec.js';

export const DT = 1 / 120;
export const MAX_RATE = 20;   // rad/s: body rates are held inside this, far beyond any real maneuver
const G_W = [0, 0, G0];
const RHO0 = atmosphere(0).rho;
const AT_REST = { sep: [0, 0], power: 0, gear: 0, flaps: 0 };
const GEAR_SECONDS = 4, FLAP_SECONDS = 3;   // full travel
const MAX_STEER = (30 * Math.PI) / 180;      // the nose wheel's steering angle at full tilt, standing still
const STEER_FADE = 15;                       // m/s: by this speed the steering is down to half

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const FULL_RUDDER_SLIP = (12 * Math.PI) / 180;   // sideslip that calls for full rudder
const SLIP_LEAD = 1;       // s: the feet act on where the sideslip will be this far ahead
const SLOWEST = 30;        // m/s: below this the sideslip's rate is worked out as if at this speed

/**
 * Controls in pilot sense, clamped to their ranges. Back stick, right stick
 * and right rudder are positive; throttle is 0..1. Rudder is left out in the
 * game, and auto-coordination then flies it (see coordinate).
 */
export function normalizeControls(ctl = {}) {
  return {
    elevator: clamp(ctl.elevator ?? 0, -1, 1),
    aileron: clamp(ctl.aileron ?? 0, -1, 1),
    rudder: ctl.rudder === undefined ? undefined : clamp(ctl.rudder, -1, 1),
    throttle: clamp(ctl.throttle ?? 0, 0, 1),
    gear: ctl.gear === true,     // the three toggles: true is gear down, flaps down, brakes on
    flaps: ctl.flaps === true,
    brake: ctl.brake === true,
  };
}

/**
 * Auto-coordination (wings-v1's auto-rudder, always on): the rudder a pilot's
 * feet would hold. They lead the ailerons against their adverse yaw, push
 * against the sideslip, and damp it: they also push against the rate the
 * sideslip is building, so the nose is stopped as it swings instead of being
 * chased back and forth. That rate is known without waiting to see it: the
 * nose slips when the airplane rolls at an angle of attack, when it yaws,
 * and when gravity pulls it sideways in a bank. `air` is the air data with
 * its `gravity` (body axes) filled in.
 */
export function coordinate(card, ctl, air) {
  const lead = (card.aileron.adverseYaw * aileronPower(card, air.qbar)) / card.rudder.cn;
  const [p, , r] = air.omega;
  const slipRate = p * Math.sin(air.alpha) - r * Math.cos(air.alpha) + (air.gravity ? air.gravity[1] : 0) / Math.max(air.V, SLOWEST);
  return clamp(lead * ctl.aileron + (air.beta + SLIP_LEAD * slipRate) / FULL_RUDDER_SLIP, -1, 1);
}

/**
 * Body-axis force and moment on the airplane at a state: aero, thrust along
 * the nose through the CG, gravity and, with a ground, contact. `sys` is the
 * airplane's own state: { sep, power, gear, flaps } - the wing halves' stall
 * state, the engine's power, and the gear and flap positions (0 up, 1 down).
 */
export function totalForces(card, state, ctl, ground = null, sys = AT_REST) {
  const atm = atmosphere(-state.x[2]);
  const air = airData(card, state.v, state.omega, atm);
  if (ground) air.ge = groundEffect(-state.x[2] - ground.heightAt(state.x[0], state.x[1]), card.b);
  const g = qrotateInv(state.q, G_W);
  air.gravity = g;
  air.gear = sys.gear;
  air.flaps = sys.flaps;
  const flown = ctl.rudder === undefined ? { ...ctl, rudder: coordinate(card, ctl, air) } : ctl;
  const aero = aeroForces(card, air, flown, sys.sep);
  // On the ground, tilt steers the nose wheel: a lot when slow, a little when fast.
  const steer = (ctl.aileron * MAX_STEER) / (1 + (air.V / STEER_FADE) ** 2);
  const contact = contactForces(card, state, ground, { brake: ctl.brake, steer }, sys.gear >= 1);
  const T = thrust(card, sys.power, air.mach, atm.rho / RHO0);
  const F = [0, 1, 2].map((i) => aero.F[i] + contact.F[i] + card.m * g[i]);
  F[0] += T;
  const M = [0, 1, 2].map((i) => aero.M[i] + contact.M[i]);
  return { F, M, air, coef: aero.coef, thrust: T };
}

/**
 * How many fixed steps to take for a frame that lasted `elapsed` seconds,
 * with `carry` seconds left over from the frame before (after Rage's
 * stepsFor). A long frame takes at most `maxSteps` and drops the rest, so a
 * slow phone slows the flight down instead of falling ever further behind.
 * `fraction` is how far the picture is between the last two steps, 0..1.
 */
export function stepsFor(carry, elapsed, maxSteps = 8, dt = DT) {
  let time = carry + Math.max(0, elapsed);
  let steps = Math.floor(time / dt + 1e-9);
  if (steps > maxSteps) { steps = maxSteps; time = maxSteps * dt; }
  time -= steps * dt;
  return { steps, carry: time, fraction: time / dt };
}

/** Whether every number in a state is finite. */
export function finite(state) {
  return [state.x, state.v, state.q, state.omega].every((a) => a.every(Number.isFinite));
}

// One step of dt for a gear or flap position toward up (0) or down (1), taking `seconds` for the full travel.
const travel = (position, down, seconds, dt) => clamp(position + (down ? dt : -dt) / seconds, 0, 1);

export class Sim {
  /**
   * card: from deriveCard. state: { x, v, q, omega } (see body.js).
   * options: { ground, throttle, gear, flaps, crashes }. Without a ground there is
   * nothing to land on (headless flight). The engine starts spooled to
   * `throttle`; `gear` and `flaps` say whether each starts down.
   */
  constructor(card, state, { ground = null, throttle = 0, gear = false, flaps = false, crashes = true } = {}) {
    this.card = card;
    this.state = state;
    this.ground = ground;
    this.t = 0;
    this.sep = [0, 0];     // how stalled each wing half is, right then left, 0..1
    this.power = powerWanted(throttle);   // the engine: 0 idle, 1 MIL, 2 full afterburner
    this.gear = gear ? 1 : 0;             // 0 up, 1 down and locked
    this.flaps = flaps ? 1 : 0;           // 0 up, 1 down
    this.crashes = crashes;   // false is the crash override: no arrival, however hard, ends the flight
    this.crashed = null;   // set once: by the touchdown check, or by the safety net
    this.touching = touching(card, state, ground, this.gear >= 1);
  }

  /** Advance one fixed step with the given controls. After a crash the sim no longer steps. */
  step(controls) {
    if (this.crashed) return this.state;
    const ctl = normalizeControls(controls);
    const before = this.state;
    // Gear and flaps travel first, so the whole step sees one set of contact
    // points. When the wheels lock down or come up, the points that can touch
    // change: wheels that appear already in the ground have arrived, and
    // arrive at the speed the airplane is coming down.
    const hadWheels = this.gear >= 1;
    this.gear = travel(this.gear, ctl.gear, GEAR_SECONDS, DT);
    this.flaps = travel(this.flaps, ctl.flaps, FLAP_SECONDS, DT);
    const wheels = this.gear >= 1;
    if (wheels !== hadWheels && this.ground) {
      const airframe = this.touching.slice(hadWheels ? this.card.contacts.filter(onGear).length : 0);
      if (wheels) {
        let i = 0;
        const was = this.card.contacts.map((p) => (onGear(p) ? false : airframe[i++]));
        if (this.crashes) this.crashed = crashCheck(this.card, before, before, this.ground, was, true);
        if (this.crashed) return this.state;
      }
      this.touching = touching(this.card, before, this.ground, wheels);
    }
    const sys = { sep: this.sep, power: this.power, gear: this.gear, flaps: this.flaps };
    const forces = (s) => totalForces(this.card, s, ctl, this.ground, sys);
    const after = rk4Step(before, this.t, DT, forces, this.card.m, this.card.I);
    // The safety net: a state that is no longer a number ends the flight on the
    // last good state, the way a crash does, instead of freezing the game.
    if (!finite(after)) {
      this.crashed = { reason: 'broken state', value: this.t };
      return this.state;
    }
    after.omega = after.omega.map((w) => clamp(w, -MAX_RATE, MAX_RATE));
    this.state = after;
    this.t += DT;
    const air = airData(this.card, after.v, after.omega, atmosphere(-after.x[2]));
    this.sep = separationStep(this.card, air, this.sep, DT);
    this.power = powerStep(this.power, powerWanted(ctl.throttle), DT);
    if (this.ground && this.crashes) this.crashed = crashCheck(this.card, before, after, this.ground, this.touching, wheels);
    this.touching = touching(this.card, after, this.ground, wheels);
    return this.state;
  }

  /** Forces, air data and coefficients at the current state, for instruments and tests. */
  observe(controls) {
    const sys = { sep: this.sep, power: this.power, gear: this.gear, flaps: this.flaps };
    return totalForces(this.card, this.state, normalizeControls(controls), this.ground, sys);
  }

  /** World-axis velocity (m/s): north, east, down. */
  velocityWorld() {
    return qrotate(this.state.q, this.state.v);
  }
}
