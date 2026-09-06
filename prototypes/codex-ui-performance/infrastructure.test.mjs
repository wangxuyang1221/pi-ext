import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { test } from 'node:test';

const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');

test('build can select a new immutable baseline without overwriting the historical snapshot', () => {
  const historical = fs.readFileSync(path.join(directory, 'baselines/before.json.gz'));
  const temporary = fs.mkdtempSync(path.join(directory, '.baseline-test-'));
  try {
    const source = fs.readFileSync(path.join(directory, '../../extensions/codex-ui/src/tools.ts'), 'utf8');
    const snapshotPath = path.join(temporary, 'snapshot.json.gz');
    fs.writeFileSync(snapshotPath, gzipSync(JSON.stringify({ commit: 'test-snapshot', sources: { 'tools.ts': source },
      mcp: { sources: { 'renderers.ts': 'export const marker = 1;' } } })));
    execFileSync(process.execPath, ['build.mjs'], { cwd: directory,
      env: { ...process.env, PI_PERF_BASELINE: snapshotPath } });
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.generated/build.json'), 'utf8'));
    assert.equal(manifest.baselineCommit, 'test-snapshot');
    assert.equal(manifest.baselineSnapshot.sha256, hash(fs.readFileSync(snapshotPath)));
    assert.equal(manifest.before['tools.ts'], hash(source));
    assert.equal(manifest.mcp.before['renderers.ts'], hash('export const marker = 1;'));
    assert.ok(fs.existsSync(path.join(directory, '.generated/after/mcp/renderers.js')));
    assert.deepEqual(fs.readFileSync(path.join(directory, 'baselines/before.json.gz')), historical);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('snapshot creation records production hashes and refuses to overwrite an existing snapshot', () => {
  const name = `test-${process.pid}`;
  const snapshotPath = path.join(directory, 'baselines', `${name}.json.gz`);
  try {
    execFileSync(process.execPath, ['snapshot.mjs', name], { cwd: directory });
    const bytes = fs.readFileSync(snapshotPath);
    const snapshot = JSON.parse(gunzipSync(bytes));
    for (const [name, source] of Object.entries(snapshot.sources)) assert.equal(snapshot.sha256[name], hash(source));
    assert.equal(snapshot.inputs['themes/codex-pi.json'].sha256, hash(snapshot.inputs['themes/codex-pi.json'].content));
    const mcpSource = fs.readFileSync(path.join(directory, '../../extensions/mcp/src/renderers.ts'), 'utf8');
    assert.equal(snapshot.mcp.sources['renderers.ts'], mcpSource);
    for (const [name, source] of Object.entries(snapshot.mcp.sources)) assert.equal(snapshot.mcp.sha256[name], hash(source));
    assert.throws(() => execFileSync(process.execPath, ['snapshot.mjs', name], { cwd: directory, stdio: 'pipe' }), /EEXIST/u);
    assert.deepEqual(fs.readFileSync(snapshotPath), bytes);
  } finally { fs.rmSync(snapshotPath, { force: true }); }
});

test('build compares an immutable source snapshot with real production sources', () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: directory,
    env: { ...process.env, PI_PERF_BASELINE: 'baselines/before.json.gz' } });
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
