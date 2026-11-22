// The app: the screens, the pilot's controls, and what happens when. The
// platform rules and the update logic are Rage's (135crewdog/rage, src/main.js).
import { APP_VERSION } from './version.js';
import { PARKED } from './field.js';
import { startFlight } from './flight.js';
import { openHawaii } from './hawaii.js';
import { createTilt } from './input/tilt.js';
import { createThrottle } from './ui/throttle.js';
import { readouts } from './readouts.js';
import { createHud } from './hud.js';
import { createMap } from './map.js';

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll('.version')) el.textContent = APP_VERSION;

// ---- screens: one at a time, none while flying ----
const screens = [...document.querySelectorAll('.screen')];
const show = (name) => {
  for (const el of screens) el.hidden = el.id !== `screen-${name}`;
  $('controls').hidden = name !== null;
  showDevBox();
};

// ---- the pilot's controls ----
// The four toggles and the throttle live here; the stick comes from tilt.
const pilot = { throttle: 0, gear: true, flaps: true, speedbrake: false, brake: true };
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
const toggles = [['gear', 'Gear', 'Down', 'Up'], ['flaps', 'Flaps', 'Down', 'Up'], ['speedbrake', 'Boards', 'Out', 'In'], ['brake', 'Brakes', 'On', 'Off']];
const showToggles = () => {
  for (const [key, name, on, off] of toggles) {
    $(key).textContent = `${name} ${pilot[key] ? on : off}`;
    $(key).setAttribute('aria-pressed', String(pilot[key]));
  }
};
for (const [key] of toggles) $(key).addEventListener('click', () => { pilot[key] = !pilot[key]; showToggles(); });
const parkControls = () => {
  Object.assign(pilot, { gear: PARKED.gear, flaps: PARKED.flaps, speedbrake: PARKED.speedbrake, brake: PARKED.brake });
  throttle.set(PARKED.throttle);
  showToggles();
};

// ---- the HUD, or with it off just its airspeed and altitude ----
const hud = createHud($('hud'), () => $('safe').getBoundingClientRect());
let hudOn = true;

// ---- Hawaii: downloaded once, then always on the phone ----
// The start screen says how far the download has got; Fly waits for it all.
// If it stops (no signal), it carries on when the phone is back online.
async function prepareHawaii() {
  const line = $('download'), mb = (bytes) => Math.round(bytes / 1e6);
  const hawaii = await openHawaii();
  for (;;) {
    try {
      if (await hawaii.missing() === 0) break;
      line.hidden = false;
      await hawaii.download((done, total) => { line.textContent = `Hawaii: ${mb(done)} of ${mb(total)} MB`; });
      break;
    } catch {
      line.textContent = 'Hawaii’s download stopped. It carries on when the device is back online.';
      await new Promise((resolve) => { window.addEventListener('online', resolve, { once: true }); setTimeout(resolve, 15000); });
    }
  }
  line.hidden = true;
  await hawaii.near(hawaii.index.start.north, hawaii.index.start.east);   // the ground under the start, ready for the flight model
  return hawaii;
}

// ---- the debug overlay ----
// A small box of raw numbers, for troubleshooting and for screen recordings
// sent to Claude Code (the Ideas doc, picked 17 Nov 2026). Switched on and
// off on the pause screen, off until the pilot turns it on. It shows in
// flight and stays up on the pause and crashed screens, so its last signals
// can be read there.
let devOn = false, devAt = 0, lastReading = null;
const fixed = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n) : '-');
const showDevBox = () => { $('dev').hidden = !devOn || mode === 'start'; };
const showDev = (now = false) => {
  const r = lastReading;
  if (!r || (!now && performance.now() - devAt < 250)) return;   // four times a second is plenty to read
  devAt = performance.now();
  const s = flight.status(), t = tilt.raw;
  $('dev').textContent = [
    `${fixed(s.fps, 0)} fps  ${s.draws} draws  ${mode}  ${APP_VERSION}`,
    `sensor β ${fixed(t.beta)} γ ${fixed(t.gamma)} screen ${t.screen}  tilt ${fixed(t.pitch)}/${fixed(t.roll)} conf ${fixed(t.confidence, 2)}`,
    `stick ${fixed(tilt.stick.pitch, 2)}/${fixed(tilt.stick.roll, 2)}  throttle ${fixed(pilot.throttle, 2)}  power ${fixed(r.power, 2)}`,
    `${fixed(r.knots, 0)} kt  M ${fixed(r.mach, 2)}  g ${fixed(r.g)}  α ${fixed(r.alpha)}  β ${fixed(r.beta)}`,
    `${Math.round(r.feet)} ft  ${Math.round(r.aboveGround)} above ground  hdg ${fixed(r.heading, 0)}T`,
    `N ${Math.round(s.north)} E ${Math.round(s.east)} m  levels ${s.levels.join(',') || 'none'}  tiles waiting ${s.queued}`,
    ...signals.map((line) => `signal ${line}`),
  ].join('\n');
};

