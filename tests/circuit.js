// A pilot for one circuit of a field, flown through the same controls the app
// gives the player: stick, throttle, and the gear, flap and brake toggles.
// Take off, turn right onto downwind, come round to the right onto final,
// land and stop. The pilot thinks in the runway's own terms: "north" is along
// the takeoff heading from the runway's middle, "east" is to its right.

import { FIELD as TEST_FIELD } from '../src/field.js';
import { FT } from '../src/sim/card.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const DEG = Math.PI / 180;
const turn = (to, from) => ((to - from + 540) % 360) - 180;   // degrees to turn, the short way

/** Returns controls(readout) for fly(); `.phase` says where in the circuit it is, `.events` what happened when. */
export function circuit({ pattern = 1500, downwind = 300, final = 160, field = TEST_FIELD } = {}) {
  const FIELD = field, way = field.heading * DEG;
  const south = -FIELD.runway.length / 2;   // the landing threshold, metres north of the middle
  let phase = 'roll', trim = 0, power = 0.4, last = null, alpha = 3;
  const events = {};
  const mark = (name, r) => { if (!(name in events)) events[name] = { t: r.t, kias: r.kias, ft: r.ft, north: r.north, east: r.east }; };

  // The elevator for a pitch attitude; the throttle for a speed; the aileron for a heading.
  const pitchTo = (r, deg, dt) => {
    const err = deg - r.pitch;
    trim = clamp(trim + 0.03 * err * dt, -0.6, 0.9);
    return clamp(trim + 0.06 * err - 0.025 * r.pitchRate, -1, 1);
  };
  // To hold a height: aim the flight path, and add the angle of attack (as it has been lately) for the nose.
  // `slope` is the path's own angle (degrees, negative going down).
  const climbTo = (r, ft, dt, limit = 10, slope = 0) => {
    alpha += (r.alpha - alpha) * Math.min(1, dt / 4);
    const fpm = r.groundKt * 101.27 * Math.tan(slope * DEG);   // the climb rate of the path itself
    return pitchTo(r, alpha + slope + clamp((ft - r.ft) * 0.02 - (r.fpm - fpm) * 0.002, -limit, limit), dt);
  };
  const speedTo = (r, kt, dt, max = 0.8) => {
    const err = kt - r.kias;
    power = clamp(power + 0.004 * err * dt, 0, max);
    return clamp(power + 0.02 * err, 0, max);
  };
  const bankTo = (r, deg) => clamp(0.03 * (deg - r.roll) - 0.012 * r.rollRate, -1, 1);
  const headTo = (r, deg, most = 45) => bankTo(r, clamp(turn(deg, r.heading) * 1.5, -most, most));

  // A readout in the runway's terms, heights and all.
  const onRunway = (r) => {
    const n = r.north - field.north, e = r.east - field.east;
    return { ...r, north: n * Math.cos(way) + e * Math.sin(way), east: -n * Math.sin(way) + e * Math.cos(way), heading: turn(r.heading, field.heading) };
  };
  const fly = (seen) => {
    const r = onRunway(seen);
    const dt = last === null ? 0 : r.t - last;
    last = r.t;
    const agl = r.ft - FIELD.height / FT;
    switch (phase) {
      case 'roll':      // brakes off, afterburner, rotate
        if (r.kias > 165) phase = 'rotate';
        return { throttle: 1, gear: true, flaps: true, brake: false, elevator: 0, aileron: headTo(r, 0, 5) };
      case 'rotate':
        if (!r.onGround) mark('liftoff', r);
        if (agl > 300) phase = 'climb';
        return { throttle: 1, gear: true, flaps: true, elevator: pitchTo(r, 12, dt), aileron: r.onGround ? 0 : bankTo(r, 0) };
      case 'climb':     // clean up, climb straight ahead to pattern altitude
        if (r.ft > pattern - 200 && r.north > FIELD.runway.length / 2) phase = 'crosswind';
        return { throttle: speedTo(r, downwind, dt), elevator: climbTo(r, pattern, dt), aileron: headTo(r, 0) };
      case 'crosswind': // a right turn to downwind
        if (Math.abs(turn(180, r.heading)) < 30) phase = 'downwind';
        return { throttle: speedTo(r, downwind, dt), elevator: climbTo(r, pattern, dt), aileron: bankTo(r, 45) };
      case 'downwind':  // past the landing end, slow down and put the gear and flaps down
        if (r.north < south - 30000 * FT) { mark('base', r); phase = 'base'; }
        return { throttle: speedTo(r, r.north < south ? 200 : downwind, dt), gear: r.north < south, flaps: r.north < south, elevator: climbTo(r, pattern, dt), aileron: headTo(r, 180) };
      case 'base':      // a right turn onto final
        if (Math.abs(turn(0, r.heading)) < 60) phase = 'final';
        return { throttle: speedTo(r, 200, dt), gear: true, flaps: true, elevator: climbTo(r, pattern, dt), aileron: bankTo(r, 35) };
      case 'final': {   // line up on the centreline, three degrees down to the numbers
        const toGo = south + 300 - r.north;                     // metres to the aim point
        const onPath = (toGo * Math.tan(3 * DEG)) / FT < pattern, path = onPath ? (toGo * Math.tan(3 * DEG)) / FT : pattern;
        if (agl < 25) { mark('flare', r); phase = 'flare'; }
        const heading = clamp(-r.east * 0.06, -35, 35);   // toward the centreline, then along it
        return { throttle: speedTo(r, final, dt), gear: true, flaps: true, elevator: climbTo(r, FIELD.height / FT + path, dt, 6, onPath ? -3 : 0), aileron: headTo(r, heading, 30) };
      }
      case 'flare':     // throttle to idle, hold the nose up, let it settle
        if (r.onGround) { mark('touchdown', r); phase = 'stop'; }
        return { throttle: 0, gear: true, flaps: true, elevator: pitchTo(r, 9, dt), aileron: bankTo(r, 0) };
      default:          // on the runway: nose down, brakes on, keep straight
        if (r.groundKt < 1) mark('stopped', r);
        return { throttle: 0, gear: true, flaps: true, brake: true, elevator: 0, aileron: clamp(-r.east * 0.01 - turn(r.heading, 0) * 0.05, -0.3, 0.3) };
    }
  };
  const pilot = (r) => fly(r);
  Object.defineProperty(pilot, 'phase', { get: () => phase });
  pilot.events = events;
  return pilot;
}
