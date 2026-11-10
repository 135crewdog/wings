// From 135crewdog/wings-v1, src/sim/contact.js.
// Ground contact. Normal and friction forces at each contact point, and the
// touchdown check that ends a flight. Pure functions; the ground comes from the caller.
//
// ground: { heightAt(x, y) → m above sea level, surfaceAt(x, y) → name, surfaces: { name: { mu_roll,
// mu_side, mu_brake, mu_skid } } }. The ground is flat: its normal is world up.

import { add, cross, qrotate, qrotateInv } from './vec.js';

export const V_SLIP = 0.1; // m/s,

const N_UP = [0, 0, -1];
const sat = (u) => Math.max(-1, Math.min(1, u));

/** A contact point's position, velocity, penetration and penetration rate. */
export function pointState(state, r, ground) {
  const rw = add(state.x, qrotate(state.q, r));
  const vb = add(state.v, cross(state.omega, r));
  const vw = qrotate(state.q, vb);
  const d = ground.heightAt(rw[0], rw[1]) + rw[2];
  return { rw, vw, d, dDot: vw[2] }; // flat ground: ḋ = −(v_p · n) = v_p.z
}

/** The world-axis force on one point ; zero when it isn't touching. */
function pointForce(p, ps, state, ground, brakeOn) {
  if (ps.d <= 0) return null;
  const N = Math.max(0, p.k * ps.d + p.c * ps.dDot);
  if (N === 0) return null;
  const mu = ground.surfaces[ground.surfaceAt(ps.rw[0], ps.rw[1])];
  const vt = [ps.vw[0], ps.vw[1], 0]; // along the flat ground
  let fx = 0, fy = 0;
  // A wheel rolls along the body x axis laid flat; one pointing straight up or down slides.
  const xw = qrotate(state.q, [1, 0, 0]);
  const flat = Math.hypot(xw[0], xw[1]);
  if (p.wheel && flat > 1e-6) {
    const er = [xw[0] / flat, xw[1] / flat], es = [er[1], -er[0]];
    const along = vt[0] * er[0] + vt[1] * er[1], across = vt[0] * es[0] + vt[1] * es[1];
    const fr = -(mu.mu_roll + (p.brake && brakeOn ? mu.mu_brake : 0)) * N * sat(along / V_SLIP);
    const fs = -mu.mu_side * N * sat(across / V_SLIP);
    fx = fr * er[0] + fs * es[0];
    fy = fr * er[1] + fs * es[1];
  } else {
    const speed = Math.hypot(vt[0], vt[1]);
    const mu_k = p.wheel ? mu.mu_side : mu.mu_skid;
    const scale = (-mu_k * N) / Math.max(speed, V_SLIP);
    fx = scale * vt[0];
    fy = scale * vt[1];
  }
  return [fx + N * N_UP[0], fy + N * N_UP[1], N * N_UP[2]];
}


/** Total body-axis contact force and moment. */
export function contactForces(card, state, ground, ctl) {
  const F = [0, 0, 0], M = [0, 0, 0];
  if (!ground || card.contacts.length === 0) return { F, M };
  const brakeOn = ctl.brake === true;   // wheel brakes are their own control (wings-v1 tied them to the airbrake)
  for (const p of card.contacts) {
    const fw = pointForce(p, pointState(state, p.r, ground), state, ground, brakeOn);
    if (!fw) continue;
    const fb = qrotateInv(state.q, fw);
    const mb = cross(p.r, fb);
    for (let i = 0; i < 3; i++) { F[i] += fb[i]; M[i] += mb[i]; }
  }
  return { F, M };
}

/** Which contact points are inside the ground (d > 0). */
export function touching(card, state, ground) {
  if (!ground) return card.contacts.map(() => false);
  return card.contacts.map((p) => pointState(state, p.r, ground).d > 0);
}

/**
 * The touchdown check, after a step from `before` to `after`: a point that wasn't touching
 * and now is has touched down. Its speeds are the ones it arrived with, measured in `before`, the
 * last state before contact; within the step the contact's damping has already slowed it.
 * Returns null, or the crash: { point, reason, value }.
 */
export function crashCheck(card, before, after, ground, wasTouching) {
  if (!ground) return null;
  for (let i = 0; i < card.contacts.length; i++) {
    const p = card.contacts[i];
    if (wasTouching[i] || pointState(after, p.r, ground).d <= 0) continue;
    const arrival = pointState(before, p.r, ground);
    if (p.wheel && arrival.dDot > card.crash.wheelSink)
      return { point: p.name, reason: "wheel sink rate", value: arrival.dDot };
    const slide = Math.hypot(arrival.vw[0], arrival.vw[1]);
    if (!p.wheel && slide > card.crash.skidSpeed)
      return { point: p.name, reason: "skid speed along the ground", value: slide };
  }
  return null;
}
