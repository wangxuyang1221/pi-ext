#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { executeScenario } from './scenario-runner.mjs';

mkdirSync(resolve('.tmp/test-results'), { recursive: true });
const evidence = mkdtempSync(resolve('.tmp/test-results/permissions-runner-'));
const entry = 'extensions/permissions/src/index.ts';
const results = [];
const blocked = { scenario: 'evidence-directory-failure', evidence: join(evidence, 'blocked-directory') };
writeFileSync(blocked.evidence, 'A file prevents directory creation');
await executeScenario(blocked, { entry, timeoutMs: 400, forwardOutput: false,
  commandFactory: () => { throw new Error('Must not launch after mkdir failure'); } });
assert.equal(blocked.status, 'failed');
assert.equal(blocked.scratch, undefined);
assert.equal(blocked.cleanup, 'not-created');
assert.equal(blocked.fallbackArtifacts.length, 2);
for (const path of blocked.fallbackArtifacts) assert.equal(existsSync(path), true);
results.push(blocked);
const run = async (scenario, options) => {
  const item = { scenario, evidence: join(evidence, scenario) };
  const started = performance.now();
  await executeScenario(item, { entry, timeoutMs: 400, graceMs: 150, forwardOutput: false, ...options });
  item.elapsedMs = Math.round(performance.now() - started);
  assert.ok(item.elapsedMs < 10000, 'Runner must finish within its deadline and bounded cleanup');
  assert.equal(item.status, 'failed');
  assert.ok(existsSync(join(item.evidence, 'output.log')), 'Failure must retain output');
  assert.ok(existsSync(join(item.evidence, 'runner.json')), 'Failure must retain runner summary');
  results.push(item);
  return item;
};
const partial = await run('partial-environment', {
  environmentFactory: prefix => {
    mkdirSync(resolve('.tmp', `${prefix}-partial`));
    throw new Error('Injected environment preparation failure');
  },
  commandFactory: () => { throw new Error('Must not launch after preparation failure'); },
});
assert.match(partial.error, /Injected environment/);
assert.equal(partial.cleanup, 'removed');
assert.equal(existsSync(partial.scratch), false);

const startup = await run('missing-executable', {
  commandFactory: () => [join(evidence, 'does-not-exist')],
});
assert.match(startup.error, /ENOENT/);
assert.equal(startup.cleanup, 'removed');
assert.equal(existsSync(startup.scratch), false);

const graceful = await run('never-exits-until-term', {
  commandFactory: (_scratch, output) => [process.execPath, '-e', `
    const fs = require('node:fs');
    console.log('fixture ready');
    process.on('SIGTERM', () => {
      fs.writeFileSync(${JSON.stringify(join(output, 'journey.json'))}, JSON.stringify({ processStopped: true }));
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  `],
});
assert.equal(graceful.timedOut, true);
assert.equal(graceful.cleanup, 'removed');
assert.match(readFileSync(join(graceful.evidence, 'output.log'), 'utf8'), /fixture ready/);

const forced = await run('ignores-term', {
  commandFactory: () => [process.execPath, '-e', `
    console.log('ignoring TERM');
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `],
});
assert.equal(forced.timedOut, true);
assert.equal(forced.process.groupStopped, true);
assert.equal(forced.cleanup, 'unverified');
assert.equal(existsSync(forced.scratch), true, 'Missing journey must retain scratch');

const malformed = await run('cleanup-error', {
  commandFactory: (scratch, output) => [process.execPath, '-e', `
    const fs = require('node:fs');
    console.log('cleanup fixture ran');
    fs.writeFileSync(${JSON.stringify(join(scratch, 'owned-processes.json'))}, 'invalid JSON');
    fs.writeFileSync(${JSON.stringify(join(output, 'journey.json'))}, JSON.stringify({ processStopped: true }));
  `],
});
assert.equal(malformed.cleanup, 'unverified');
assert.ok(malformed.cleanupErrors.length > 0);
assert.match(readFileSync(join(malformed.evidence, 'output.log'), 'utf8'), /cleanup fixture ran/);
// These fixtures spawn no descendants; their verified stopped groups permit test cleanup.
for (const item of [forced, malformed]) {
  assert.equal(item.process.groupStopped, true);
  rmSync(item.scratch, { recursive: true, force: true });
  item.testCleanup = 'removed-after-retention-assertion';
}
writeFileSync(join(evidence, 'regression.json'), JSON.stringify({ passed: true, results }, null, 2));
console.log(JSON.stringify({ passed: true, evidence, cases: results.length }));
