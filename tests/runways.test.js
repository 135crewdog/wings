// A takeoff from every runway end in Hawaii: which of them can an F-4C get
// out of? A report, not a grade: a runway too short for the jet doesn't fail
// the build. What does fail it is a start that isn't a start: off the
// runway, through the ground, or not sitting on its wheels.
//
// The takeoff is the checkride's own (tests/checkride.test.js, "Takeoff"):
// gear and flaps down, full afterburner from the start, the stick full back
// from 80 kt, and once airborne the nose held 10 degrees up. A real runway
// adds only this: the jet starts as the app starts it (src/flight.js), on the
// numbers 200 ft in from the end, on Hawaii's own ground and settled on its
// brakes; the brakes come off as the throttle goes to full burner; and tilt
// holds the centreline. The air is the standard atmosphere at the runway's
// own height, as it is everywhere in the flight model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, readout, takeoffStick, FT, DEG, DT } from './fly.js';
import { index, hawaii } from './tiles.js';
import { Sim } from '../src/sim/sim.js';
import { PARKED, randomEnd, runwayEnds, runwayField, startState } from '../src/field.js';

const NM = 1852;
const AHEAD = 3 * NM;          // how far past the runway's end the ground is looked at, and the takeoff flown
const SPARE = 1000 * FT;       // less runway than this left at 50 ft is "tight"
const c = card();
const wheels = c.contacts.filter((p) => p.wheel);
const wheelsBelow = Math.max(...wheels.map((p) => p.r[2] - p.sag));   // the wheels under the centre of gravity, at rest (as src/flight.js)
const isNose = c.contacts.map((p) => p.name === 'nose wheel');
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const turn = (a) => ((a + 540) % 360) - 180;   // an angle as -180..180
const feet = (m, to = 10) => (Math.round(m / FT / to) * to).toLocaleString('en-US');

/** Every runway end: 27 runways, both ends of each. */
const SHORT = { PHNL: 'Honolulu', PHKO: 'Kona', PHNG: 'Kaneohe Bay', PHDH: 'Kawaihapai (Dillingham)' };   // the names a pilot uses, where the index's are long
const fieldName = (way) => SHORT[way.airport] ?? way.name.replace(/ (International )?Airport$| Army Airfield$/, '');
const ends = runwayEnds(index.runways).map((end) => ({ ...end, name: `${fieldName(end.way)} ${end.way.ends[end.from].ident}` }));

/**
 * Tilt that holds the centreline. On the wheels it steers the nose wheel
 * toward the line (the steering fades with speed, as in the app); in the air
 * it banks gently toward it, 10 degrees at most. `across` is metres right of
 * the centreline, `off` degrees the track or the nose points right of it.
 */
const centreline = (r, across, off) => (r.onGround
  ? clamp(-(0.05 * across + 0.1 * off) * (1 + (r.groundKt / 30) ** 2), -0.3, 0.3)
  : clamp(0.04 * (clamp(-(0.5 * across + 3 * off), -10, 10) - r.roll) - 0.015 * r.rollRate, -1, 1));

/** The highest the ground stands on the runway's line, within 3 nm past its far end (m above the runway). */
function groundAhead(field) {
  const a = field.heading * DEG, far = field.runway.length / 2;
  let top = -Infinity;
  for (let s = far; s <= far + AHEAD; s += index.post) top = Math.max(top, hawaii.heightAt(field.north + s * Math.cos(a), field.east + s * Math.sin(a)));
  return top - field.height;
}

/**
 * One takeoff from a runway end. Returns what happened, in metres, knots and
 * seconds. With `fumble`, the pilot's tilt slips: a little right tilt (15%)
 * from 30 to 45 kt, in place of holding the centreline.
 */
