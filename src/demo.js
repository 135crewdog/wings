// The hangar view's demo: the airplane's gear, flaps and controls moving by
// themselves in a slow repeating cycle. No browser or three.js code, so the
// tests can run it.

// The demo: [seconds, what moves, from, to]. Each control is swept from
// neutral to one end, to the other, and back; then flaps, then gear.
const sweep = (name) => [[1, name, 0.5, 1], [2, name, 1, 0], [1, name, 0, 0.5], [0.5]];
const DEMO = [
  ...sweep('elevator'), ...sweep('aileron'), ...sweep('rudder'),
  [2, 'flaps', 0, 1], [1.5], [2, 'flaps', 1, 0], [1],
  [3, 'gear', 1, 0], [2], [3, 'gear', 0, 1], [2],
];
const DEMO_SECONDS = DEMO.reduce((sum, step) => sum + step[0], 0);

/** Where each motion is, `seconds` into the demo. */
export function demoAt(seconds) {
  const positions = { gear: 1, flaps: 0, elevator: 0.5, aileron: 0.5, rudder: 0.5 };
  let t = ((seconds % DEMO_SECONDS) + DEMO_SECONDS) % DEMO_SECONDS;
  for (const [length, name, from, to] of DEMO) {
    if (name) positions[name] = t >= length ? to : from + (to - from) * (t / length);
    if (t < length) break;
    t -= length;
  }
  return positions;
}
