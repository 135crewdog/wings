// The app: the screens, the pilot's controls, and what happens when. The
// platform rules and the update logic are Rage's (135crewdog/rage, src/main.js).
import { APP_VERSION } from './version.js';
import { PARKED } from './field.js';
import { startFlight } from './flight.js';
import { createTilt } from './input/tilt.js';
import { createThrottle } from './ui/throttle.js';
import { readouts } from './readouts.js';

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll('.version')) el.textContent = APP_VERSION;

// ---- screens: one at a time, none while flying ----
const screens = [...document.querySelectorAll('.screen')];
const show = (name) => {
  for (const el of screens) el.hidden = el.id !== `screen-${name}`;
  $('controls').hidden = name !== null;
};

// ---- the pilot's controls ----
// The three toggles and the throttle live here; the stick comes from tilt.
const pilot = { throttle: 0, gear: true, flaps: true, brake: true };
const recenterButton = $('recenter');
let recenterTimer = null;
const tilt = createTilt({
  // Recenter happened: the button says so for a second.
  onNeutral() {
    recenterButton.textContent = 'Recentered ✓';
    clearTimeout(recenterTimer);
    recenterTimer = setTimeout(() => { recenterButton.textContent = 'Recenter'; }, 1200);
  },
});
const throttle = createThrottle($('throttle'), (value) => { pilot.throttle = value; });
const toggles = [['gear', 'Gear', 'down', 'up'], ['flaps', 'Flaps', 'down', 'up'], ['brake', 'Brakes', 'on', 'off']];
const showToggles = () => {
  for (const [key, name, on, off] of toggles) {
    $(key).textContent = `${name} ${pilot[key] ? on : off}`;
    $(key).setAttribute('aria-pressed', String(pilot[key]));
  }
};
for (const [key] of toggles) $(key).addEventListener('click', () => { pilot[key] = !pilot[key]; showToggles(); });
const parkControls = () => {
  Object.assign(pilot, { gear: PARKED.gear, flaps: PARKED.flaps, brake: PARKED.brake });
  throttle.set(PARKED.throttle);
  showToggles();
};

// ---- the flight ----
let mode = 'start';   // start, flying, paused or crashed
const flight = startFlight($('view'), {
  controls: () => ({ ...pilot, elevator: tilt.stick.pitch, aileron: tilt.stick.roll }),
  onCrash() { mode = 'crashed'; show('crashed'); checkForUpdate(); },
  onReadout(knots, feet, aboveGround) {
    for (const [name, text] of Object.entries(readouts(knots, feet, aboveGround))) {
      if ($(name).textContent !== text) $(name).textContent = text;   // touch the page only when a number changes
    }
  },
});
flight.ready.then(() => { $('fly').disabled = false; });
parkControls();

const isPortrait = () => window.innerHeight > window.innerWidth;   // read directly: the media query's answer can be stale
const keepAwake = () => { navigator.wakeLock?.request('screen').catch(() => {}); };
const takeOff = () => { mode = 'flying'; show(null); flight.fly(); };
const pause = () => {
  if (mode !== 'flying') return;
  mode = 'paused';
  flight.hold();
  show('pause');
  checkForUpdate();
};

$('fly').addEventListener('click', () => {
  // Asking for motion access must be the first thing in the tap, or iOS refuses it.
  const allowed = tilt.request();
  keepAwake();
  allowed.then((yes) => {
    if (!yes) { show('denied'); return; }
    tilt.recenter();
    takeOff();
  });
});
$('pause').addEventListener('click', pause);
$('resume').addEventListener('click', () => {
  if (isPortrait()) return;
  keepAwake();
  takeOff();
});
recenterButton.addEventListener('click', () => tilt.recenter());
for (const id of ['restart', 'crash-restart']) {
  $(id).addEventListener('click', () => {
    if (isPortrait()) return;
    keepAwake();
    flight.restart();
    parkControls();
    tilt.recenter();
    takeOff();
  });
}

// Leaving the app, turning the phone to portrait, or flipping it to the other
// landscape pauses the flight. It resumes only from the pause screen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else { keepAwake(); checkForUpdate(); }
});
window.addEventListener('resize', () => { if (isPortrait()) pause(); });
window.addEventListener('orientationchange', pause);
screen.orientation?.addEventListener('change', pause);

// iOS ignores user-scalable=no for pinch and double-tap in some versions.
for (const type of ['gesturestart', 'dblclick']) {
  document.addEventListener(type, (event) => event.preventDefault());
}

// ---- service worker and updates ----
// A new version is offered on the start, pause and crashed screens only, never mid-flight.
let waiting = null, registration = null, updateAccepted = false;
const offerUpdate = () => { for (const el of document.querySelectorAll('.update')) el.hidden = false; };

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    // A new worker that has installed while an old one still runs the app is
    // an update waiting to be taken. (With no old one, it's the first install.)
    const watch = (w) => {
      if (!w) return;
      const check = () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) { waiting = w; offerUpdate(); }
      };
      check();
      w.addEventListener('statechange', check);
    };
    watch(reg.waiting);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch(() => {});
  // Reload only for an update the pilot accepted: the first install also
  // takes control (clients.claim) and must not interrupt anything.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateAccepted) location.reload(); });
}

// The browser looks for a new sw.js only on a navigation, and a home-screen
// app resumed from the background makes none; so ask whenever the app comes
// back to the screen or a flight stops. Nothing activates until the offer is taken.
function checkForUpdate() { registration?.update().catch(() => {}); }

for (const button of document.querySelectorAll('.update')) {
  button.addEventListener('click', () => {
    if (!waiting) return;
    updateAccepted = true;
    waiting.postMessage('skip-waiting');
  });
}