function takeoff({ way, from, name }, fumble = false) {
  const field = runwayField(way, from), a = field.heading * DEG;
  const dir = [Math.cos(a), Math.sin(a)], length = field.runway.length;
  // Where the jet is against the runway: metres along it from the end behind, and right of its centreline.
  const place = (x) => {
    const n = x[0] - field.north, e = x[1] - field.east;
    return { along: n * dir[0] + e * dir[1] + length / 2, across: e * dir[0] - n * dir[1] };
  };
  // The app's own start: parked on the numbers, settled for 3 s on the brakes at idle.
  const start = startState(c, field);
  const sim = new Sim(c, start, { ground: hawaii, gear: true, flaps: true });
  const at = place(start.x);
  assert.ok(Math.abs(at.along - field.startBack) < 0.01 && Math.abs(at.across) < 0.01, `${name}: it starts on the numbers, 200 ft in, on the centreline`);
  assert.equal(hawaii.surfaceAt(start.x[0], start.x[1]), 'runway', `${name}: the start is dry runway`);
  assert.ok(Math.abs(hawaii.heightAt(start.x[0], start.x[1]) - field.height) < 0.01, `${name}: the ground under the start is the runway's height`);
  // Never through the ground: the wheels never sink further than a tyre squashes.
  let deepest = 0;
  const sunk = () => { deepest = Math.max(deepest, hawaii.heightAt(sim.state.x[0], sim.state.x[1]) + sim.state.x[2] + wheelsBelow); };
  for (let t = 0; t < 3; t += DT) { sim.step(PARKED); sunk(); }
  const parked = readout(sim, PARKED), rest = place(sim.state.x);
  assert.equal(sim.crashed, null, `${name}: it is in one piece on the brakes`);
  assert.ok(c.contacts.every((p, i) => sim.touching[i] === !!p.wheel), `${name}: it sits on all its wheels and nothing else before the brakes come off`);
  assert.ok(parked.groundKt < 0.5 && Math.abs(parked.fpm) < 20, `${name}: it sits still (${parked.groundKt.toFixed(2)} kt)`);
  assert.ok(Math.abs(rest.along - field.startBack) < 1 && Math.abs(rest.across) < 0.5, `${name}: it is still on the numbers`);
  assert.ok(Math.abs(turn(parked.heading - field.heading)) < 0.5 && Math.abs(parked.pitch) < 2 && Math.abs(parked.roll) < 1, `${name}: it points down the runway, level on its gear`);
  assert.ok(Math.abs(-sim.state.x[2] - wheelsBelow - field.height) < 0.05, `${name}: its wheels are at the runway's height`);

  // Brakes off and full afterburner together.
  const out = { name, field, wheelOff: null, off: null, at50: null, lowestOver: Infinity, widest: 0, widestUp: 0, rollEnd: null };
  const t0 = sim.t;
  let ctl = { ...PARKED }, airborne = 0, was = null;
  while (sim.t - t0 < 120 && !sim.crashed) {
    const r = readout(sim, ctl), here = place(sim.state.x);
    const vw = sim.velocityWorld(), moving = r.groundKt > 20;
    const off = moving && !r.onGround ? turn(Math.atan2(vw[1], vw[0]) / DEG - field.heading) : turn(r.heading - field.heading);
    const up = -sim.state.x[2] - wheelsBelow - field.height;   // the wheels above the runway
    if (r.onGround) out.widest = Math.max(out.widest, Math.abs(here.across));
    else out.widestUp = Math.max(out.widestUp, Math.abs(here.across));
    if (out.wheelOff === null && r.kias > 80 && !sim.touching.some((touching, i) => touching && isNose[i])) out.wheelOff = r.kias;
    // Lifted off: the first moment of a second clear of the ground (the checkride's rule).
    airborne = r.onGround ? 0 : airborne + 1;
    if (airborne === 1) was = { kias: r.kias, t: sim.t - t0, roll: here.along - rest.along, left: length - here.along, across: here.across };
    if (out.off === null && airborne * DT >= 1) out.off = was;
    if (out.off && out.at50 === null && up >= 50 * FT) out.at50 = { kias: r.kias, t: sim.t - t0, left: length - here.along };
    if (out.rollEnd === null && here.along >= length) out.rollEnd = { kias: r.kias, onGround: r.onGround, up };
    if (here.along > length) out.lowestOver = Math.min(out.lowestOver, -sim.state.x[2] - wheelsBelow - hawaii.heightAt(sim.state.x[0], sim.state.x[1]));
    if (here.along > length + AHEAD) break;
    ctl = { ...PARKED, brake: false, throttle: 1, elevator: takeoffStick(r), aileron: fumble && r.onGround && r.groundKt > 30 && r.groundKt < 45 ? 0.15 : centreline(r, here.across, off) };
    sim.step(ctl);
    sunk();
  }
  assert.ok(deepest < 0.3, `${name}: it never falls through the ground (wheels ${deepest.toFixed(2)} m in at most)`);
  out.crashed = sim.crashed;
  out.rise = groundAhead(field);
  out.length = length;
  out.verdict = out.at50 === null || out.at50.left < 0 ? 'no' : out.at50.left < SPARE ? 'tight' : 'fine';
  return out;
}

