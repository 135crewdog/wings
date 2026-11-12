// From 135crewdog/rage, src/input/look.js, as it is.
// Look-around by dragging: a finger dragged across the view swings the chase
// camera around the jet, dragging the world (drag right and you look left,
// drag down and you look up), and the view eases back to the chase position
// when the finger lifts. The angles are in the jet's frame, so the camera
// orbits the jet. Pure maths in createLook(); the pointer wiring is
// attachLook().

export const DEG_PER_PX = 0.25;   // a 360 px swipe is a quarter turn
export const YAW_MAX = 170;       // deg, nearly straight back
export const PITCH_MAX = 80;      // deg, nearly straight over or under
export const RETURN_TAU = 0.25;   // s, the ease back to the chase view

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createLook() {
  let yaw = 0, pitch = 0, held = false;
  return {
    get yaw() { return yaw; },        // deg, positive looks left
    get pitch() { return pitch; },    // deg, positive looks up
    get active() { return held || yaw !== 0 || pitch !== 0; },
    begin() { held = true; },
    drag(dx, dy) {                    // px moved since the last call, screen axes
      if (!held) return;
      yaw = clamp(yaw + dx * DEG_PER_PX, -YAW_MAX, YAW_MAX);
      pitch = clamp(pitch + dy * DEG_PER_PX, -PITCH_MAX, PITCH_MAX);
    },
    release() { held = false; },
    update(dt) {                      // ease back once released
      if (held) return;
      const k = Math.exp(-dt / RETURN_TAU);
      yaw = Math.abs(yaw) < 0.05 ? 0 : yaw * k;
      pitch = Math.abs(pitch) < 0.05 ? 0 : pitch * k;
    },
    reset() { yaw = 0; pitch = 0; held = false; },
  };
}

// One finger at a time on `element`; `allowed()` says whether a new drag may
// start (only in flight). The controls sit above the view and take their own
// touches, so a drag can only start on the view itself.
export function attachLook(element, look, allowed = () => true) {
  let id = null, lastX = 0, lastY = 0;
  element.addEventListener('pointerdown', (e) => {
    if (id !== null || !allowed()) return;
    id = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    element.setPointerCapture(id);
    look.begin();
  });
  element.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    look.drag(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  });
  const end = (e) => { if (e.pointerId !== id) return; id = null; look.release(); };
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
}
