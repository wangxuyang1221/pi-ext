import assert from 'node:assert/strict';
import { cwd, definitions, fixtures, variants, save, restoreClock } from './shared.mjs';
import { loadThemeFromPath, setThemeInstance } from '@earendil-works/pi-coding-agent';
import path from 'node:path';
setThemeInstance(loadThemeFromPath(path.join(cwd, 'themes/codex-pi.json'), 'truecolor'));
const report = { environment: JSON.parse(process.env.PI_PERF_SOURCES), cycles: 24, rowCount: 20, cases: [] };
try {
  for (const fixture of fixtures.filter(item => item.name === 'read')) for (const variant of variants) {
    globalThis.gc?.(); const initial = process.memoryUsage();
    const owner = definitions(variant);
    owner.declareGroup('read', 20);
    const rows = Array.from({ length: 20 }, (_, index) => owner.row('read', { path: `memory/${index}.txt` }));
    const samples = [];
    try {
      for (let cycle = 0; cycle < 24; cycle++) {
        rows.forEach((row, index) => row.updateResult({ content: [{ type: 'text', text: `${cycle}/${index}\n${fixture.result.content[0].text}` }], isError: false }));
        for (const expanded of [false, true, false]) {
          rows.forEach(row => row.setExpanded(expanded));
          for (const width of [120, 30, 120]) rows.forEach(row => row.render(width));
        }
        const peak = process.memoryUsage(); globalThis.gc?.();
        const cache = owner.stats();
        if (cache) for (const value of Object.values(cache)) assert(value.chargedBytes <= value.limitBytes);
        samples.push({ cycle, peak, afterGc: process.memoryUsage(), cache });
      }
    } finally { owner.dispose(); rows.length = 0; }
    globalThis.gc?.(); const cleared = owner.stats();
    if (cleared) assert(Object.values(cleared).every(value => value.chargedBytes === 0));
    report.cases.push({ fixture: fixture.id, variant, initial, samples, cleared, afterDispose: process.memoryUsage() });
    console.log(`Measured Read memory ${fixture.id}/${variant}`);
    save(`read-memory-${process.env.PI_PERF_AGENT_VERSION}.json`, report);
  }
} finally { restoreClock(); }