const find = (airport, ident) => ends.find((e) => e.way.airport === airport && e.way.ends[e.from].ident === ident);
const line = (o) => {
  // Past the runway's end, nose held 10 degrees up: worth a word only if the ground comes closer than it was at the end.
  const after = o.crashed ? `hits ${o.crashed.reason === 'water' ? 'the water' : 'the ground'} ahead`
    : o.rollEnd && o.lowestOver < o.rollEnd.up - 5 * FT ? `then comes within ${feet(o.lowestOver)} ft of the rising ground` : '';
  return [
    o.name.padEnd(28), feet(o.length).padStart(7), feet(o.field.height).padStart(7),
    (o.wheelOff ? Math.round(o.wheelOff) : '-').toString().padStart(5), (o.off ? Math.round(o.off.kias) : '-').toString().padStart(5),
    (o.off ? feet(o.off.roll) : 'never').padStart(7), (o.at50 ? feet(o.at50.left) : 'never').padStart(8),
    (o.rollEnd ? feet(o.rollEnd.up) : '-').padStart(7), feet(o.rise).padStart(7), `  ${o.verdict.padEnd(6)}`, after,
  ].join(' ');
};
const HEAD = `${'runway end'.padEnd(28)} ${'length'.padStart(7)} ${'height'.padStart(7)} ${'nose'.padStart(5)} ${'off'.padStart(5)} ${'roll'.padStart(7)} ${'left@50'.padStart(8)} ${'at end'.padStart(7)} ${'ahead'.padStart(7)}   mark`;
const KEY = `  feet and knots. nose: the nose wheel lifts; off: lifts off; roll: ground roll from brakes off to liftoff;
  left@50: runway left when the wheels are 50 ft up; at end: the wheels' height crossing the runway's far end;
  ahead: how high the ground rises above the runway within 3 nm straight ahead.
  fine: 1,000 ft or more of runway left at 50 ft; tight: less; no: not 50 ft up by the end of the runway.`;

const flown = new Map();
const flownFrom = (end) => flown.get(end) ?? flown.set(end, takeoff(end)).get(end);

test('the procedure is the checkride\'s: Honolulu 08R, then a short runway and a high one', () => {
  const hnl = flownFrom(find('PHNL', '08R'));
  const proof = [hnl, flownFrom(find('PHJH', '02')), flownFrom(find('PHJH', '20')), ...ends.filter((e) => e.way.airport === 'PHSF').map(flownFrom)];
  console.log(`\n  ${HEAD}\n${proof.map((o) => `  ${line(o)}`).join('\n')}\n${KEY}`);
  // The checkride's takeoff, on a flat field at sea level: the nose wheel lifts at the card's 150 kt and the jet lifts off at about 174.
  assert.ok(Math.abs(hnl.wheelOff - c.pilot.rotate_kt) <= 5, `at Honolulu the nose wheel lifts at ${hnl.wheelOff.toFixed(0)} kt, within 5 kt of the card's ${c.pilot.rotate_kt}`);
  assert.ok(Math.abs(hnl.off.kias - 174) <= 5, `and the jet lifts off at ${hnl.off.kias.toFixed(0)} kt, about 174`);
  assert.equal(hnl.verdict, 'fine');
});

