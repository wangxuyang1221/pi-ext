import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepare } from './prepare.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
await mkdir(join(repo, '.tmp'), { recursive: true });
const root = await mkdtemp(join(repo, '.tmp/tool-icon-'));
const handlers = new Map();
try {
  for (const dir of ['workspace', 'home', 'tmp', 'agent', 'sessions', 'runtime']) await mkdir(join(root, dir));
  await prepare(repo, join(root, 'runtime'), process.argv.includes('--before'), process.argv.includes('--symbols'));
  const env = Object.fromEntries(['PATH', 'TERM', 'COLORTERM', 'LANG', 'LC_ALL'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, {
    HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), PI_CODING_AGENT_DIR: join(root, 'agent'),
    PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions'), PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0', TOOL_STATUS_ROOT: root, TOOL_STATUS_REPO: repo,
    TOOL_STATUS_PRODUCTION: '1', TOOL_STATUS_FULLSCREEN: process.argv.includes('--fullscreen') ? '1' : '0',
  });
  const child = spawn(process.execPath, [join(root, 'runtime/runtime.mjs')], { cwd: join(root, 'workspace'), env, stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.exitCode = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', code => done(code ?? 1));
  });
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(root, { recursive: true, force: true });
}
