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

// Every module the app loads: src/main.js and whatever it imports, followed
// to the end. Code the app doesn't load yet (the simulation, until first
// flight) isn't cached, so adding it doesn't push an update to phones.
function modulesLoaded(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(join(root, file), 'utf8');
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      visit('./' + posix.normalize(posix.join(posix.dirname(file), m[1])));
    }
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

test('sw.js caches every module the app loads, and lists only files that exist', () => {
  const listed = [...sw.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]);
  const files = listed.filter((f) => f !== './');
  const missing = files.filter((f) => !existsSync(join(root, f)));
  assert.deepEqual(missing, [], 'listed but not on disk');
  const modules = modulesLoaded('./src/main.js');
  const uncached = modules.filter((m) => !files.includes(m));
  assert.deepEqual(uncached, [], 'loaded by the app but not in sw.js');
  assert.equal(new Set(files).size, files.length, 'no file listed twice');
  console.log(`  ${files.length} files cached, ${modules.length} modules loaded by the app`);
});
