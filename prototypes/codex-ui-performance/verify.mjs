import assert from 'node:assert/strict';
import path from 'node:path';
import { setTheme, setThemeInstance, loadThemeFromPath } from '@earendil-works/pi-coding-agent';
import { verifyTerminal } from './verify-terminal.mjs';
import { fitToWidth as originalFit } from './.generated/before/layout.js';
import { fitToWidth as optimizedFit } from './.generated/after/layout.js';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { cwd, definitions, fixtures, textResult, restoreClock, save } from './shared.mjs';

function compareRows(rows, width, label, groupedBash = false) {
  const before = rows[0].render(width);
  const after = rows[1].render(width);
  const write = rows[1].toolName === 'write';
  if (!groupedBash && !write) return assert.deepEqual(after, before, label);
  // Changed contracts compare warmed state with a fresh host row and explicit visible requirements.
  const owner = definitions('after');
  try {
    const source = rows[1];
    const fresh = owner.row(write ? 'write' : 'bash', source.args);
    fresh.setExpanded(source.expanded);
    if (source.executionStarted) fresh.markExecutionStarted();
    if (source.argsComplete) fresh.setArgsComplete();
    if (source.result) fresh.updateResult(source.result, source.isPartial);
    assert.deepEqual(after, fresh.render(width), `${label}/fresh-grouped-layout`);
    assert.ok(after.every(line => visibleWidth(line) <= width), `${label}/width`);
    if (source.result) assert.deepEqual(source.resultRendererComponent?.render(width), [], `${label}/single-carrier`);
    if (write) {
      assert.doesNotMatch(after.map(stripTerminalSequences).join('\n'), /Written|Writing|bytes/u);
      if (width >= 120 && source.result && !source.isPartial && !source.result.isError && typeof source.args.content === 'string') {
        const count = source.args.content.length ? source.args.content.split('\n').length : 0;
        assert.match(after.map(stripTerminalSequences).join('\n'), new RegExp(`\\(${count} lines?\\)`));
      }
    }
  } finally { owner.dispose(); }
}

const readFixture = { id: 'read-unicode', name: 'read', args: { path: 'fixture.ts', offset: 3, limit: 40 },
  result: textResult('alpha\n中文\nlast line') };
const widths = [1, 2, 4, 9, 10, 30, 71, 72, 119, 120, 121, 300];
const samples = ['', 'a', ' 中文\tvalue ', 'e\u0301👨‍👩‍👧‍👦 🇨🇳', '\x1b[31mred\x1b[0m text',
  '\x1b]8;;https://example.com\x07link\x1b]8;;\x07', '\ud800bad\ufff9text\x00\r\nlast'];
