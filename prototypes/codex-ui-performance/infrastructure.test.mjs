import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';

const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');

test('build compares an immutable source snapshot with real production sources', () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: directory });
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.generated/build.json'), 'utf8'));
  const snapshot = JSON.parse(gunzipSync(fs.readFileSync(path.join(directory, 'baselines/before.json.gz'))));
  for (const [name, source] of Object.entries(snapshot.sources)) {
    assert.equal(manifest.before[name], hash(source));
    assert.ok(fs.existsSync(path.join(directory, '.generated/before', name.replace(/\.ts$/, '.js'))));
  }
  const source = fs.readFileSync(path.join(directory, '../../extensions/codex-ui/src/tools.ts'), 'utf8');
  assert.equal(manifest.after['tools.ts'], hash(source));
  assert.ok(fs.existsSync(path.join(directory, '.generated/after/tools.js')));
});
