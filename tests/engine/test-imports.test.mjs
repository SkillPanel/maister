import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// On Windows a bare path such as D:\a\... is not a module specifier: import()
// refuses it with ERR_UNSUPPORTED_ESM_URL_SCHEME. A test loads a module by
// path through pathToFileURL(...).href, never by handing import() a path.

const TESTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : files(full);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

test('no test hands import() a filesystem path', () => {
  const bare = /\bimport\(\s*path\.(join|resolve)\(/;
  const found = files(TESTS).filter(file => bare.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(TESTS, file));
  assert.deepEqual(found, [], `wrap the path in pathToFileURL(...).href in: ${found.join(', ')}`);
});