let checks = 0;
try {
  for (const text of samples) for (const width of widths) for (const pad of [false, true]) {
    for (const ellipsis of ['', '...', '…']) {
      assert.equal(optimizedFit(text, width, { pad, ellipsis }), originalFit(text, width, { pad, ellipsis }));
      checks++;
    }
  }
  const edgeCases = samples.map((text, index) => ({
    id: `edge-${index}`, name: 'bash', args: { command: text + 'a'.repeat(1000) }, result: textResult(text + '\n' + text.repeat(200)),
  }));
  for (const theme of ['dark', 'light']) {
    setTheme(theme, false);
    for (const fixture of [...fixtures.filter(f => f.id !== 'edit-10000'), readFixture, ...edgeCases]) {
      const current = definitions('before');
      const optimized = definitions('after');
      try {
        const rows = [current, optimized].map(definition => definition.row(fixture.name, fixture.args));
        for (const row of rows) { row.updateResult(fixture.result); row.setArgsComplete(); }
        for (const expanded of [false, true, false, true]) {
          for (const row of rows) row.setExpanded(expanded);
          for (const width of widths) {
            compareRows(rows, width, `${fixture.id}/${theme}/${expanded}/${width}`, fixture.name === 'bash');
            checks++;
          }
        }
      } finally { current.dispose(); optimized.dispose(); }
    }
  }
  // Exercise replaced, not merely append-only output; warning-only changes; partial/final transitions.
  for (const expanded of [false, true]) {
    const owners = [definitions('before'), definitions('after')];
    try {
      const rows = owners.map(owner => owner.row('bash', { command: 'printf sample' }));
      for (const row of rows) { row.setExpanded(expanded); row.setArgsComplete(); row.markExecutionStarted(); }
      for (let index = 0; index < 35; index++) {
        const output = index % 3 ? `prefix\t中文\n${'x'.repeat(index * 37)}` : 'replaced entirely';
        const result = textResult(output, { fullOutputPath: index % 2 ? '/fixture/log' : undefined,
          truncation: { truncated: index % 2 === 1, truncatedBy: 'bytes', outputLines: 1, totalLines: 2, maxBytes: 51200 } });
        for (const row of rows) row.updateResult(result, index < 34);
        if (index % 5) continue;
        for (const width of [4, 40, 120]) {
          compareRows(rows, width, `output revision/${index}/${expanded}/${width}`, true);
          checks++;
        }
      }
    } finally { for (const owner of owners) owner.dispose(); }
  }
  for (const withResult of [false, true]) for (const argsComplete of [false, true]) {
    const owners = [definitions('before'), definitions('after')];
    try {
      const rows = owners.map(owner => owner.row('write', { path: 'fixture.ts' }));
      for (const content of [undefined, '', 'one', 'one\n', '\n\n', '中文\ud800', null, [], 123, 'last\nline']) {
        for (const row of rows) {
          row.updateArgs({ path: 'fixture.ts', content });
          if (argsComplete) row.setArgsComplete();
          if (withResult) row.updateResult(textResult('partial'), true);
        }
        for (const width of [1, 40, 120]) {
          compareRows(rows, width, `write revision/${String(content)}/${width}`);
          checks++;
        }
      }
    } finally { for (const owner of owners) owner.dispose(); }
  }
  // The actual upstream highlighter reads this same stable theme proxy, not a mock palette.
  const palette = loadThemeFromPath(path.join(cwd, 'themes/codex-pi.json'), 'truecolor');
  let keyword = 196;
  setThemeInstance(new Proxy(palette, {
    get(target, property) {
      if (property === 'fg') return (name, text) => name === 'syntaxKeyword'
        ? `\x1b[38;5;${keyword}m${text}\x1b[39m` : target.fg(name, text);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
  const syntaxOwner = definitions('after');
  try {
    const fixture = fixtures.find(fixture => fixture.id === 'edit-1000');
    const row = syntaxOwner.row('edit', fixture.args);
    row.updateResult(fixture.result); row.setExpanded(true);
    const original = row.render(120);
    keyword = 82;
    row.invalidate();
    const changed = row.render(120);
    const fresh = syntaxOwner.row('edit', fixture.args);
    fresh.updateResult(fixture.result); fresh.setExpanded(true);
    assert.deepEqual(changed, fresh.render(120));
    assert.notDeepEqual(changed, original);
    checks++;
  } finally { syntaxOwner.dispose(); setTheme('dark', false); }
  for (const fixture of [...fixtures, readFixture]) {
    const owners = [definitions('before', { isLowPowerEnabled: () => true }), definitions('after', { isLowPowerEnabled: () => true })];
    try {
      const rows = owners.map(owner => owner.row(fixture.name, fixture.args));
      for (const row of rows) { row.updateResult(fixture.result); row.setArgsComplete(); }
      for (const expanded of [false, true]) for (const width of widths) {
        for (const row of rows) row.setExpanded(expanded);
        compareRows(rows, width, `low-power/${fixture.id}/${expanded}/${width}`);
        checks++;
      }
    } finally { for (const owner of owners) owner.dispose(); }
  }
  const terminal = await verifyTerminal();
  const report = { environment: JSON.parse(process.env.PI_PERF_SOURCES), agentVersion: process.env.PI_PERF_AGENT_VERSION, passedFrameAndFitComparisons: checks, terminal };
  save(`verification-${process.env.PI_PERF_AGENT_VERSION}.json`, report);
  console.log(`Passed ${checks} frame/fit comparisons and ${terminal.length} parsed terminal frames.`);
} finally { restoreClock(); }
