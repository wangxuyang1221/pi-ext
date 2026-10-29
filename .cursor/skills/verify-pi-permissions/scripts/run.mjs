#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeScenario } from './scenario-runner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const requested = process.argv[2] ?? 'all';
assert.ok(['all', 'matrix', 'capacity', 'headless', 'deny-probe'].includes(requested), 'Expected all, matrix, capacity, headless, or deny-probe');
assert.equal(resolve(here, '../../../..'), process.cwd(), 'Run from the repository root');
const scenarios = requested === 'all' ? ['matrix', 'capacity', 'headless'] : [requested];
mkdirSync(resolve('.tmp/test-results'), { recursive: true });
const evidence = mkdtempSync(resolve('.tmp/test-results/permissions-journeys-'));
const summary = { command: process.argv, evidence, entry: process.env.PI_PERMISSIONS_VERIFY_ENTRY ?? 'extensions/permissions/src/index.ts', scenarios: [], status: 'running' };
console.log(JSON.stringify({ evidence, scenarios }));
const abort = new AbortController();
const interrupt = () => abort.abort();
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
const save = () => writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
try {
  for (const scenario of scenarios) {
    const timeoutMs = Number(process.env.PI_PERMISSIONS_VERIFY_TIMEOUT_MS ?? (scenario === 'capacity' ? 600000 : 180000));
    assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'Invalid scenario timeout');
    const item = { scenario, evidence: join(evidence, scenario), status: 'preparing' };
    summary.scenarios.push(item); save();
    await executeScenario(item, { entry: summary.entry, signal: abort.signal, timeoutMs, onUpdate: save,
      commandFactory: (scratch, output) => scenario === 'headless'
        ? [process.execPath, join(here, 'headless.mjs'), scratch, output]
        : ['conda', 'run', '--no-capture-output', '-n', 'codex-py312', 'python', join(here, 'permissions-pty.py'), scenario, scratch, output] });
    save();
    assert.equal(item.cleanup, 'removed', 'Owned processes or scratch cleanup unverified');
    assert.equal(item.status, 'passed', `Scenario failed: ${scenario}`);
  }
  summary.status = 'passed';
} catch (error) {
  summary.status = 'failed'; summary.error = error.stack; process.exitCode = 1;
  console.error(error);
} finally {
  process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  save();
}
