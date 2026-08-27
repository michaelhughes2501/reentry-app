// Regression tests for the package-lock.json dependency bumps in this PR:
//   - body-parser        2.2.2 -> 2.3.0 (now depends on content-type ^2.0.0,
//     which is nested under body-parser because other packages still need
//     the older content-type ^1.0.5)
//   - express-rate-limit  8.5.2 -> 8.6.0 (gained a new `debug` dependency)
//
// These tests read package-lock.json directly (no `npm install` required) so
// they run fast and don't depend on node_modules being present.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const SHA512_RE = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

// Minimal caret-range check (`^x.y.z`), sufficient for the ranges declared
// in this project's package.json — avoids pulling in a semver dependency
// just for tests.
function satisfiesCaret(range, version) {
  assert.match(range, /^\^\d+\.\d+\.\d+$/, `unsupported range shape: ${range}`);
  const [reqMajor, reqMinor, reqPatch] = range.slice(1).split('.').map(Number);
  const [major, minor, patch] = version.split('.').map(Number);
  if (major !== reqMajor) return false;
  if (minor > reqMinor) return true;
  if (minor < reqMinor) return false;
  return patch >= reqPatch;
}

// Walks up the node_modules nesting the same way Node's module resolution
// would, so we can find which physical copy of a dependency a package will
// actually get at runtime.
function resolveNestedPackage(lockData, parentKey, depName) {
  const segments = parentKey === '' ? [] : parentKey.split('/node_modules/');
  for (let i = segments.length; i >= 0; i--) {
    const prefix = segments.slice(0, i).join('/node_modules/');
    const candidate = prefix ? `${prefix}/node_modules/${depName}` : `node_modules/${depName}`;
    if (lockData.packages[candidate]) return candidate;
  }
  return undefined;
}

test('package-lock.json is valid and matches package.json identity', () => {
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].name, pkg.name);
});

test('body-parser is bumped to 2.3.0 with the expected integrity and resolved URL', () => {
  const entry = lock.packages['node_modules/body-parser'];
  assert.ok(entry, 'expected node_modules/body-parser in the lockfile');
  assert.equal(entry.version, '2.3.0');
  assert.match(entry.integrity, SHA512_RE);
  assert.equal(
    entry.resolved,
    'https://registry.npmjs.org/body-parser/-/body-parser-2.3.0.tgz'
  );
});

test('body-parser declares the updated dependency ranges', () => {
  const entry = lock.packages['node_modules/body-parser'];
  assert.deepEqual(entry.dependencies, {
    bytes: '^3.1.2',
    'content-type': '^2.0.0',
    debug: '^4.4.3',
    'http-errors': '^2.0.1',
    'iconv-lite': '^0.7.2',
    'on-finished': '^2.4.1',
    qs: '^6.15.2',
    'raw-body': '^3.0.2',
    'type-is': '^2.1.0',
  });
});

test('body-parser gets its own nested content-type@2.0.0', () => {
  const nestedKey = 'node_modules/body-parser/node_modules/content-type';
  const nested = lock.packages[nestedKey];
  assert.ok(nested, 'expected a nested content-type override for body-parser');
  assert.equal(nested.version, '2.0.0');
  assert.match(nested.integrity, SHA512_RE);
  assert.equal(
    nested.resolved,
    'https://registry.npmjs.org/content-type/-/content-type-2.0.0.tgz'
  );
  assert.equal(nested.engines.node, '>=18');
});

test('body-parser resolves content-type to its nested 2.x copy, not the top-level 1.x one', () => {
  const resolvedKey = resolveNestedPackage(lock, 'node_modules/body-parser', 'content-type');
  assert.equal(resolvedKey, 'node_modules/body-parser/node_modules/content-type');

  const resolvedVersion = lock.packages[resolvedKey].version;
  assert.ok(
    satisfiesCaret(lock.packages['node_modules/body-parser'].dependencies['content-type'], resolvedVersion),
    `resolved content-type@${resolvedVersion} does not satisfy body-parser's required range`
  );

  // The pre-existing top-level content-type is left untouched for whichever
  // other package still needs the 1.x line — nesting must not have
  // clobbered it.
  const topLevel = lock.packages['node_modules/content-type'];
  if (topLevel) {
    assert.notEqual(topLevel.version, resolvedVersion);
  }
});

test('every dependency body-parser declares resolves to some package entry in the lock', () => {
  const entry = lock.packages['node_modules/body-parser'];
  for (const depName of Object.keys(entry.dependencies)) {
    const resolvedKey = resolveNestedPackage(lock, 'node_modules/body-parser', depName);
    assert.ok(resolvedKey, `no resolvable package entry found for body-parser's dependency "${depName}"`);
  }
});

test('express-rate-limit is bumped to 8.6.0 with the expected integrity and resolved URL', () => {
  const entry = lock.packages['node_modules/express-rate-limit'];
  assert.ok(entry, 'expected node_modules/express-rate-limit in the lockfile');
  assert.equal(entry.version, '8.6.0');
  assert.match(entry.integrity, SHA512_RE);
  assert.equal(
    entry.resolved,
    'https://registry.npmjs.org/express-rate-limit/-/express-rate-limit-8.6.0.tgz'
  );
});

test('express-rate-limit gains a debug dependency while keeping ip-address', () => {
  const entry = lock.packages['node_modules/express-rate-limit'];
  assert.deepEqual(entry.dependencies, {
    debug: '^4.4.3',
    'ip-address': '^10.2.0',
  });
});

test('express-rate-limit dependencies resolve to real package entries in the lock', () => {
  const entry = lock.packages['node_modules/express-rate-limit'];
  for (const depName of Object.keys(entry.dependencies)) {
    const resolvedKey = resolveNestedPackage(lock, 'node_modules/express-rate-limit', depName);
    assert.ok(resolvedKey, `no resolvable package entry found for express-rate-limit's dependency "${depName}"`);
  }
});

test('locked express-rate-limit version still satisfies the ^8.5.2 range declared in package.json', () => {
  const declaredRange = pkg.dependencies['express-rate-limit'];
  const lockedVersion = lock.packages['node_modules/express-rate-limit'].version;
  assert.ok(
    satisfiesCaret(declaredRange, lockedVersion),
    `locked express-rate-limit@${lockedVersion} does not satisfy package.json range ${declaredRange}`
  );
});

test('locked body-parser version stays within a 2.x major (no accidental major bump)', () => {
  const version = lock.packages['node_modules/body-parser'].version;
  assert.equal(version.split('.')[0], '2');
});