test('tilt holds the centreline: a slip of the hand on Princeville\'s 60 ft of runway is steered out', () => {
  const end = find('HI01', '05'), straight = flownFrom(end), slipped = takeoff(end, true);
  const half = straight.field.runway.width / 2 - 2.7;   // how far the jet's middle can stray with both main wheels on the runway
  console.log(`  ${slipped.name}, a little right tilt from 30 to 45 kt: strays ${feet(slipped.widest, 1)} ft from the centreline (the main wheels reach the edge at ${feet(half, 1)}),`
    + ` is ${feet(Math.abs(slipped.off.across), 1)} ft from it at liftoff, and rolls ${feet(slipped.off.roll - straight.off.roll)} ft further`);
  assert.ok(straight.widest < 0.01, 'left alone, the jet rolls dead straight');
  assert.ok(slipped.widest > 1, 'the slip does push it off the centreline');
  assert.ok(slipped.widest < half, 'its main wheels stay on the runway');
  assert.ok(Math.abs(slipped.off.across) < 1 && slipped.widestUp < 2, 'and it is back on the centreline by liftoff, and stays there');
  assert.ok(Math.abs(slipped.off.roll - straight.off.roll) < 100 * FT, 'at next to no cost in ground roll');
});

test('a takeoff from every runway end (reported, not graded)', () => {
  const all = ends.map(flownFrom);
  console.log(`\n  ${HEAD}\n${all.map((o) => `  ${line(o)}`).join('\n')}\n${KEY}`);
  const count = (v) => all.filter((o) => o.verdict === v).length;
  console.log(`  ${all.length} runway ends: ${count('fine')} fine, ${count('tight')} tight, ${count('no')} no`);
  assert.equal(all.length, 54, 'both ends of all 27 runways');
  // Flown fairly, every one: the jet kept to the runway while its wheels were on it.
  for (const o of all) assert.ok(o.widest < o.field.runway.width / 2 - 2.7, `${o.name}: the main wheels stay on the runway (${o.widest.toFixed(1)} m off the centreline at most, ${o.field.runway.width.toFixed(0)} m wide)`);
});

test('the random runway: any of the 54 ends, and never the one the last flight started from', () => {
  const all = runwayEnds(index.runways);
  assert.equal(all.length, 54);
  assert.equal(new Set(all.map((e) => `${e.way.airport} ${e.way.ends[e.from].ident}`)).size, 54, 'each end once');
  // The dice at every value they can show: each end comes up, evenly.
  const first = Array.from({ length: 5400 }, (_, k) => randomEnd(all, null, () => (k + 0.5) / 5400));
  for (const end of all) assert.equal(first.filter((e) => e === end).length, 100, 'every end is as likely as any other');
  // After a flight from one end, the next is from any of the other 53.
  for (const last of all) {
    const next = new Set(Array.from({ length: 530 }, (_, k) => randomEnd(all, last, () => (k + 0.5) / 530)));
    assert.ok(!next.has(last) && next.size === 53, 'a new runway end every time');
  }
  assert.ok(all.includes(randomEnd(all, null, () => 0.999999999)), 'the dice never run off the end of the list');
  // The two ends of a runway start 200 ft in from opposite ends, facing each other.
  const [a, b] = all.filter((e) => e.way.airport === 'PHNL' && e.way.ends.some((x) => x.ident === '08R')).map((e) => runwayField(e.way, e.from));
  assert.ok(Math.abs(Math.abs(a.heading - b.heading) - 180) < 1e-6, '08R and 26L point opposite ways');
  const sa = startState(c, a).x, sb = startState(c, b).x;
  assert.ok(Math.abs(Math.hypot(sa[0] - sb[0], sa[1] - sb[1]) - (a.runway.length - 400 * FT)) < 0.01, 'and start a runway apart, less 200 ft at each end');
});
