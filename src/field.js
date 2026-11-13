// A field: a runway, and where the airplane starts on it. One description,
// used by the simulation (where the airplane starts) and by the picture (what
// to draw). There are two: the island's air base, where the app flies, and
// the old flat test field at sea level, which the headless tests still fly
// from. No browser code.

import { FT, DEG, KT } from './sim/card.js';
import { flatGround } from './sim/ground.js';
import { qfromEuler, qrotateInv } from './sim/vec.js';

export const FIELD = {
  height: 0,            // m above sea level
  north: 0, east: 0,    // the runway's middle
  heading: 0,           // degrees: the way a takeoff goes
  runway: { length: 10000 * FT, width: 150 * FT, numbers: ['36', '18'] },   // the south end is 36, taking off north
  startBack: 200 * FT,  // the airplane starts this far in from the runway's end, on the numbers
};

/**
 * The island's air base (docs/island.md): runway 10/28, 9,200 by 150 feet,
 * taking off on 28. `region` is terrain/island.json and `island` its land
 * (src/sim/island.js): the runway lies at the height the land has there.
 */
export function baseField(region, island) {
  const { north, east, heading } = region.sites.base;
  return { height: island.heightAt(north, east), north, east, heading, runway: { length: 9200 * FT, width: 150 * FT, numbers: ['28', '10'] }, startBack: 200 * FT };
}

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

/** How a flight starts: parked, gear and flaps down, brakes on, engine at idle. */
export const PARKED = Object.freeze({ elevator: 0, aileron: 0, throttle: 0, gear: true, flaps: true, brake: true });

/** Where a flight starts: on the numbers at the runway's near end, pointing down it. */
export function startState(card, field = FIELD) {
  const back = field.runway.length / 2 - field.startBack, a = field.heading * DEG;
  return onGround(card, { north: field.north - back * Math.cos(a), east: field.east - back * Math.sin(a), heading: field.heading, height: field.height });
}