// ---- what iOS tells the app ----
// Which signals arrive while Control Center comes down or a screen recording
// starts (the Ideas doc, 22 Nov 2026): every one the app could pause on,
// with the clock time it came, the newest six kept for the debug overlay.
// Events are logged as they come; focus, the frames and the tilt sensor
// are checked every frame and logged when they change.
const signals = [];
const signal = (what) => {
  const d = new Date();
  signals.push(`${d.toTimeString().slice(0, 8)}.${Math.floor(d.getMilliseconds() / 100)} ${what}`);
  if (signals.length > 6) signals.shift();
  if (devOn) showDev(true);
};
let frameAt = null, focused = document.hasFocus(), tiltQuiet = false;
const watchSignals = () => {
  const now = performance.now();
  if (mode !== 'flying') frameAt = null;
  else {
    if (frameAt !== null && now - frameAt > 200) signal(`no frames for ${((now - frameAt) / 1000).toFixed(1)} s`);
    frameAt = now;
  }
  if (document.hasFocus() !== focused) { focused = !focused; signal(`hasFocus ${focused}`); }
  if (mode !== 'flying') { tiltQuiet = false; return; }
  const quiet = now - tilt.raw.at > 300;   // the sensor speaks about 60 times a second
  if (quiet !== tiltQuiet) { tiltQuiet = quiet; signal(quiet ? 'tilt stopped' : 'tilt back'); }
};

// ---- the flight ----
let mode = 'start';   // start, flying, paused or crashed
let heading = 0;      // true, degrees: for the map
const hawaii = await prepareHawaii();
const flight = startFlight($('view'), hawaii, {
  controls: () => ({ ...pilot, elevator: tilt.stick.pitch, aileron: tilt.stick.roll }),
  onCrash() { mode = 'crashed'; letSleep(); show('crashed'); checkForUpdate(); },
  onReadout(reading, project, view) {
    const text = readouts(reading.knots, reading.feet, reading.aboveGround);
    hud.draw({ ...reading, airspeed: text.airspeed, altitude: text.radar || text.altitude }, project, view, hudOn);
    lastReading = reading;
    watchSignals();
    if (devOn) showDev();
    heading = reading.heading;
  },
});

// ---- the map on the pause screen ----
const map = createMap($('map'), hawaii, flight.silhouette);
flight.ready.then(() => map.prepare());   // the photographs, made while the pilot is still on the start screen
const showMap = () => {
  const [north, east] = flight.sim.state.x;
  map.show({ north, east, heading });
};
flight.ready.then(() => { $('fly').disabled = false; $('settings').disabled = false; });

