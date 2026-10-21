import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
await mkdir(join(repo, '.tmp'), { recursive: true });
const root = await mkdtemp(join(repo, '.tmp/codemode-production-'));
const handlers = new Map();
let child, stopping = false;
try {
  for (const dir of ['workspace', 'home', 'tmp', 'agent', 'sessions']) await mkdir(join(root, dir));
  const env = Object.fromEntries(['PATH', 'TERM', 'COLORTERM', 'LANG', 'LC_ALL'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions'), PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', CODEMODE_UI_ROOT: root });
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
    const handler = () => { stopping = true; child?.kill(signal); }; handlers.set(signal, handler); process.on(signal, handler);
  }
  for (let attempt = 0; attempt < (process.argv.includes('--restart') ? 2 : 1) && !stopping; attempt++) {
    child = spawn(process.execPath, [join(here, 'codemode-runtime.mjs'), ...process.argv.slice(2)], { cwd: join(root, 'workspace'), env: { ...env, CODEMODE_RESUME: attempt ? '1' : '0' }, stdio: 'inherit' });
    process.exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => done(code ?? 1)); });
    if (process.exitCode !== 0) break;
  }
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(root, { recursive: true, force: true });
}
