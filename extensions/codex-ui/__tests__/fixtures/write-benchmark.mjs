// Run after build with the baseline or current compiled tools module as the first argument.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initTheme, ToolExecutionComponent } from '@earendil-works/pi-coding-agent';

const { registerCodexTools } = await import(pathToFileURL(resolve(process.argv[2])).href);
initTheme('dark', false);
const sample = process.argv[3] ?? 'short';
const samples = {
  short: ['const value = 1;\n', 'const value = 2;\n'],
  lines1800: [
    Array.from({ length: 1800 }, (_, i) => `const old${i} = ${i};\n`).join(''),
    Array.from({ length: 1800 }, (_, i) => `const new${i} = ${i};\n`).join(''),
  ],
  token50k: ['a'.repeat(50 * 1024), 'b'.repeat(50 * 1024)],
};
const [oldContent, content] = samples[sample];
const cwd = await mkdtemp(resolve('.scratch/write-bench-'));
const ms = (start) => +(performance.now() - start).toFixed(2);
try {
  const registered = [];
  registerCodexTools({ registerTool(tool) { registered.push(tool); }, on() {} });
  const write = registered.find(tool => tool.name === 'write');
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await writeFile(join(cwd, 'file.ts'), oldContent);
    const args = { path: 'file.ts', content };
    let requests = 0;
    const row = new ToolExecutionComponent('write', `bench-${i}`, args, { showImages: false }, write,
      { requestRender() { requests++; } }, cwd);
    row.setArgsComplete(); row.markExecutionStarted();
    let start = performance.now();
    for (let j = 0; j < 100; j++) row.render(92);
    const pendingMs = ms(start);
    start = performance.now();
    const result = await write.execute(`bench-${i}`, args, undefined, undefined, { cwd });
    const executeMs = ms(start);
    start = performance.now();
    row.updateResult({ ...result, isError: false });
    row.setExpanded(false); row.render(92);
    const collapsedMs = ms(start);
    start = performance.now();
    row.setExpanded(true); row.render(92);
    const expandedMs = ms(start);
    start = performance.now();
    for (let j = 0; j < 100; j++) { row.invalidate(); row.render(92); }
    const repeatMs = ms(start);
    if (await readFile(join(cwd, 'file.ts'), 'utf8') !== content) throw new Error('Unexpected written content');
    runs.push({ pendingMs, executeMs, collapsedMs, expandedMs, repeatMs, requests,
      detailsBytes: Buffer.byteLength(JSON.stringify(result.details) ?? '') });
  }
  console.log(JSON.stringify({ module: process.argv[2], node: process.version, sample, width: 92,
    maxRssKiB: process.resourceUsage().maxRSS, runs }));
} finally { await rm(cwd, { recursive: true, force: true }); }
