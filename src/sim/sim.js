// The simulation: one airplane, a state, and step(controls) at a fixed 1/120 s.
// From 135crewdog/wings-v1, src/sim/sim.js, with the safety net of
// docs/sim-core-review.md finding 2 added and the wind removed (the air is
// always still). Forces: aerodynamics, gravity, and ground contact when a
// ground is given. Thrust joins with the engine.

import { atmosphere, G0 } from './atmosphere.js';
import { aeroForces, airData, groundEffect, separationStep } from './aero.js';
import { rk4Step } from './body.js';
import { contactForces, crashCheck, touching } from './contact.js';
import { qrotate, qrotateInv } from './vec.js';

export const DT = 1 / 120;
export const MAX_RATE = 20;   // rad/s: body rates are held inside this, far beyond any real maneuver
const G_W = [0, 0, G0];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Controls in pilot sense, clamped to their ranges. Back stick, right stick and right rudder are positive. */
export function normalizeControls(ctl = {}) {
  return {
    elevator: clamp(ctl.elevator ?? 0, -1, 1),
    aileron: clamp(ctl.aileron ?? 0, -1, 1),
    rudder: clamp(ctl.rudder ?? 0, -1, 1),
    brake: ctl.brake === true,
  };
}

/** Body-axis force and moment on the airplane at a state: aero, gravity and, with a ground, contact. */
export function totalForces(card, state, ctl, ground = null, sep = [0, 0]) {
  const atm = atmosphere(-state.x[2]);
  const air = airData(card, state.v, state.omega, atm);
  if (ground) air.ge = groundEffect(-state.x[2] - ground.heightAt(state.x[0], state.x[1]), card.b);
  const aero = aeroForces(card, air, ctl, sep);
  const contact = contactForces(card, state, ground, ctl);
  const g = qrotateInv(state.q, G_W);
  const F = [0, 1, 2].map((i) => aero.F[i] + contact.F[i] + card.m * g[i]);
  const M = [0, 1, 2].map((i) => aero.M[i] + contact.M[i]);
  return { F, M, air, coef: aero.coef };
}

/** Whether every number in a state is finite. */
export function finite(state) {
  return [state.x, state.v, state.q, state.omega].every((a) => a.every(Number.isFinite));
}

export class Sim {
  /**
   * card: from deriveCard. state: { x, v, q, omega } (see body.js).
   * options: { ground }. Without a ground there is nothing to land on (headless flight).
   */
  constructor(card, state, { ground = null } = {}) {
    this.card = card;
    this.state = state;
    this.ground = ground;
    this.t = 0;
    this.sep = [0, 0];     // how stalled each wing half is, right then left, 0..1
    this.crashed = null;   // set once: by the touchdown check, or by the safety net
    this.touching = touching(card, state, ground);
  }

  /** Advance one fixed step with the given controls. After a crash the sim no longer steps. */
  step(controls) {
    if (this.crashed) return this.state;
    const ctl = normalizeControls(controls);
    const forces = (s) => totalForces(this.card, s, ctl, this.ground, this.sep);
    const before = this.state;
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
    if (this.ground) {
      this.crashed = crashCheck(this.card, before, after, this.ground, this.touching);
      this.touching = touching(this.card, after, this.ground);
    }
    return this.state;
  }

  /** Forces, air data and coefficients at the current state, for instruments and tests. */
  observe(controls) {
    return totalForces(this.card, this.state, normalizeControls(controls), this.ground, this.sep);
  }

  /** World-axis velocity (m/s): north, east, down. */
  velocityWorld() {
    return qrotate(this.state.q, this.state.v);
  }
}
