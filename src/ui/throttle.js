// The throttle: a knob in a groove on the left edge. It stays where it is left.
// After 135crewdog/rage, src/ui/throttle.js, with its detent at MIL: a finger
// anywhere in a band around the mark gives exactly MIL, so reaching for MIL
// gets MIL, and the band has to be crossed to light the afterburner.

import { MIL_THROTTLE } from '../sim/engine.js';

// Places along the track, 0 at the bottom, 1 at the top.
const DRY = 0.66;    // idle to MIL runs up to here
const MARK = 0.72;   // where the thumb sits at MIL, and where the caution stripes start
const BURNER = 0.8;  // the afterburner starts here and is full at the top

/** A finger's place along the track (0 bottom, 1 top) to a throttle position 0..1. */
export function throttleFromPosition(place) {
  const p = Math.max(0, Math.min(1, place));
  if (p <= DRY) return (p / DRY) * MIL_THROTTLE;
  if (p <= BURNER) return MIL_THROTTLE;
  return MIL_THROTTLE + ((p - BURNER) / (1 - BURNER)) * (1 - MIL_THROTTLE);
}

/** The other way, for drawing the thumb: at MIL it sits on the mark. */
export function positionFromThrottle(throttle) {
  if (throttle < MIL_THROTTLE) return (throttle / MIL_THROTTLE) * DRY;
  if (throttle === MIL_THROTTLE) return MARK;
  return BURNER + ((throttle - MIL_THROTTLE) / (1 - MIL_THROTTLE)) * (1 - BURNER);
}

/** Makes the slider work. onChange(throttle) is called on every change; returns { set(throttle) }. */
export function createThrottle(root, onChange) {
  const rail = root.querySelector('.rail'), thumb = root.querySelector('.thumb');
  // The caution stripes run from the knob's place at MIL to the top of the groove.
  root.querySelector('.ab').style.bottom = `calc(16px + ${MARK} * (100% - 32px))`;
  let finger = null;
  const set = (throttle) => {
    const value = Math.max(0, Math.min(1, throttle));
    const place = positionFromThrottle(value);
    thumb.style.top = `${(1 - place) * 100}%`;
    root.classList.toggle('burner', value > MIL_THROTTLE);
    root.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    onChange(value);
  };
  const follow = (event) => {
    const r = rail.getBoundingClientRect();
    set(throttleFromPosition(1 - (event.clientY - r.top) / r.height));
  };
  root.addEventListener('pointerdown', (event) => {
    if (finger !== null) return;
    finger = event.pointerId;
    root.setPointerCapture(event.pointerId);
    follow(event);
    event.preventDefault();
  });
  root.addEventListener('pointermove', (event) => { if (event.pointerId === finger) follow(event); });
  const lift = (event) => { if (event.pointerId === finger) finger = null; };
  root.addEventListener('pointerup', lift);
  root.addEventListener('pointercancel', lift);
  return { set };
}
