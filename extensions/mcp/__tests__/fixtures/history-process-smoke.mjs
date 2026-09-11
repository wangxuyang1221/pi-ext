import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HistoryHandoff } from '../../dist/history-handoff.js';

if (process.argv[2] === '--child') {
  const handoff = new HistoryHandoff(process.env.PI_CODING_AGENT_DIR);
  handoff.publish([{ fullName: `mcp__process__${process.pid}` }]);
  process.send({ path: handoff.path, pid: process.pid });
  process.once('message', () => {
    process.send({ identities: handoff.consume() });
    process.disconnect();
  });
} else {
  mkdirSync('.tmp', { recursive: true });
  const dir = mkdtempSync(resolve('.tmp/mcp-process-'));
  const children = [];
  try {
    const ready = [];
    for (let i = 0; i < 2; i++) {
      const child = fork(fileURLToPath(import.meta.url), ['--child'], {
        env: { ...process.env, PI_CODING_AGENT_DIR: dir, HOME: dir, TMPDIR: dir, JITI_FS_CACHE: dir },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      children.push(child);
      ready.push((await once(child, 'message'))[0]);
    }
    for (const item of ready) utimesSync(item.path, new Date(0), new Date(0));
    assert.deepEqual(new HistoryHandoff(dir).consume(), []);
    for (const item of ready) {
      assert.ok(existsSync(item.path));
      assert.deepEqual(new HistoryHandoff(dir, `${item.pid}-different-boot`).consume(), []);
    }
    for (const child of children) {
      const response = once(child, 'message');
      const exit = once(child, 'exit');
      child.send('consume');
      assert.deepEqual((await response)[0].identities, [{ fullName: `mcp__process__${child.pid}` }]);
      assert.equal((await exit)[0], 0);
    }
    assert.deepEqual(readdirSync(join(dir, 'mcp-history')), []);
    console.log(JSON.stringify({ child_pids_exited: children.map(child => child.pid), files: 0, ports: [] }));
  } finally {
    for (const child of children) {
      if (child.exitCode === null) {
        const exit = once(child, 'exit');
        child.kill('SIGKILL');
        await exit;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
