import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { definitions, variants, editFixture, textResult, cpuMilliseconds, restoreClock, save } from './shared.mjs';

if (!globalThis.gc) throw new Error('Memory benchmark requires node --expose-gc');
const collect = async () => {
  await new Promise(resolve => setImmediate(resolve));
  globalThis.gc(); globalThis.gc();
  return process.memoryUsage();
};
const report = { environment: JSON.parse(process.env.PI_PERF_SOURCES), node: process.version,
  note: 'Fixed 20 live rows; budgets charge text and estimated entry overhead, not V8 heap/RSS.', samples: [] };
try {
  for (const variant of variants) {
    let owner = definitions(variant);
    let rows = Array.from({ length: 20 }, (_, index) => {
      const row = owner.row(index % 2 ? 'edit' : 'bash', index % 2 ? { path: 'fixture.ts', edits: [] } : { command: `sample-${index}` });
      row.setExpanded(true);
      return row;
    });
    const initial = await collect();
    const cycles = [];
    let peakHeap = initial.heapUsed;
    let peakRss = initial.rss;
    for (let cycle = 0; cycle < 24; cycle++) {
      const cpu = process.cpuUsage();
      const start = performance.now();
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const marker = `revision_${cycle}_${index}`;
        const result = index % 2 ? editFixture(1000).result : textResult(Array.from({ length: 1800 }, (_, line) => `${marker} output ${line}`).join('\n'));
        if (index % 2) {
          result.details.diff = result.details.diff.replaceAll('value', marker);
          result.details.patch = result.details.patch.replaceAll('value', marker);
        }
        row.updateResult(result);
        row.setExpanded(false); row.render(120);
        row.setExpanded(true);
        for (const width of [120, 119, 121, 120]) row.render(width);
        const current = process.memoryUsage();
        peakHeap = Math.max(peakHeap, current.heapUsed);
        peakRss = Math.max(peakRss, current.rss);
      }
      const wallMs = performance.now() - start;
      const cpuMs = cpuMilliseconds(cpu);
      const cache = owner.stats();
      for (const bucket of Object.values(cache ?? {})) assert.ok(bucket.chargedBytes <= bucket.limitBytes);
      cycles.push({ cycle, wallMs, cpuMs, cache, memory: await collect() });
    }
    const beforeClear = owner.stats();
    if (variant === 'after') {
      assert.ok(beforeClear.layouts.evictions > 20);
      // Grouped Bash no longer counts wrapped output for the collapsed summary.
      assert.ok(beforeClear.counts.chargedBytes <= beforeClear.counts.limitBytes);
    }
    owner.reset();
    const clearedCache = owner.stats();
    if (clearedCache) for (const bucket of Object.values(clearedCache)) assert.equal(bucket.chargedBytes, 0);
    const clearedWithLiveRows = await collect();
    owner.dispose(); rows = undefined; owner = undefined;
    const released = await collect();
    report.samples.push({ variant, initial, cycles, peakHeap, peakRss, clearedCache, clearedWithLiveRows, released });
    console.log(`Completed memory churn: ${variant}`);
  }
  save(`memory-${process.env.PI_PERF_AGENT_VERSION}.json`, report);
} finally { restoreClock(); }
