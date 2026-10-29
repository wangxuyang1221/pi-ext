#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve('.tmp/test-results'), { recursive: true });
const evidence = mkdtempSync(resolve('.tmp/test-results/permissions-regression-'));
const copy = join(evidence, 'mutated-source');
cpSync(resolve('extensions/permissions/src'), copy, { recursive: true });
const policy = join(copy, 'permission-policy.ts');
const original = readFileSync(policy, 'utf8');
const needle = '  return { block: true, reason: "Blocked by user" };\n}';
assert.equal(original.split(needle).length, 2, 'Deny mutation target must be unique');
writeFileSync(policy, original.replace(needle, '  return undefined;\n}'));
const results = [];
for (const [name, entry] of [['baseline', resolve('extensions/permissions/src/index.ts')],
  ['deny-disabled', join(copy, 'index.ts')]]) {
  const command = [process.execPath, join(here, 'run.mjs'), 'deny-probe'];
  const child = spawn(command[0], command.slice(1), { env: { ...process.env, PI_PERMISSIONS_VERIFY_ENTRY: entry },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
  const [code] = await once(child, 'close');
  writeFileSync(join(evidence, `${name}.log`), output);
  const location = JSON.parse(output.split('\n').find(line => line.startsWith('{"evidence":'))).evidence;
  const summary = JSON.parse(readFileSync(join(location, 'summary.json'), 'utf8'));
  const journey = JSON.parse(readFileSync(join(location, 'deny-probe/journey.json'), 'utf8'));
  assert.equal(summary.scenarios[0].cleanup, 'removed', 'Probe cleanup must complete');
  if (name === 'baseline') assert.equal(code, 0, 'Baseline deny must pass');
  else {
    assert.notEqual(code, 0, 'Disabled deny must fail the same driver');
    assert.ok(journey.results.some(result => result.name === 'write-denied-unchanged' && !result.passed),
      'Mutation must fail on actual denied side effects');
    assert.ok(journey.actions.some(action => action.afterFiles?.['denied.txt'] === 'must not exist\n'),
      'Mutation must record the forbidden file bytes');
  }
  results.push({ name, command, entry, code, evidence: location, cleanup: 'removed' });
}
writeFileSync(join(evidence, 'regression.json'), JSON.stringify({ passed: true, mutation: 'Deny returns allow in private source copy',
  productionChanged: false, results }, null, 2));
console.log(JSON.stringify({ passed: true, evidence }));
