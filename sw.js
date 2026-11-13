// Wings' service worker (after Rage's): caches the whole app so it works
// offline. Every app on this origin shares storage, so every cache here starts
// with "wings-" and only caches that start with "wings-" are ever deleted. It
// never calls skipWaiting() on its own; the app offers the update and posts
// "skip-waiting" when the pilot accepts.

const VERSION = '0.0.25';   // the same value as APP_VERSION in src/version.js
const CACHE = `wings-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/main.js',
  './src/version.js',
  './src/flight.js',
  './src/field.js',
  './terrain/island.json',
  './terrain/landmarks.json',
  './terrain/island.png',
  './terrain/country.png',
  './src/land.js',
  './src/fields.js',
  './src/input/look.js',
  './src/input/tilt.js',
  './src/readouts.js',
  './src/render/aircraft.js',
  './src/render/camera.js',
  './src/render/frames.js',
  './src/render/landmarks.js',
  './src/render/terrain.js',
  './src/render/trees.js',
  './src/render/world.js',
  './src/sim/aero.js',
  './src/sim/airdata.js',
  './src/sim/atmosphere.js',
  './src/sim/body.js',
  './src/sim/card.js',
  './src/sim/cards/f4c.js',
  './src/sim/contact.js',
  './src/sim/engine.js',
  './src/sim/ground.js',
  './src/sim/island.js',
  './src/sim/sim.js',
  './src/sim/solids.js',
  './src/sim/trim.js',
  './src/sim/vec.js',
  './src/ui/throttle.js',
  './vendor/three/build/three.module.js',
  './vendor/three/build/three.core.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/three/examples/jsm/utils/SkeletonUtils.js',
  './models/f4c.glb',
  './models/viaduct.glb',
  './models/castle.glb',
  './models/door.glb',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own HTTP cache, so a new version
  // never stores a stale copy of a file.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('wings-') && k !== CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Cache first, network as the fallback; the app is static and versioned.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(event.request, { ignoreSearch: true })).then((hit) => hit || fetch(event.request)),
  );
});
