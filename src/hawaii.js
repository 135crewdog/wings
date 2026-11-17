// Hawaii on the phone: the tiles of terrain/hawaii/ (docs/hawaii.md),
// downloaded once into their own store, apart from the app's, so an app
// update never fetches them again; only a sheet whose bytes changed is fetched
// anew. From the store it hands out tiles: as pictures for the GPU, and
// decoded into heights and water for the flight model (src/sim/hawaii.js).

import { createHawaii, decodeTile } from './sim/hawaii.js';

const BASE = './terrain/hawaii/';
const STORE = 'wings-hawaii';   // never deleted by the service worker: see sw.js
const AT_ONCE = 3;              // sheets downloading together
const SHEETS_KEPT = 16;         // sheets held in memory, the most recently used
const TILES_KEPT = 96;          // tiles decoded for the flight model, besides the coarse ones

const urlOf = (name, sheet) => `${BASE}${name}?v=${sheet.sha256}`;
const key = (level, i, j) => `${level}/${i}/${j}`;
const PICTURE = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };

/**
 * Opens Hawaii. Returns { index, ground, missing(), download(onProgress),
 * pictures(level, i, j), has(level, i, j), near(north, east) }:
 *  - `missing()` resolves with the bytes still to download (0 when all is here);
 *  - `download(onProgress)` fetches what's missing, calling onProgress(done, total) in bytes;
 *  - `pictures` resolves with a tile's { height, colour } ImageBitmaps, or null for open sea;
 *  - `ground` is the flight model's ground; `near` keeps the tiles round a point decoded for it.
 */
export async function openHawaii() {
  const index = await (await fetch(`${BASE}index.json`)).json();
  const tiles = new Map(index.tiles.map(([level, i, j, sheet, ho, hl, co, cl]) => [key(level, i, j), { sheet, ho, hl, co, cl }]));
  const store = await caches.open(STORE);
  navigator.storage?.persist?.().catch(() => {});

  const href = (name) => new URL(urlOf(name, index.sheets[name]), location.href).href;
  const missing = async () => {
    const have = new Set((await store.keys()).map((r) => r.url));
    return Object.entries(index.sheets).reduce((bytes, [name, sheet]) => bytes + (have.has(href(name)) ? 0 : sheet.bytes), 0);
  };

  const download = async (onProgress) => {
    const have = new Set((await store.keys()).map((r) => r.url));
    const wanted = Object.entries(index.sheets).map(([name, sheet]) => ({ name, sheet, url: href(name) }));
    const total = wanted.reduce((sum, w) => sum + w.sheet.bytes, 0);
    let done = wanted.filter((w) => have.has(w.url)).reduce((sum, w) => sum + w.sheet.bytes, 0);
    onProgress(done, total);
    const queue = wanted.filter((w) => !have.has(w.url));
    const worker = async () => {
      while (queue.length) {
        const w = queue.shift();
        const response = await fetch(w.url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${w.name}: ${response.status}`);
        await store.put(w.url, response);
        done += w.sheet.bytes;
        onProgress(done, total);
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    // Sheets from an older Hawaii go, now the new one is all here.
    const keep = new Set(wanted.map((w) => w.url));
    for (const request of await store.keys()) if (!keep.has(request.url)) await store.delete(request);
  };

  // Sheets in memory, the most recently used last.
  const sheets = new Map();
  const sheet = (name) => {
    let blob = sheets.get(name);
    if (blob) { sheets.delete(name); sheets.set(name, blob); return blob; }
    blob = store.match(href(name)).then((r) => {
      if (!r) throw new Error(`${name} is not on the phone`);
      return r.blob();
    });
    sheets.set(name, blob);
    while (sheets.size > SHEETS_KEPT) sheets.delete(sheets.keys().next().value);
    return blob;
  };

  const has = (level, i, j) => tiles.has(key(level, i, j));
  const pictures = async (level, i, j) => {
    const t = tiles.get(key(level, i, j));
    if (!t) return null;
    const blob = await sheet(t.sheet);
    const [height, colour] = await Promise.all([
      createImageBitmap(blob.slice(t.ho, t.ho + t.hl, 'image/png'), PICTURE),
      createImageBitmap(blob.slice(t.co, t.co + t.cl, 'image/webp'), PICTURE),
    ]);
    return { height, colour };
  };

  // Tiles decoded for the flight model. The coarse levels (a handful of
  // tiles) stay; the fine ones are kept round where the airplane is.
  const decoded = new Map(), pending = new Map();
  const canvas = new OffscreenCanvas(index.tile, index.tile);
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  const decode = (level, i, j) => {
    const k = key(level, i, j);
    if (decoded.has(k)) return Promise.resolve();
    if (!pending.has(k)) pending.set(k, decodeNow(level, i, j, k).finally(() => pending.delete(k)));
    return pending.get(k);
  };
  const decodeNow = async (level, i, j, k) => {
    const t = tiles.get(k), blob = await sheet(t.sheet);
    const bitmap = await createImageBitmap(blob.slice(t.ho, t.ho + t.hl, 'image/png'), PICTURE);
    context.clearRect(0, 0, index.tile, index.tile);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    decoded.set(k, decodeTile(context.getImageData(0, 0, index.tile, index.tile).data, index, 4));
  };
  const tileAt = (level, i, j) => {
    const k = key(level, i, j);
    if (!tiles.has(k)) return null;
    const t = decoded.get(k);
    if (t) return t;
    decode(level, i, j);
    return undefined;
  };
  const ground = createHawaii(index, tileAt);

  // Keeps the tiles within `reach` metres of a point decoded for the flight
  // model, at every level. Cheap to call every frame: it does its work only
  // when the point moves into another level-0 tile. Resolves when they are all decoded.
  let around = null, aroundDone = Promise.resolve();
  const near = (north, east, reach = 3000) => {
    const here = `${Math.floor(north / (index.tile * index.post))}/${Math.floor(east / (index.tile * index.post))}`;
    if (here === around) return aroundDone;
    around = here;
    const wanted = new Set();
    for (let level = 0; level < index.levels; level++) {
      const span = index.tile * index.post * 2 ** level;
      for (let i = Math.floor((north - reach) / span); i <= Math.floor((north + reach) / span); i++) {
        for (let j = Math.floor((east - reach) / span); j <= Math.floor((east + reach) / span); j++) {
          if (has(level, i, j)) wanted.add(key(level, i, j));
        }
      }
    }
    // Let the fine tiles that are no longer wanted go once there are too many.
    for (const k of [...decoded.keys()]) {
      if (decoded.size <= TILES_KEPT) break;
      if (+k.split('/')[0] < 3 && !wanted.has(k)) decoded.delete(k);
    }
    aroundDone = Promise.all([...wanted].map((k) => decode(...k.split('/').map(Number))));
    return aroundDone;
  };

  return { index, ground, missing, download, pictures, has, near };
}
