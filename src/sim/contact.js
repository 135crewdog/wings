// From 135crewdog/wings-v1, src/sim/contact.js, with the changes of
// docs/sim-core-review.md finding 17: the wheel brake is its own control, the
// nose wheel steers, wheels are there only with the gear down, and only a
// hard arrival ends a flight.
// Ground contact. Normal and friction forces at each contact point, and the
// touchdown check that ends a flight. Pure functions; the ground comes from the caller.
//
// ground: { heightAt(x, y) → m above sea level, surfaceAt(x, y) → name, surfaces: { name: { mu_roll,
// mu_side, mu_brake, mu_skid } } }. The forces treat the ground under each point as level; the touchdown
// check knows its slope, so flying into a hillside is the hard arrival it is. A surface with `ends: true`
// (water, lava) ends the flight at any touch.
// The ground may also carry `solidBetween(from, to)` → the name of a landmark's solid shape on the straight
// path between two points, each [north, east, up], or null: the piers, towers and walls that stand on the
// land. Touching one ends the flight.

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
function pointForce(p, ps, state, ground, brakeOn, steer) {
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
    // The nose wheel is turned by the steering angle (positive to the right).
    const turn = p.steers ? steer : 0, cos = Math.cos(turn), sin = Math.sin(turn);
    const fwd = [xw[0] / flat, xw[1] / flat];
    const er = [fwd[0] * cos - fwd[1] * sin, fwd[0] * sin + fwd[1] * cos], es = [er[1], -er[0]];
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


/** The points that can touch: the airframe always; the wheels and the rest of the gear only with the gear down. */
export const onGear = (p) => p.wheel || p.gearOnly === true;
export const contactPoints = (card, gearDown) => (gearDown ? card.contacts : card.contacts.filter((p) => !onGear(p)));

/**
 * Total body-axis contact force and moment. ctl: { brake, steer } - wheel
 * brakes on or off, and the nose wheel's steering angle (rad).
 */
export function contactForces(card, state, ground, ctl, gearDown = true) {
  const F = [0, 0, 0], M = [0, 0, 0];
  if (!ground) return { F, M };
  for (const p of contactPoints(card, gearDown)) {
    const fw = pointForce(p, pointState(state, p.r, ground), state, ground, ctl.brake === true, ctl.steer ?? 0);
    if (!fw) continue;
    const fb = qrotateInv(state.q, fw);
    const mb = cross(p.r, fb);
    for (let i = 0; i < 3; i++) { F[i] += fb[i]; M[i] += mb[i]; }
  }
  return { F, M };
}

/** Which contact points are inside the ground (d > 0). */
export function touching(card, state, ground, gearDown = true) {
  const points = contactPoints(card, gearDown);
  if (!ground) return points.map(() => false);
  return points.map((p) => pointState(state, p.r, ground).d > 0);
}

const up = (x) => [x[0], x[1], -x[2]];
const SLOPE_STEP = 5;   // m: the ground's slope is measured this far either side of a point

/**
 * How fast the airplane is closing with the ground under a point (m/s): its velocity into the
 * surface there. On level ground that is its sink rate; into a hillside it is most of its speed.
 */
export function closingSpeed(state, at, ground) {
  const [vn, ve, vd] = qrotate(state.q, state.v), [n, e] = at;
  const gn = (ground.heightAt(n + SLOPE_STEP, e) - ground.heightAt(n - SLOPE_STEP, e)) / (2 * SLOPE_STEP);
  const ge = (ground.heightAt(n, e + SLOPE_STEP) - ground.heightAt(n, e - SLOPE_STEP)) / (2 * SLOPE_STEP);
  return (vn * gn + ve * ge + vd) / Math.hypot(gn, ge, 1);
}

/**
 * The touchdown check, after a step from `before` to `after`: a point that wasn't touching
 * and now is has touched down. What counts is how fast the airplane as a whole was closing
 * with the ground there, measured in `before`, the last state before contact; within the step
 * the contact's damping has already slowed it. It is the airplane's own speed into the ground and
 * not the point's, so a wing low or a nose slapping down is not punished harder than a level arrival.
 * Only a hard arrival is a crash: scrapes, slides and wingtip touches survive. Water is the
 * exception: any point in it ends the flight, however gently it got there. So is a landmark:
 * any point whose path through the step touches one of its solid shapes ends the flight.
 * Returns null, or the crash: { point, reason, value }.
 */
export function crashCheck(card, before, after, ground, wasTouching, gearDown = true) {
  if (!ground) return null;
  const points = contactPoints(card, gearDown);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const ps = pointState(after, p.r, ground);
    const solid = ground.solidBetween ? ground.solidBetween(up(add(before.x, qrotate(before.q, p.r))), up(ps.rw)) : null;
    if (solid) return { point: p.name, reason: 'landmark', value: 0, solid };
    if (ps.d <= 0) continue;
    const under = ground.surfaceAt(ps.rw[0], ps.rw[1]);
    if (ground.surfaces[under].ends) return { point: p.name, reason: under, value: 0 };
    if (wasTouching[i]) continue;
    const closing = closingSpeed(before, ps.rw, ground);
    if (closing > card.crash.sink) return { point: p.name, reason: 'hard impact', value: closing };
  }
  return null;
}