// The crash override: on, nothing ends a flight but the pilot. It is on until
// the pilot turns it off, and the choice is kept between visits.
const OVERRIDE_KEY = 'wings.crashOverride';
const overrideSwitch = $('override');
const setOverride = (on) => {
  overrideSwitch.setAttribute('aria-checked', String(on));
  flight.setCrashes(!on);
  try { localStorage.setItem(OVERRIDE_KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked; the choice still holds for this visit */ }
};
let saved = null;
try { saved = localStorage.getItem(OVERRIDE_KEY); } catch { /* storage may be blocked */ }
setOverride(saved !== 'off');
overrideSwitch.addEventListener('click', () => setOverride(overrideSwitch.getAttribute('aria-checked') !== 'true'));

// The HUD: on until the pilot turns it off, kept between visits. Off, only
// its airspeed and altitude show, in their places.
const HUD_KEY = 'wings.hud';
const hudSwitch = $('hud-switch');
const setHud = (on) => {
  hudOn = on;
  hudSwitch.setAttribute('aria-checked', String(on));
  flight.redraw();
  try { localStorage.setItem(HUD_KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked; the choice still holds for this visit */ }
};
let savedHud = null;
try { savedHud = localStorage.getItem(HUD_KEY); } catch { /* storage may be blocked */ }
setHud(savedHud !== 'off');
hudSwitch.addEventListener('click', () => setHud(hudSwitch.getAttribute('aria-checked') !== 'true'));

// The debug overlay's switch, kept between visits like the others.
const DEV_KEY = 'wings.dev';
const devSwitch = $('dev-switch');
const setDev = (on) => {
  devOn = on;
  devSwitch.setAttribute('aria-checked', String(on));
  showDevBox();
  showDev(true);
  flight.redraw();
  try { localStorage.setItem(DEV_KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked */ }
};
let savedDev = null;
try { savedDev = localStorage.getItem(DEV_KEY); } catch { /* storage may be blocked */ }
setDev(savedDev === 'on');
devSwitch.addEventListener('click', () => setDev(devSwitch.getAttribute('aria-checked') !== 'true'));

// A read-only hook for browser tests and troubleshooting (after Rage's window.rage).
window.wings = Object.freeze({
  version: APP_VERSION,
  get mode() { return mode; },
  get sim() { return flight.sim; },
  get status() { return flight.status(); },
  get stick() { return { ...tilt.stick }; },
});
parkControls();

const isPortrait = () => window.innerHeight > window.innerWidth;   // read directly: the media query's answer can be stale
// The screen is kept awake only in flight. On the start, pause and crashed
// screens it is let go, so a phone put down with the app open can sleep.
let lock = null, awake = false;
const keepAwake = () => {
  awake = true;
  navigator.wakeLock?.request('screen').then((held) => {
    // The pilot may have paused before iOS answered: then let it straight go.
    if (awake) { lock?.release().catch(() => {}); lock = held; } else held.release().catch(() => {});
    held.addEventListener?.('release', () => { if (awake && lock === held) signal('wake lock dropped'); });   // let go by iOS, not by the app
  }).catch(() => {});
};
const letSleep = () => {
  awake = false;
  lock?.release().catch(() => {});
  lock = null;
};
const takeOff = () => { mode = 'flying'; show(null); flight.fly(); };
// The pause screen before the first flight (opened with Settings on the start
// screen): its top button is Fly, and Restart and Recenter wait for a flight.
const menu = (beforeFlight) => {
  $('resume').textContent = beforeFlight ? 'Fly' : 'Resume';
  $('restart').hidden = beforeFlight;
  recenterButton.hidden = beforeFlight;
};
const pause = () => {
  if (mode !== 'flying') return;
  mode = 'paused';
  menu(false);
  letSleep();
  flight.hold();
  show('pause');
  showMap();
  checkForUpdate();
};

// The first flight, from Fly on the start screen or on the pause screen opened with Settings.
const fly = () => {
  // Asking for motion access must be the first thing in the tap, or iOS refuses it.
  const allowed = tilt.request();
  keepAwake();
  allowed.then((yes) => {
    if (!yes) { letSleep(); show('denied'); return; }
    tilt.recenter();
    takeOff();
  });
};
$('fly').addEventListener('click', fly);
$('settings').addEventListener('click', () => {
  menu(true);
  show('pause');
  showMap();
});
$('pause').addEventListener('click', pause);
$('resume').addEventListener('click', () => {
  if (mode === 'start') { fly(); return; }
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

// Leaving the app, anything that takes the screen over it (Control Center and
// its screen-recording button, a call, Siri), turning the phone to portrait,
// or flipping it to the other landscape pauses the flight. It resumes only
// from the pause screen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else checkForUpdate();   // iOS drops the wake lock when the app is hidden; Resume asks again
});
window.addEventListener('blur', pause);   // Control Center leaves the app showing underneath, so it isn't hidden; it only loses focus
window.addEventListener('resize', () => { if (isPortrait()) pause(); });
window.addEventListener('orientationchange', pause);
screen.orientation?.addEventListener('change', pause);

// Every signal that might come with Control Center or a recording, logged
// for the debug overlay; only the ones above pause the flight, for now.
const log = (target, types, say = (e) => e.type) => { for (const type of types) target?.addEventListener(type, (e) => signal(say(e))); };
log(window, ['focus', 'blur', 'pagehide', 'pageshow', 'orientationchange']);
log(window, ['resize'], () => `resize ${window.innerWidth}×${window.innerHeight}`);
log(document, ['visibilitychange'], () => `visibility ${document.visibilityState}`);
log(document, ['freeze', 'resume', 'touchcancel', 'pointercancel']);
log(screen.orientation, ['change'], () => `screen turned ${screen.orientation.angle}`);

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
