// The app's own bookkeeping (after Rage's tests/app.test.js): the version is
// the same in all three places, and the service worker's file list matches
// the app, so an update never leaves a phone on old files or a new file
// uncached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/version.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

// Every file the app loads: src/main.js and whatever it imports, followed to
// the end, through the import map in index.html for Three.js, plus any model
// a module names. Code the app doesn't load yet (the simulation, until first
// flight) isn't cached, so adding it doesn't push an update to phones.
const importMap = JSON.parse(readFileSync(join(root, 'index.html'), 'utf8').match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
function resolve(specifier, from) {
  if (specifier.startsWith('.')) return './' + posix.normalize(posix.join(posix.dirname(from), specifier));
  if (importMap[specifier]) return importMap[specifier];
  const prefix = Object.keys(importMap).find((key) => key.endsWith('/') && specifier.startsWith(key));
  if (!prefix) throw new Error(`${from} imports ${specifier}, which the import map does not know`);
  return importMap[prefix] + specifier.slice(prefix.length);
}
function filesLoaded(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(join(root, file), 'utf8');
    // import ... from '...', export ... from '...', import '...', and import('...')
    const imports = [/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"\n]+)['"]/gm, /^\s*import\s*['"]([^'"\n]+)['"]/gm, /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g];
    for (const pattern of imports) for (const m of source.matchAll(pattern)) visit(resolve(m[1], file));
    if (file.startsWith('./src/')) for (const m of source.matchAll(/['"](\.\/models\/[^'"]+)['"]/g)) seen.add(m[1]);
  };
  visit(entry);
  return [...seen];
}

test('the version is the same in src/version.js, sw.js and CHANGELOG.md', () => {
  const inSw = sw.match(/const VERSION = '([^']+)'/);
  assert.ok(inSw, 'VERSION in sw.js');
  assert.equal(inSw[1], APP_VERSION, 'VERSION in sw.js equals APP_VERSION');
  const log = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const newest = log.match(/^## (\S+)/m);
  assert.ok(newest, 'a version heading in CHANGELOG.md');
  assert.equal(newest[1], APP_VERSION, 'the newest CHANGELOG.md entry equals APP_VERSION');
  console.log(`  version ${APP_VERSION}`);
});

test('sw.js caches every file the app loads, and lists only files that exist', () => {
  const listed = [...sw.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]);
  const files = listed.filter((f) => f !== './');
  const missing = files.filter((f) => !existsSync(join(root, f)));
  assert.deepEqual(missing, [], 'listed but not on disk');
  const modules = filesLoaded('./src/main.js');
  const uncached = modules.filter((m) => !files.includes(m));
  assert.deepEqual(uncached, [], 'loaded by the app but not in sw.js');
  assert.equal(new Set(files).size, files.length, 'no file listed twice');
  console.log(`  ${files.length} files cached, ${modules.length} loaded by the app's code`);
});

test('the hangar demo moves every part and returns it to where it started', async () => {
  const { demoAt } = await import('../src/demo.js');
  const rest = { gear: 1, flaps: 0, elevator: 0.5, aileron: 0.5, rudder: 0.5 };
  assert.deepEqual(demoAt(0), rest, 'it starts at rest: gear down, flaps up, controls neutral');
  const seen = Object.fromEntries(Object.keys(rest).map((name) => [name, [Infinity, -Infinity]]));
  let period = 0;
  for (let t = 0; t < 120; t += 0.05) {
    const at = demoAt(t);
    for (const [name, x] of Object.entries(at)) {
      assert.ok(x >= 0 && x <= 1, `${name} stays between 0 and 1`);
      seen[name] = [Math.min(seen[name][0], x), Math.max(seen[name][1], x)];
    }
    if (!period && t > 1 && JSON.stringify(at) === JSON.stringify(rest) && JSON.stringify(demoAt(t + 0.05)) !== JSON.stringify(rest)) period = t;
  }
  for (const [name, [low, high]] of Object.entries(seen)) assert.ok(low < 0.02 && high > 0.98, `${name} goes all the way both ways`);
  console.log(`  every motion sweeps its full travel`);
});
