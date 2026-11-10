// The test field: flat ground at sea level with one runway, until the island
// replaces it. One description, used by the simulation (where the ground is,
// where the airplane starts) and by the picture (what to draw). No browser code.

import { FT, DEG, KT } from './sim/card.js';
import { flatGround } from './sim/ground.js';
import { qfromEuler, qrotateInv } from './sim/vec.js';

export const FIELD = {
  height: 0,            // m above sea level
  // The runway runs north-south through the middle of the field. Positions
  // are metres north and east of that middle.
  runway: { length: 10000 * FT, width: 150 * FT, numbers: ['36', '18'] },   // the south end is 36, taking off north
  startBack: 200 * FT,  // the airplane starts this far in from the south end, on the numbers
};

/** The field's ground, for the simulation. */
export const fieldGround = () => flatGround(FIELD.height);

/**
 * The state of an airplane on or just above flat ground: on its wheels,
 * moving at `kt` along its heading, nose `pitch` and `roll` degrees from
 * level. `sink` (ft/min) starts it just above the ground coming down, as at
 * touchdown. With `gear` false it rests on its belly. `north` and `east`
 * (metres) and `heading` (degrees) say where; `height` is the ground's.
 */
export function onGround(card, { kt = 0, sink = 0, pitch = 0, roll = 0, gear = true, north = 0, east = 0, heading = 0, height = 0 } = {}) {
  const points = card.contacts.filter((p) => gear || !(p.wheel || p.gearOnly));
  const th = pitch * DEG, ph = roll * DEG;
  // How far below the centre of gravity the lowest point hangs at this attitude.
  const low = Math.max(...points.map((p) => -Math.sin(th) * p.r[0] + Math.cos(th) * (Math.sin(ph) * p.r[1] + Math.cos(ph) * p.r[2])));
  const q = qfromEuler(ph, th, heading * DEG);
  const psi = heading * DEG, V = kt * KT;
  return {
    x: [north, east, -height - (low + (sink > 0 ? 0.05 : -0.1))],
    v: qrotateInv(q, [V * Math.cos(psi), V * Math.sin(psi), (sink * FT) / 60]),
    q,
    omega: [0, 0, 0],
  };
}

/** Where a flight starts: on the runway numbers at the south end, pointing north. */
export function startState(card) {
  return onGround(card, { north: -FIELD.runway.length / 2 + FIELD.startBack, height: FIELD.height });
}
