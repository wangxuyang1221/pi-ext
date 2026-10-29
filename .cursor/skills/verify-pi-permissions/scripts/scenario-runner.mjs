import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createTestEnvironment } from '../../../../test-support/environment.mjs';
import { stopProcessGroup } from '../../../../scripts/codex-compact-quality-process.mjs';
import { stopRecordedPtyOwners } from '../../verify-pi-ext/scripts/runtime-support.mjs';

async function bounded(promise, duration, signal) {
  let timer, listener;
  try {
    return await Promise.race([promise, new Promise(resolve => {
      timer = setTimeout(() => resolve({ timedOut: true }), duration);
      listener = () => resolve({ interrupted: true });
      if (signal?.aborted) listener();
      else signal?.addEventListener('abort', listener, { once: true });
    })]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', listener);
  }
}

function terminate(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export async function executeScenario(item, { commandFactory, entry, signal, timeoutMs,
  graceMs = 2000, environmentFactory = createTestEnvironment, forwardOutput = true, onUpdate = () => {} } = {}) {
  const prefix = `permissions-journey-${randomUUID()}`;
  const output = item.evidence;
  let child, isolated, closed, outputLog = '';
  item.timeoutMs = timeoutMs;
  item.status = 'running';
  item.cleanupErrors = [];
  try {
    mkdirSync(output, { recursive: true });
    isolated = environmentFactory(prefix);
    item.scratch = isolated.directory;
    item.command = commandFactory(isolated.directory, output);
    if (signal?.aborted) throw new Error('Verification interrupted before launch');
    child = spawn(item.command[0], item.command.slice(1), { env: { ...isolated.env,
      PI_PERMISSIONS_VERIFY_ENTRY: resolve(entry) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    item.pid = child.pid;
    let spawnError;
    child.on('error', error => { spawnError = error; });
    closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, spawnError })));
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', chunk => { outputLog += chunk; if (forwardOutput) target.write(chunk); });
    }
    onUpdate();
    let outcome = await bounded(closed, timeoutMs, signal);
    if (outcome.timedOut || outcome.interrupted) {
      Object.assign(item, outcome);
      terminate(child);
      outcome = await bounded(closed, graceMs);
    }
    if (outcome.spawnError) throw outcome.spawnError;
    Object.assign(item, { code: outcome.code, signal: outcome.signal });
    if (item.timedOut) throw new Error(`Scenario exceeded ${timeoutMs}ms deadline`);
    if (item.interrupted) throw new Error('Verification interrupted');
    if (outcome.code !== 0) throw new Error(`Scenario exited with ${outcome.code ?? outcome.signal}`);
    item.status = 'passed';
  } catch (error) {
    item.status = 'failed'; item.error = error.stack;
  } finally {
    // An environment factory can fail after mkdtemp but before returning its directory.
    if (!item.scratch) {
      try {
        const partial = readdirSync(resolve('.tmp')).filter(name => name.startsWith(`${prefix}-`));
        if (partial.length === 1) item.scratch = resolve('.tmp', partial[0]);
        else if (partial.length > 1) item.cleanupErrors.push('Multiple partial isolation directories');
      } catch (error) { item.cleanupErrors.push(String(error)); }
    }
    if (child?.pid) {
      try { item.process = await stopProcessGroup(child, { graceMs: 0 }); }
      catch (error) { item.cleanupErrors.push(String(error)); }
      // Closing the driver group does not close separately owned PTY/CLI groups.
      if (item.scratch && existsSync(join(item.scratch, 'owned-processes.json'))) {
        try {
          const pids = JSON.parse(readFileSync(join(item.scratch, 'owned-processes.json'), 'utf8'));
          item.owners = await stopRecordedPtyOwners(pids);
        } catch (error) { item.cleanupErrors.push(String(error)); }
      }
      const finalClose = await bounded(closed, 1000);
      if (finalClose.timedOut) {
        item.cleanupErrors.push('Driver close not observed after forced cleanup');
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
      } else Object.assign(item, { code: finalClose.code, signal: finalClose.signal });
    } else item.process = { notStarted: true, groupStopped: true };
    let journey = {};
    try {
      if (existsSync(join(output, 'journey.json'))) journey = JSON.parse(readFileSync(join(output, 'journey.json'), 'utf8'));
    } catch (error) { item.cleanupErrors.push(String(error)); }
    const stopped = item.process?.groupStopped && (!child?.pid || journey.processStopped)
      && (!item.owners || item.owners.groupStopped) && item.cleanupErrors.length === 0;
    if (stopped) {
      try {
        if (item.scratch) rmSync(item.scratch, { recursive: true, force: true });
        item.cleanup = item.scratch ? 'removed' : 'not-created';
      } catch (error) { item.cleanupErrors.push(String(error)); item.cleanup = 'unverified'; }
    } else item.cleanup = 'unverified';
    if (item.cleanup === 'unverified') item.status = 'failed';
    // Persist each artifact independently so cleanup failures cannot hide the original error.
    for (const name of ['output.log', 'runner.json']) {
      const value = name === 'output.log' ? outputLog : JSON.stringify(item, null, 2);
      try { writeFileSync(join(output, name), value); }
      catch (error) {
        item.cleanupErrors.push(String(error));
        const fallback = join(dirname(output), `${basename(output)}.${name}`);
        try {
          writeFileSync(fallback, value);
          (item.fallbackArtifacts ??= []).push(fallback);
        } catch (fallbackError) { item.cleanupErrors.push(String(fallbackError)); }
      }
    }
    if (item.cleanupErrors.length) item.status = 'failed';
  }
  return item;
}
