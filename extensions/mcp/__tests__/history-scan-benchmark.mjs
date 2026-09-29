// Synthetic files only. Each scan runs in a fresh process to isolate peak RSS.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const mib = 1024 * 1024;
if (process.argv[2] === '--worker') {
  const { readHistoryIdentities } = await import('../dist/history.js');
  const [file, recordMiB, count] = process.argv.slice(3);
  // Independent JSON decode cost plus generous async-I/O scheduling allowance.
  const sample = JSON.stringify({ data: 'A'.repeat(Number(recordMiB) * mib) });
  const decodeStart = performance.now();
  for (let i = 0; i < 3; i++) JSON.parse(sample);
  const decodeMs = (performance.now() - decodeStart) / 3;
  global.gc?.();
  const baseline = process.memoryUsage().rss;
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  const start = performance.now();
  const identities = await readHistoryIdentities(file);
  const elapsedMs = performance.now() - start;
  clearInterval(timer);
  const peak = process.resourceUsage().maxRSS * 1024;
  const extraMiB = Math.max(0, peak - baseline) / mib;
  const memoryLimitMiB = 64 + 6 * Number(recordMiB);
  const timeLimitMs = 500 + Number(count) * (5 * decodeMs + 4 * Number(recordMiB));
  console.log(JSON.stringify({ totalMiB: Number(recordMiB) * Number(count), recordMiB: Number(recordMiB), elapsedMs, extraMiB, ticks,
    identities: identities.length, decodeMs, memoryLimitMiB, timeLimitMs,
    passed: identities.length === 1 && ticks > 1 && extraMiB < memoryLimitMiB && elapsedMs < timeLimitMs }));
} else {
  mkdirSync('.tmp', { recursive: true });
  const root = mkdtempSync(resolve('.tmp/history-scan-'));
  let failed = false;
  try {
    for (const [recordMiB, count] of [[1, 32], [1, 65], [1, 120], [32, 4]]) {
      const file = join(root, 'session.jsonl');
      writeFileSync(file, '');
      const row = JSON.stringify({ type: 'message', message: { role: 'toolResult', toolName: 'mcp__fixture__image',
        content: [{type:'image', mimeType:'image/png', data:'A'.repeat(recordMiB * mib)}] } }) + '\n';
      for (let i = 0; i < count; i++) appendFileSync(file, row);
      const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', file, String(recordMiB), String(count)], { encoding:'utf8' });
      if (child.status !== 0) throw new Error(child.stderr || `Worker exit ${child.status}`);
      const result = JSON.parse(child.stdout);
      console.log(JSON.stringify(result));
      failed ||= !result.passed;
    }
  } finally { rmSync(root, { recursive:true, force:true }); }
  if (failed && process.argv.includes('--check')) process.exitCode = 1;
}
