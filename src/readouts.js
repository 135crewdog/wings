// What the readouts say: airspeed in knots and altitude in feet, and below
// 2,000 feet above the ground, radar altitude too. Plain text, no browser code.

export const RADAR_BELOW = 2000;   // ft above the ground

const nearest = (x, step) => Math.round(x / step) * step || 0;   // never "-0"

/**
 * The text of each readout for an indicated airspeed (knots), an altitude
 * (feet above sea level) and a height above the ground (feet), both measured
 * at the wheels. `radar` is empty above 2,000 ft. Altitude reads to the
 * nearest 10 ft; radar altitude to the nearest 10, and to the foot below 100.
 */
export function readouts(knots, feet, aboveGround) {
  const above = Math.max(0, aboveGround);
  return {
    airspeed: String(Math.round(Math.max(0, knots))),
    altitude: nearest(feet, 10).toLocaleString('en-US'),
    radar: above < RADAR_BELOW ? `R ${nearest(above, above < 100 ? 1 : 10).toLocaleString('en-US')}` : '',
  };
}
