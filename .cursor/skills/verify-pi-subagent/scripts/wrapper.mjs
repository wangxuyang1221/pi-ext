import { createTestEnvironment } from '../../../../test-support/environment.mjs';
import { stopProcessGroup } from '../../../../scripts/codex-compact-quality-process.mjs';
import { finishOutput } from '../../verify-pi-ext/scripts/runtime-support.mjs';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

function groupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}

/** Run one isolated journey and retain evidence whenever cleanup cannot be confirmed. */
export async function runJourney({ label = `subagent-pty-${Date.now()}`, mode = 'full',
  timeoutMs = 180_000, graceMs = 10_000, killWaitMs = 3000,
  command: selectCommand, createEnvironment = createTestEnvironment } = {}) {
  if (!['full', 'legacy', 'leave-fault'].includes(mode)) throw new Error('Journey mode must be full, legacy or leave-fault');
  if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Evidence label must be a simple name');
  if (![timeoutMs, graceMs, killWaitMs].every(value => Number.isFinite(value) && value >= 0) || !timeoutMs || !killWaitMs) throw new Error('Invalid wrapper deadlines');
  mkdirSync(resolve('.tmp/test-results'), { recursive: true });
  const evidence = resolve('.tmp/test-results', label);
  mkdirSync(evidence, { recursive: false });
  const proof = join(evidence, 'journey.json');
  const summary = { evidence, mode, status: 'running', interrupted: false, timedOut: false,
    allStopped: false, scratchRemoved: false, evidenceRetained: false, errors: [] };
  const save = () => writeFileSync(join(evidence, 'wrapper-cleanup.json'), JSON.stringify(summary, null, 2));
  let isolated, child, log, closed, timer, interruption;
  const stoppedProof = () => {
    try { return existsSync(proof) && JSON.parse(readFileSync(proof, 'utf8')).cleanup?.allStopped === true; }
    catch { return false; }
  };
  const abort = new Promise(resolveAbort => { interruption = reason => resolveAbort({ type: 'interrupted', reason }); });
  const onInt = () => interruption('SIGINT');
  const onTerm = () => interruption('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    save();
    log = createWriteStream(join(evidence, 'output.log'));
    log.on('error', error => interruption(`output error: ${String(error)}`));
    isolated = createEnvironment('sa-pty');
    summary.scratch = isolated.directory;
    writeFileSync(join(evidence, 'environment.json'), JSON.stringify({ scratch: isolated.directory, environmentKeys: Object.keys(isolated.env) }, null, 2));
    const command = selectCommand ? selectCommand(isolated.directory, evidence) : ['conda', 'run', '--no-capture-output', '-n', 'codex-py312', 'python',
      fileURLToPath(new URL('./driver.py', import.meta.url)), isolated.directory, evidence, mode];
    summary.command = command;
    console.log(JSON.stringify({ evidence, scratch: isolated.directory }));
    child = spawn(command[0], command.slice(1), { env: isolated.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    closed = new Promise(resolveClose => child.once('close', resolveClose));
    summary.pid = child.pid;
    save();
    child.stdout.on('data', data => log.write(data));
    child.stderr.on('data', data => log.write(data));
    const completed = new Promise(resolveExit => {
      child.once('error', error => resolveExit({ type: 'error', error }));
      child.once('exit', (code, signal) => resolveExit({ type: 'exit', code, signal }));
    });
    timer = setTimeout(() => interruption('timeout'), timeoutMs);
    const outcome = await Promise.race([completed, abort]);
    if (outcome.type === 'error') throw outcome.error;
    if (outcome.type === 'interrupted') {
      summary.interrupted = true;
      summary.timedOut = outcome.reason === 'timeout';
      summary.interruption = outcome.reason;
      throw new Error(`Journey interrupted: ${outcome.reason}`);
    }
    summary.exitCode = outcome.code;
    summary.signalCode = outcome.signal;
    if (outcome.code !== 0) throw new Error(`Journey exited with ${outcome.code ?? outcome.signal}`);
    summary.status = 'passed';
  } catch (error) {
    summary.status = 'failed';
    summary.errors.push({ stage: 'run', error: String(error) });
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    const stage = async (name, operation) => {
      try { await operation(); }
      catch (error) { summary.errors.push({ stage: name, error: String(error) }); }
    };
    await stage('process', async () => {
      if (!child?.pid) { summary.process = { groupStopped: true, spawned: false }; return; }
      if (summary.status === 'failed' && groupExists(child.pid)) {
        try { process.kill(-child.pid, 'SIGTERM'); }
        catch (error) {
          if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
          if (error.code === 'EPERM') summary.termError = String(error);
        }
        // Conda may exit before Python's finally. Give the whole group time to write proof.
        const deadline = performance.now() + graceMs;
        while (groupExists(child.pid) && !stoppedProof() && performance.now() < deadline) await delay(20);
      }
      summary.process = await stopProcessGroup(child, { graceMs: 200, killWaitMs });
      summary.exitCode ??= child.exitCode;
      summary.signalCode ??= child.signalCode;
    });
    await stage('output', () => finishOutput({ child, closed, log }));
    await stage('proof', async () => {
      summary.evidenceRetained = existsSync(proof);
      summary.allStopped = summary.process?.groupStopped === true && stoppedProof();
      if (!summary.allStopped) throw new Error('Driver cleanup proof is missing or incomplete; scratch retained');
    });
    if (summary.allStopped && !summary.errors.some(error => error.stage !== 'run')) await stage('scratch', async () => {
      if (isolated) rmSync(isolated.directory, { recursive: true, force: true });
    });
    summary.scratchRemoved = Boolean(isolated) && !existsSync(isolated.directory);
    await stage('diagnostics', async () => {
      if (summary.errors.length) appendFileSync(join(evidence, 'output.log'), summary.errors.map(error => `[wrapper:${error.stage}] ${error.error}\n`).join(''));
    });
    if (summary.errors.length) summary.status = 'failed';
    save();
    console.log(JSON.stringify(summary));
  }
  return summary;
}
