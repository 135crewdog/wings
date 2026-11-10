// The app's own bookkeeping (after Rage's tests/app.test.js): the version is
// the same in all three places, and the service worker's file list matches
// the app, so an update never leaves a phone on old files or a new file
// uncached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/version.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
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

test('sw.js caches every file under src/, and lists only files that exist', () => {
  const listed = [...sw.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]);
  const files = listed.filter((f) => f !== './');
  const missing = files.filter((f) => !existsSync(join(root, f)));
  assert.deepEqual(missing, [], 'listed but not on disk');
  const modules = filesUnder(join(root, 'src')).map((p) => './' + relative(root, p).split('\\').join('/'));
  const uncached = modules.filter((m) => !files.includes(m));
  assert.deepEqual(uncached, [], 'under src/ but not in sw.js');
  assert.equal(new Set(files).size, files.length, 'no file listed twice');
  console.log(`  ${files.length} files cached, ${modules.length} under src/`);
});
