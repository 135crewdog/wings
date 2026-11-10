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

test('sw.js lists no code the app does not load', () => {
  const listed = [...sw.matchAll(/'(\.\/(?:src|vendor)\/[^']+)'/g)].map((m) => m[1]);
  const loaded = filesLoaded('./src/main.js');
  assert.deepEqual(listed.filter((f) => !loaded.includes(f)), [], 'cached but never loaded');
});

test('the simulation and the field contain no browser or Three.js code', () => {
  const files = filesLoaded('./src/field.js').concat(filesLoaded('./src/render/frames.js'), filesLoaded('./src/sim/trim.js'), filesLoaded('./src/sim/airdata.js'));
  for (const file of new Set(files)) {
    assert.ok(file.startsWith('./src/sim/') || file === './src/field.js' || file === './src/render/frames.js', `${file} is headless code`);
    const source = readFileSync(join(root, file), 'utf8');
    assert.doesNotMatch(source, /\b(document|window|navigator|requestAnimationFrame|THREE)\b\s*[.(]/, `${file} uses nothing from the browser`);
  }
  console.log(`  ${new Set(files).size} headless files`);
});
