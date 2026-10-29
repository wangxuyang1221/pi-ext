import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { runJourney } from './wrapper.mjs';

const label = name => `subagent-wrapper-${name}-${randomUUID()}`;
const evidence = summary => JSON.parse(readFileSync(`${summary.evidence}/wrapper-cleanup.json`, 'utf8'));
const removeRetainedScratch = summary => {
  assert.equal(summary.process.groupStopped, true);
  if (summary.scratch) rmSync(summary.scratch, { recursive: true, force: true });
};

test('a spawn failure retains scratch and records ENOENT in summary and log', async () => {
  const result = await runJourney({ label: label('missing'), command: scratch => [`${scratch}/missing-command`] });
  try {
    assert.equal(result.status, 'failed');
    assert.equal(result.process.spawned, false);
    assert.equal(result.scratchRemoved, false);
    assert.ok(existsSync(result.scratch));
    assert.match(readFileSync(`${result.evidence}/output.log`, 'utf8'), /ENOENT/);
    assert.match(evidence(result).errors[0].error, /ENOENT/);
  } finally { removeRetainedScratch(result); }
});

test('a preparation failure still finishes summary and log without spawning', async () => {
  const result = await runJourney({ label: label('prepare'), createEnvironment() { throw new Error('Controlled preparation failure'); } });
  assert.equal(result.status, 'failed');
  assert.equal(result.process.spawned, false);
  assert.equal(result.pid, undefined);
  assert.match(readFileSync(`${result.evidence}/output.log`, 'utf8'), /Controlled preparation failure/);
  assert.equal(evidence(result).status, 'failed');
});

test('timeout force stops a driver that ignores TERM within the bounded grace', async () => {
  const started = performance.now();
  const result = await runJourney({ label: label('stubborn'), timeoutMs: 500, graceMs: 100, killWaitMs: 2000,
    command: () => [process.execPath, '-e', "process.on('SIGTERM',()=>console.log('TERM observed')); console.log('ready'); setInterval(()=>{},1000)"] });
  try {
    assert.equal(result.timedOut, true);
    assert.equal(result.process.groupStopped, true);
    assert.equal(result.process.signalCode, 'SIGKILL');
    assert.equal(result.scratchRemoved, false);
    assert.match(readFileSync(`${result.evidence}/output.log`, 'utf8'), /ready[\s\S]*TERM observed/);
    assert.ok(performance.now() - started < 6000);
    assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
    assert.equal(evidence(result).status, 'failed');
  } finally { removeRetainedScratch(result); }
});

test('a completed driver with cleanup proof removes scratch and preserves its log', async () => {
  const result = await runJourney({ label: label('normal'), command: (_scratch, output) => [process.execPath, '-e',
    "require('node:fs').writeFileSync(process.argv[1],JSON.stringify({cleanup:{allStopped:true}})); console.log('normal driver completed')", `${output}/journey.json`] });
  assert.equal(result.status, 'passed');
  assert.equal(result.allStopped, true);
  assert.equal(result.scratchRemoved, true);
  assert.equal(result.evidenceRetained, true);
  assert.match(readFileSync(`${result.evidence}/output.log`, 'utf8'), /normal driver completed/);
  assert.equal(evidence(result).status, 'passed');
});
