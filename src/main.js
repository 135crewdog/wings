// The empty shell: shows the version and offers updates. The update logic is
// Rage's (135crewdog/rage, src/main.js).
import { APP_VERSION } from './version.js';

document.getElementById('version').textContent = APP_VERSION;

// iOS ignores user-scalable=no for pinch and double-tap in some versions.
for (const type of ['gesturestart', 'dblclick']) {
  document.addEventListener(type, (event) => event.preventDefault());
}

// ---- service worker and updates ----
const offer = document.getElementById('update');
let waiting = null, registration = null, updateAccepted = false;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    // A new worker that has installed while an old one still runs the app is
    // an update waiting to be taken. (With no old one, it's the first install.)
    const watch = (w) => {
      if (!w) return;
      const check = () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) { waiting = w; offer.hidden = false; }
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
// back to the screen. Nothing activates until the offer is taken.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && registration) registration.update().catch(() => {});
});

offer.addEventListener('click', () => {
  if (!waiting) return;
  updateAccepted = true;
  waiting.postMessage('skip-waiting');
});
