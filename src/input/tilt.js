// Tilt to stick. The arithmetic is 135crewdog/rage's src/input/tilt.js (the
// same as wings-v1's), proven on the iPhone; it is plain and tested headless.
// createTilt at the bottom is the only part that touches the browser.
//
// The phone is held in landscape like a steering wheel. Raw beta and gamma
// are never used as pitch and roll: in landscape they jump by about 180
// degrees just as the screen passes upright. Instead, find which way is "up"
// on the screen, and measure the tilt against a neutral captured at Fly or
// Recenter.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export const MAPPING = {
  pitchFull: 25,        // degrees of tilt from neutral for full stick
  rollFull: 30,
  pitchDeadband: 2,     // degrees around neutral where nothing happens
  rollDeadband: 1.5,
  filterTau: 0.020,     // s: a little smoothing of the sensor
  confidenceFade: 0.3,  // roll fades to nothing as the screen comes to face straight up or down
  // Found on the iPhone in Rage: both angles come out opposite to the
  // pilot's sense, so both are flipped. Top edge toward you is back stick;
  // clockwise is right stick.
  pitchSign: -1,
  rollSign: -1,
};

/**
 * Which way is up, in the screen's own directions (x right, y up the screen,
 * z out of the screen toward the pilot), from the sensor's beta and gamma
 * (degrees) and the screen's angle (0, 90, 180 or 270). The compass angle
 * drops out, so turning in a chair moves nothing.
 */
export function upInScreen(beta, gamma, screenAngle) {
  const b = beta * D2R, g = gamma * D2R;
  const x = -Math.cos(b) * Math.sin(g), y = Math.sin(b), z = Math.cos(b) * Math.cos(g);
  const t = screenAngle * D2R, c = Math.cos(t), s = Math.sin(t);
  return { x: c * x - s * y, y: s * x + c * y, z };
}

/** Tilt angles (degrees) from an up vector: pitch, the steering-wheel roll, and how far to trust the roll. */
export function tiltOf(u) {
  const flat = Math.hypot(u.x, u.y);
  return { pitch: Math.atan2(u.z, flat) * R2D, roll: Math.atan2(u.x, u.y) * R2D, confidence: flat };
}

/** An angle in degrees, wrapped to -180..180. */
export const wrap = (deg) => ((deg + 180) % 360 + 360) % 360 - 180;

/** Nothing inside the deadband, then straight to +-1 at `full` degrees. */
export function shape(deg, deadband, full) {
  const a = Math.abs(deg);
  if (a <= deadband) return 0;
  return Math.sign(deg) * Math.min(1, (a - deadband) / (full - deadband));
}

/** The stick, { pitch, roll } each -1..1 (back and right are positive), from the tilt now and the neutral tilt. */
export function stickFrom(tilt, neutral, m = MAPPING) {
  const fade = Math.max(0, Math.min(1, tilt.confidence / m.confidenceFade));
  return {
    pitch: m.pitchSign * shape(wrap(tilt.pitch - neutral.pitch), m.pitchDeadband, m.pitchFull),
    roll: m.rollSign * shape(wrap(tilt.roll - neutral.roll), m.rollDeadband, m.rollFull) * fade,
  };
}

/** A little smoothing, by the time between the sensor's own readings. */
export function smooth(previous, value, dtSeconds, tau = MAPPING.filterTau) {
  if (!(dtSeconds > 0)) return value;
  return previous + (value - previous) * (1 - Math.exp(-dtSeconds / tau));
}

/**
 * Listens to the phone. Returns { stick, request(), recenter() }: `stick` is
 * { pitch, roll }, zero until there is a neutral. request() asks iOS for
 * motion access and must be called first thing inside a tap; it resolves to
 * whether access was given. recenter() makes the phone's attitude at the next
 * reading the neutral, then calls onNeutral.
 */
export function createTilt({ onNeutral = () => {} } = {}) {
  const stick = { pitch: 0, roll: 0 };
  let neutral = null, wanted = true, last = null;
  const screenAngle = () => (((screen.orientation?.angle ?? window.orientation ?? 0) % 360) + 360) % 360;
  window.addEventListener('deviceorientation', (event) => {
    if (event.beta === null || event.gamma === null) return;
    const tilt = tiltOf(upInScreen(event.beta, event.gamma, screenAngle()));
    if (wanted && tilt.confidence > MAPPING.confidenceFade) {
      neutral = { pitch: tilt.pitch, roll: tilt.roll };
      wanted = false;
      onNeutral();
    }
    if (!neutral) return;
    const now = event.timeStamp / 1000, dt = last === null ? 0 : now - last, to = stickFrom(tilt, neutral);
    last = now;
    stick.pitch = smooth(stick.pitch, to.pitch, dt);
    stick.roll = smooth(stick.roll, to.roll, dt);
  });
  return {
    stick,
    request() {
      const asked = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
        ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
      return asked.then((state) => state === 'granted', () => false);
    },
    recenter() { neutral = null; wanted = true; stick.pitch = stick.roll = 0; },
  };
}
