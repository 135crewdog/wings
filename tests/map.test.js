// The pause screen's map (src/map.js): the whole chain fits, every airport is
// on it once, north is up, and the jet points where it heads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extent, wholeView, toMap, airports, noseOnMap } from '../src/map.js';

const index = JSON.parse(readFileSync(new URL('../terrain/hawaii/index.json', import.meta.url), 'utf8'));
const box = extent(index);
// A phone's map, landscape, and a squarer one.
const sizes = [[410, 360], [300, 300]];

test('the whole chain fits the map, middle on middle', () => {
  console.log(`  the chain: ${((box.east1 - box.east0) / 1000).toFixed(0)} km east to west, ${((box.north1 - box.north0) / 1000).toFixed(0)} km north to south`);
  for (const [w, h] of sizes) {
    const view = wholeView(box, w, h);
    const a = toMap(view, w, h, box.north1, box.east0), b = toMap(view, w, h, box.north0, box.east1);
    for (const p of [a, b]) {
      assert.ok(p.x >= -0.01 && p.x <= w + 0.01 && p.y >= -0.01 && p.y <= h + 0.01, `the chain's corners are on a ${w} × ${h} map`);
    }
    assert.ok(Math.abs(b.x - a.x - w) < 0.01 || Math.abs(b.y - a.y - h) < 0.01, 'and it fills the map one way');
    assert.ok(Math.abs(a.x + b.x - w) < 0.01 && Math.abs(a.y + b.y - h) < 0.01, 'centred');
  }
});

test('every airport is on the map once, at the middle of its runways', () => {
  const fields = airports(index);
  const names = new Set(index.runways.map((w) => w.airport));
  assert.equal(fields.length, names.size);
  console.log(`  ${fields.length} airports, ${index.runways.length} runways`);
  const [w, h] = sizes[0], view = wholeView(box, w, h);
  for (const f of fields) {
    const ends = index.runways.filter((way) => way.airport === f.airport).flatMap((way) => way.ends);
    const n = ends.map((e) => e.north), e = ends.map((p) => p.east);
    assert.ok(f.north >= Math.min(...n) && f.north <= Math.max(...n) && f.east >= Math.min(...e) && f.east <= Math.max(...e), `${f.airport} among its runways`);
    const p = toMap(view, w, h, f.north, f.east);
    assert.ok(p.x > 0 && p.x < w && p.y > 0 && p.y < h, `${f.airport} on the map`);
  }
  const honolulu = fields.find((f) => f.airport === index.start.airport);
  assert.ok(Math.hypot(honolulu.north - index.start.north, honolulu.east - index.start.east) < 3000, 'Honolulu\'s dot within 3 km of 8R, where every flight starts');
});

test('north is up and east is right', () => {
  const [w, h] = sizes[0], view = wholeView(box, w, h);
  const here = toMap(view, w, h, 0, 0), north = toMap(view, w, h, 10000, 0), east = toMap(view, w, h, 0, 10000);
  assert.ok(north.y < here.y && Math.abs(north.x - here.x) < 1e-9, 'north is up the page');
  assert.ok(east.x > here.x && Math.abs(east.y - here.y) < 1e-9, 'east is to the right');
  assert.ok(here.x > 0 && here.x < w / 2 && here.y > 0 && here.y < h / 2, 'Honolulu, where every flight starts, is in the map\'s top left quarter, as Oahu is in the chain');
});

test('the jet points the way it heads', () => {
  const near = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  assert.ok(near(noseOnMap(0), { x: 0, y: -1 }), 'north: up the page');
  assert.ok(near(noseOnMap(90), { x: 1, y: 0 }), 'east: right');
  assert.ok(near(noseOnMap(180), { x: 0, y: 1 }), 'south: down');
  assert.ok(near(noseOnMap(-90), { x: -1, y: 0 }), 'west (the sim\'s heading runs -180 to 180): left');
});
